// tests/conversationApi.test.ts
// AI 회화 서버 디스패처, Gemini Interactions API 모의 규격, Fail-Closed 보안 가드 및 클라이언트 API 테스트

import { describe, it, expect, vi } from 'vitest';
import { handleConversationAction } from '../src/features/conversation/server/router';
import { onRequest as onPagesConversationRequest } from '../functions/api/conversation/[[action]]';
import type { ServerConfig, ServerAuthAdapter, ServerBudgetAdapter } from '../src/features/conversation/server/types';
import {
  ConversationApiClient,
  type UserConsent,
} from '../src/features/conversation/services/conversationApi';
import {
  GEMINI_CHAT_ENDPOINT,
  GEMINI_MODELS,
  callGeminiChatApi,
} from '../src/features/conversation/server/geminiInteractionsClient';
import { normalizeInteractionsAudioMime } from '../src/features/conversation/server/audioUtils';

describe('AI 회화 API 엔드포인트 및 모의 Interactions 규격 검증', () => {
  function createValidConfig(fetchFn?: typeof fetch): ServerConfig {
    const authAdapter: ServerAuthAdapter = {
      verifyCaller: vi.fn().mockResolvedValue({ authorized: true, callerId: 'user-valid' }),
    };

    const budgetAdapter: ServerBudgetAdapter = {
      reserve: vi.fn().mockResolvedValue({ allowed: true, remaining: 100 }),
      consume: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    return {
      allowExternalFreeGeminiCalls: true,
      geminiApiKey: 'test-valid-api-key-12345',
      isAdultConfirmed: true,
      isFreeTierProjectConfirmed: true,
      authAdapter,
      budgetAdapter,
      fetchFn,
    };
  }

  const validConsent: UserConsent = {
    isAdult: true,
    sendCurrentTurnOnlyAgreed: true,
    googleReviewDisclosureAgreed: true,
    noSensitiveInfoAgreed: true,
  };

  describe('0. Cloudflare Pages 엔트리포인트 자체 검증', () => {
    it('실제 Pages 엔트리([[action]].ts)는 기본적으로 어댑터 부재로 403 Fail-Closed 되어야 한다', async () => {
      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-pages-01',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await onPagesConversationRequest({
        request: req,
        env: {},
        params: { action: 'chat' },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.fallbackToRuleEngine).toBe(true);
    });
  });

  describe('1. Fail-Closed 보안 가드 및 전제 조건 검증', () => {
    it('외부 호출 허용 플래그가 false이면 403으로 차단되어야 한다', async () => {
      const config = createValidConfig();
      config.allowExternalFreeGeminiCalls = false;

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-1',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.errorMessage).toContain('비활성화');
      expect(data.fallbackToRuleEngine).toBe(true);
    });

    it('클라이언트의 userConsentToCloud가 false이거나 누락되면 upstream 0회로 403 차단되어야 한다', async () => {
      const mockFetch = vi.fn();
      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-no-consent',
          userConsentToCloud: false, // 동의 미제공
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled(); // upstream 0회
    });

    it('API Key가 누락되었거나 비어있으면 403으로 차단되어야 한다', async () => {
      const config = createValidConfig();
      config.geminiApiKey = '';

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-1',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(403);
    });

    it('성인 확인 또는 무료 티어 확인이 누락되면 403으로 차단되어야 한다', async () => {
      const config = createValidConfig();
      config.isAdultConfirmed = false;

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-1',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(403);
      expect((await res.json()).errorMessage).toContain('성인 사용자');
    });

    it('인증 어댑터가 없거나 인증 실패 시 401로 차단되어야 한다', async () => {
      const config = createValidConfig();
      config.authAdapter = {
        verifyCaller: vi.fn().mockResolvedValue({ authorized: false, reason: '토큰 만료' }),
      };

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-1',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(401);
      expect((await res.json()).errorMessage).toContain('토큰 만료');
    });

    it('예산 어댑터가 없거나 예약 한도 초과/중복 요청 시 429로 차단되어야 한다', async () => {
      const config = createValidConfig();
      config.budgetAdapter = {
        reserve: vi.fn().mockResolvedValue({ allowed: false, reason: '예산 한도 초과' }),
        consume: vi.fn(),
        release: vi.fn(),
      };

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-dup',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hi',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(429);
      expect((await res.json()).errorMessage).toContain('예산 한도 초과');
    });

    it('존재하지 않는 수업 ID나 리비전 불일치, 유효하지 않은 단계는 400으로 upstream 0회 거부되어야 한다', async () => {
      const mockFetch = vi.fn();
      const config = createValidConfig(mockFetch);

      const invalidReq = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'r-bad-lesson',
          userConsentToCloud: true,
          lessonId: 'non-existing-lesson',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'invalid_phase',
        }),
      });

      const res = await handleConversationAction(invalidReq, 'chat', config);
      expect(res.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('2. Chat generateContent API HTTP Shape 및 턴 평가(chat) 검증', () => {
    it('chat 요청 시 공식 gemini-3.5-flash-lite generateContent URL, lowthinking, x-goog-api-key 헤더가 올바르게 전송되어야 한다', async () => {
      let capturedUrl = '';
      let capturedOptions: RequestInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedUrl = String(_url);
        capturedOptions = options;

        const fakeModelOutput = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      evaluation: 'ACCEPT',
                      userSpokenText: 'Hello, I am Alex.',
                      isShortAnswer: false,
                      tutorResponseEn: 'Nice to meet you too! Welcome to the team.',
                      factualConsistency: { consistent: true },
                    }),
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };

        return new Response(JSON.stringify(fakeModelOutput), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-chat-test-01',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello, I am Alex.',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(200);

      const resData = await res.json();
      expect(resData.success).toBe(true);
      expect(resData.evaluation.evaluation).toBe('ACCEPT');

      // fetch Spy 검증: Interactions 대신 공식 generateContent 엔드포인트 호출 확인
      expect(GEMINI_MODELS.CHAT).toBe('gemini-3.5-flash-lite');
      expect(capturedUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
      );
      expect(capturedUrl).toBe(GEMINI_CHAT_ENDPOINT);
      expect((capturedOptions?.headers as any)['x-goog-api-key']).toBe('test-valid-api-key-12345');

      const sentBody = JSON.parse(capturedOptions?.body as string);
      expect(sentBody.contents[0].parts[0].text).toContain('intro-u01-l01');
      expect(sentBody.systemInstruction.parts[0].text).toContain('professional, encouraging');
      expect(sentBody.generationConfig.responseMimeType).toBe('application/json');
      expect(sentBody.generationConfig.responseSchema).toBeDefined();
      expect(sentBody.generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');
      expect(sentBody.generationConfig.maxOutputTokens).toBe(1024);
    });

    it('해당 차시 과제에 부합하는 자연스러운 단답을 모델이 오교정(ERROR_CORRECTION)하면 로컬 엔진 기준으로 보정해야 한다', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        const fakeModelOutput = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      evaluation: 'ERROR_CORRECTION', // 잘못된 오교정
                      userSpokenText: 'Good, thanks.',
                      isShortAnswer: true,
                      onePointFeedbackKo: '완전한 문장으로 말하세요.',
                      tutorResponseEn: 'Glad to hear that!',
                      factualConsistency: { consistent: true },
                    }),
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };
        return new Response(JSON.stringify(fakeModelOutput), { status: 200 });
      });

      const config = createValidConfig(mockFetch);

      // intro-u01-l03은 "How are you?"에 대한 안부 답하기 차시로 'Good, thanks.'가 허용 단답임
      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-short-fix',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l03',
          contentRevision: 1,
          userSpokenText: 'Good, thanks.',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(200);
      const resData = await res.json();
      expect(['ACCEPT', 'OPTIONAL_EXPANSION']).toContain(resData.evaluation.evaluation);
    });

    it('이미 iced 사실이 확정되었는데 튜터가 hot/iced를 재질문하면 502로 안전 거부하고 왜곡 대사를 미노출해야 한다', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        const fakeModelOutput = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      evaluation: 'ACCEPT',
                      userSpokenText: 'Two iced americanos, please.',
                      isShortAnswer: false,
                      tutorResponseEn: 'Sure! Would you like that hot or iced?', // 고정 사실 위반 재질문!
                      factualConsistency: { consistent: true },
                    }),
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };
        return new Response(JSON.stringify(fakeModelOutput), { status: 200 });
      });

      const config = createValidConfig(mockFetch);

      // beginner-u01-l01: 카페 주문 차시
      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-ice-conflict',
          userConsentToCloud: true,
          lessonId: 'beginner-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Two iced americanos, please.',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(502);

      const resData = await res.json();
      expect(resData.errorMessage).toContain('INVALID_MODEL_RESPONSE');
      expect(resData.evaluation).toBeUndefined(); // 왜곡된 튜터 대사가 UI로 노출되지 않음!
    });

    it('모델 응답이 빈 결과물이거나 MAX_TOKENS로 잘렸거나 안전 차단된 경우 502로 안전하게 거절해야 한다', async () => {
      // 1. candidates 빈 배열
      const emptyMockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
      const config1 = createValidConfig(emptyMockFetch);
      const req1 = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-empty-candidates',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello.',
          currentPhase: 'practice',
        }),
      });
      const res1 = await handleConversationAction(req1, 'chat', config1);
      expect(res1.status).toBe(502);

      // 2. finishReason: MAX_TOKENS (토큰 한도로 인한 불완전 JSON)
      const maxTokensFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"evaluation": "ACC' }] }, finishReason: 'MAX_TOKENS' }]
      }), { status: 200 }));
      const config2 = createValidConfig(maxTokensFetch);
      const req2 = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-max-tokens',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello.',
          currentPhase: 'practice',
        }),
      });
      const res2 = await handleConversationAction(req2, 'chat', config2);
      expect(res2.status).toBe(502);
      expect((await res2.json()).errorMessage).toContain('MAX_TOKENS');

      // 3. finishReason: SAFETY
      const safetyFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{ finishReason: 'SAFETY' }]
      }), { status: 200 }));
      const config3 = createValidConfig(safetyFetch);
      const req3 = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-safety-blocked',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello.',
          currentPhase: 'practice',
        }),
      });
      const res3 = await handleConversationAction(req3, 'chat', config3);
      expect(res3.status).toBe(502);

      // 4. finishReason: OTHER 및 MALFORMED_FUNCTION_CALL
      for (const badReason of ['OTHER', 'MALFORMED_FUNCTION_CALL']) {
        const badReasonFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"evaluation": "ACCEPT"}' }] }, finishReason: badReason }]
        }), { status: 200 }));
        const resBad = await handleConversationAction(
          new Request('https://toeic.app/api/conversation/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: `req-${badReason}`, userConsentToCloud: true, lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hello.', currentPhase: 'practice' }),
          }),
          'chat',
          createValidConfig(badReasonFetch)
        );
        expect(resBad.status).toBe(502);
      }

      // 5. 두 번째 part에 functionCall이 숨어있는 경우 502 거절
      const fnCallFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: '{"evaluation": "ACCEPT", "userSpokenText": "Hi", "isShortAnswer": false, "tutorResponseEn": "Hi", "factualConsistency": {"consistent": true}}' },
              { functionCall: { name: 'unexpected_tool', args: {} } }
            ]
          },
          finishReason: 'STOP'
        }]
      }), { status: 200 }));
      const resFn = await handleConversationAction(
        new Request('https://toeic.app/api/conversation/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'req-fn-call', userConsentToCloud: true, lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hello.', currentPhase: 'practice' }),
        }),
        'chat',
        createValidConfig(fnCallFetch)
      );
      expect(resFn.status).toBe(502);

      // 6. thought: true part는 제외하고 일반 text parts만 결합하여 JSON 파싱 성공
      const thoughtFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: 'This is internal model thinking and should not be parsed as output.' },
              { text: JSON.stringify({
                evaluation: 'ACCEPT',
                userSpokenText: 'Hello, I am Alex.',
                isShortAnswer: false,
                tutorResponseEn: 'Nice to meet you!',
                factualConsistency: { consistent: true }
              }) }
            ]
          },
          finishReason: 'STOP'
        }]
      }), { status: 200 }));
      const resThought = await handleConversationAction(
        new Request('https://toeic.app/api/conversation/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'req-thought-pass', userConsentToCloud: true, lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Hello, I am Alex.', currentPhase: 'practice' }),
        }),
        'chat',
        createValidConfig(thoughtFetch)
      );
      expect(resThought.status).toBe(200);
      expect((await resThought.json()).evaluation.evaluation).toBe('ACCEPT');
    });
  });

  describe('3. 음성 전사(transcribe) 및 합성(tts) HTTP 규격 검증', () => {
    it('transcribe 요청 시 gemini-3.5-transcribe 모델 및 verbatim 모드가 전달되어야 한다', async () => {
      let sentBody: any;
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            steps: [
              {
                content: [{ text: 'Hello, I am testing speech.' }],
              },
            ],
          }),
          { status: 200 }
        );
      });

      const config = createValidConfig(mockFetch);

      const fakeAudioBase64 = Buffer.from('fake-audio-bytes').toString('base64');
      const req = new Request('https://toeic.app/api/conversation/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-transcribe-01',
          userConsentToCloud: true,
          audioBase64: fakeAudioBase64,
          mimeType: 'audio/webm',
          durationSeconds: 5,
        }),
      });

      const res = await handleConversationAction(req, 'transcribe', config);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.transcription).toContain('testing speech');
      expect(sentBody.model).toBe(GEMINI_MODELS.TRANSCRIBE);
      expect(sentBody.generation_config.transcription_config.mode.type).toBe('verbatim');
    });

    it('tts 요청 시 gemini-3.8-flash-lite-tts 모델 및 voice Kore가 전달되며 audio/l16 PCM은 WAV로 변환되어야 한다', async () => {
      let sentBody: any;
      const rawPcmBytes = new Uint8Array(480);
      const rawPcmBase64 = Buffer.from(rawPcmBytes).toString('base64');

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            steps: [
              {
                content: [
                  {
                    type: 'audio',
                    data: rawPcmBase64,
                    mime_type: 'audio/l16', // Raw PCM
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      });

      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-tts-01',
          userConsentToCloud: true,
          text: 'Good morning!',
        }),
      });

      const res = await handleConversationAction(req, 'tts', config);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(sentBody.model).toBe(GEMINI_MODELS.TTS);
      expect(sentBody.generation_config.speech_config[0].voice).toBe('Kore');

      expect(data.mimeType).toBe('audio/wav');
      const decodedBytes = Buffer.from(data.audioBase64, 'base64');
      expect(decodedBytes.length).toBe(44 + 480);
      expect(decodedBytes.subarray(0, 4).toString()).toBe('RIFF');
      expect(decodedBytes.subarray(8, 12).toString()).toBe('WAVE');
    });
  });

  describe('4. 클라이언트 ConversationApiClient 상태 및 에러 분류 검증', () => {
    it('사용자 동의가 누락되면 호출 전 CONSENT_REQUIRED 오류를 발생시켜야 한다', async () => {
      const client = new ConversationApiClient();

      await expect(
        client.sendTurn(
          {
            lessonId: 'intro-u01-l01',
            contentRevision: 1,
            userSpokenText: 'Hi',
            currentPhase: 'practice',
          },
          undefined
        )
      ).rejects.toThrow('사용자 동의가 필요합니다');
    });

    it('성인이 아니면 CONSENT_REQUIRED 오류로 외부 API 호출이 차단되어야 한다', async () => {
      const client = new ConversationApiClient();
      const minorConsent: UserConsent = { ...validConsent, isAdult: false };

      await expect(
        client.sendTurn(
          {
            lessonId: 'intro-u01-l01',
            contentRevision: 1,
            userSpokenText: 'Hi',
            currentPhase: 'practice',
          },
          minorConsent
        )
      ).rejects.toThrow('성인 사용자만');
    });

    it('동시 요청 시 CONCURRENCY_LOCKED 오류를 발생시켜 중복 전송을 방지해야 한다', async () => {
      let resolveFirst: any;
      const delayedFetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      });

      const client = new ConversationApiClient(delayedFetch);

      const call1 = client.sendTurn(
        { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'First', currentPhase: 'practice' },
        validConsent
      );

      await expect(
        client.sendTurn(
          { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'Second', currentPhase: 'practice' },
          validConsent
        )
      ).rejects.toThrow('이미 진행 중인 회화 요청이 있습니다');

      resolveFirst(new Response(JSON.stringify({ success: true, evaluation: { evaluation: 'ACCEPT', userSpokenText: 'First', isShortAnswer: true, tutorResponseEn: 'Hello.', factualConsistency: { consistent: true } } })));
      await call1;
    });

    it('abortCurrentRequest 호출 시 요청이 TIMEOUT 오류 및 코드로 중단되어야 한다', async () => {
      const abortableFetch = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const client = new ConversationApiClient(abortableFetch);

      const promise = client.sendTurn(
        { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'To be aborted', currentPhase: 'practice' },
        validConsent
      );

      client.abortCurrentRequest();

      try {
        await promise;
        expect.unreachable();
      } catch (err: any) {
        expect(err.code).toBe('TIMEOUT');
        expect(err.message).toContain('시간 초과되었거나 사용자에 의해 중단되었습니다');
      }
    });

    it('이미 취소된 AbortSignal을 전달하면 네트워크 fetch를 0회 호출하고 즉시 TIMEOUT 오류를 발생시켜야 한다', async () => {
      const mockFetch = vi.fn();
      const client = new ConversationApiClient(mockFetch);

      const preAbortedController = new AbortController();
      preAbortedController.abort(new Error('PRE_ABORTED'));

      await expect(
        client.sendTurn(
          { lessonId: 'intro-u01-l01', contentRevision: 1, userSpokenText: 'No call', currentPhase: 'practice' },
          validConsent,
          preAbortedController.signal
        )
      ).rejects.toThrow('시간 초과되었거나 사용자에 의해 중단되었습니다');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('upstream 한 번 시도 후에는 실패하더라도 requestId가 consume 처리되어 중복 재전송이 방지되어야 한다', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-atomic-retry',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(502);

      // upstream 1회 호출됨
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // consume이 호출되어 해당 requestId를 retain하여 중복 재시도 방지
      expect(config.budgetAdapter!.consume).toHaveBeenCalledWith('user-valid:req-atomic-retry', 1);
      expect(config.budgetAdapter!.release).not.toHaveBeenCalled();
    });
  });

  describe('8. 오디오 MIME Interactions 규격 정규화 검증', () => {
    it('Interactions API audio format에 맞춰 MIME을 audio/m4a, audio/wav 등으로 안전하게 정규화해야 한다', () => {
      // 코덱 접미사 제거
      expect(normalizeInteractionsAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
      expect(normalizeInteractionsAudioMime('audio/ogg;codecs=opus')).toBe('audio/ogg');
      // mp4 -> m4a 매핑
      expect(normalizeInteractionsAudioMime('audio/mp4')).toBe('audio/m4a');
      expect(normalizeInteractionsAudioMime('audio/mp4;codecs=mp4a.40.2')).toBe('audio/m4a');
      // x-wav -> wav 매핑
      expect(normalizeInteractionsAudioMime('audio/x-wav')).toBe('audio/wav');
      expect(normalizeInteractionsAudioMime('audio/wav')).toBe('audio/wav');
      // 비정상/누락 값은 기본 wav 반환
      expect(normalizeInteractionsAudioMime('')).toBe('audio/wav');
      expect(normalizeInteractionsAudioMime(null as any)).toBe('audio/wav');
    });
  });

  describe('9. 서버 규칙 엔진의 목표 달성 증거 엄격 격리 검증 (LLM 환각 차단)', () => {
    it('LLM이 ACCEPT 판정 및 유효한 목표 ID를 주장하더라도, 로컬 규칙 엔진이 OFF_TOPIC이면 matchedObjectiveId를 제거해야 한다', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => {
        // LLM이 무관한 발화에 대해 ACCEPT와 obj-intro-01을 사칭하여 응답했다고 가정
        const forgedModelOutput = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      evaluation: 'ACCEPT',
                      matchedObjectiveId: 'obj-intro-01',
                      intentId: 'intent-intro-01',
                      userSpokenText: 'I want to eat pizza.',
                      isShortAnswer: false,
                      tutorResponseEn: 'Sounds delicious, but this is an intro lesson!',
                      factualConsistency: { consistent: true },
                    }),
                  },
                ],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        };

        return new Response(JSON.stringify(forgedModelOutput), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-forged-obj-test',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'I want to eat pizza.',
          currentPhase: 'practice',
          currentTaskId: 'obj-intro-01',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);

      // 로컬 규칙 평가가 OFF_TOPIC이므로, LLM의 주장과 무관하게 성취 증거는 반드시 제거(undefined)되어야 함
      expect(data.evaluation.matchedObjectiveId).toBeUndefined();
      expect(data.evaluation.intentId).toBeUndefined();
    });
  });

  describe('10. Provider 실패 분류 및 안전 오류 경계 검증 (503/Timeout/Cancel/Transport)', () => {
    it('실제 Google HTTP 503 모의 응답이면 router 503, errorCode UPSTREAM_UNAVAILABLE, retryable true, fetch 1회, consume 1, release 0이어야 한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: 'The model is overloaded. PROVIDER_PRIVATE_DETAIL_NEVER_EXPOSE',
              status: 'UNAVAILABLE',
            },
          }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          }
        )
      );

      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-503-unavailable',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(503);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.fallbackToRuleEngine).toBe(true);
      expect(data.errorCode).toBe('UPSTREAM_UNAVAILABLE');
      expect(data.retryable).toBe(true);
      expect(data.errorMessage).toContain('일시적');

      // upstream fetch 1회 호출 (자동 재시도 0회)
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // consume 1회 처리 (중복 재시도 방지), release 0회
      expect(config.budgetAdapter!.consume).toHaveBeenCalledWith('user-valid:req-503-unavailable', 1);
      expect(config.budgetAdapter!.release).not.toHaveBeenCalled();

      // key 및 provider 원문 민감값 응답 JSON 미노출
      const rawJson = JSON.stringify(data);
      expect(rawJson).not.toContain(config.geminiApiKey);
      expect(rawJson).not.toContain('The model is overloaded');
      expect(rawJson).not.toContain('PROVIDER_PRIVATE_DETAIL_NEVER_EXPOSE');
    });

    it('서버 타이머 만료 시 UPSTREAM_TIMEOUT으로 구별되고 retryable은 없어야 한다', async () => {
      const delayedFetch = vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      // 10ms 초단기 타임아웃으로 모의 호출
      await expect(
        callGeminiChatApi(
          { contents: [] },
          'test-api-key',
          delayedFetch,
          10
        )
      ).rejects.toMatchObject({
        statusCode: 504,
        failureKind: 'UPSTREAM_TIMEOUT',
      });
      expect(delayedFetch).toHaveBeenCalledTimes(1);
    });

    it('외부 사전 중단(pre-abort) 시 REQUEST_CANCELLED로 구별되고 upstream fetch는 0회여야 한다', async () => {
      const mockFetch = vi.fn();

      const preAbortedController = new AbortController();
      preAbortedController.abort(new Error('Pre-aborted request'));

      await expect(
        callGeminiChatApi(
          { contents: [] },
          'test-api-key',
          mockFetch,
          20000,
          preAbortedController.signal
        )
      ).rejects.toMatchObject({
        statusCode: 504,
        failureKind: 'REQUEST_CANCELLED',
      });

      expect(mockFetch).not.toHaveBeenCalled(); // upstream 0회
    });

    it('HTTP 429 응답은 기존 그대로 429 및 no auto try를 유지하고 retryable은 부여되지 않아야 한다', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Resource has been exhausted (e.g. check quota).',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-429-exhausted',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(429);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.fallbackToRuleEngine).toBe(true);
      expect(data.retryable).toBeUndefined();

      // upstream 1회만 호출 (no auto try)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(config.budgetAdapter!.consume).toHaveBeenCalledWith('user-valid:req-429-exhausted', 1);
      expect(config.budgetAdapter!.release).not.toHaveBeenCalled();

      // 키 및 민감 원문 미노출
      const rawJson = JSON.stringify(data);
      expect(rawJson).not.toContain(config.geminiApiKey);
      expect(rawJson).not.toContain('RESOURCE_EXHAUSTED');
    });

    it('네트워크 통신 오류 발생 시 router 502, TRANSPORT_ERROR로 분류되고 retryable은 부여되지 않아야 한다', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (DNS / Connection Refused)'));
      const config = createValidConfig(mockFetch);

      const req = new Request('https://toeic.app/api/conversation/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'req-transport-fail',
          userConsentToCloud: true,
          lessonId: 'intro-u01-l01',
          contentRevision: 1,
          userSpokenText: 'Hello',
          currentPhase: 'practice',
        }),
      });

      const res = await handleConversationAction(req, 'chat', config);
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.fallbackToRuleEngine).toBe(true);
      expect(data.errorCode).toBe('TRANSPORT_ERROR');
      expect(data.retryable).toBeUndefined();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(config.budgetAdapter!.consume).toHaveBeenCalledWith('user-valid:req-transport-fail', 1);
      expect(config.budgetAdapter!.release).not.toHaveBeenCalled();

      const rawJson = JSON.stringify(data);
      expect(rawJson).not.toContain(config.geminiApiKey);
      expect(rawJson).not.toContain('DNS / Connection Refused');
    });
  });
});

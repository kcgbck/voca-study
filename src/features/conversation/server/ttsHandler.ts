// src/features/conversation/server/ttsHandler.ts
// 음성 합성(TTS) 처리기 (gemini-3.8-flash-lite-tts, voice: 'Kore')

import type {
  ConversationTtsRequestBody,
  ConversationTtsResponseBody,
  ServerConfig,
} from './types';
import {
  readBoundedJsonBody,
  verifyServerCallPrerequisites,
  validateTextLength,
  MAX_USER_TEXT_LENGTH,
  SecurityGuardError,
} from './securityGuards';
import {
  pcm16ToWav,
  base64ToUint8Array,
  uint8ArrayToBase64,
} from './audioUtils';
import {
  callGeminiInteractionsApi,
  GEMINI_MODELS,
  GeminiApiError,
} from './geminiInteractionsClient';

export async function handleConversationTts(
  request: Request,
  config: ServerConfig
): Promise<Response> {
  // 1. 요청 본문 유한 스트림(3 MiB) 읽기 및 기본 구조 검증 (검증 우선 -> upstream 0회)
  const body = await readBoundedJsonBody<ConversationTtsRequestBody>(request);

  if (body.userConsentToCloud !== true) {
    throw new SecurityGuardError('사용자 클라우드 전송 명시 동의(userConsentToCloud)가 필요합니다.', 403);
  }

  if (!body.requestId || typeof body.requestId !== 'string' || body.requestId.trim().length === 0) {
    throw new SecurityGuardError('requestId가 누락되었거나 유효하지 않습니다.', 400);
  }

  // 2. 텍스트 길이 사전 검증 (최대 500자, upstream 0회)
  const validatedText = validateTextLength(body.text, MAX_USER_TEXT_LENGTH);

  // 3. 보안 전제 조건 검증 (Fail-Closed)
  const callerId = await verifyServerCallPrerequisites(request, config);
  const budgetKey = `${callerId}:${body.requestId}`;

  // 4. 원자적 예산 예약 및 중복 차단
  const reservation = await config.budgetAdapter!.reserve(budgetKey, 1);
  if (!reservation.allowed) {
    throw new SecurityGuardError(
      reservation.reason || '동시 중복 요청이 감지되었거나 예산이 초과되었습니다.',
      429
    );
  }

  let upstreamInitiated = false;

  try {
    const requestPayload = {
      model: GEMINI_MODELS.TTS,
      input: [
        {
          type: 'user_input',
          content: [
            {
              type: 'text',
              text: validatedText,
            },
          ],
        },
      ],
      store: false,
      response_format: {
        type: 'audio',
      },
      generation_config: {
        speech_config: [
          {
            voice: body.voiceName || 'Kore',
          },
        ],
      },
    };

    upstreamInitiated = true;

    const apiResult = await callGeminiInteractionsApi(
      requestPayload,
      config.geminiApiKey!,
      config.fetchFn,
      15000,
      request.signal
    );

    // 5. 오디오 결과물 추출
    let rawAudioBase64: string | undefined;
    let mimeType = 'audio/wav';

    if (Array.isArray(apiResult.steps)) {
      for (const step of apiResult.steps) {
        if (Array.isArray(step.content)) {
          for (const c of step.content) {
            if (typeof c.data === 'string' && c.data.trim().length > 0) {
              rawAudioBase64 = c.data.trim();
              if (c.mime_type) {
                mimeType = c.mime_type;
              }
              break;
            }
          }
        }
        if (rawAudioBase64) break;
      }
    }

    if (!rawAudioBase64 || rawAudioBase64.length === 0) {
      throw new GeminiApiError('Gemini TTS 응답에서 유효한 오디오 데이터를 찾을 수 없습니다.', 502);
    }

    let finalAudioBase64 = rawAudioBase64;
    let finalMimeType = mimeType;

    // audio/l16 (Raw Linear PCM 16-bit)인 경우 브라우저 재생용 RIFF/WAV 헤더 추가 변환
    if (mimeType.toLowerCase().includes('l16') || mimeType.toLowerCase().includes('pcm')) {
      const pcmBytes = base64ToUint8Array(rawAudioBase64);
      const wavBytes = pcm16ToWav(pcmBytes, 24000, 1);
      finalAudioBase64 = uint8ArrayToBase64(wavBytes);
      finalMimeType = 'audio/wav';
    }

    const responseBody: ConversationTtsResponseBody = {
      success: true,
      audioBase64: finalAudioBase64,
      mimeType: finalMimeType,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    if (upstreamInitiated) {
      try {
        await config.budgetAdapter!.consume(budgetKey, 1);
      } catch {
        // ignore consume error
      }
    } else {
      try {
        await config.budgetAdapter!.release(budgetKey);
      } catch {
        // ignore release error
      }
    }
  }
}

// tests/conversationAdaptiveCoach.test.ts
// 카페 상황 기반 적응형 회화 코치 프로토콜/API/서버 검증

import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handlePublicCoach } from '../src/features/conversation/server/publicCoachHandler';
import {
  COACH_POLICY_VERSION,
  COACH_QUESTIONS,
  CAFE_QUESTIONS,
  CAFE_SCENARIO_ID,
  SCENARIO_COMPLETE_SENTINEL,
  type CoachEvaluation,
} from '../src/features/conversation/coach/coachProtocol';
import { PublicCoachApiClient } from '../src/features/conversation/coach/publicCoachApi';
import { MODEL_HARD_CAPS_90_PERCENT } from '../src/features/conversation/server/budgetPolicy';
import type { D1Database, D1PreparedStatement } from '../src/features/conversation/server/budgetAdapter';

const baseAdaptiveEval: CoachEvaluation = {
  meaning: 'relevant',
  sentenceComplete: true,
  feedbackKo: '완벽하고 자연스러운 문장이에요!',
  modelAnswerEn: 'I would like an iced tea, please.',
  nextQuestionId: 'cafe_size',
};

function setupMockServer(overrides: Record<string, unknown> = {}, denyBudget = false) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const run = async () => ({ success: true, meta: { changes: denyBudget ? 0 : 1 } });
  const db = {
    prepare(sql: string): D1PreparedStatement {
      const statement: D1PreparedStatement = {
        run,
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return statement;
        },
      };
      return statement;
    },
  };
  const env = {
    PUBLIC_CONVERSATION_ENABLED: 'true',
    ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
    CONVERSATION_FREE_TIER_CONFIRMED: 'true',
    GEMINI_API_KEY: 'TEST_ONLY_KEY_DO_NOT_USE',
    CONVERSATION_BUDGET_DB: db,
    CONVERSATION_MODEL_LIMITS_JSON: JSON.stringify(MODEL_HARD_CAPS_90_PERCENT),
    ...overrides,
  };
  const fetchFn = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(baseAdaptiveEval) }] } }],
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  );
  return { env, fetchFn, statements };
}

function createServerRequest(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('https://study.example/api/conversation/coach', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://study.example',
      'CF-Connecting-IP': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify({
      requestId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      adultConfirmed: true,
      policyVersion: COACH_POLICY_VERSION,
      scenarioId: CAFE_SCENARIO_ID,
      questionId: 'cafe_drink',
      answer: 'I would like an iced tea, please.',
      ...body,
    }),
  });
}

describe('Adaptive Coach - Server & Protocol & API Integration', () => {
  describe('1. Authoritative Catalog & Transition Graph', () => {
    it('defines 6 authoritative cafe nodes with complete sentinel', () => {
      expect(CAFE_QUESTIONS).toHaveLength(6);
      const nodeIds = CAFE_QUESTIONS.map((q) => q.id);
      expect(nodeIds).toEqual([
        'cafe_drink',
        'cafe_temp',
        'cafe_size',
        'cafe_dine_in',
        'cafe_option',
        'cafe_payment',
      ]);
      expect(CAFE_QUESTIONS[0].allowedNextQuestionIds).toEqual(['cafe_temp', 'cafe_size']);
      expect(CAFE_QUESTIONS[1].allowedNextQuestionIds).toEqual(['cafe_size']);
      expect(CAFE_QUESTIONS[2].allowedNextQuestionIds).toEqual(['cafe_dine_in']);
      expect(CAFE_QUESTIONS[3].allowedNextQuestionIds).toEqual(['cafe_option']);
      expect(CAFE_QUESTIONS[4].allowedNextQuestionIds).toEqual(['cafe_payment']);
      expect(CAFE_QUESTIONS[5].allowedNextQuestionIds).toEqual([SCENARIO_COMPLETE_SENTINEL]);
    });

    it('injects server-authoritative candidate metadata into Gemini user content and schema', async () => {
      const { env, fetchFn } = setupMockServer();
      const res = await handlePublicCoach(createServerRequest(), env, { fetchFn });
      expect(res.status).toBe(200);
      expect(fetchFn).toHaveBeenCalledOnce();

      const callArgs = fetchFn.mock.calls[0];
      const parsedBody = JSON.parse(callArgs[1].body);

      // System instruction includes nextQuestionId requirement and advice for iced tea
      expect(parsedBody.system_instruction.parts[0].text).toContain('nextQuestionId');
      expect(parsedBody.system_instruction.parts[0].text).toContain('allowedNextCandidates');
      expect(parsedBody.system_instruction.parts[0].text).toContain('carrier만 거절하면 carrier만 언급');
      expect(parsedBody.system_instruction.parts[0].text).toContain('영어 예문/문장을 feedbackKo에 중복 포함하지 마세요');

      // generationConfig responseSchema requires nextQuestionId with allowed enums
      const schema = parsedBody.generationConfig.responseSchema;
      expect(schema.required).toContain('nextQuestionId');
      expect(schema.properties.nextQuestionId.enum).toEqual(['cafe_temp', 'cafe_size']);

      // User content contains authoritative candidates
      const userContent = JSON.parse(parsedBody.contents[0].parts[0].text);
      expect(userContent.scenarioId).toBe(CAFE_SCENARIO_ID);
      expect(userContent.currentQuestion.id).toBe('cafe_drink');
      expect(userContent.allowedNextCandidates).toHaveLength(2);
      expect(userContent.allowedNextCandidates[0].id).toBe('cafe_temp');
      expect(userContent.allowedNextCandidates[1].id).toBe('cafe_size');
    });

    it('last payment node only permits complete sentinel in schema', async () => {
      const paymentEval = {
        ...baseAdaptiveEval,
        nextQuestionId: SCENARIO_COMPLETE_SENTINEL,
        modelAnswerEn: 'Credit card, please.',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(paymentEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({ questionId: 'cafe_payment', answer: 'Credit card, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const parsed = await res.json();
      expect(parsed.evaluation.nextQuestionId).toBe(SCENARIO_COMPLETE_SENTINEL);

      const parsedBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      expect(parsedBody.generationConfig.responseSchema.properties.nextQuestionId.enum).toEqual([
        SCENARIO_COMPLETE_SENTINEL,
      ]);
    });
  });

  describe('2. Client & Server Context Bounding and Pre-Budget 400 Validation', () => {
    it.each([
      { name: 'invalid scenarioId', body: { scenarioId: 'hacked_scenario' } },
      { name: 'invalid questionId in scenario', body: { questionId: 'invalid_node' } },
      { name: 'recentContext not an array', body: { recentContext: 'not-array' } },
      {
        name: 'recentContext exceeds 2 turns',
        body: {
          recentContext: [
            { questionId: 'cafe_drink', answer: 'tea' },
            { questionId: 'cafe_temp', answer: 'iced' },
            { questionId: 'cafe_size', answer: 'large' },
          ],
        },
      },
      {
        name: 'recentContext invalid item structure',
        body: { recentContext: [{ questionId: 'cafe_drink' }] },
      },
      {
        name: 'recentContext uncataloged questionId',
        body: { recentContext: [{ questionId: 'unknown_q', answer: 'tea' }] },
      },
      {
        name: 'recentContext empty answer',
        body: { recentContext: [{ questionId: 'cafe_drink', answer: '   ' }] },
      },
      {
        name: 'recentContext answer exceeds 500 chars',
        body: { recentContext: [{ questionId: 'cafe_drink', answer: 'a'.repeat(501) }] },
      },
    ])('rejects $name with HTTP 400 before budget reservation or upstream call', async ({ body }) => {
      const { env, fetchFn, statements } = setupMockServer();
      const res = await handlePublicCoach(createServerRequest(body), env, { fetchFn });
      expect(res.status).toBe(400);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(statements).toHaveLength(0);
    });

    it('rejects recentContext when serialized UTF-8 bytes exceed 1024 bytes', async () => {
      const longAns1 = '한'.repeat(180); // 180 * 3 = 540 bytes (<= 500 chars)
      const longAns2 = '글'.repeat(180); // 180 * 3 = 540 bytes (<= 500 chars)
      // total JSON bytes > 1080 > 1024 bytes
      const { env, fetchFn, statements } = setupMockServer();
      const res = await handlePublicCoach(
        createServerRequest({
          recentContext: [
            { questionId: 'cafe_drink', answer: longAns1 },
            { questionId: 'cafe_temp', answer: longAns2 },
          ],
        }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.errorMessage).toContain('1024B');
      expect(fetchFn).not.toHaveBeenCalled();
      expect(statements).toHaveLength(0);
    });

    it('accepts valid recentContext within 2 turns and 1024B, and forwards it to upstream user content', async () => {
      const { env, fetchFn, statements } = setupMockServer();
      const validContext = [
        { questionId: 'cafe_drink', answer: 'Iced tea, please.' },
      ];
      const res = await handlePublicCoach(
        createServerRequest({
          questionId: 'cafe_temp',
          answer: 'Iced, please.',
          recentContext: validContext,
        }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      expect(fetchFn).toHaveBeenCalledOnce();
      const userContent = JSON.parse(JSON.parse(fetchFn.mock.calls[0][1].body).contents[0].parts[0].text);
      expect(userContent.recentContext).toEqual(validContext);
      expect(statements.some((s) => s.sql.includes('state = \'consumed\''))).toBe(true);
    });
  });

  describe('3. Single-Call Meaning, Short Orders & Model Answers', () => {
    it('understands "Coffee, please" as relevant and preserves intent without marking it as grammar error', async () => {
      const shortCoffeeEval = {
        meaning: 'relevant',
        sentenceComplete: false,
        feedbackKo: '주문할 때 자연스럽게 통하는 표현이에요.',
        modelAnswerEn: 'I would like coffee, please.',
        nextQuestionId: 'cafe_temp',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(shortCoffeeEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({ answer: 'Coffee, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.meaning).toBe('relevant');
      expect(data.evaluation.sentenceComplete).toBe(false);
      expect(data.evaluation.nextQuestionId).toBe('cafe_temp');
      expect(data.evaluation.feedbackKo).toBe('주문할 때 자연스럽게 통하는 표현이에요.');
    });

    it('sanitizes feedbackKo to clean Korean when AI includes Latin English sentence in adaptive feedback', async () => {
      // AI output has redundant English "I would like coffee, please." inside feedbackKo
      const aiWithEnglishFeedback = {
        meaning: 'relevant',
        sentenceComplete: false,
        feedbackKo: '좋은 표현이에요. I would like coffee, please. 처럼 말해 보세요.',
        modelAnswerEn: 'I would like coffee, please.',
        nextQuestionId: 'cafe_temp',
      };
      const { env, fetchFn, statements } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(aiWithEnglishFeedback) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({ answer: 'Coffee, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      expect(fetchFn).toHaveBeenCalledOnce(); // No extra API retry!
      expect(statements.some((s) => s.sql.includes("state = 'consumed'"))).toBe(true);

      const data = await res.json();
      expect(data.evaluation.meaning).toBe('relevant');
      expect(data.evaluation.sentenceComplete).toBe(false);
      expect(data.evaluation.modelAnswerEn).toBe('I would like coffee, please.');
      expect(data.evaluation.nextQuestionId).toBe('cafe_temp');

      // Feedback sanitized to concise Korean template (no Latin characters, <= 100 chars)
      expect(data.evaluation.feedbackKo).toBe('뜻은 잘 전달됐어요. 예문처럼 완전한 문장으로 말해 보세요.');
      expect(/[a-zA-Z]/.test(data.evaluation.feedbackKo)).toBe(false);
      expect(data.evaluation.feedbackKo.length).toBeLessThanOrEqual(100);
    });

    it('sanitizes feedbackKo when explanation exceeds 100 characters while preserving evaluation outcomes', async () => {
      const verboseFeedback = '정말 좋은 답변입니다. '.repeat(10); // > 100 chars
      const aiVerboseEval = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: verboseFeedback,
        modelAnswerEn: 'I would like coffee, please.',
        nextQuestionId: 'cafe_temp',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(aiVerboseEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({ answer: 'I would like coffee, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.meaning).toBe('relevant');
      expect(data.evaluation.sentenceComplete).toBe(true);
      expect(data.evaluation.modelAnswerEn).toBe('I would like coffee, please.');
      expect(data.evaluation.feedbackKo).toBe('뜻이 잘 전달됐어요. 완전한 문장으로 자연스럽게 답했어요.');
      expect(data.evaluation.feedbackKo.length).toBeLessThanOrEqual(100);
    });

    it('sanitizes feedbackKo for needs_help without promoting meaning to relevant', async () => {
      const needsHelpEval = {
        meaning: 'needs_help',
        sentenceComplete: false,
        feedbackKo: '질문과 맞지 않아요. I would like a car.', // Contains English + Korean
        modelAnswerEn: 'I would like coffee, please.',
        nextQuestionId: 'cafe_temp',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(needsHelpEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({ answer: 'A car, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.meaning).toBe('needs_help'); // Preserved without promotion!
      expect(data.evaluation.sentenceComplete).toBe(false);
      expect(data.evaluation.feedbackKo).toBe('질문에 맞는 답변인지 확인하고, 이어지는 예문으로 연습해 보세요.');
    });

    it('preserves clean Korean specific feedback for carrier and sleeve without modification', async () => {
      const carrierOnlyFeedback = '캐리어가 필요 없다고 정확히 밝히셨어요.';
      const cleanEval = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: carrierOnlyFeedback,
        modelAnswerEn: 'I do not need a carrier, thank you.',
        nextQuestionId: 'cafe_payment',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(cleanEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(
        createServerRequest({
          questionId: 'cafe_option',
          answer: 'I do not need a carrier, thank you.',
        }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.feedbackKo).toBe(carrierOnlyFeedback); // Preserved exactly!
    });

    it('when learner already specifies "I would like iced tea, please", AI selects cafe_size directly', async () => {
      const { env, fetchFn } = setupMockServer();
      const res = await handlePublicCoach(
        createServerRequest({ answer: 'I would like iced tea, please.' }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.nextQuestionId).toBe('cafe_size');
    });
  });

  describe('4. Transition Whitelist & Failure Containment (No Retry, No Promotion)', () => {
    it('returns 502 and keeps consumed budget when AI returns an unpermitted nextQuestionId', async () => {
      const invalidNextEval = {
        ...baseAdaptiveEval,
        nextQuestionId: 'cafe_payment', // Illegal jump from cafe_drink!
      };
      const { env, fetchFn, statements } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(invalidNextEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(createServerRequest(), env, { fetchFn });
      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.errorMessage).toContain('nextQuestionId');
      // Already consumed 1 unit
      expect(statements.some((s) => s.sql.includes('state = \'consumed\''))).toBe(true);
      expect(statements.some((s) => s.sql.includes('state = \'released\''))).toBe(false);
      // No retry
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('returns 502 when AI prematurely returns complete on non-terminal node', async () => {
      const prematureCompleteEval = {
        ...baseAdaptiveEval,
        nextQuestionId: SCENARIO_COMPLETE_SENTINEL, // Illegal on cafe_drink
      };
      const { env, fetchFn, statements } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(prematureCompleteEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(createServerRequest(), env, { fetchFn });
      expect(res.status).toBe(502);
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(statements.some((s) => s.sql.includes('state = \'consumed\''))).toBe(true);
    });

    it('returns 502 when nextQuestionId is missing in adaptive scenario', async () => {
      const missingNextEval = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '좋은 표현이에요.',
        modelAnswerEn: 'I would like iced tea, please.',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(missingNextEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await handlePublicCoach(createServerRequest(), env, { fetchFn });
      expect(res.status).toBe(502);
      expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('negation conflict guard preserves uncertain result and prevents next transition', async () => {
      const negationEval = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '잘 전달되었어요.',
        modelAnswerEn: 'I do want coffee.',
        recognizedCandidateIndex: 1,
        nextQuestionId: 'cafe_temp',
      };
      const { env, fetchFn } = setupMockServer();
      fetchFn.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(negationEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      // Raw has 'no' (negation), candidate 1 has positive
      const res = await handlePublicCoach(
        createServerRequest({
          answer: 'No coffee.',
          candidates: ['No coffee.', 'I do want coffee.'],
        }),
        env,
        { fetchFn }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.evaluation.meaning).toBe('uncertain');
      expect(data.evaluation.nextQuestionId).toBe('cafe_temp');
      expect(data.evaluation.sentenceComplete).toBe(false);
      expect(data.evaluation.feedbackKo).toContain('긍정과 부정 표현이 엇갈려');
    });
  });

  describe('5. Shared Conservative Budget Metering with Dynamic Payload', () => {
    it('meters all dynamic serialized user content bytes strictly on top of 16384 base units', async () => {
      const { env, fetchFn, statements } = setupMockServer();
      await handlePublicCoach(createServerRequest(), env, { fetchFn });

      expect(statements[0].sql).toContain('INSERT INTO conversation_budget_reservations');
      const reservedUnits = statements[0].values[5] as number;

      // Extract exact user content from the fetch call
      const upstreamBody = JSON.parse(fetchFn.mock.calls[0][1].body);
      const serializedUserContent = upstreamBody.contents[0].parts[0].text;
      const expectedBytes = new TextEncoder().encode(serializedUserContent).byteLength;

      expect(reservedUnits).toBe(16384 + expectedBytes);
      expect(reservedUnits).toBeGreaterThan(16384 + 100);
    });

    it('with real SQLite in-memory budget adapter, respects TPM limit when large context is added', async () => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec(readFileSync('scripts/conversation/budget-schema.sql', 'utf8'));
      const db: D1Database = {
        prepare(sql: string) {
          let values: any[] = [];
          const stmt = {
            bind(...args: any[]) {
              values = args;
              return stmt;
            },
            async run() {
              const r = sqlite.prepare(sql).run(...values);
              return { success: true, meta: { changes: Number(r.changes) } };
            },
            async first() {
              return (sqlite.prepare(sql).get(...values) as any) ?? null;
            },
          };
          return stmt;
        },
      };

      const now = Date.parse('2026-10-24T12:00:00Z');
      const env = {
        PUBLIC_CONVERSATION_ENABLED: 'true',
        ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
        CONVERSATION_FREE_TIER_CONFIRMED: 'true',
        GEMINI_API_KEY: 'TEST_REAL_METERING_KEY',
        CONVERSATION_BUDGET_DB: db,
        CONVERSATION_MODEL_LIMITS_JSON: JSON.stringify(MODEL_HARD_CAPS_90_PERCENT),
      };

      const fetchFn = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(baseAdaptiveEval) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      // Pre-seed 220,000 units to create TPM pressure
      const insert = sqlite.prepare(
        "INSERT INTO conversation_budget_reservations(request_hash,caller_hash,model,created_ms,day_key,units,state) VALUES(?,?,?,?,?,?, 'consumed')"
      );
      insert.run('seed-tpm', 'seed-caller', 'gemini-3.5-flash-lite', now, '2026-10-24', 215000);

      // A request with 16384 + ~1000B payload = ~17400 units will exceed 225,000 TPM limit
      const req = createServerRequest({
        recentContext: [
          { questionId: 'cafe_drink', answer: 'a'.repeat(300) },
          { questionId: 'cafe_temp', answer: 'b'.repeat(300) },
        ],
      });

      const res = await handlePublicCoach(req, env, { fetchFn, clockNow: () => now });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.errorCode).toBe('COACH_MINUTE_LIMIT');
      expect(fetchFn).not.toHaveBeenCalled();

      sqlite.close();
    });
  });

  describe('6. PublicCoachApiClient Client-Side Compatibility & Validation', () => {
    it('validates and sends adaptive scenario and recentContext through PublicCoachApiClient', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            evaluation: baseAdaptiveEval,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new PublicCoachApiClient(mockFetch);
      const evalResult = await client.evaluate(
        'cafe_drink',
        'I would like an iced tea, please.',
        true,
        {
          inputSource: 'voice',
          scenarioId: CAFE_SCENARIO_ID,
          recentContext: [{ questionId: 'cafe_drink', answer: 'Hello' }],
        }
      );

      expect(evalResult.meaning).toBe('relevant');
      expect(evalResult.sentenceComplete).toBe(true);
      expect(evalResult.nextQuestionId).toBe('cafe_size');
      expect(mockFetch).toHaveBeenCalledOnce();

      const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(sentBody.scenarioId).toBe(CAFE_SCENARIO_ID);
      expect(sentBody.questionId).toBe('cafe_drink');
      expect(sentBody.recentContext).toEqual([{ questionId: 'cafe_drink', answer: 'Hello' }]);
    });

    it('rejects invalid client-side recentContext before fetch', async () => {
      const mockFetch = vi.fn();
      const client = new PublicCoachApiClient(mockFetch);

      await expect(
        client.evaluate('cafe_drink', 'Tea', true, {
          inputSource: 'voice',
          scenarioId: CAFE_SCENARIO_ID,
          recentContext: [
            { questionId: 'cafe_drink', answer: '1' },
            { questionId: 'cafe_temp', answer: '2' },
            { questionId: 'cafe_size', answer: '3' },
          ],
        })
      ).rejects.toThrow('최근 대화 맥락은 최대 2턴까지만 허용됩니다.');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects unpermitted nextQuestionId in client response parser', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            evaluation: {
              ...baseAdaptiveEval,
              nextQuestionId: 'cafe_payment', // Invalid transition from cafe_drink
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new PublicCoachApiClient(mockFetch);
      await expect(
        client.evaluate('cafe_drink', 'I would like an iced tea, please.', true, {
          inputSource: 'voice',
          scenarioId: CAFE_SCENARIO_ID,
        })
      ).rejects.toThrow('다음 질문 ID(nextQuestionId)가 허용 목록에 없습니다.');
    });

    it('remains fully backward compatible with legacy 5 questions without nextQuestionId', async () => {
      const legacyEval = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '좋아요!',
        modelAnswerEn: 'My name is Alex.',
      };
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            evaluation: legacyEval,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const client = new PublicCoachApiClient(mockFetch);
      const result = await client.evaluate(COACH_QUESTIONS[0].id, 'Alex.', true);
      expect(result.meaning).toBe('relevant');
      expect(result.modelAnswerEn).toBe('My name is Alex.');
      expect(result.nextQuestionId).toBeUndefined();
    });
  });
});

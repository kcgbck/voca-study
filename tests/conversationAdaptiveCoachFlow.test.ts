// tests/conversationAdaptiveCoachFlow.test.ts
// 통합 적응형 대화 흐름 (Controller + Api + Handler + In-Memory SQLite Budget) 종합 검증

import { describe, expect, it, vi, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CoachTutorController, type CoachSnapshot } from '../src/features/conversation/coach/CoachTutorController';
import { PublicCoachApiClient } from '../src/features/conversation/coach/publicCoachApi';
import { handlePublicCoach } from '../src/features/conversation/server/publicCoachHandler';
import {
  CAFE_QUESTIONS,
  CAFE_SCENARIO_ID,
  SCENARIO_COMPLETE_SENTINEL,
  type CoachEvaluation,
} from '../src/features/conversation/coach/coachProtocol';
import { MODEL_HARD_CAPS_90_PERCENT } from '../src/features/conversation/server/budgetPolicy';
import type { D1Database } from '../src/features/conversation/server/budgetAdapter';

const model = 'gemini-3.5-flash-lite';
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setupIntegratedEnv(limits: Record<string, number> = {}) {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
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

  let now = Date.parse('2026-10-24T12:00:00Z');
  const caps = { ...MODEL_HARD_CAPS_90_PERCENT[model], ...limits };
  const env = {
    PUBLIC_CONVERSATION_ENABLED: 'true',
    ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
    CONVERSATION_FREE_TIER_CONFIRMED: 'true',
    GEMINI_API_KEY: 'TEST_REAL_METERING_KEY',
    CONVERSATION_BUDGET_DB: db,
    CONVERSATION_MODEL_LIMITS_JSON: JSON.stringify({ ...MODEL_HARD_CAPS_90_PERCENT, [model]: caps }),
  };

  const mockUpstreamFetch = vi.fn();

  // PublicCoachApiClient -> handlePublicCoach 직접 연결
  const clientFetch: typeof fetch = async (input, init) => {
    const req = new Request(
      input instanceof Request ? input.url : `https://study.example${String(input)}`,
      {
        method: init?.method ?? 'POST',
        headers: {
          Origin: 'https://study.example',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '203.0.113.100',
          ...(init?.headers as any),
        },
        body: init?.body,
        signal: init?.signal,
      }
    );
    return handlePublicCoach(req, env, { fetchFn: mockUpstreamFetch, clockNow: () => now });
  };

  const apiClient = new PublicCoachApiClient(clientFetch);

  const getConsumedCount = () =>
    (sqlite.prepare("SELECT COUNT(*) as c FROM conversation_budget_reservations WHERE state = 'consumed'").get() as any).c as number;

  const getReservedRows = () =>
    sqlite.prepare('SELECT * FROM conversation_budget_reservations').all();

  return {
    sqlite,
    env,
    mockUpstreamFetch,
    apiClient,
    getConsumedCount,
    getReservedRows,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('Adaptive Coach End-to-End Flow & Budget Integration', () => {
  it('1. executes full 6-node path with approved answer and pending next progression', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];
    let currentSpeechText = '';

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => currentSpeechText,
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    let recentHistory: Array<{ questionId: string; answer: string }> = [];

    // Full 6 nodes: cafe_drink -> cafe_temp -> cafe_size -> cafe_dine_in -> cafe_option -> cafe_payment -> complete
    for (let i = 0; i < CAFE_QUESTIONS.length; i++) {
      const node = CAFE_QUESTIONS[i];
      const nextId = node.allowedNextQuestionIds[0];
      const spoken = node.exampleAnswerEn;
      currentSpeechText = spoken;

      const evalData: CoachEvaluation = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '훌륭해요!',
        modelAnswerEn: spoken,
        nextQuestionId: nextId,
      };

      h.mockUpstreamFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(evalData) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      await controller.start(node, {
        scenarioId: CAFE_SCENARIO_ID,
        recentContext: recentHistory,
      });

      const lastState = states.at(-1)!;
      expect(lastState.phase).toBe('complete');
      expect(lastState.practiceDone).toBe(1);
      expect(lastState.pendingNextQuestionId).toBe(nextId);
      expect(lastState.approvedAnswer).toBe(spoken);

      // Verify that the upstream request actually received the recentContext
      const upstreamReq = JSON.parse(h.mockUpstreamFetch.mock.calls[i][1].body);
      const userContent = JSON.parse(upstreamReq.contents[0].parts[0].text);
      if (i > 0) {
        expect(userContent.recentContext).toBeDefined();
        expect(userContent.recentContext.length).toBeLessThanOrEqual(2);
      }

      recentHistory = [
        ...recentHistory,
        { questionId: node.id, answer: lastState.approvedAnswer! },
      ].slice(-2);
    }

    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(6);
    expect(h.getConsumedCount()).toBe(6);
  });

  it('2. iced tea answer executes full 5-node shortcut path (cafe_drink -> cafe_size -> cafe_dine_in -> cafe_option -> cafe_payment -> complete)', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];
    let currentSpeechText = '';

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => currentSpeechText,
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    let recentHistory: Array<{ questionId: string; answer: string }> = [];

    // 5-node sequence: drink -> size -> dine_in -> option -> payment
    const shortcutNodes = [
      CAFE_QUESTIONS[0], // cafe_drink -> cafe_size
      CAFE_QUESTIONS[2], // cafe_size -> cafe_dine_in
      CAFE_QUESTIONS[3], // cafe_dine_in -> cafe_option
      CAFE_QUESTIONS[4], // cafe_option -> cafe_payment
      CAFE_QUESTIONS[5], // cafe_payment -> complete
    ];

    for (let i = 0; i < shortcutNodes.length; i++) {
      const node = shortcutNodes[i];
      const spoken = i === 0 ? 'I would like an iced tea, please.' : node.exampleAnswerEn;
      currentSpeechText = spoken;
      const nextId = i === 0 ? 'cafe_size' : node.allowedNextQuestionIds[0];

      const evalData: CoachEvaluation = {
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '좋아요!',
        modelAnswerEn: spoken,
        nextQuestionId: nextId,
      };

      h.mockUpstreamFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(evalData) }] } }],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

      await controller.start(node, {
        scenarioId: CAFE_SCENARIO_ID,
        recentContext: recentHistory,
      });

      const lastState = states.at(-1)!;
      expect(lastState.phase).toBe('complete');
      expect(lastState.pendingNextQuestionId).toBe(nextId);
      expect(lastState.approvedAnswer).toBe(spoken);

      // Verify cafe_temp was NEVER visited
      expect(node.id).not.toBe('cafe_temp');

      recentHistory = [
        ...recentHistory,
        { questionId: node.id, answer: lastState.approvedAnswer! },
      ].slice(-2);
    }

    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(5);
    expect(h.getConsumedCount()).toBe(5);
  });

  it('3. short answer evaluates meaning=relevant + sentenceComplete=false, requires 2 practices; approved identical repeat reuses cache (consume=2)', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];
    const answers = [
      'Coffee, please.', // 1st: initial evaluation
      'I would like coffee, please.', // 2nd: 1st practice evaluation
      'I would like coffee, please.', // 3rd: 2nd practice -> cache reuse!
    ];

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => answers.shift() ?? '',
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    // 1st upstream evaluation for short answer
    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      meaning: 'relevant',
                      sentenceComplete: false,
                      feedbackKo: '뜻이 통합니다. 완전한 문장으로 연습해 봐요.',
                      modelAnswerEn: 'I would like coffee, please.',
                      nextQuestionId: 'cafe_temp',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    // 2nd upstream evaluation for the newly spoken full sentence
    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      meaning: 'relevant',
                      sentenceComplete: true,
                      feedbackKo: '완벽한 문장이에요!',
                      modelAnswerEn: 'I would like coffee, please.',
                      nextQuestionId: 'cafe_temp',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    await controller.start(CAFE_QUESTIONS[0], { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('complete');
    expect(lastState.practiceDone).toBe(2);
    expect(lastState.approvedAnswer).toBe('I would like coffee, please.');

    // Exactly 2 external API calls (the 3rd speech was reused from cache)
    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(2);
    expect(h.getConsumedCount()).toBe(2);
  });

  it('4. changing speech during repeat (e.g. coffee -> tea) invalidates cache and triggers fresh evaluation', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];
    const answers = [
      'Coffee, please.',
      'I would like tea, please.', // changed drink
      'I would like tea, please.', // exact repeat of tea
    ];

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => answers.shift() ?? '',
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    h.mockUpstreamFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        meaning: 'relevant',
                        sentenceComplete: false,
                        feedbackKo: '문장으로 연습해요.',
                        modelAnswerEn: 'I would like coffee, please.',
                        nextQuestionId: 'cafe_temp',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        meaning: 'relevant',
                        sentenceComplete: true,
                        feedbackKo: '차로 바꾸셨군요!',
                        modelAnswerEn: 'I would like tea, please.',
                        nextQuestionId: 'cafe_temp',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      );

    await controller.start(CAFE_QUESTIONS[0], { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('complete');
    expect(lastState.approvedAnswer).toBe('I would like tea, please.');
    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('5. uncertain evaluation halts progression (paused, 0 progress, no pendingNextQuestionId)', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => 'asdf xyz blabla',
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      meaning: 'uncertain',
                      sentenceComplete: false,
                      feedbackKo: '잘 알아듣지 못했어요. 다시 말씀해 주세요.',
                      modelAnswerEn: 'I would like coffee, please.',
                      nextQuestionId: 'cafe_temp',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    await controller.start(CAFE_QUESTIONS[0], { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('paused');
    expect(lastState.practiceDone).toBe(0);
    expect(lastState.pendingNextQuestionId).toBeUndefined();
    expect(lastState.approvedAnswer).toBeUndefined();
    expect(h.getConsumedCount()).toBe(1);
  });

  it('6. negation conflict in alternatives safely yields uncertain and stops controller progression', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async (_lang, options) => {
        options?.onAlternatives?.(['No coffee.', 'I do want coffee.']);
        return 'No coffee.';
      },
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      recognizedCandidateIndex: 1, // selects alternative 1
                      meaning: 'relevant',
                      sentenceComplete: true,
                      feedbackKo: '커피를 원하시는군요.',
                      modelAnswerEn: 'I do want coffee.',
                      nextQuestionId: 'cafe_temp',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    await controller.start(CAFE_QUESTIONS[0], { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    // Server negation guard forced meaning='uncertain'
    expect(lastState.phase).toBe('paused');
    expect(lastState.practiceDone).toBe(0);
    expect(lastState.pendingNextQuestionId).toBeUndefined();
    expect(lastState.feedbackKo).toContain('긍정과 부정 표현이 엇갈려');
  });

  it('7. controller rejects unpermitted nextQuestionId from mock AI with error state and 0 progress', async () => {
    const states: CoachSnapshot[] = [];

    // Bypass client-side validation to test Controller's own independent defense
    const mockBypassedEvaluate = vi.fn().mockResolvedValue({
      meaning: 'relevant',
      sentenceComplete: true,
      feedbackKo: '잘하셨어요.',
      modelAnswerEn: 'I would like coffee, please.',
      nextQuestionId: 'cafe_payment', // Illegal transition from cafe_drink!
    });

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => 'Coffee, please.',
      evaluate: mockBypassedEvaluate,
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    await controller.start(CAFE_QUESTIONS[0], { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('error');
    expect(lastState.practiceDone).toBe(0);
    expect(lastState.pendingNextQuestionId).toBeUndefined();
    expect(lastState.message).toContain('유효하지 않은 다음 질문');
  });

  it('8. starting a new question instance resets repeat cache and transition state', async () => {
    const h = setupIntegratedEnv();
    const states: CoachSnapshot[] = [];

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => 'Yes, please.',
      evaluate: (qId, ans, ctx) => h.apiClient.evaluate(qId, ans, true, ctx),
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    // 1st question
    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      meaning: 'relevant',
                      sentenceComplete: true,
                      feedbackKo: '좋아요.',
                      modelAnswerEn: 'Yes, please.',
                      nextQuestionId: 'cafe_payment',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    await controller.start(CAFE_QUESTIONS[4], { scenarioId: CAFE_SCENARIO_ID });
    expect(states.at(-1)!.phase).toBe('complete');
    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(1);

    // 2nd question: same answer 'Yes, please.' must NOT reuse cache from question 4!
    h.mockUpstreamFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      meaning: 'relevant',
                      sentenceComplete: true,
                      feedbackKo: '결제 답변입니다.',
                      modelAnswerEn: 'Yes, please.',
                      nextQuestionId: SCENARIO_COMPLETE_SENTINEL,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    await controller.start(CAFE_QUESTIONS[5], { scenarioId: CAFE_SCENARIO_ID });
    expect(states.at(-1)!.phase).toBe('complete');
    expect(h.mockUpstreamFetch).toHaveBeenCalledTimes(2); // strictly fresh call!
  });

  it('9. rejects drink -> payment transition even if client tampers question object with forged allowedNextQuestionIds', async () => {
    const states: CoachSnapshot[] = [];

    // Client object has forged allowedNextQuestionIds including cafe_payment
    const tamperedDrinkQuestion = {
      ...CAFE_QUESTIONS[0],
      allowedNextQuestionIds: ['cafe_payment'], // malicious client override
    };

    const mockEvaluate = vi.fn().mockResolvedValue({
      meaning: 'relevant',
      sentenceComplete: true,
      feedbackKo: '결제하세요.',
      modelAnswerEn: 'I want coffee.',
      nextQuestionId: 'cafe_payment',
    });

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => 'Coffee, please.',
      evaluate: mockEvaluate,
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    // Controller must consult authoritative CAFE_QUESTIONS, which only allows temp & size for drink
    await controller.start(tamperedDrinkQuestion, { scenarioId: CAFE_SCENARIO_ID });

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('error');
    expect(lastState.practiceDone).toBe(0);
    expect(lastState.pendingNextQuestionId).toBeUndefined();
    expect(lastState.message).toContain('유효하지 않은 다음 질문 추천입니다.');
  });

  it('10. drops older history whole without text truncation when 3 items or large multilingual texts exceed 1024B', async () => {
    const states: CoachSnapshot[] = [];
    let capturedContext: any = null;

    const mockEvaluate = vi.fn().mockImplementation((_qId, _ans, ctx) => {
      capturedContext = ctx;
      return Promise.resolve({
        meaning: 'relevant',
        sentenceComplete: true,
        feedbackKo: '좋아요.',
        modelAnswerEn: 'Medium, please.',
        nextQuestionId: 'cafe_dine_in',
      });
    });

    const controller = new CoachTutorController({
      speak: async () => true,
      listen: async () => 'Medium, please.',
      evaluate: mockEvaluate,
      cancel: () => {},
      emit: (s) => states.push(structuredClone(s)),
    });

    // Provide 3 items with multi-byte text (total length and bytes exceed 1024B)
    const longText1 = '아이스 아메리카노 주세요. '.repeat(20); // ~400 chars, ~1100 bytes
    const longText2 = '차가운 걸로 부탁드립니다. '.repeat(10); // ~150 chars, ~430 bytes
    const longText3 = '중간 사이즈로 마실게요. '.repeat(5); // ~75 chars, ~210 bytes

    const inputContextHistory = [
      { questionId: 'cafe_drink', answer: longText1 },
      { questionId: 'cafe_temp', answer: longText2 },
      { questionId: 'cafe_temp', answer: longText3 },
    ];

    await controller.start(CAFE_QUESTIONS[2], {
      scenarioId: CAFE_SCENARIO_ID,
      recentContext: inputContextHistory,
    });

    expect(mockEvaluate).toHaveBeenCalledOnce();
    expect(capturedContext).toBeDefined();

    const deliveredRecentContext = capturedContext.recentContext;
    expect(deliveredRecentContext).toBeDefined();

    // 1. Total bytes must be strictly <= 1024
    const totalBytes = new TextEncoder().encode(JSON.stringify(deliveredRecentContext)).byteLength;
    expect(totalBytes).toBeLessThanOrEqual(1024);

    // 2. Oldest item (longText1 and/or longText2) must be dropped WHOLE, never truncated character-wise
    for (const item of deliveredRecentContext) {
      if (item.answer.includes('중간 사이즈로 마실게요.')) {
        expect(item.answer).toBe(longText3); // preserved whole!
      }
      if (item.answer.includes('차가운 걸로 부탁드립니다.')) {
        expect(item.answer).toBe(longText2); // preserved whole!
      }
    }

    const lastState = states.at(-1)!;
    expect(lastState.phase).toBe('complete');
    expect(lastState.approvedAnswer).toBe('Medium, please.');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { handlePublicCoach } from '../src/features/conversation/server/publicCoachHandler';
import { COACH_POLICY_VERSION, COACH_QUESTIONS } from '../src/features/conversation/coach/coachProtocol';
import { MODEL_HARD_CAPS_90_PERCENT } from '../src/features/conversation/server/budgetPolicy';
import type { D1PreparedStatement } from '../src/features/conversation/server/budgetAdapter';

const evaluation = { meaning: 'relevant', sentenceComplete: false, feedbackKo: '뜻은 전달됐어요. 이번에는 완전한 문장으로 말해 봐요.', modelAnswerEn: 'I am twenty years old.' };
function setup(overrides: Record<string, unknown> = {}, denyBudget = false) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const run = async () => ({ success: true, meta: { changes: denyBudget ? 0 : 1 } });
  const db = { prepare(sql: string): D1PreparedStatement { const statement: D1PreparedStatement = { run, bind(...values: unknown[]) { statements.push({ sql, values }); return statement; } }; return statement; } };
  const env = { PUBLIC_CONVERSATION_ENABLED: 'true', ALLOW_EXTERNAL_GEMINI_CALLS: 'true', CONVERSATION_FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: 'TEST_ONLY_KEY_DO_NOT_USE', CONVERSATION_BUDGET_DB: db, CONVERSATION_MODEL_LIMITS_JSON: JSON.stringify(MODEL_HARD_CAPS_90_PERCENT), ...overrides };
  const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(evaluation) }] } }] }), { headers: { 'Content-Type': 'application/json' } }));
  return { env, fetchFn, statements };
}
function request(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('https://study.example/api/conversation/coach', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://study.example', 'CF-Connecting-IP': '203.0.113.5', ...headers },
    body: JSON.stringify({ requestId: '0a1f7384-9e4e-4a7e-a62e-5f8667e28a1a', adultConfirmed: true, policyVersion: COACH_POLICY_VERSION, questionId: COACH_QUESTIONS[0].id, answer: 'Alex.', ...body }),
  });
}

describe('anonymous adult coach admission and shared budget', () => {
  it('uses compact single-call evaluation with bounded output and minimal thinking', async () => {
    const {env,fetchFn}=setup();await handlePublicCoach(request(),env,{fetchFn});
    expect(fetchFn).toHaveBeenCalledOnce();const body=JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.generationConfig).toMatchObject({responseMimeType:'application/json',maxOutputTokens:512,thinkingConfig:{thinkingLevel:'minimal'}});
    // Beginner intent/grammar and uncertain-input safeguards fit within the revised compact prompt budget.
    expect(body.system_instruction.parts[0].text.length).toBeLessThan(1500);
    expect(JSON.parse(body.contents[0].parts[0].text).userAnswerEn).toBe('Alex.');
  });
  it('requires no Access JWT or internal-trial checkboxes, but reserves and consumes the shared model budget', async () => {
    const { env, fetchFn, statements } = setup();
    const response = await handlePublicCoach(request(), env, { fetchFn });
    expect(response.status).toBe(200); expect(fetchFn).toHaveBeenCalledOnce();
    expect((await response.json()).evaluation).toEqual(evaluation);
    expect(statements[0].sql).toContain('INSERT INTO conversation_budget_reservations');
    expect(statements[0].values[2]).toBe('gemini-3.5-flash-lite');
    expect(statements[0].values[5]).toBeGreaterThan(16384);
    expect(statements[0].values.at(-1)).toBe(13);
    expect(statements.some(statement => statement.sql.includes("state = 'consumed'"))).toBe(true);
    expect(JSON.stringify(statements)).not.toContain('Alex.');
    expect(JSON.stringify(statements)).not.toContain('203.0.113.5');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it.each([{ adultConfirmed: false }, { policyVersion: 'old' }, { questionId: 'attacker-question' }, { answer: ' ' }, { answer: 'x'.repeat(501) }, { requestId: 'not-uuid' }])('rejects invalid learner assertions before budget or Google: %j', async invalid => {
    const { env, fetchFn, statements } = setup();
    const response = await handlePublicCoach(request(invalid), env, { fetchFn });
    expect(response.status).toBeGreaterThanOrEqual(400); expect(fetchFn).not.toHaveBeenCalled(); expect(statements).toHaveLength(0);
  });

  it('rejects cross-origin requests before Google and does not use legacy DB as a budget fallback', async () => {
    const { env, fetchFn } = setup();
    expect((await handlePublicCoach(request({}, { Origin: 'https://attacker.example' }), env, { fetchFn })).status).toBe(403);
    const withoutBudget = setup({ CONVERSATION_BUDGET_DB: undefined, DB: env.CONVERSATION_BUDGET_DB });
    expect((await handlePublicCoach(request(), withoutBudget.env, { fetchFn })).status).toBeGreaterThanOrEqual(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stays closed when public activation is absent or budget reservation is rejected', async () => {
    const disabled = setup({ PUBLIC_CONVERSATION_ENABLED: undefined });
    expect((await handlePublicCoach(request(), disabled.env, { fetchFn: disabled.fetchFn })).status).toBeGreaterThanOrEqual(400);
    expect(disabled.fetchFn).not.toHaveBeenCalled();
    const denied = setup({}, true);
    expect((await handlePublicCoach(request(), denied.env, { fetchFn: denied.fetchFn })).status).toBe(429);
    expect(denied.fetchFn).not.toHaveBeenCalled();
  });

  it('rejects unvalidated model output instead of claiming the learner passed', async () => {
    const { env, fetchFn } = setup();
    fetchFn.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...evaluation, feedbackKo: 'Everything is correct!' }) }] } }] })));
    const response = await handlePublicCoach(request(), env, { fetchFn });
    expect(response.status).toBe(502);
    expect((await response.json()).success).toBe(false);
  });

  it('a provider failure stays charged and does not trigger automatic retry or refund', async () => {
    const { env, fetchFn, statements } = setup();
    fetchFn.mockResolvedValue(new Response('unavailable', { status: 503 }));
    const response = await handlePublicCoach(request(), env, { fetchFn });
    expect(response.status).toBeGreaterThanOrEqual(400); expect(fetchFn).toHaveBeenCalledOnce();
    expect(statements.some(statement => statement.sql.includes("state = 'consumed'"))).toBe(true);
    expect(statements.some(statement => statement.sql.includes("state = 'released'"))).toBe(false);
    expect(JSON.stringify(await response.json())).not.toContain('TEST_ONLY_KEY_DO_NOT_USE');
  });
});

it('accepts final English directly, forwards coffee intact and keeps legacy extra fields compatible',async()=>{
 for(const extra of [{},{transcriptConfirmed:true}]){
  const {env,fetchFn}=setup();const response=await handlePublicCoach(request({questionId:'cafe',answer:'Coffee, please.',...extra}),env,{fetchFn});
  expect(response.status).toBe(200);expect(fetchFn).toHaveBeenCalledOnce();const upstream=JSON.parse(fetchFn.mock.calls[0][1].body);
  expect(JSON.parse(upstream.contents[0].parts[0].text).userAnswerEn).toBe('Coffee, please.');
  expect(upstream.system_instruction.parts[0].text).toMatch(/Coffee, please/i);
 }
});

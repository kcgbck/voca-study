// tests/conversationPagesIntegration.test.ts
// Cloudflare Pages Functions AI 회화 엔드포인트(/api/conversation/*) 통합 검증
// [주의: 모든 테스트 쿼터 및 JWKS는 가상 fixture이며, 실제 Google/Cloudflare Access/운영 D1 호출이 아님]
// [운영 연동 완료나 사람 검수 완료, 공개 적합성 승인을 선언하지 않음]

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  handlePagesConversationRequest,
  onRequest,
} from '../functions/api/conversation/[[action]]';
import {
  ConversationApiClient,
  type UserConsent,
} from '../src/features/conversation/services/conversationApi';
import { CONVERSATION_POLICY_VERSION } from '../src/features/conversation/types';
import {
  type D1Database,
  type D1PreparedStatement,
  type D1RunResult,
} from '../src/features/conversation/server/budgetAdapter';
import {
  pcm16ToWav,
  uint8ArrayToBase64,
} from '../src/features/conversation/server/audioUtils';

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function stringToBase64Url(text: string): string {
  return uint8ArrayToBase64Url(new TextEncoder().encode(text));
}

async function createSignedJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: CryptoKey
): Promise<string> {
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const dataToSign = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    dataToSign
  );

  const sigB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function createTestPublicJwk(
  publicKey: CryptoKey,
  kid: string
): Promise<Record<string, unknown>> {
  const exported = await crypto.subtle.exportKey('jwk', publicKey);
  return {
    ...exported,
    kid,
    use: 'sig',
    alg: 'RS256',
  };
}

function createTestD1Wrapper(db: DatabaseSync): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const createStatement = (boundValues: unknown[]): D1PreparedStatement => ({
        bind(...values: unknown[]): D1PreparedStatement {
          return createStatement(values);
        },
        async run(): Promise<D1RunResult> {
          try {
            const stmt = db.prepare(query);
            const res = stmt.run(...(boundValues as (null | number | bigint | string | Uint8Array)[]));
            return {
              success: true,
              meta: { changes: Number(res.changes) },
            };
          } catch (err) {
            return {
              success: false,
              meta: { changes: 0 },
              error: err,
            };
          }
        },
      });
      return createStatement([]);
    },
  };
}

describe('Cloudflare Pages Functions AI 회화 엔드포인트 통합 검증 (격리 환경)', () => {
  const teamDomain = 'https://my-org.cloudflareaccess.com';
  const audience = 'aud-integration-test-tag';
  const appOrigin = 'https://toeic.app';

  const validModelLimitsJson = JSON.stringify({
    'gemini-3.5-flash-lite': { rpm: 10, tpm: 1000000, rpd: 1000, callerRpm: 10 },
    'gemini-3.5-transcribe': { rpm: 10, tpm: 1000000, rpd: 1000, callerRpm: 10 },
    'gemini-3.8-flash-lite-tts': { rpm: 10, tpm: 1000000, rpd: 1000, callerRpm: 10 },
  });

  const validChatPayload = {
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    userConsentToCloud: true,
    consentPolicyVersion: CONVERSATION_POLICY_VERSION,
    consent: {
      isAdult: true,
      sendCurrentTurnOnlyAgreed: true,
      googleReviewDisclosureAgreed: true,
      noSensitiveInfoAgreed: true,
    },
    lessonId: 'intro-u01-l01',
    contentRevision: 1,
    userSpokenText: 'Hello, I am Alex.',
    currentPhase: 'practice',
  };

  const validGeminiChatSuccessResponse = {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            {
              text: JSON.stringify({
                evaluation: 'ACCEPT',
                userSpokenText: 'Hello, I am Alex.',
                isShortAnswer: false,
                tutorResponseEn: 'Nice to meet you Alex! Let us practice.',
                factualConsistency: { consistent: true },
              }),
            },
          ],
        },
      },
    ],
  };

  function setupInMemoryDatabase(): { db: DatabaseSync; d1: D1Database } {
    const db = new DatabaseSync(':memory:');
    const schemaPath = path.resolve('scripts/conversation/budget-schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    return { db, d1: createTestD1Wrapper(db) };
  }

  it('1. default flags 미구성 시 failclosed (403, upstream 0회)', async () => {
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(validChatPayload),
    });

    // 기본 미구성 env로 프로덕션 onRequest 엔트리포인트 검증
    const res = await onRequest({
      request: req,
      env: {
        CONVERSATION_BUDGET_DB: d1,
      },
      params: { action: 'chat' },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.fallbackToRuleEngine).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('2. API key 누락 시 failclosed (403, upstream 0회)', async () => {
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: '', // 누락
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('3. Model limits JSON 형식 오류/음수/누락 모델 시 failclosed (403, upstream 0회)', async () => {
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    // tts 모델 누락
    const incompleteLimitsJson = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 10, tpm: 1000, rpd: 100, callerRpm: 10 },
      'gemini-3.5-transcribe': { rpm: 10, tpm: 1000, rpd: 100, callerRpm: 10 },
    });

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: incompleteLimitsJson,
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('4. CONVERSATION_BUDGET_DB 누락 시 failclosed (403, upstream 0회, env.DB fallback 안함)', async () => {
    const upstreamFetch = vi.fn();
    const fakeAppDb = { prepare: vi.fn() };

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
          DB: fakeAppDb, // 기존 앱 DB가 있어도 fallback 금지
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(403);
    expect(fakeAppDb.prepare).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('5. 사용자 동의(consent) 누락 시 failclosed (403, upstream 0회, JWKS 0회)', async () => {
    const upstreamFetch = vi.fn();
    const authFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const badConsentPayload = {
      ...validChatPayload,
      consent: {
        ...validChatPayload.consent,
        isAdult: false, // 미성년 거부
      },
    };

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(badConsentPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(403);
    expect(authFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('6. 이전 버전(old policy version) 동의 시 failclosed (403, upstream 0회, JWKS 0회)', async () => {
    const upstreamFetch = vi.fn();
    const authFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const oldVersionPayload = {
      ...validChatPayload,
      consentPolicyVersion: 'v1.0-20250101', // 구버전 동의 재활용 거절
    };

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(oldVersionPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(403);
    expect(authFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('7. JWT 누락 또는 서명 위조 시 거부 (401, upstream 0회)', async () => {
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    // 헤더 누락
    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('8. Origin 누락 또는 불일치 시 거부 (403, upstream 0회)', async () => {
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    // 1) Origin 누락
    const reqNoOrigin = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validChatPayload),
    });

    const res1 = await handlePagesConversationRequest(
      {
        request: reqNoOrigin,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );
    expect(res1.status).toBe(403);

    // 2) Origin 불일치 (악의적 타 사이트)
    const reqBadOrigin = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.com',
      },
      body: JSON.stringify(validChatPayload),
    });

    const res2 = await handlePagesConversationRequest(
      {
        request: reqBadOrigin,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { upstreamFetchFn: upstreamFetch }
    );
    expect(res2.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('9. 정상 요청 시 200 반환 및 DB reservation consumed 확정 (upstream 1회)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    let capturedUpstreamUrl = '';
    const upstreamFetch = vi.fn().mockImplementation(async (url) => {
      capturedUpstreamUrl = String(url);
      return new Response(JSON.stringify(validGeminiChatSuccessResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.evaluation.evaluation).toBe('ACCEPT');
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(capturedUpstreamUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
    );

    // DB 확인: state가 consumed로 변경되었고 units가 양수이며 model이 gemini-3.5-flash-lite임 확인
    const row = db.prepare('SELECT model, state, units FROM conversation_budget_reservations').get() as { model: string; state: string; units: number };
    expect(row).toBeDefined();
    expect(row.model).toBe('gemini-3.5-flash-lite');
    expect(row.state).toBe('consumed');
    expect(row.units).toBeGreaterThan(0);
  });

  it('10. 동일 requestId 재전송 시 429 차단 및 추가 upstream 0회', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(validGeminiChatSuccessResponse), { status: 200 })
    );

    const { d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const makeRequest = () =>
      new Request(`${appOrigin}/api/conversation/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify(validChatPayload),
      });

    const env = {
      ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
      CONVERSATION_FREE_TIER_CONFIRMED: 'true',
      CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
      GEMINI_API_KEY: 'test-valid-key',
      CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
      CONVERSATION_ACCESS_AUDIENCE: audience,
      CONVERSATION_BUDGET_DB: d1,
      CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
    };

    const deps = { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 };

    // 1차 요청: 성공
    const res1 = await handlePagesConversationRequest({ request: makeRequest(), env, params: { action: 'chat' } }, deps);
    expect(res1.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    // 2차 요청 (동일 requestId 중복): 429 차단
    const res2 = await handlePagesConversationRequest({ request: makeRequest(), env, params: { action: 'chat' } }, deps);
    expect(res2.status).toBe(429);
    // 추가 Google 호출 0회
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('11. 병렬 경합 시 RPM 한도만큼만 통과하고 초과분은 429 차단', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(validGeminiChatSuccessResponse), { status: 200 })
    );

    const { d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    // RPM 2, callerRpm 10 가상 한도
    const tightLimitsJson = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 2, tpm: 1000000, rpd: 1000, callerRpm: 10 },
      'gemini-3.5-transcribe': { rpm: 10, tpm: 1000000, rpd: 1000, callerRpm: 10 },
      'gemini-3.8-flash-lite-tts': { rpm: 10, tpm: 1000000, rpd: 1000, callerRpm: 10 },
    });

    const env = {
      ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
      CONVERSATION_FREE_TIER_CONFIRMED: 'true',
      CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
      GEMINI_API_KEY: 'test-valid-key',
      CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
      CONVERSATION_ACCESS_AUDIENCE: audience,
      CONVERSATION_BUDGET_DB: d1,
      CONVERSATION_MODEL_LIMITS_JSON: tightLimitsJson,
    };

    const deps = { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 };

    // 서로 다른 발신자 4명이 동시 요청
    const tasks = Array.from({ length: 4 }, async (_, i) => {
      const jwt = await createSignedJwt(
        { alg: 'RS256', kid: 'test-kid-01' },
        { iss: teamDomain, aud: audience, sub: `user-${i}@example.com`, exp: nowSec + 3600, iat: nowSec },
        keyPair.privateKey
      );
      const req = new Request(`${appOrigin}/api/conversation/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({
          ...validChatPayload,
          requestId: `550e8400-e29b-41d4-a716-44665544000${i}`,
        }),
      });
      return handlePagesConversationRequest({ request: req, env, params: { action: 'chat' } }, deps);
    });

    const responses = await Promise.all(tasks);
    const passed = responses.filter((r) => r.status === 200).length;
    const blocked = responses.filter((r) => r.status === 429).length;

    // RPM 2로 인해 정확히 2건만 통과하고 2건은 429 차단
    expect(passed).toBe(2);
    expect(blocked).toBe(2);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('12. DB 스키마 부재 시 예산 예약 실패로 upstream 0회 차단', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );
    const upstreamFetch = vi.fn();

    // 빈 메모리 DB (테이블 없음)
    const emptyDb = new DatabaseSync(':memory:');
    const emptyD1 = createTestD1Wrapper(emptyDb);
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: emptyD1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    // 테이블 부재 에러로 429 fail-closed
    expect(res.status).toBe(429);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('13. reserved units가 실제 wire body bytes보다 크거나 같음 검증', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(validGeminiChatSuccessResponse), { status: 200 })
    );

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const rawBodyText = JSON.stringify(validChatPayload);
    const rawBodyBytes = new TextEncoder().encode(rawBodyText).byteLength;

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: rawBodyText,
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res.status).toBe(200);

    const row = db.prepare('SELECT units FROM conversation_budget_reservations').get() as { units: number };
    // 보수적 유닛 산정은 rawBodyBytes + lessonJsonBytes + 16KiB 이므로 반드시 rawBodyBytes 이상이어야 함
    expect(row.units).toBeGreaterThanOrEqual(rawBodyBytes);
    expect(row.units).toBeGreaterThanOrEqual(16 * 1024);
  });

  it('14. 클라이언트 API(ConversationApiClient)가 UUID 및 올바른 정책 버전을 전송함 검증', async () => {
    let capturedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_path, opts) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(
        JSON.stringify({
          success: true,
          evaluation: {
            evaluation: 'ACCEPT',
            userSpokenText: 'Hello',
            isShortAnswer: false,
            tutorResponseEn: 'Hi!',
            factualConsistency: { consistent: true },
          },
        }),
        { status: 200 }
      );
    });

    const client = new ConversationApiClient(mockFetch);
    const consent: UserConsent = {
      isAdult: true,
      sendCurrentTurnOnlyAgreed: true,
      googleReviewDisclosureAgreed: true,
      noSensitiveInfoAgreed: true,
    };

    await client.sendTurn(
      {
        lessonId: 'intro-u01-l01',
        contentRevision: 1,
        userSpokenText: 'Hello',
        currentPhase: 'practice',
      },
      consent
    );

    expect(capturedBody).toBeDefined();
    expect(capturedBody.consentPolicyVersion).toBe(CONVERSATION_POLICY_VERSION);
    expect(capturedBody.userConsentToCloud).toBe(true);
    expect(capturedBody.consent).toEqual({
      isAdult: true,
      sendCurrentTurnOnlyAgreed: true,
      googleReviewDisclosureAgreed: true,
      noSensitiveInfoAgreed: true,
    });

    // UUID v4 형식 검증 (기기 코드, 이메일, 개인 학습 ID 없음)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(capturedBody.requestId).toMatch(uuidRegex);
    expect(capturedBody.requestId).not.toContain('@');
  });

  it('15. upstream 타임아웃 시 consume no-refund 정책 연결 검증 (예약 환불 불가)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    // upstream이 즉시 AbortError(타임아웃 시뮬레이션)로 reject됨
    const upstreamFetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify(validChatPayload),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res.status).toBe(504);

    // upstream 호출이 개시된 이후 실패/타임아웃된 경우 환불(released)되지 않고 consumed 상태로 유지되어야 함 (no-refund)
    const row = db.prepare('SELECT state FROM conversation_budget_reservations').get() as { state: string };
    expect(row.state).toBe('consumed');
  });

  it('16. OPTIONS 동일 Origin preflight 204 허용, GET 405 차단, 알 수 없는 액션 404 차단', async () => {
    const { d1 } = setupInMemoryDatabase();
    const env = { CONVERSATION_BUDGET_DB: d1 };

    // 1) OPTIONS 프리플라이트: 동일 Origin 시 204
    const reqOptions = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'OPTIONS',
      headers: { Origin: appOrigin },
    });
    const resOptions = await handlePagesConversationRequest({ request: reqOptions, env, params: { action: 'chat' } });
    expect(resOptions.status).toBe(204);
    expect(resOptions.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin);

    // 2) GET 요청: 405 Method Not Allowed
    const reqGet = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'GET',
      headers: { Origin: appOrigin },
    });
    const resGet = await handlePagesConversationRequest({ request: reqGet, env, params: { action: 'chat' } });
    expect(resGet.status).toBe(405);

    // 3) 알 수 없는 액션: 404 Not Found
    const reqUnknown = new Request(`${appOrigin}/api/conversation/unknown_action`, {
      method: 'POST',
      headers: { Origin: appOrigin },
      body: JSON.stringify(validChatPayload),
    });
    const resUnknown = await handlePagesConversationRequest({ request: reqUnknown, env, params: { action: 'unknown_action' } });
    expect(resUnknown.status).toBe(404);
  });

  it('17. 설정완전/합성JWT있는 POST에서 3MiB 초과 열린 스트림 전송 시 즉시 stream.cancel 및 413 반환 (JWKS/upstream 0회, tee 교착 0)', async () => {
    let streamCancelled = false;
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024)); // 2 MiB
        controller.enqueue(new Uint8Array(2 * 1024 * 1024)); // 2 MiB (총 4 MiB > 3 MiB, 닫지 않은 열린 스트림)
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const authFetch = vi.fn();
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': 'fake.jwt.token',
      },
      body: oversizedStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const startTime = Date.now();
    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch }
    );
    const elapsed = Date.now() - startTime;

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.errorMessage).toContain('초과');
    expect(streamCancelled).toBe(true);
    // tee 원본 미소비 교착 없이 즉시 종료
    expect(elapsed).toBeLessThan(1000);
    expect(authFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('18. 유효하지 않은 JSON 문자열 전송 시 400 반환 (JWKS/upstream 0회)', async () => {
    const authFetch = vi.fn();
    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': 'fake.jwt.token',
      },
      body: 'invalid-json-string-not-an-object',
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch }
    );

    expect(res.status).toBe(400);
    expect(authFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('19. 원본 request의 AbortSignal이 forwardRequest로 전달되어 upstream 사전 취소 가능 검증', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn();
    const { d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const abortController = new AbortController();
    abortController.abort(new DOMException('Pre-aborted request', 'AbortError'));

    const req = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify(validChatPayload),
      signal: abortController.signal,
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: validModelLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res.status).toBe(504);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('20. 이전 chat 모델(gemini-3.8-flash) 키만 있고 신규 chat 모델 키가 없는 한도 JSON은 failclosed 403 및 upstream 0회 (신규 키 제공 시 200 통과)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-01');

    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify(validGeminiChatSuccessResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-01' },
      { iss: teamDomain, aud: audience, sub: 'user@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    // old chat 모델 키만 있고 gemini-3.5-flash-lite 키가 없는 JSON (rpm 10, tpm 1000000, rpd 100, callerRpm: 10)
    const oldChatLimitsJson = JSON.stringify({
      'gemini-3.8-flash': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
      'gemini-3.5-transcribe': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
      'gemini-3.8-flash-lite-tts': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
    });

    const reqOld = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        ...validChatPayload,
        requestId: '550e8400-e29b-41d4-a716-446655440020',
      }),
    });

    const resOld = await handlePagesConversationRequest(
      {
        request: reqOld,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: oldChatLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(resOld.status).toBe(403);
    expect(upstreamFetch).not.toHaveBeenCalled();

    // old 요청 후 예산 테이블에 예약이 생성되지 않았는지(count 0) 확인
    const countAfterOld = (
      db.prepare('SELECT count(*) as count FROM conversation_budget_reservations').get() as { count: number }
    ).count;
    expect(countAfterOld).toBe(0);

    // 같은 조건에서 chat 모델 키를 gemini-3.5-flash-lite로 바꾼 정상 설정
    const newChatLimitsJson = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
      'gemini-3.5-transcribe': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
      'gemini-3.8-flash-lite-tts': { rpm: 10, tpm: 1000000, rpd: 100, callerRpm: 10 },
    });

    const reqNew = new Request(`${appOrigin}/api/conversation/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        ...validChatPayload,
        requestId: '550e8400-e29b-41d4-a716-446655440021',
      }),
    });

    const resNew = await handlePagesConversationRequest(
      {
        request: reqNew,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: newChatLimitsJson,
        },
        params: { action: 'chat' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(resNew.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('21. 3초 PCM16 WAV STT 및 보통 TTS가 9000 TPM 한도 내에서 Pages 200 통과 및 올바른 모델 소진 확인', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-pages-90');
    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const upstreamFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.model === 'gemini-3.5-transcribe') {
        return new Response(
          JSON.stringify({
            steps: [{ content: [{ type: 'text', text: 'Hello Alex' }] }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (body.model === 'gemini-3.8-flash-lite-tts') {
        const dummyWav = pcm16ToWav(new Uint8Array(16000 * 1 * 2), 16000, 1);
        return new Response(
          JSON.stringify({
            steps: [{ content: [{ type: 'audio', data: uint8ArrayToBase64(dummyWav), mime_type: 'audio/wav' }] }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'unsupported model' }), { status: 400 });
    });

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-pages-90' },
      { iss: teamDomain, aud: audience, sub: 'user-stt-tts@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const limits90Json = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
      'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
      'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
    });

    // 1) 3초 PCM16 WAV STT 요청
    const wav3s = pcm16ToWav(new Uint8Array(16000 * 3 * 2), 16000, 1);
    const reqStt = new Request(`${appOrigin}/api/conversation/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: '550e8400-e29b-41d4-a716-446655440050',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        audioBase64: uint8ArrayToBase64(wav3s),
        mimeType: 'audio/wav',
        durationSeconds: 3,
      }),
    });

    const resStt = await handlePagesConversationRequest(
      {
        request: reqStt,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(resStt.status).toBe(200);
    const sttData = await resStt.json();
    expect(sttData.success).toBe(true);
    expect(sttData.transcription.trim()).toBe('Hello Alex');

    // D1 예약 확인: units는 1216(ceil(3*64)+1024), 상태 consumed, 모델 transcribe
    const sttRow = db
      .prepare("SELECT model, units, state FROM conversation_budget_reservations WHERE model = 'gemini-3.5-transcribe'")
      .get() as { model: string; units: number; state: string };
    expect(sttRow).toBeDefined();
    expect(sttRow.units).toBe(1216);
    expect(sttRow.state).toBe('consumed');

    // 2) 보통 TTS 요청
    const reqTts = new Request(`${appOrigin}/api/conversation/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: '550e8400-e29b-41d4-a716-446655440051',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        text: 'Hello Alex, nice to meet you!',
        voiceName: 'Kore',
      }),
    });

    const resTts = await handlePagesConversationRequest(
      {
        request: reqTts,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 1) * 1000 }
    );

    expect(resTts.status).toBe(200);
    const ttsData = await resTts.json();
    expect(ttsData.success).toBe(true);

    const ttsRow = db
      .prepare("SELECT model, units, state FROM conversation_budget_reservations WHERE model = 'gemini-3.8-flash-lite-tts'")
      .get() as { model: string; units: number; state: string };
    expect(ttsRow).toBeDefined();
    expect(ttsRow.units).toBeLessThanOrEqual(9000);
    expect(ttsRow.state).toBe('consumed');
  });

  it('22. STT 및 TTS 동일 caller 모델별 rolling 60초 2회 허용 후 3번째 429 차단 및 중복 requestId 429 (모델별 독립 격리)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-rpm');
    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    const dummyWav = pcm16ToWav(new Uint8Array(16000 * 1 * 2), 16000, 1);
    const upstreamFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.model === 'gemini-3.8-flash-lite-tts') {
        return new Response(
          JSON.stringify({
            steps: [{ content: [{ type: 'audio', data: uint8ArrayToBase64(dummyWav), mime_type: 'audio/wav' }] }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ steps: [{ content: [{ type: 'text', text: 'Transcribed' }] }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const { d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-rpm' },
      { iss: teamDomain, aud: audience, sub: 'user-rpm@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const limits90Json = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
      'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
      'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
    });

    const wav = pcm16ToWav(new Uint8Array(16000 * 1 * 2), 16000, 1);
    const makeReq = (id: string) =>
      new Request(`${appOrigin}/api/conversation/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({
          requestId: id,
          userConsentToCloud: true,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: true,
            sendCurrentTurnOnlyAgreed: true,
            googleReviewDisclosureAgreed: true,
            noSensitiveInfoAgreed: true,
          },
          audioBase64: uint8ArrayToBase64(wav),
          mimeType: 'audio/wav',
          durationSeconds: 1,
        }),
      });

    // 1회차 호출 (0초)
    const res1 = await handlePagesConversationRequest(
      {
        request: makeReq('req-01'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );
    expect(res1.status).toBe(200);

    // 2회차 호출 (10초 후)
    const res2 = await handlePagesConversationRequest(
      {
        request: makeReq('req-02'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 10) * 1000 }
    );
    expect(res2.status).toBe(200);

    // 3회차 호출 (20초 후 - 60초 윈도우 내 3번째): callerRpm 2 초과로 429 차단
    const res3 = await handlePagesConversationRequest(
      {
        request: makeReq('req-03'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 20) * 1000 }
    );
    expect(res3.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(2); // 3회차는 upstream 호출 0회

    // 중복 requestId 재전송 시 429 차단 (upstream 추가 호출 0회)
    const resDup = await handlePagesConversationRequest(
      {
        request: makeReq('req-01'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 21) * 1000 }
    );
    expect(resDup.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);

    // 동일 발신자(caller)이지만 TTS 모델은 독립적인 callerRpm=2 예산을 가짐
    const makeTtsReq = (id: string) =>
      new Request(`${appOrigin}/api/conversation/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({
          requestId: id,
          userConsentToCloud: true,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: true,
            sendCurrentTurnOnlyAgreed: true,
            googleReviewDisclosureAgreed: true,
            noSensitiveInfoAgreed: true,
          },
          text: 'Practice sentence',
          voiceName: 'Kore',
        }),
      });

    // TTS 1회차 호출 (25초): STT 소진과 무관하게 모델별 독립 격리로 200 허용
    const resTts1 = await handlePagesConversationRequest(
      {
        request: makeTtsReq('tts-req-01'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 25) * 1000 }
    );
    expect(resTts1.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(3);

    // TTS 2회차 호출 (35초): 200 허용
    const resTts2 = await handlePagesConversationRequest(
      {
        request: makeTtsReq('tts-req-02'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 35) * 1000 }
    );
    expect(resTts2.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(4);

    // TTS 3회차 호출 (45초 - 60초 윈도우 내 3번째): TTS 모델 callerRpm 2 초과로 429 차단
    const resTts3 = await handlePagesConversationRequest(
      {
        request: makeTtsReq('tts-req-03'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 45) * 1000 }
    );
    expect(resTts3.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(4);

    // TTS 중복 requestId 재전송 시 429 차단
    const resTtsDup = await handlePagesConversationRequest(
      {
        request: makeTtsReq('tts-req-01'),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 46) * 1000 }
    );
    expect(resTtsDup.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(4);
  });

  it('23. TTS 일일 9회 소진 후 10번째 호출은 429 차단 (가상 clock 61000ms 롤링 분리, 1건 upstream 실패 후에도 consumed 유지)', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-rpd');
    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    let callCount = 0;
    const dummyWav = pcm16ToWav(new Uint8Array(16000 * 1 * 2), 16000, 1);
    const upstreamFetch = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      callCount++;
      if (callCount === 1) {
        // 첫 1회차 호출은 upstream 500 오류 반환
        return new Response(JSON.stringify({ error: { message: 'Internal Server Error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          steps: [{ content: [{ type: 'audio', data: uint8ArrayToBase64(dummyWav), mime_type: 'audio/wav' }] }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const { db, d1 } = setupInMemoryDatabase();
    // 태평양 시간 기준 정오 (12:00 PM)에 고정
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-rpd' },
      { iss: teamDomain, aud: audience, sub: 'user-rpd@example.com', exp: nowSec + 86400 * 2, iat: nowSec },
      keyPair.privateKey
    );

    const limits90Json = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
      'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
      'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
    });

    // 가상 clock을 각 요청마다 61000ms (61초)씩 이동하여 rolling 60초 RPM/TPM 영향을 분리하면서 일일 RPD 9회 소진
    for (let i = 1; i <= 9; i++) {
      const stepTimeMs = nowSec * 1000 + i * 61000;
      const req = new Request(`${appOrigin}/api/conversation/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({
          requestId: `tts-turn-${i}`,
          userConsentToCloud: true,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: true,
            sendCurrentTurnOnlyAgreed: true,
            googleReviewDisclosureAgreed: true,
            noSensitiveInfoAgreed: true,
          },
          text: `Practice sentence number ${i}`,
          voiceName: 'Kore',
        }),
      });

      const res = await handlePagesConversationRequest(
        {
          request: req,
          env: {
            ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
            CONVERSATION_FREE_TIER_CONFIRMED: 'true',
            CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
            GEMINI_API_KEY: 'test-valid-key',
            CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
            CONVERSATION_ACCESS_AUDIENCE: audience,
            CONVERSATION_BUDGET_DB: d1,
            CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
          },
          params: { action: 'tts' },
        },
        { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => stepTimeMs }
      );

      if (i === 1) {
        expect(res.status).toBe(502); // upstream 500 오류
      } else {
        expect(res.status).toBe(200);
      }
    }

    expect(upstreamFetch).toHaveBeenCalledTimes(9);

    // 1회차 실패 건을 포함하여 9건 모두 consumed 상태로 DB에 기록되어 있는지 확인
    const consumedCount = (
      db
        .prepare(
          "SELECT count(*) as count FROM conversation_budget_reservations WHERE model = 'gemini-3.8-flash-lite-tts' AND state = 'consumed'"
        )
        .get() as { count: number }
    ).count;
    expect(consumedCount).toBe(9);

    // 10번째 호출 (여전히 동일 태평양 일자, 61000ms 후) -> RPD 9 한도 도달로 429 차단
    const step10Ms = nowSec * 1000 + 10 * 61000;
    const req10 = new Request(`${appOrigin}/api/conversation/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: 'tts-turn-10',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        text: 'Practice sentence number 10',
        voiceName: 'Kore',
      }),
    });

    const res10 = await handlePagesConversationRequest(
      {
        request: req10,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => step10Ms }
    );

    expect(res10.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(9); // 10번째는 upstream 호출 0회
  });

  it('24. 업스트림 실패(500) 시에도 예약 상태는 consumed로 유지되고 중복 requestId는 429 차단', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-fail');
    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );

    // 업스트림이 500 오류를 반환
    const upstreamFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ error: { message: 'Internal Server Error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-fail' },
      { iss: teamDomain, aud: audience, sub: 'user-fail@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const limits90Json = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
      'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
      'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
    });

    const fixedRequestId = '550e8400-e29b-41d4-a716-446655440099';
    const makeReq = () =>
      new Request(`${appOrigin}/api/conversation/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: appOrigin,
          'Cf-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({
          requestId: fixedRequestId,
          userConsentToCloud: true,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: true,
            sendCurrentTurnOnlyAgreed: true,
            googleReviewDisclosureAgreed: true,
            noSensitiveInfoAgreed: true,
          },
          text: 'Practice fail sentence',
          voiceName: 'Kore',
        }),
      });

    // 1차 호출: 업스트림 500 반환
    const res1 = await handlePagesConversationRequest(
      {
        request: makeReq(),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res1.status).toBe(502); // GeminiApiError 502

    // D1에서 쿼터가 환불되지 않고 'consumed'로 소진 처리되었는지 확인
    const row = db
      .prepare("SELECT state FROM conversation_budget_reservations WHERE model = 'gemini-3.8-flash-lite-tts'")
      .get() as { state: string };
    expect(row.state).toBe('consumed');

    // 동일한 requestId로 재시도 시 primary key 충돌 및 중복 요청으로 429 차단
    const resRetry = await handlePagesConversationRequest(
      {
        request: makeReq(),
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'tts' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => (nowSec + 1) * 1000 }
    );

    expect(resRetry.status).toBe(429);
    expect(upstreamFetch).toHaveBeenCalledTimes(1); // 재시도는 업스트림 도달 전 차단
  });

  it('25. 31초 초과 WAV는 metadata를 1초로 조작해도 Pages 400 반환 및 upstream/예약 0건', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'test-kid-oversize');
    const authFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 })
    );
    const upstreamFetch = vi.fn();
    const { db, d1 } = setupInMemoryDatabase();
    const nowSec = 1700000000;

    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'test-kid-oversize' },
      { iss: teamDomain, aud: audience, sub: 'user-oversize@example.com', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const limits90Json = JSON.stringify({
      'gemini-3.5-flash-lite': { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
      'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
      'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
    });

    // 8kHz mono 16-bit PCM으로 31초 WAV 생성 (16000 * 31 = 496000 바이트)
    const longWav = pcm16ToWav(new Uint8Array(16000 * 31), 8000, 1);

    const req = new Request(`${appOrigin}/api/conversation/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: '550e8400-e29b-41d4-a716-446655440098',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        audioBase64: uint8ArrayToBase64(longWav),
        mimeType: 'audio/wav',
        durationSeconds: 1, // 클라이언트가 지속시간을 1초로 거짓말함
      }),
    });

    const res = await handlePagesConversationRequest(
      {
        request: req,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errorMessage).toContain('최대 허용치');
    expect(upstreamFetch).not.toHaveBeenCalled();

    let count = (
      db.prepare('SELECT count(*) as count FROM conversation_budget_reservations').get() as { count: number }
    ).count;
    expect(count).toBe(0);

    // MIME이 audio/webm으로 위장된 31초 WAV도 Pages config 경로에서 400 반환 및 upstream/예약 0건
    const reqWebmDisguised = new Request(`${appOrigin}/api/conversation/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: '550e8400-e29b-41d4-a716-446655440097',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        audioBase64: uint8ArrayToBase64(longWav),
        mimeType: 'audio/webm', // webm으로 위장
        durationSeconds: 1,
      }),
    });

    const resWebm = await handlePagesConversationRequest(
      {
        request: reqWebmDisguised,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(resWebm.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
    count = (
      db.prepare('SELECT count(*) as count FROM conversation_budget_reservations').get() as { count: number }
    ).count;
    expect(count).toBe(0);

    // 2 MiB 초과 오디오 전송 시에도 Pages 400 반환 및 upstream/예약 0건
    const hugeAudio = new Uint8Array(2 * 1024 * 1024 + 100);
    const reqHuge = new Request(`${appOrigin}/api/conversation/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: appOrigin,
        'Cf-Access-Jwt-Assertion': jwt,
      },
      body: JSON.stringify({
        requestId: '550e8400-e29b-41d4-a716-446655440096',
        userConsentToCloud: true,
        consentPolicyVersion: CONVERSATION_POLICY_VERSION,
        consent: {
          isAdult: true,
          sendCurrentTurnOnlyAgreed: true,
          googleReviewDisclosureAgreed: true,
          noSensitiveInfoAgreed: true,
        },
        audioBase64: uint8ArrayToBase64(hugeAudio),
        mimeType: 'audio/wav',
        durationSeconds: 2,
      }),
    });

    const resHuge = await handlePagesConversationRequest(
      {
        request: reqHuge,
        env: {
          ALLOW_EXTERNAL_GEMINI_CALLS: 'true',
          CONVERSATION_FREE_TIER_CONFIRMED: 'true',
          CONVERSATION_ADULT_TESTERS_CONFIRMED: 'true',
          GEMINI_API_KEY: 'test-valid-key',
          CONVERSATION_ACCESS_TEAM_DOMAIN: teamDomain,
          CONVERSATION_ACCESS_AUDIENCE: audience,
          CONVERSATION_BUDGET_DB: d1,
          CONVERSATION_MODEL_LIMITS_JSON: limits90Json,
        },
        params: { action: 'transcribe' },
      },
      { authFetchFn: authFetch, upstreamFetchFn: upstreamFetch, clockNow: () => nowSec * 1000 }
    );

    expect(resHuge.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
    count = (
      db.prepare('SELECT count(*) as count FROM conversation_budget_reservations').get() as { count: number }
    ).count;
    expect(count).toBe(0);
  });
});

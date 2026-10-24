// tests/conversationAuthBudget.test.ts
// Cloudflare Access RS256 JWT 인증 어댑터 및 D1 원자적 예산 제어 어댑터 단위/동시성 검증

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  CloudflareAccessAuthAdapter,
  sha256Hex,
} from '../src/features/conversation/server/authAdapter';
import {
  D1ServerBudgetAdapter,
  toPacificDateString,
  type D1Database,
  type D1PreparedStatement,
  type D1RunResult,
} from '../src/features/conversation/server/budgetAdapter';
import {
  GEMINI_MODELS,
  isAllowedModel,
} from '../src/features/conversation/server/geminiInteractionsClient';

/**
 * 테스트용 RS256 JWT 서명 헬퍼
 */
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

describe('1. Cloudflare Access RS256 JWT 인증 어댑터 검증', () => {
  const teamDomain = 'https://my-org.cloudflareaccess.com';
  const audience = 'aud-test-tag-12345';

  it('유효한 RS256 토큰은 서명 검증을 통과하고 SHA-256(sub) 기반 callerId를 반환해야 한다', async () => {
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

    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01', typ: 'JWT' },
      {
        iss: teamDomain,
        aud: audience,
        sub: 'test-user@example.com',
        exp: nowSec + 3600,
        iat: nowSec - 10,
        nbf: nowSec - 10,
      },
      keyPair.privateKey
    );

    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    const req = new Request('https://toeic.app/api/conversation/chat', {
      headers: {
        'Cf-Access-Jwt-Assertion': jwt,
      },
    });

    const result = await adapter.verifyCaller(req);
    expect(result.authorized).toBe(true);
    expect(result.callerId).toBe(await sha256Hex('test-user@example.com'));
    expect(result.reason).toBeUndefined();
  });

  it('서명이 위조된 토큰은 SIGNATURE_VERIFICATION_FAILED로 거부되어야 한다', async () => {
    const keyPair1 = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const keyPair2 = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );

    const publicJwk = await createTestPublicJwk(keyPair1.publicKey, 'kid-test-01');

    // keyPair2로 서명하여 서명 불일치 위조
    const nowSec = 1700000000;
    const forgedJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user@test.com', exp: nowSec + 3600, iat: nowSec },
      keyPair2.privateKey
    );

    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    const req = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': forgedJwt },
    });

    const result = await adapter.verifyCaller(req);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('SIGNATURE_VERIFICATION_FAILED');
  });

  it('alg: none 또는 HS256 알고리즘은 거부되어야 한다', async () => {
    const adapter = new CloudflareAccessAuthAdapter({ teamDomain, audience });

    // alg none
    const headerNone = stringToBase64Url(JSON.stringify({ alg: 'none', kid: 'kid-01' }));
    const payload = stringToBase64Url(JSON.stringify({ iss: teamDomain, aud: audience, sub: 'u', exp: 2000000000 }));
    const noneJwt = `${headerNone}.${payload}.`;

    const reqNone = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': noneJwt },
    });
    expect((await adapter.verifyCaller(reqNone)).reason).toBe('UNSUPPORTED_JWT_ALGORITHM');

    // alg HS256
    const headerHs = stringToBase64Url(JSON.stringify({ alg: 'HS256', kid: 'kid-01' }));
    const hsJwt = `${headerHs}.${payload}.fakeSignature`;
    const reqHs = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': hsJwt },
    });
    expect((await adapter.verifyCaller(reqHs)).reason).toBe('UNSUPPORTED_JWT_ALGORITHM');
  });

  it('iss 불일치, aud 불일치, 만료된 토큰, sub 누락은 각각 failclosed 거부되어야 한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    // 1. iss 불일치
    const badIssJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: 'https://evil-issuer.com', aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': badIssJwt } }))).reason).toBe('ISSUER_MISMATCH');

    // 2. aud 불일치
    const badAudJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: 'wrong-aud', sub: 'user', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': badAudJwt } }))).reason).toBe('AUDIENCE_MISMATCH');

    // 3. 만료된 토큰
    const expiredJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec - 100, iat: nowSec - 200 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': expiredJwt } }))).reason).toBe('TOKEN_EXPIRED');

    // 4. sub 누락
    const emptySubJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: '   ', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': emptySubJwt } }))).reason).toBe('MISSING_SUBJECT');
  });

  it('토큰 길이가 8KiB를 초과하거나 헤더가 누락되면 즉시 거부되어야 한다', async () => {
    const adapter = new CloudflareAccessAuthAdapter({ teamDomain, audience });

    // 헤더 누락
    const reqNoHeader = new Request('https://toeic.app/api/conversation/chat');
    expect((await adapter.verifyCaller(reqNoHeader)).reason).toBe('MISSING_CF_ACCESS_JWT_HEADER');

    // 8KiB 초과
    const oversizedJwt = 'a'.repeat(8193);
    const reqOversized = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': oversizedJwt },
    });
    expect((await adapter.verifyCaller(reqOversized)).reason).toBe('TOKEN_LENGTH_EXCEEDED');
  });

  it('JWKS 원격 조회 시 고정 domain/cdn-cgi/access/certs만 조회하고 64KiB 초과 및 리다이렉트를 거부해야 한다', async () => {
    let capturedUrl = '';
    let capturedRedirect = '';

    const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedUrl = String(url);
      capturedRedirect = opts?.redirect;
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    });

    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'remote-kid-1' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      fetchFn: mockFetch,
    });

    const req = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': jwt },
    });

    const result = await adapter.verifyCaller(req);
    expect(capturedUrl).toBe(`${teamDomain}/cdn-cgi/access/certs`);
    expect(capturedRedirect).toBe('manual');
    expect(result.authorized).toBe(false);
  });

  it('JWKS 조회 시 Workers 호환 fetch init(redirect: manual)을 사용하고 리다이렉트 응답 시 후속 요청 없이 즉시 거부되어야 한다', async () => {
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      capturedInit = init;
      // Workers 환경 new Request(url, init) 호환성 검증: redirect: 'manual'은 유효하며 예외가 발생하지 않음
      expect(() => new Request(url, init)).not.toThrow();
      // 302 Redirect 응답 모의 (ok: false)
      return new Response(null, {
        status: 302,
        statusText: 'Found',
        headers: { Location: `${teamDomain}/redirect-target` },
      });
    });

    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'redirect-test-kid' },
      { iss: teamDomain, aud: audience, sub: 'test-user', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      fetchFn: mockFetch,
    });

    const req = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': jwt },
    });

    const result = await adapter.verifyCaller(req);

    // Workers-compatible fetch init 검증
    expect(capturedInit?.redirect).toBe('manual');
    // 후속 요청(follow-up) 없이 정확히 1회만 fetch 수행
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 리다이렉트 응답 시 failclosed로 발신자 거부
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('JWKS_FETCH_ERROR');
  });

  it('JWT header 또는 payload가 객체가 아닌 경우(null, array, number 등) INVALID_JWT_JSON으로 거부되어야 한다', async () => {
    const adapter = new CloudflareAccessAuthAdapter({ teamDomain, audience });

    // 1. null header
    const nullHeaderJwt = `${stringToBase64Url('null')}.${stringToBase64Url('{}')}.fakeSig`;
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': nullHeaderJwt } }))).reason).toBe('INVALID_JWT_JSON');

    // 2. number payload
    const numberPayloadJwt = `${stringToBase64Url('{"alg":"RS256","kid":"k1"}')}.${stringToBase64Url('12345')}.fakeSig`;
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': numberPayloadJwt } }))).reason).toBe('INVALID_JWT_JSON');

    // 3. array payload
    const arrayPayloadJwt = `${stringToBase64Url('{"alg":"RS256","kid":"k1"}')}.${stringToBase64Url('["item"]')}.fakeSig`;
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': arrayPayloadJwt } }))).reason).toBe('INVALID_JWT_JSON');
  });

  it('토큰의 부분이 비어있거나 base64url 안전 문자가 아니면 MALFORMED_JWT_BASE64URL로 거부되어야 한다', async () => {
    const adapter = new CloudflareAccessAuthAdapter({ teamDomain, audience });

    // 세 파트 중 하나가 빈 문자열
    const emptyPartJwt = `header..sig`;
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': emptyPartJwt } }))).reason).toBe('MALFORMED_JWT_BASE64URL');

    // base64url이 아닌 문자(+, /, =) 포함
    const plusJwt = `part+1.part2.part3`;
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': plusJwt } }))).reason).toBe('MALFORMED_JWT_BASE64URL');
  });

  it('iat가 없거나 유효한 finite number가 아니거나 미래 시간이면 거부되어야 한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    // 1. iat 누락
    const missingIatJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': missingIatJwt } }))).reason).toBe('MISSING_OR_INVALID_IAT');

    // 2. string iat
    const stringIatJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: String(nowSec) as any },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': stringIatJwt } }))).reason).toBe('MISSING_OR_INVALID_IAT');

    // 3. 미래 iat
    const futureIatJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec + 10 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': futureIatJwt } }))).reason).toBe('TOKEN_ISSUED_IN_FUTURE');
  });

  it('nbf가 존재할 때 유효한 finite number가 아니거나 미래 시간이면 거부되어야 한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    // 1. string nbf
    const stringNbfJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec, nbf: 'not-a-number' as any },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': stringNbfJwt } }))).reason).toBe('INVALID_NBF');

    // 2. 미래 nbf
    const futureNbfJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec, nbf: nowSec + 10 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': futureNbfJwt } }))).reason).toBe('TOKEN_NOT_YET_VALID');
  });

  it('1초라도 지난 만료 토큰(exp <= now)은 skew 없이 즉시 거부되어야 한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    // 정확히 1초 전 만료
    const expired1sJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec - 1, iat: nowSec - 100 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': expired1sJwt } }))).reason).toBe('TOKEN_EXPIRED');

    // 현재 시간과 동일(exp === nowSec) -> exp > nowSec 불만족으로 거부
    const exactNowJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec, iat: nowSec - 100 },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': exactNowJwt } }))).reason).toBe('TOKEN_EXPIRED');
  });

  it('sub의 길이가 256자를 초과하면 INVALID_SUBJECT로 거부되어야 한다', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await createTestPublicJwk(keyPair.publicKey, 'kid-test-01');

    const nowSec = 1700000000;
    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      publicJwksFixture: { keys: [publicJwk] },
      clockNow: () => nowSec * 1000,
    });

    // sub 길이 257
    const longSub = 'u'.repeat(257);
    const longSubJwt = await createSignedJwt(
      { alg: 'RS256', kid: 'kid-test-01' },
      { iss: teamDomain, aud: audience, sub: longSub, exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );
    expect((await adapter.verifyCaller(new Request('https://a.b', { headers: { 'Cf-Access-Jwt-Assertion': longSubJwt } }))).reason).toBe('INVALID_SUBJECT');
  });

  it('원격 certs 조회 시 64KiB 초과 시 stream reader가 cancel되고 거절되어야 한다', async () => {
    let streamCancelled = false;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(40 * 1024));
        controller.enqueue(new Uint8Array(40 * 1024)); // total 80KiB > 64KiB (스트림을 닫지 않고 열린 상태 유지하여 조기 cancel 검증)
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    const adapter = new CloudflareAccessAuthAdapter({
      teamDomain,
      audience,
      fetchFn: mockFetch,
    });

    const keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await createSignedJwt(
      { alg: 'RS256', kid: 'oversized-kid' },
      { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec },
      keyPair.privateKey
    );

    const req = new Request('https://toeic.app/api/conversation/chat', {
      headers: { 'Cf-Access-Jwt-Assertion': jwt },
    });

    const res = await adapter.verifyCaller(req);
    expect(res.authorized).toBe(false);
    expect(res.reason).toBe('JWKS_FETCH_ERROR');
    expect(streamCancelled).toBe(true);
  });

  it('원격 certs 조회가 3초 동안 응답하지 않는 미협조 스트림인 경우 타임아웃으로 유한 종료되어야 한다', async () => {
    vi.useFakeTimers();
    try {
      const hangingStream = new ReadableStream({
        start() {
          // 의도적으로 완료되지 않는 미협조 스트림
        },
      });

      const mockFetch = vi.fn().mockResolvedValue(new Response(hangingStream, { status: 200 }));

      const adapter = new CloudflareAccessAuthAdapter({
        teamDomain,
        audience,
        fetchFn: mockFetch,
      });

      const keyPair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      );
      const nowSec = Math.floor(Date.now() / 1000);
      const jwt = await createSignedJwt(
        { alg: 'RS256', kid: 'hanging-kid' },
        { iss: teamDomain, aud: audience, sub: 'user', exp: nowSec + 3600, iat: nowSec },
        keyPair.privateKey
      );

      const req = new Request('https://toeic.app/api/conversation/chat', {
        headers: { 'Cf-Access-Jwt-Assertion': jwt },
      });

      const verifyPromise = adapter.verifyCaller(req);
      await vi.advanceTimersByTimeAsync(3000);

      const res = await verifyPromise;
      expect(res.authorized).toBe(false);
      expect(res.reason).toBe('JWKS_FETCH_ERROR');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('2. D1 단일 쓰기 원자적 예산(Budget) 어댑터 검증 (node:sqlite 실제 메모리 DB)', () => {
  function createTestD1Wrapper(
    db: DatabaseSync,
    interceptor?: (query: string, values: unknown[]) => D1RunResult | undefined
  ): D1Database {
    return {
      prepare(query: string): D1PreparedStatement {
        const createStatement = (boundValues: unknown[]): D1PreparedStatement => ({
          bind(...values: unknown[]): D1PreparedStatement {
            return createStatement(values);
          },
          async run(): Promise<D1RunResult> {
            if (interceptor) {
              const intercepted = interceptor(query, boundValues);
              if (intercepted !== undefined) {
                return intercepted;
              }
            }
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

  function setupInMemoryDatabase(): D1Database {
    const db = new DatabaseSync(':memory:');
    const schemaPath = path.resolve('scripts/conversation/budget-schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    return createTestD1Wrapper(db);
  }

  it('병렬 50개 동시 예약(Promise.all) 요청 중 정확히 RPM 한도(10)만큼만 원자적으로 통과해야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    // 가상 테스트용 한도: rpm 10, tpm 10000, rpd 1000, callerRpm 50
    const adapter1 = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 10000,
      rpd: 1000,
      callerRpm: 50,
      clockNow: () => 1700000000000,
    });

    const adapter2 = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 10000,
      rpd: 1000,
      callerRpm: 50,
      clockNow: () => 1700000000000,
    });

    // 50개의 서로 다른 requestId로 2개 어댑터를 통해 병렬 요청
    const tasks = Array.from({ length: 50 }, (_, i) => {
      const adapter = i % 2 === 0 ? adapter1 : adapter2;
      return adapter.reserve(`user-${i}:req-concurrent-${i}`, 1);
    });

    const results = await Promise.all(tasks);
    const passed = results.filter((r) => r.allowed).length;
    const blocked = results.filter((r) => !r.allowed).length;

    // 단일 INSERT ... SELECT ... WHERE 원자적 조건으로 인해 정확히 10건만 승인됨
    expect(passed).toBe(10);
    expect(blocked).toBe(40);
  });

  it('동일한 requestId는 중복 예약 시 PK 충돌로 인해 즉시 거부되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 1000,
      rpd: 100,
      callerRpm: 10,
    });

    const first = await adapter.reserve('user-1:req-atomic-01', 1);
    expect(first.allowed).toBe(true);

    const duplicate = await adapter.reserve('user-1:req-atomic-01', 1);
    expect(duplicate.allowed).toBe(false);
  });

  it('TPM 한도를 초과하는 유닛 예약은 원자적으로 거절되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    // 가상 한도: tpm 100
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100,
      rpd: 100,
      callerRpm: 10,
      clockNow: () => 1700000000000,
    });

    // 1차: 80유닛 예약 성공
    const res1 = await adapter.reserve('user-1:req-tpm-1', 80);
    expect(res1.allowed).toBe(true);

    // 2차: 30유닛 예약 시도 -> 80 + 30 = 110 > 100으로 거절
    const res2 = await adapter.reserve('user-1:req-tpm-2', 30);
    expect(res2.allowed).toBe(false);

    // 3차: 20유닛 예약 시도 -> 80 + 20 = 100 <= 100으로 통과
    const res3 = await adapter.reserve('user-1:req-tpm-3', 20);
    expect(res3.allowed).toBe(true);
  });

  it('미국 태평양 표준시(RPD) 일일 한도가 소진되면 거부되고 날짜 변경 시 리셋되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    let currentMs = new Date('2026-10-22T20:00:00Z').getTime(); // Pacific 13:00

    // 가상 한도: rpd 2
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 100,
      tpm: 10000,
      rpd: 2,
      callerRpm: 100,
      clockNow: () => currentMs,
    });

    expect((await adapter.reserve('u:req-rpd-1', 1)).allowed).toBe(true);
    expect((await adapter.reserve('u:req-rpd-2', 1)).allowed).toBe(true);
    // 3번째는 일일 한도 초과로 거부
    expect((await adapter.reserve('u:req-rpd-3', 1)).allowed).toBe(false);

    // 태평양 시간 자정 경과 (24시간 뒤)
    currentMs += 24 * 60 * 60 * 1000;
    expect((await adapter.reserve('u:req-rpd-next-day', 1)).allowed).toBe(true);
  });

  it('발신자별(callerRpm) 분당 한도 초과 시 모델 한도와 무관하게 차단되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    // 가상 한도: callerRpm 2
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 100,
      tpm: 10000,
      rpd: 100,
      callerRpm: 2,
      clockNow: () => 1700000000000,
    });

    expect((await adapter.reserve('caller-A:req-1', 1)).allowed).toBe(true);
    expect((await adapter.reserve('caller-A:req-2', 1)).allowed).toBe(true);
    // 동일 발신자 3번째 요청 차단
    expect((await adapter.reserve('caller-A:req-3', 1)).allowed).toBe(false);

    // 다른 발신자는 여유 한도 내에서 통과
    expect((await adapter.reserve('caller-B:req-1', 1)).allowed).toBe(true);
  });

  it('consume은 reserved를 consumed로 변경하며 units를 줄이지 않고 멱등해야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });

    const reqId = 'user-1:req-consume-test';
    await adapter.reserve(reqId, 10);

    // 1회 consume: 15유닛으로 증가 확정
    await adapter.consume(reqId, 15);

    // 2회 consume: 5유닛을 요청해도 units가 줄어들지 않음 (MAX 적용)
    await adapter.consume(reqId, 5);

    // release 시도: 이미 consumed 상태이므로 절대 환불(released로 변경) 불가
    await adapter.release(reqId);

    // 다시 같은 ID로 예약 시도해도 PK 충돌로 재호출 불가
    const reReserve = await adapter.reserve(reqId, 1);
    expect(reReserve.allowed).toBe(false);
  });

  it('upstream 호출 전 release는 reserved를 released로 변경하여 회수되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 1, // 분당 1건만 허용
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
      clockNow: () => 1700000000000,
    });

    const req1 = 'user-1:req-pre-fail';
    expect((await adapter.reserve(req1, 1)).allowed).toBe(true);

    // 한도 소진으로 두 번째 요청은 거부됨
    expect((await adapter.reserve('user-1:req-blocked', 1)).allowed).toBe(false);

    // upstream 전 실패로 req1을 정상 release
    await adapter.release(req1);

    // 회수 후 새로운 다른 requestId는 정상 승인됨
    expect((await adapter.reserve('user-1:req-new-slot', 1)).allowed).toBe(true);
  });

  it('허용되지 않은 모델 이름은 INVALID_OR_MISSING_BUDGET_CONFIG로 failclosed되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gpt-4o', // 허용되지 않은 모델
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });

    const res = await adapter.reserve('user-1:req-1', 1);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('INVALID_OR_MISSING_BUDGET_CONFIG');
  });

  it('requestId 형식이 caller:opaqueId가 아니거나 빈 파트이면 INVALID_RESERVATION_PARAMS로 거부되어야 한다', async () => {
    const d1 = setupInMemoryDatabase();
    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });

    // 콜론 없음
    expect((await adapter.reserve('plain-id-without-colon', 1)).reason).toBe('INVALID_RESERVATION_PARAMS');
    // 빈 caller
    expect((await adapter.reserve(':opaqueId', 1)).reason).toBe('INVALID_RESERVATION_PARAMS');
    // 빈 opaqueId
    expect((await adapter.reserve('callerId:', 1)).reason).toBe('INVALID_RESERVATION_PARAMS');
    // 공백만
    expect((await adapter.reserve('   :   ', 1)).reason).toBe('INVALID_RESERVATION_PARAMS');
  });

  it('D1 실행 결과 meta.changes가 1이더라도 success가 false이면 거절되어야 한다', async () => {
    const fakeDb: D1Database = {
      prepare(): D1PreparedStatement {
        const createStmt = (): D1PreparedStatement => ({
          bind(): D1PreparedStatement {
            return createStmt();
          },
          async run(): Promise<D1RunResult> {
            return {
              success: false,
              meta: { changes: 1 },
            };
          },
        });
        return createStmt();
      },
    };

    const adapter = new D1ServerBudgetAdapter({
      db: fakeDb,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });

    const res = await adapter.reserve('user:req-1', 1);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('BUDGET_LIMIT_EXCEEDED_OR_DUPLICATE_REQUEST');
  });

  it('toPacificDateString은 여름(PDT, UTC-7)과 겨울(PST, UTC-8)의 자정 경계에서 정확한 일자를 반환해야 한다', () => {
    // 1. 여름(PDT, UTC-7) 자정 경계: 07:00:00 UTC
    // 2026-07-15T06:59:59.999Z -> PDT 2026-07-14 23:59:59.999
    expect(toPacificDateString(new Date('2026-07-15T06:59:59.999Z'))).toBe('2026-07-14');
    // 2026-07-15T07:00:00.000Z -> PDT 2026-07-15 00:00:00.000
    expect(toPacificDateString(new Date('2026-07-15T07:00:00.000Z'))).toBe('2026-07-15');

    // 2. 겨울(PST, UTC-8) 자정 경계: 08:00:00 UTC
    // 2026-01-15T07:59:59.999Z -> PST 2026-01-14 23:59:59.999
    expect(toPacificDateString(new Date('2026-01-15T07:59:59.999Z'))).toBe('2026-01-14');
    // 2026-01-15T08:00:00.000Z -> PST 2026-01-15 00:00:00.000
    expect(toPacificDateString(new Date('2026-01-15T08:00:00.000Z'))).toBe('2026-01-15');
  });

  it('consume 실패 시 오류가 throw되고 예약 units는 취소되지 않고 유지되어야 한다', async () => {
    let failConsume = false;
    const db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.resolve('scripts/conversation/budget-schema.sql'), 'utf-8');
    db.exec(schemaSql);

    const d1 = createTestD1Wrapper(db, (query) => {
      if (failConsume && query.includes("state = 'consumed'")) {
        return { success: false, meta: { changes: 0 } };
      }
      return undefined;
    });

    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100, // 총 100 유닛
      rpd: 10,
      callerRpm: 10,
      clockNow: () => 1700000000000,
    });

    const reqId = 'user-1:req-consume-fail';
    const res = await adapter.reserve(reqId, 80); // 80유닛 예약
    expect(res.allowed).toBe(true);

    failConsume = true;
    await expect(adapter.consume(reqId, 85)).rejects.toThrow('D1_BUDGET_CONSUME_FAILED');

    // 예약(80유닛)이 DB에 여전히 reserved 상태로 남아 있으므로, 30유닛을 추가 예약하려고 하면
    // 80 + 30 = 110 > 100 이므로 TPM 한도 초과로 거절되어야 함
    const resNext = await adapter.reserve('user-1:req-consume-next', 30);
    expect(resNext.allowed).toBe(false);
  });

  it('release 실패 시 오류가 throw되어야 한다', async () => {
    const db = new DatabaseSync(':memory:');
    const schemaSql = fs.readFileSync(path.resolve('scripts/conversation/budget-schema.sql'), 'utf-8');
    db.exec(schemaSql);

    const d1 = createTestD1Wrapper(db, (query) => {
      if (query.includes("state = 'released'")) {
        return { success: false, meta: { changes: 0 } };
      }
      return undefined;
    });

    const adapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.5-flash-lite',
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });

    const reqId = 'user-1:req-release-fail';
    await adapter.reserve(reqId, 10);

    await expect(adapter.release(reqId)).rejects.toThrow('D1_BUDGET_RELEASE_FAILED');
  });

  it('이전 3.8-flash 모델은 isAllowedModel=false 및 budget 생성 거절되어야 하며, TTS/전사 모델은 불변이어야 한다', async () => {
    expect(isAllowedModel('gemini-3.8-flash')).toBe(false);
    expect(isAllowedModel('gemini-3.5-flash-lite')).toBe(true);
    expect(GEMINI_MODELS.TRANSCRIBE).toBe('gemini-3.5-transcribe');
    expect(isAllowedModel('gemini-3.5-transcribe')).toBe(true);
    expect(GEMINI_MODELS.TTS).toBe('gemini-3.8-flash-lite-tts');
    expect(isAllowedModel('gemini-3.8-flash-lite-tts')).toBe(true);

    const d1 = setupInMemoryDatabase();
    const oldModelAdapter = new D1ServerBudgetAdapter({
      db: d1,
      model: 'gemini-3.8-flash',
      rpm: 10,
      tpm: 100,
      rpd: 10,
      callerRpm: 10,
    });
    const res = await oldModelAdapter.reserve('user-1:req-old-model', 1);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('INVALID_OR_MISSING_BUDGET_CONFIG');
  });
});

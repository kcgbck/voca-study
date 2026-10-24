// src/features/conversation/server/authAdapter.ts
// Cloudflare Access 전용 RS256 JWT 서명 검증 서버 인증 어댑터
// [보안 및 규정 원칙]
// 1. HS256, alg none 등 비인가 알고리즘 엄격 차단 (오직 RS256만 허용).
// 2. teamDomain은 https://[a-z0-9-]+.cloudflareaccess.com 형태의 단일 호스트만 허용.
// 3. request는 Cf-Access-Jwt-Assertion 헤더만 허용 (Origin/deviceCode/query 통과 금지).
// 4. JWT 내의 jku, x5u, iss URL 조회 원천 배제 (고정 domain/cdn-cgi/access/certs만 64KiB bounded fetch).
// 5. JWT 원문, 이메일, sub를 로그에 남기지 않으며, callerId는 SHA-256(sub) 가명 식별자(pseudonymous ID)로 산출.

import type { ServerAuthAdapter } from './types';
import { readBoundedJsonBody } from './securityGuards';

export const MAX_JWT_LENGTH = 8192; // 8 KiB 상한
export const MAX_CERTS_BYTES = 64 * 1024; // 64 KiB 상한
export const MAX_SUB_LENGTH = 256; // subject 256자 상한

export interface CloudflareAccessAuthOptions {
  teamDomain: string; // e.g. https://myteam.cloudflareaccess.com
  audience: string; // Cloudflare Access Application AUD tag
  publicJwksFixture?: { keys: Array<Record<string, unknown>> };
  clockNow?: () => number; // milliseconds
  fetchFn?: typeof fetch;
}

export function base64UrlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlToString(base64url: string): string {
  const bytes = base64UrlToUint8Array(base64url);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class CloudflareAccessAuthAdapter implements ServerAuthAdapter {
  private readonly teamDomain: string;
  private readonly audience: string;
  private readonly publicJwksFixture?: { keys: Array<Record<string, unknown>> };
  private readonly clockNow: () => number;
  private readonly fetchFn: typeof fetch;
  private readonly isConfigValid: boolean;

  constructor(options: CloudflareAccessAuthOptions) {
    this.publicJwksFixture = options.publicJwksFixture;
    this.clockNow = options.clockNow || (() => Date.now());
    this.fetchFn = options.fetchFn || ((...args) => fetch(...args));

    // teamDomain 엄격 검증: https://[a-z0-9-]+.cloudflareaccess.com (포트, 경로, 사용자정보, 쿼리 금지)
    const domainRegex = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;
    if (
      !options.teamDomain ||
      typeof options.teamDomain !== 'string' ||
      !domainRegex.test(options.teamDomain) ||
      !options.audience ||
      typeof options.audience !== 'string' ||
      options.audience.trim().length === 0
    ) {
      this.teamDomain = '';
      this.audience = '';
      this.isConfigValid = false;
    } else {
      this.teamDomain = options.teamDomain;
      this.audience = options.audience.trim();
      this.isConfigValid = true;
    }
  }

  public async verifyCaller(request: Request): Promise<{
    authorized: boolean;
    callerId?: string;
    reason?: string;
  }> {
    if (!this.isConfigValid) {
      return { authorized: false, reason: 'INVALID_ADAPTER_CONFIGURATION' };
    }

    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt || typeof jwt !== 'string') {
      return { authorized: false, reason: 'MISSING_CF_ACCESS_JWT_HEADER' };
    }

    // 토큰 길이 상한 8 KiB
    if (jwt.length > MAX_JWT_LENGTH) {
      return { authorized: false, reason: 'TOKEN_LENGTH_EXCEEDED' };
    }

    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return { authorized: false, reason: 'MALFORMED_JWT_PARTS' };
    }

    // 세 base64url 부분 모두 비어있지 않고 URL-safe 문자만 포함
    const base64UrlRegex = /^[A-Za-z0-9_-]+$/;
    if (
      !parts[0] ||
      !parts[1] ||
      !base64UrlRegex.test(parts[0]) ||
      !base64UrlRegex.test(parts[1])
    ) {
      return { authorized: false, reason: 'MALFORMED_JWT_BASE64URL' };
    }

    let headerRaw: unknown;
    let payloadRaw: unknown;

    try {
      headerRaw = JSON.parse(base64UrlToString(parts[0]));
      payloadRaw = JSON.parse(base64UrlToString(parts[1]));
    } catch {
      return { authorized: false, reason: 'INVALID_JWT_JSON' };
    }

    // header 및 payload는 null, 배열, 원시값이 아닌 순수 객체여야 함 (throw 500 방지)
    if (
      !headerRaw ||
      typeof headerRaw !== 'object' ||
      Array.isArray(headerRaw) ||
      !payloadRaw ||
      typeof payloadRaw !== 'object' ||
      Array.isArray(payloadRaw)
    ) {
      return { authorized: false, reason: 'INVALID_JWT_JSON' };
    }

    const header = headerRaw as Record<string, unknown>;
    const payload = payloadRaw as Record<string, unknown>;

    // 1. 헤더 검증 (RS256 및 kid 필수)
    if (header.alg !== 'RS256') {
      return { authorized: false, reason: 'UNSUPPORTED_JWT_ALGORITHM' };
    }
    if (typeof header.kid !== 'string' || header.kid.trim().length === 0) {
      return { authorized: false, reason: 'MISSING_JWT_KID' };
    }

    // RS256 서명 부분 검증 (비어있지 않고 URL-safe 문자만)
    if (!parts[2] || !base64UrlRegex.test(parts[2])) {
      return { authorized: false, reason: 'MALFORMED_JWT_BASE64URL' };
    }

    // 2. 페이로드 클레임 검증 (고정 issuer, audience, sub)
    if (payload.iss !== this.teamDomain) {
      return { authorized: false, reason: 'ISSUER_MISMATCH' };
    }

    const isAudValid = Array.isArray(payload.aud)
      ? payload.aud.includes(this.audience)
      : payload.aud === this.audience;
    if (!isAudValid) {
      return { authorized: false, reason: 'AUDIENCE_MISMATCH' };
    }

    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      return { authorized: false, reason: 'MISSING_SUBJECT' };
    }
    if (payload.sub.length > MAX_SUB_LENGTH) {
      return { authorized: false, reason: 'INVALID_SUBJECT' };
    }

    const nowMs = this.clockNow();
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
      return { authorized: false, reason: 'INVALID_CLOCK' };
    }
    const nowSec = Math.floor(nowMs / 1000);

    // 엄격한 시간 검증 (임의의 60초 skew 배제)
    // exp > now
    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= nowSec
    ) {
      return { authorized: false, reason: 'TOKEN_EXPIRED' };
    }

    // iat 필수 finite number 및 iat <= now
    if (
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat)
    ) {
      return { authorized: false, reason: 'MISSING_OR_INVALID_IAT' };
    }
    if (payload.iat > nowSec) {
      return { authorized: false, reason: 'TOKEN_ISSUED_IN_FUTURE' };
    }

    // nbf 존재 시 finite number 및 nbf <= now
    if (typeof payload.nbf !== 'undefined') {
      if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
        return { authorized: false, reason: 'INVALID_NBF' };
      }
      if (payload.nbf > nowSec) {
        return { authorized: false, reason: 'TOKEN_NOT_YET_VALID' };
      }
    }

    // 3. 서명 검증을 위한 JWK 확보 (고정 certs URL 또는 fixture)
    let matchedKey: Record<string, unknown> | undefined;

    if (this.publicJwksFixture?.keys) {
      matchedKey = this.publicJwksFixture.keys.find((k) => k.kid === header.kid);
    } else {
      // 고정 도메인 cdn-cgi/access/certs 조회 (timeout 3s, redirect: manual, bounded 64 KiB)
      const certsUrl = `${this.teamDomain}/cdn-cgi/access/certs`;
      const certsController = new AbortController();
      const certsTimeout = setTimeout(() => certsController.abort(new Error('CERTS_TIMEOUT')), 3000);

      let onCertsAbort: (() => void) | undefined;
      const certsAbortPromise = new Promise<never>((_, reject) => {
        onCertsAbort = () => reject(new Error('CERTS_TIMEOUT'));
        certsController.signal.addEventListener('abort', onCertsAbort, { once: true });
      });
      certsAbortPromise.catch(() => {});

      const fetchAndReadCerts = async (): Promise<Array<Record<string, unknown>>> => {
        const certsResponse = await this.fetchFn(certsUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: certsController.signal,
        });

        if (!certsResponse.ok) {
          throw new Error('JWKS_FETCH_FAILED');
        }

        // 기존 readBoundedJsonBody를 사용하여 스트림 도중 64 KiB 초과 시 즉시 reader.cancel 수행
        const certsData = await readBoundedJsonBody<{ keys?: Array<Record<string, unknown>> }>(
          certsResponse,
          MAX_CERTS_BYTES
        );

        if (!Array.isArray(certsData.keys)) {
          throw new Error('MALFORMED_JWKS_RESPONSE');
        }
        return certsData.keys;
      };

      try {
        const keys = await Promise.race([fetchAndReadCerts(), certsAbortPromise]);
        matchedKey = keys.find((k) => k.kid === header.kid);
      } catch {
        return { authorized: false, reason: 'JWKS_FETCH_ERROR' };
      } finally {
        clearTimeout(certsTimeout);
        if (onCertsAbort) {
          certsController.signal.removeEventListener('abort', onCertsAbort);
        }
      }
    }

    if (!matchedKey) {
      return { authorized: false, reason: 'SIGNING_KEY_NOT_FOUND' };
    }

    // 키 속성 검증 (kty: RSA, alg: RS256, use: sig)
    if (matchedKey.kty !== 'RSA') {
      return { authorized: false, reason: 'INVALID_KEY_TYPE' };
    }
    if (matchedKey.alg && matchedKey.alg !== 'RS256') {
      return { authorized: false, reason: 'INVALID_KEY_ALGORITHM' };
    }
    if (matchedKey.use && matchedKey.use !== 'sig') {
      return { authorized: false, reason: 'INVALID_KEY_USAGE' };
    }

    // 4. Web Crypto RSASSA-PKCS1-v1_5 SHA-256 서명 검증
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        matchedKey,
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        },
        false,
        ['verify']
      );

      const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
      const signatureBytes = base64UrlToUint8Array(parts[2]);

      const isSignatureValid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        signatureBytes,
        signedData
      );

      if (!isSignatureValid) {
        return { authorized: false, reason: 'SIGNATURE_VERIFICATION_FAILED' };
      }

      // 5. 검증 완료 후 익명화된 가명 식별자(callerId) 생성: SHA-256(sub) hex
      const callerId = await sha256Hex(payload.sub as string);
      return { authorized: true, callerId };
    } catch {
      return { authorized: false, reason: 'CRYPTO_VERIFICATION_ERROR' };
    }
  }
}

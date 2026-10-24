// src/features/conversation/server/securityGuards.ts
// 외부 API 실호출 기본 차단 (Fail-Closed), 예산/중복 요청 잠금, 유한 스트림 및 페이로드 제약 가드

import type { ServerConfig } from './types';

export const MAX_BODY_BYTES = 3 * 1024 * 1024; // 3 MiB
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_AUDIO_DURATION_SECONDS = 30; // 30초
export const MAX_USER_TEXT_LENGTH = 500; // 500자
export const MAX_RECENT_TURNS = 6; // 최근 6턴

export class SecurityGuardError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = 'SecurityGuardError';
    this.statusCode = statusCode;
  }
}

/**
 * Request 본문을 Bounded Stream으로 최대 3 MiB까지만 안전하게 읽기 (Content-Length 신뢰 안 함)
 */
export async function readBoundedJsonBody<T = unknown>(
  request: Request | Response,
  maxBytes = MAX_BODY_BYTES
): Promise<T> {
  // ReadableStream getReader 지원 확인
  if (request.body && typeof request.body.getReader === 'function') {
    const reader = request.body.getReader();
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel error
          }
          throw new SecurityGuardError(
            `요청 본문 크기가 최대 허용치(${maxBytes / (1024 * 1024)} MiB)를 초과했습니다.`,
            413
          );
        }
        chunks.push(value);
      }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder('utf-8').decode(combined);
    if (text.trim().length === 0) {
      throw new SecurityGuardError('요청 본문이 비어 있습니다.', 400);
    }

    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SecurityGuardError('JSON 본문은 배열이 아닌 단일 객체여야 합니다.', 400);
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof SecurityGuardError) throw err;
      throw new SecurityGuardError('요청 본문이 유효한 JSON 형식이 아닙니다.', 400);
    }
  }

  // Node.js 또는 이미 소비된 스트림 폴백
  const rawText = await request.text().catch(() => '');
  if (rawText.length > maxBytes * 2) {
    throw new SecurityGuardError('요청 본문 크기가 최대 허용치를 초과했습니다.', 413);
  }
  if (rawText.trim().length === 0) {
    throw new SecurityGuardError('요청 본문이 비어 있습니다.', 400);
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SecurityGuardError('JSON 본문은 배열이 아닌 단일 객체여야 합니다.', 400);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof SecurityGuardError) throw err;
    throw new SecurityGuardError('요청 본문이 유효한 JSON 형식이 아닙니다.', 400);
  }
}

/**
 * 실호출 전제 조건 엄격 검증 (하나라도 미충족 시 Fail-Closed 차단)
 * 발신자 ID 반환
 */
export async function verifyServerCallPrerequisites(
  request: Request,
  config: ServerConfig
): Promise<string> {
  // 1. 외부 호출 허용 설정 확인 (기본 false)
  if (!config.allowExternalFreeGeminiCalls) {
    throw new SecurityGuardError(
      '외부 Gemini API 호출이 비활성화되어 있습니다. 로컬 규칙 엔진으로 대체됩니다.',
      403
    );
  }

  // 2. API Key 존재 확인
  if (!config.geminiApiKey || config.geminiApiKey.trim().length === 0) {
    throw new SecurityGuardError(
      'Gemini API Key가 구성되지 않았습니다. 외부 호출이 차단됩니다.',
      403
    );
  }

  // 3. 성인 내부 시험 동의 확인
  if (!config.isAdultConfirmed) {
    throw new SecurityGuardError(
      '성인 사용자 명시 동의 및 내부 시험 확인이 누락되었습니다.',
      403
    );
  }

  // 4. 무료 티어 프로젝트 확인 (과금형 프로젝트 원천 차단)
  if (!config.isFreeTierProjectConfirmed) {
    throw new SecurityGuardError(
      '유료 종량제 방지를 위한 무료 티어 프로젝트 확인이 누락되었습니다.',
      403
    );
  }

  // 5. 서버 측 인증 어댑터 확인 및 발신자 검증
  if (!config.authAdapter) {
    throw new SecurityGuardError(
      '서버 인증 어댑터(ServerAuthAdapter)가 구성되지 않아 호출이 거부됩니다. (Fail-Closed)',
      401
    );
  }

  const authResult = await config.authAdapter.verifyCaller(request);
  if (!authResult.authorized) {
    throw new SecurityGuardError(
      authResult.reason || '서버 발신자 인증에 실패했습니다.',
      401
    );
  }

  // 6. 원자적 예산 및 중복 방지 어댑터 확인
  if (!config.budgetAdapter) {
    throw new SecurityGuardError(
      '원자적 예산 및 중복 요청 제어 어댑터(ServerBudgetAdapter)가 부재하여 호출이 거부됩니다.',
      403
    );
  }

  return authResult.callerId || 'anonymous-caller';
}

/**
 * 최근 대화 턴 목록 필터링 및 allowlist 정제 (최대 6턴, 허용 필드만 유지, invalid role 강제 coercion 금지)
 */
export function sanitizeRecentTurns(
  rawTurns: unknown
): Array<{ turnId: string; speaker: 'tutor' | 'user'; text: string; timestamp: string }> {
  if (!Array.isArray(rawTurns)) return [];

  const validTurns: Array<{ turnId: string; speaker: 'tutor' | 'user'; text: string; timestamp: string }> = [];

  for (const item of rawTurns) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;

    // user 또는 tutor 역할만 엄격 허용 (임의의 role을 tutor로 변환하지 않고 스킵)
    if (r.speaker !== 'user' && r.speaker !== 'tutor') {
      continue;
    }

    const text = typeof r.text === 'string' ? r.text.slice(0, MAX_USER_TEXT_LENGTH).trim() : '';
    if (text.length === 0) continue;

    validTurns.push({
      turnId: typeof r.turnId === 'string' ? r.turnId : `t-${validTurns.length}`,
      speaker: r.speaker,
      text,
      timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date().toISOString(),
    });
  }

  return validTurns.slice(-MAX_RECENT_TURNS);
}

/**
 * 텍스트 길이 및 안전성 검증
 */
export function validateTextLength(text: unknown, maxLength = MAX_USER_TEXT_LENGTH): string {
  if (typeof text !== 'string') {
    throw new SecurityGuardError('입력 텍스트가 유효한 문자열이 아닙니다.', 400);
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new SecurityGuardError('입력 텍스트가 비어 있습니다.', 400);
  }
  if (trimmed.length > maxLength) {
    throw new SecurityGuardError(`입력 텍스트가 최대 길이(${maxLength}자)를 초과했습니다.`, 400);
  }
  return trimmed;
}

/**
 * Base64 오디오 페이로드 유효성, 크기 및 지속시간 검증
 */
export function validateAudioPayload(
  audioBase64: unknown,
  durationSeconds?: unknown
): void {
  if (typeof audioBase64 !== 'string' || audioBase64.trim().length === 0) {
    throw new SecurityGuardError('오디오 데이터가 누락되었거나 비어 있습니다.', 400);
  }

  const cleanBase64 = audioBase64.trim();
  // Base64 형식 정규식 검증
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(cleanBase64)) {
    throw new SecurityGuardError('오디오 데이터가 올바른 Base64 형식이 아닙니다.', 400);
  }

  // 실제 디코딩 바이트 수 계산
  const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
  if (approxBytes === 0) {
    throw new SecurityGuardError('오디오 데이터 바이트 크기가 0입니다.', 400);
  }
  if (approxBytes > MAX_AUDIO_BYTES) {
    throw new SecurityGuardError(
      `오디오 파일 크기(${approxBytes} 바이트)가 최대 허용치(${MAX_AUDIO_BYTES / (1024 * 1024)} MiB)를 초과했습니다.`,
      400
    );
  }

  // 지속시간 검증 (음수, NaN, Infinity, 0 거부)
  if (typeof durationSeconds !== 'undefined') {
    if (
      typeof durationSeconds !== 'number' ||
      isNaN(durationSeconds) ||
      !isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new SecurityGuardError('유효하지 않은 오디오 재생 지속시간(duration)입니다.', 400);
    }
    if (durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
      throw new SecurityGuardError(
        `오디오 녹음 시간(${durationSeconds}초)이 최대 허용치(${MAX_AUDIO_DURATION_SECONDS}초)를 초과했습니다.`,
        400
      );
    }
  }
}

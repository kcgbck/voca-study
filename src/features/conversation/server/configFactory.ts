// src/features/conversation/server/configFactory.ts
// Cloudflare Pages 환경변수 및 요청 기반 AI 회화 ServerConfig 팩토리
// [보안 및 예산 정책]
// 1. 모든 플래그(ALLOW_EXTERNAL_GEMINI_CALLS, CONVERSATION_FREE_TIER_CONFIRMED, CONVERSATION_ADULT_TESTERS_CONFIRMED)가
//    명시적으로 문자열 'true'일 때만 활성화하며, 하나라도 누락/불일치 시 Fail-Closed.
// 2. Cloudflare Access (CONVERSATION_ACCESS_TEAM_DOMAIN, CONVERSATION_ACCESS_AUDIENCE) 필수 검증.
// 3. 예산 DB는 오직 독립된 CONVERSATION_BUDGET_DB만 허용하며 기존 앱 DB(env.DB) 절대 fallback 금지.
// 4. 모델별 할당량(CONVERSATION_MODEL_LIMITS_JSON)은 지정 3모델 모두 {rpm, tpm, rpd, callerRpm} 양의 safe 정수가 명시되어야 함.
// 5. isAdultConfirmed는 서버 운영자 성인 내부 테스터 설정과 클라이언트 동의(consent.isAdult)의 AND 조건으로만 성립하며,
//    JWT만으로 나이가 확인되었다고 간주하지 않습니다.
// 6. DB에는 보수적 입력 예산 숫자만 저장하며 본문/수업/음성은 절대 저장하지 않습니다.
//    이 값은 정확한 Google 사용량이 아닌 보수적 로컬 입력 예산이며, 모델별 실제 TPM 사용량에 따라 업스트림 제공자 429가 발생할 수 있습니다.
//    Google 프로젝트 외부 타 앱의 사용량까지 통제하지 않습니다.

import type {
  ServerConfig,
  ServerBudgetAdapter,
} from './types';
import { CloudflareAccessAuthAdapter } from './authAdapter';
import {
  D1ServerBudgetAdapter,
  type D1Database,
} from './budgetAdapter';
import {
  GEMINI_MODELS,
  isAllowedModel,
} from './geminiInteractionsClient';
import {
  readBoundedJsonBody,
  MAX_BODY_BYTES,
} from './securityGuards';
import { getLessonById } from '../content/lessons';
import { CONVERSATION_POLICY_VERSION } from '../types';
import {
  clampModelLimitsToPolicy,
  calculateTtsEstimatedUnits,
  calculateTranscribeEstimatedUnits,
  type ModelBudgetLimits,
  type ModelLimitsMap,
} from './budgetPolicy';

export type { ModelBudgetLimits, ModelLimitsMap };

export interface ConversationEnv {
  GEMINI_API_KEY?: string;
  ALLOW_EXTERNAL_GEMINI_CALLS?: string;
  CONVERSATION_FREE_TIER_CONFIRMED?: string;
  CONVERSATION_ADULT_TESTERS_CONFIRMED?: string;
  CONVERSATION_ACCESS_TEAM_DOMAIN?: string;
  CONVERSATION_ACCESS_AUDIENCE?: string;
  CONVERSATION_BUDGET_DB?: D1Database;
  CONVERSATION_MODEL_LIMITS_JSON?: string;
  DB?: unknown; // 기존 앱 DB 바인딩 (회화 예산에서 절대 fallback 금지)
}

export interface ConfigFactoryDependencies {
  authFetchFn?: typeof fetch;
  upstreamFetchFn?: typeof fetch;
  clockNow?: () => number;
}

export interface PagesAdmissionResult {
  config: ServerConfig;
  forwardRequest: Request;
}

/**
 * 모델별 할당량 JSON 검증 (지정 3모델 필수, 양의 safe 정수, unknown 모델 불허)
 */
export function validateModelLimitsJson(rawJson: unknown): ModelLimitsMap | null {
  if (typeof rawJson !== 'string' || rawJson.trim().length === 0 || rawJson.length > 4096) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const requiredModels = [
    GEMINI_MODELS.CHAT,
    GEMINI_MODELS.TRANSCRIBE,
    GEMINI_MODELS.TTS,
  ];

  const keys = Object.keys(parsed);
  if (keys.length !== requiredModels.length) {
    return null;
  }

  for (const model of requiredModels) {
    if (!keys.includes(model)) {
      return null;
    }
  }

  for (const key of keys) {
    if (!isAllowedModel(key)) {
      return null;
    }
    const val = (parsed as Record<string, unknown>)[key];
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      return null;
    }
    const limits = val as Record<string, unknown>;
    const isPosSafeInt = (n: unknown): n is number =>
      typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

    if (
      !isPosSafeInt(limits.rpm) ||
      !isPosSafeInt(limits.tpm) ||
      !isPosSafeInt(limits.rpd) ||
      !isPosSafeInt(limits.callerRpm)
    ) {
      return null;
    }
  }

  // 90% 하드캡 클램핑 적용 (상한 초과 시 90% floor로 clamp, 더 작은 사용자 설정값은 존중)
  return clampModelLimitsToPolicy(parsed as ModelLimitsMap);
}

/**
 * 요청 본문의 사용자 동의 및 정책 버전 검증
 */
export function validateBodyConsent(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  const record = body as Record<string, unknown>;
  if (record.userConsentToCloud !== true) {
    return false;
  }

  if (record.consentPolicyVersion !== CONVERSATION_POLICY_VERSION) {
    return false;
  }

  const consent = record.consent;
  if (!consent || typeof consent !== 'object' || Array.isArray(consent)) {
    return false;
  }

  const consentRecord = consent as Record<string, unknown>;
  return (
    consentRecord.isAdult === true &&
    consentRecord.sendCurrentTurnOnlyAgreed === true &&
    consentRecord.googleReviewDisclosureAgreed === true &&
    consentRecord.noSensitiveInfoAgreed === true
  );
}

/**
 * 보수적 입력 예산 유닛 계산
 * - chat: wire body bytes + 교재 JSON bytes + 16 KiB 고정 프롬프트/스키마 마진 유지 (기존 회귀/보호 보존)
 * - tts: 500자 검증 텍스트 및 옵션 UTF-8 바이트 + 1024 로컬 유닛 추정
 * - transcribe: PCM16 RIFF/WAV 실제 구조 검증 지속시간 기반 ceil(duration * 64) + 1024 (비WAV는 decodedBytes + 1024 폴백)
 */
export function calculateConservativeEstimatedUnits(
  action: string,
  rawBodyBytes: number,
  lessonId?: string,
  parsedBody?: Record<string, unknown>
): number {
  if (action === 'chat') {
    let lessonJsonBytes = 0;
    if (typeof lessonId === 'string') {
      const lesson = getLessonById(lessonId);
      if (lesson) {
        lessonJsonBytes = new TextEncoder().encode(JSON.stringify(lesson)).byteLength;
      }
    }
    const fixedOverheadBytes = 16 * 1024; // 16 KiB 고정 프롬프트 및 JSON 스키마 마진
    return rawBodyBytes + lessonJsonBytes + fixedOverheadBytes;
  }

  if (action === 'tts') {
    return calculateTtsEstimatedUnits(parsedBody, rawBodyBytes);
  }

  if (action === 'transcribe') {
    return calculateTranscribeEstimatedUnits(parsedBody, rawBodyBytes);
  }

  const fixedOverheadBytes = 16 * 1024;
  return rawBodyBytes + fixedOverheadBytes;
}

/**
 * Cloudflare Pages 환경변수 및 요청 기반 ServerConfig 생성 (단일 읽기 및 forwardRequest 반환)
 */
export async function createPagesConversationConfig(
  env: ConversationEnv,
  action: string,
  request: Request,
  deps?: ConfigFactoryDependencies
): Promise<PagesAdmissionResult> {
  // 기본 비활성(Fail-Closed) 설정
  const disabledConfig: ServerConfig = {
    allowExternalFreeGeminiCalls: false,
    geminiApiKey: undefined,
    isAdultConfirmed: false,
    isFreeTierProjectConfirmed: false,
    authAdapter: undefined,
    budgetAdapter: undefined,
    fetchFn: deps?.upstreamFetchFn,
  };

  // 1. 필수 문자열 플래그 검증
  if (env.ALLOW_EXTERNAL_GEMINI_CALLS !== 'true') {
    return { config: disabledConfig, forwardRequest: request };
  }
  if (env.CONVERSATION_FREE_TIER_CONFIRMED !== 'true') {
    return { config: disabledConfig, forwardRequest: request };
  }
  if (env.CONVERSATION_ADULT_TESTERS_CONFIRMED !== 'true') {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 2. Gemini API 키 검증
  if (
    !env.GEMINI_API_KEY ||
    typeof env.GEMINI_API_KEY !== 'string' ||
    env.GEMINI_API_KEY.trim().length === 0 ||
    env.GEMINI_API_KEY.length > 512
  ) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 3. Cloudflare Access 고정 도메인 및 Audience 검증
  const teamDomain = env.CONVERSATION_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CONVERSATION_ACCESS_AUDIENCE?.trim();
  if (
    !teamDomain ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) ||
    !audience ||
    audience.length === 0 ||
    audience.length > 256
  ) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 4. 예산 DB 바인딩 검증 (기존 DB 절대 fallback 금지)
  if (
    !env.CONVERSATION_BUDGET_DB ||
    typeof env.CONVERSATION_BUDGET_DB.prepare !== 'function'
  ) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 5. 모델별 할당량 JSON 검증
  const limitsMap = validateModelLimitsJson(env.CONVERSATION_MODEL_LIMITS_JSON);
  if (!limitsMap) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 6. 단일 스트림 Bounded Body 읽기 (원본 request를 직접 읽어 tee 클론 교착 원천 차단)
  // 3 MiB 초과 시 readBoundedJsonBody가 즉시 stream.cancel() 및 SecurityGuardError(413) throw
  // JSON 파싱 실패 시 SecurityGuardError(400) throw
  const parsedBody = await readBoundedJsonBody<Record<string, unknown>>(request, MAX_BODY_BYTES);

  // 동의 및 정책 버전 검증 (실패 시 JWKS 및 외부 호출 0회)
  if (!validateBodyConsent(parsedBody)) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 7. 타겟 모델 결정
  let targetModel: string;
  if (action === 'chat') {
    targetModel = GEMINI_MODELS.CHAT;
  } else if (action === 'transcribe') {
    targetModel = GEMINI_MODELS.TRANSCRIBE;
  } else if (action === 'tts') {
    targetModel = GEMINI_MODELS.TTS;
  } else {
    return { config: disabledConfig, forwardRequest: request };
  }

  const modelLimits = limitsMap[targetModel];
  if (!modelLimits) {
    return { config: disabledConfig, forwardRequest: request };
  }

  // 8. 어댑터 인스턴스화
  const authAdapter = new CloudflareAccessAuthAdapter({
    teamDomain,
    audience,
    fetchFn: deps?.authFetchFn,
    clockNow: deps?.clockNow,
  });

  const underlyingBudget = new D1ServerBudgetAdapter({
    db: env.CONVERSATION_BUDGET_DB,
    model: targetModel,
    rpm: modelLimits.rpm,
    tpm: modelLimits.tpm,
    rpd: modelLimits.rpd,
    callerRpm: modelLimits.callerRpm,
    clockNow: deps?.clockNow,
  });

  // 9. 파싱된 본문 재직렬화 및 forwardRequest 구성
  const reSerializedJson = JSON.stringify(parsedBody);
  const rawBodyBytes = new TextEncoder().encode(reSerializedJson).byteLength;
  const lessonId = typeof parsedBody.lessonId === 'string' ? parsedBody.lessonId : undefined;
  const conservativeUnits = calculateConservativeEstimatedUnits(action, rawBodyBytes, lessonId, parsedBody);

  // 보수적 로컬 입력 예산 래퍼
  // DB에는 보수적 계산 유닛 숫자만 저장되며 본문/수업/음성은 저장되지 않음
  const wrappedBudgetAdapter: ServerBudgetAdapter = {
    async reserve(requestId: string, _units: number) {
      return underlyingBudget.reserve(requestId, conservativeUnits);
    },
    async consume(requestId: string, actualUnits: number) {
      return underlyingBudget.consume(requestId, actualUnits);
    },
    async release(requestId: string) {
      return underlyingBudget.release(requestId);
    },
  };

  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set('Content-Type', 'application/json; charset=utf-8');
  forwardHeaders.delete('Content-Length');

  const forwardRequest = new Request(request.url, {
    method: request.method,
    headers: forwardHeaders,
    body: reSerializedJson,
    signal: request.signal,
  });

  return {
    config: {
      allowExternalFreeGeminiCalls: true,
      geminiApiKey: env.GEMINI_API_KEY.trim(),
      // 성인 확인: 서버 운영자의 내부 시험 확인과 클라이언트 assertion의 AND 조건
      isAdultConfirmed: true,
      isFreeTierProjectConfirmed: true,
      authAdapter,
      budgetAdapter: wrappedBudgetAdapter,
      fetchFn: deps?.upstreamFetchFn,
    },
    forwardRequest,
  };
}

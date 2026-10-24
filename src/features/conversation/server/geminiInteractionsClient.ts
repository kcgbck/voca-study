// src/features/conversation/server/geminiInteractionsClient.ts
// Google AI API 클라이언트 모듈
// 공식 모델: gemini-3.5-flash-lite (chat generateContent), gemini-3.5-transcribe (Interactions verbatim), gemini-3.8-flash-lite-tts (Interactions tts)
import { readBoundedJsonBody } from './securityGuards';

export const GEMINI_INTERACTIONS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

export const GEMINI_CHAT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

export const GEMINI_MODELS = {
  CHAT: 'gemini-3.5-flash-lite',
  TRANSCRIBE: 'gemini-3.5-transcribe',
  TTS: 'gemini-3.8-flash-lite-tts',
} as const;

export function isAllowedModel(modelName: string): boolean {
  return Object.values(GEMINI_MODELS).includes(modelName as any);
}

export interface InteractionsStepContent {
  type: string;
  text?: string;
  data?: string; // base64
  mime_type?: string;
}

export interface InteractionsStep {
  type: string;
  content?: InteractionsStepContent[];
}

export interface InteractionsResponse {
  steps?: InteractionsStep[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export interface GenerateContentCandidate {
  content?: {
    parts?: Array<{
      text?: string;
      thought?: boolean;
      functionCall?: unknown;
    }>;
    role?: string;
  };
  finishReason?: string;
}

export interface GenerateContentResponse {
  candidates?: GenerateContentCandidate[];
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export type GeminiFailureKind =
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'REQUEST_CANCELLED'
  | 'TRANSPORT_ERROR'
  | 'UPSTREAM_ERROR';

export class GeminiApiError extends Error {
  public statusCode: number;
  public details?: unknown;
  public failureKind?: GeminiFailureKind;

  constructor(
    message: string,
    statusCode = 500,
    details?: unknown,
    failureKind?: GeminiFailureKind
  ) {
    super(message);
    this.name = 'GeminiApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.failureKind = failureKind;
  }
}

/**
 * 대화 전용 generateContent API 단일 호출 (자동 재시도 0회, 서버 20초 유한 데드라인)
 */
export async function callGeminiChatApi(
  body: Record<string, unknown>,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20000,
  externalSignal?: AbortSignal
): Promise<GenerateContentResponse> {
  // 이미 취소된 시그널인 경우 upstream 0회 즉시 거부
  if (externalSignal?.aborted) {
    throw new GeminiApiError(
      'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
      504,
      undefined,
      'REQUEST_CANCELLED'
    );
  }

  let isTimedOut = false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    controller.abort(new Error('TIMEOUT'));
  }, timeoutMs);

  let onAbort: (() => void) | undefined;
  if (externalSignal) {
    onAbort = () => {
      clearTimeout(timeoutId);
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchFn(GEMINI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new GeminiApiError('Google Gemini API 호출 한도 초과 (429 Rate Limit)', 429);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GeminiApiError('Google Gemini API 인증 실패 (Key 권한 오류)', 403);
      }
      if (response.status === 503) {
        throw new GeminiApiError(
          'Google Gemini 서비스가 일시적으로 사용 불가능합니다 (503 Service Unavailable). 잠시 후 수동으로 다시 시도해주세요.',
          503,
          undefined,
          'UPSTREAM_UNAVAILABLE'
        );
      }

      throw new GeminiApiError(
        `Gemini API 응답 오류 (HTTP ${response.status})`,
        response.status >= 500 ? 502 : response.status,
        undefined,
        response.status >= 500 ? 'UPSTREAM_ERROR' : undefined
      );
    }

    const data = await readBoundedJsonBody<GenerateContentResponse>(response, 4 * 1024 * 1024);
    return data;
  } catch (err: unknown) {
    if (err instanceof GeminiApiError) {
      throw err;
    }

    const errorObj = err as Error;
    if (externalSignal?.aborted) {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
        504,
        undefined,
        'REQUEST_CANCELLED'
      );
    }

    if (isTimedOut) {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 (Timeout)',
        504,
        undefined,
        'UPSTREAM_TIMEOUT'
      );
    }

    if (controller.signal.aborted || errorObj?.name === 'AbortError') {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
        504,
        undefined,
        'REQUEST_CANCELLED'
      );
    }

    throw new GeminiApiError(
      'Gemini API 통신 또는 응답 처리에 실패했습니다.',
      502,
      undefined,
      'TRANSPORT_ERROR'
    );
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onAbort) {
      externalSignal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Interactions API 단일 호출 (자동 재시도 0회, 타임아웃 및 externalSignal 이중 결합, TTS 및 STT 전용)
 */
export async function callGeminiInteractionsApi(
  body: Record<string, unknown>,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15000,
  externalSignal?: AbortSignal
): Promise<InteractionsResponse> {
  const model = body.model as string;
  if (!isAllowedModel(model)) {
    throw new GeminiApiError(`허용되지 않은 모델입니다: ${model}`, 400);
  }

  // 이미 취소된 시그널인 경우 upstream 0회 즉시 거부
  if (externalSignal?.aborted) {
    throw new GeminiApiError(
      'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
      504,
      undefined,
      'REQUEST_CANCELLED'
    );
  }

  let isTimedOut = false;
  // AbortController 타임아웃과 externalSignal 동시 결합
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    isTimedOut = true;
    controller.abort(new Error('TIMEOUT'));
  }, timeoutMs);

  let onAbort: (() => void) | undefined;
  if (externalSignal) {
    onAbort = () => {
      clearTimeout(timeoutId);
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetchFn(GEMINI_INTERACTIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new GeminiApiError('Google Gemini API 호출 한도 초과 (429 Rate Limit)', 429);
      }
      if (response.status === 401 || response.status === 403) {
        throw new GeminiApiError('Google Gemini API 인증 실패 (Key 권한 오류)', 403);
      }
      if (response.status === 503) {
        throw new GeminiApiError(
          'Google Gemini 서비스가 일시적으로 사용 불가능합니다 (503 Service Unavailable). 잠시 후 수동으로 다시 시도해주세요.',
          503,
          undefined,
          'UPSTREAM_UNAVAILABLE'
        );
      }

      throw new GeminiApiError(
        `Gemini API 응답 오류 (HTTP ${response.status})`,
        response.status >= 500 ? 502 : response.status,
        undefined,
        response.status >= 500 ? 'UPSTREAM_ERROR' : undefined
      );
    }

    // 응답 바디 읽기가 완료될 때까지 timeout 유지
    const data = await readBoundedJsonBody<InteractionsResponse>(response, 4 * 1024 * 1024);
    return data;
  } catch (err: unknown) {
    if (err instanceof GeminiApiError) {
      throw err;
    }

    const errorObj = err as Error;
    if (externalSignal?.aborted) {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
        504,
        undefined,
        'REQUEST_CANCELLED'
      );
    }

    if (isTimedOut) {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 (Timeout)',
        504,
        undefined,
        'UPSTREAM_TIMEOUT'
      );
    }

    if (controller.signal.aborted || errorObj?.name === 'AbortError') {
      throw new GeminiApiError(
        'Gemini API 요청 시간 초과 또는 취소됨 (Timeout/Aborted)',
        504,
        undefined,
        'REQUEST_CANCELLED'
      );
    }

    throw new GeminiApiError(
      'Gemini API 통신 또는 응답 처리에 실패했습니다.',
      502,
      undefined,
      'TRANSPORT_ERROR'
    );
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onAbort) {
      externalSignal.removeEventListener('abort', onAbort);
    }
  }
}

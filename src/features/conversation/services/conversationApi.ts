// src/features/conversation/services/conversationApi.ts
// 브라우저 클라이언트 전용 AI 회화 API 호출 서비스 (동일 Origin /api/conversation/* 만 허용)

import type {
  TurnEvaluationResult,
  HintLevel,
} from '../types';
import { CONVERSATION_POLICY_VERSION } from '../types';
import { validateAndSanitizeEvaluationResult } from '../engine/responseValidator';

export interface UserConsent {
  isAdult: boolean;
  sendCurrentTurnOnlyAgreed: boolean;
  googleReviewDisclosureAgreed: boolean;
  noSensitiveInfoAgreed: boolean;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'OFFLINE'
  | 'INVALID_JSON'
  | 'CONCURRENCY_LOCKED'
  | 'CONSENT_REQUIRED';

export class ConversationApiError extends Error {
  public code: ApiErrorCode;
  public statusCode?: number;
  public fallbackToLocalRuleEngine = true;

  constructor(message: string, code: ApiErrorCode, statusCode?: number) {
    super(message);
    this.name = 'ConversationApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ClientChatRequest {
  lessonId: string;
  contentRevision: number;
  userSpokenText: string;
  currentPhase: 'intro' | 'expressions' | 'practice' | 'roleplay' | 'transfer_assessment' | 'result';
  currentTaskId?: string;
  requestedHintLevel?: HintLevel;
  recentTurns?: Array<{
    turnId: string;
    speaker: 'tutor' | 'user';
    text: string;
    timestamp: string;
  }>;
}

export interface ClientTranscribeRequest {
  audioBase64: string;
  mimeType: string;
  durationSeconds?: number;
}

export interface ClientTtsRequest {
  text: string;
  voiceName?: string;
}

export class ConversationApiClient {
  private activeRequestId: string | null = null;
  private currentAbortController: AbortController | null = null;
  private customFetch: typeof fetch;

  constructor(customFetch?: typeof fetch) {
    this.customFetch = customFetch || ((...args) => fetch(...args));
  }

  /**
   * 사용자 4대 명시 동의 및 성인 확인 검증
   */
  public verifyConsent(consent?: UserConsent): boolean {
    if (!consent) {
      throw new ConversationApiError(
        'AI 회화 사용을 위한 사용자 동의가 필요합니다.',
        'CONSENT_REQUIRED',
        403
      );
    }
    if (!consent.isAdult) {
      throw new ConversationApiError(
        '만 19세 이상 성인 사용자만 AI 회화 외부 모델 시험에 참여할 수 있습니다.',
        'CONSENT_REQUIRED',
        403
      );
    }
    if (
      !consent.sendCurrentTurnOnlyAgreed ||
      !consent.googleReviewDisclosureAgreed ||
      !consent.noSensitiveInfoAgreed
    ) {
      throw new ConversationApiError(
        '대화 전송 범위, 사람 검토 가능성, 개인정보 배제 약관에 모두 동의해야 합니다.',
        'CONSENT_REQUIRED',
        403
      );
    }
    return true;
  }

  /**
   * 진행 중인 요청 강제 취소
   */
  public abortCurrentRequest(): void {
    if (this.currentAbortController) {
      const controller = this.currentAbortController;
      this.currentAbortController = null;
      this.activeRequestId = null;
      controller.abort(new Error('REQUEST_CANCELLED'));
    }
  }

  /**
   * 대화 턴 전송 및 피드백 수신 (/api/conversation/chat)
   */
  public async sendTurn(
    req: ClientChatRequest,
    consent?: UserConsent,
    externalSignal?: AbortSignal
  ): Promise<TurnEvaluationResult> {
    const hasConsent = this.verifyConsent(consent);

    const requestId = crypto.randomUUID();
    this.acquireLock(requestId);

    try {
      const { response, data } = await this.executeFetch(
        '/api/conversation/chat',
        {
          requestId,
          userConsentToCloud: hasConsent,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: consent!.isAdult,
            sendCurrentTurnOnlyAgreed: consent!.sendCurrentTurnOnlyAgreed,
            googleReviewDisclosureAgreed: consent!.googleReviewDisclosureAgreed,
            noSensitiveInfoAgreed: consent!.noSensitiveInfoAgreed,
          },
          ...req,
        },
        externalSignal
      );

      if (data.fallbackToRuleEngine === true) {
        throw new ConversationApiError('모델 응답이 교육 규칙과 충돌하여 고정 교재 평가로 전환합니다.', 'SERVER_ERROR', response.status);
      }
      if (!data.success || !data.evaluation) {
        throw new ConversationApiError(
          data.errorMessage || 'AI 평가 응답이 올바르지 않습니다.',
          'SERVER_ERROR',
          response.status
        );
      }

      // 클라이언트 런타임 스키마 검증
      const validation = validateAndSanitizeEvaluationResult(data.evaluation);
      if (!validation.isValid || !validation.sanitizedResult) {
        throw new ConversationApiError(
          `클라이언트 응답 검증 실패: ${validation.errors.join(', ')}`,
          'INVALID_JSON',
          response.status
        );
      }

      return validation.sanitizedResult;
    } finally {
      this.releaseLock(requestId);
    }
  }

  /**
   * 음성 전사 요청 (/api/conversation/transcribe)
   */
  public async transcribeAudio(
    req: ClientTranscribeRequest,
    consent?: UserConsent,
    externalSignal?: AbortSignal
  ): Promise<string> {
    const hasConsent = this.verifyConsent(consent);

    const requestId = crypto.randomUUID();
    this.acquireLock(requestId);

    try {
      const { response, data } = await this.executeFetch(
        '/api/conversation/transcribe',
        {
          requestId,
          userConsentToCloud: hasConsent,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: consent!.isAdult,
            sendCurrentTurnOnlyAgreed: consent!.sendCurrentTurnOnlyAgreed,
            googleReviewDisclosureAgreed: consent!.googleReviewDisclosureAgreed,
            noSensitiveInfoAgreed: consent!.noSensitiveInfoAgreed,
          },
          ...req,
        },
        externalSignal
      );

      if (!data.success || typeof data.transcription !== 'string') {
        throw new ConversationApiError(
          data.errorMessage || '음성 인식 실패',
          'SERVER_ERROR',
          response.status
        );
      }

      const text = data.transcription.trim();
      if (text.length === 0) {
        throw new ConversationApiError('전사된 텍스트가 비어 있습니다.', 'INVALID_JSON', response.status);
      }

      return text;
    } finally {
      this.releaseLock(requestId);
    }
  }

  /**
   * 음성 합성 요청 (/api/conversation/tts)
   */
  public async synthesizeSpeech(
    req: ClientTtsRequest,
    consent?: UserConsent,
    externalSignal?: AbortSignal
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const hasConsent = this.verifyConsent(consent);

    const requestId = crypto.randomUUID();
    this.acquireLock(requestId);

    try {
      const { response, data } = await this.executeFetch(
        '/api/conversation/tts',
        {
          requestId,
          userConsentToCloud: hasConsent,
          consentPolicyVersion: CONVERSATION_POLICY_VERSION,
          consent: {
            isAdult: consent!.isAdult,
            sendCurrentTurnOnlyAgreed: consent!.sendCurrentTurnOnlyAgreed,
            googleReviewDisclosureAgreed: consent!.googleReviewDisclosureAgreed,
            noSensitiveInfoAgreed: consent!.noSensitiveInfoAgreed,
          },
          ...req,
        },
        externalSignal
      );

      if (!data.success || !data.audioBase64) {
        throw new ConversationApiError(
          data.errorMessage || '음성 합성 실패',
          'SERVER_ERROR',
          response.status
        );
      }

      return {
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || 'audio/wav',
      };
    } finally {
      this.releaseLock(requestId);
    }
  }

  private acquireLock(requestId: string): void {
    if (this.activeRequestId !== null) {
      throw new ConversationApiError(
        '이미 진행 중인 회화 요청이 있습니다. 이전 요청이 완료된 후 다시 시도해주세요.',
        'CONCURRENCY_LOCKED',
        409
      );
    }
    this.activeRequestId = requestId;
    this.currentAbortController = new AbortController();
  }

  private releaseLock(requestId: string): void {
    // 요청 소유권을 검사하여 이전 취소된 요청의 finally가 새 요청의 lock을 해제하지 않도록 방어
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
      this.currentAbortController = null;
    }
  }

  private async executeFetch<T = any>(
    path: string,
    payload: Record<string, unknown>,
    externalSignal?: AbortSignal
  ): Promise<{ response: Response; data: T }> {
    // 이미 취소된 시그널인 경우 upstream 0회 즉시 거부
    if (externalSignal?.aborted || this.currentAbortController?.signal.aborted) {
      throw new ConversationApiError(
        '요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.',
        'TIMEOUT'
      );
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ConversationApiError(
        '네트워크 연결이 끊어졌습니다. 오프라인 모드로 진행합니다.',
        'OFFLINE'
      );
    }

    const controller = new AbortController();
    // 브라우저 클라이언트 총 25초 유한 데드라인 (본문 파싱 완료까지 유지)
    const timeoutId = setTimeout(() => controller.abort(new Error('TIMEOUT')), 25000);

    const activeController = this.currentAbortController;
    let onActiveAbort: (() => void) | undefined;
    let onExternalAbort: (() => void) | undefined;
    let onTimeoutAbort: (() => void) | undefined;

    if (activeController) {
      onActiveAbort = () => controller.abort(activeController.signal.reason);
      activeController.signal.addEventListener('abort', onActiveAbort, { once: true });
    }
    if (externalSignal) {
      onExternalAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    // fetch부터 본문 파싱까지 controller.abort와 결합된 명시적 reject Promise를 준비
    const abortPromise = new Promise<never>((_, reject) => {
      onTimeoutAbort = () => {
        reject(new ConversationApiError('요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.', 'TIMEOUT'));
      };
      controller.signal.addEventListener('abort', onTimeoutAbort, { once: true });
    });
    // 이미 완료된 정상 작업 후의 지연 reject 유출 방지
    abortPromise.catch(() => {});

    const fetchAndParse = async (): Promise<{ response: Response; data: T }> => {
      const response = await this.customFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status} 오류`;
        try {
          const errBody = (await response.json()) as { errorMessage?: string };
          if (errBody?.errorMessage) errorMsg = errBody.errorMessage;
        } catch {
          if (controller.signal.aborted) {
            throw new ConversationApiError('요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.', 'TIMEOUT');
          }
        }

        if (response.status === 400) {
          throw new ConversationApiError(errorMsg, 'BAD_REQUEST', 400);
        }
        if (response.status === 401) {
          throw new ConversationApiError(errorMsg, 'UNAUTHORIZED', 401);
        }
        if (response.status === 403) {
          throw new ConversationApiError(errorMsg, 'FORBIDDEN', 403);
        }
        if (response.status === 429) {
          throw new ConversationApiError(errorMsg, 'RATE_LIMITED', 429);
        }
        if (response.status >= 500) {
          throw new ConversationApiError(errorMsg, 'SERVER_ERROR', response.status);
        }

        throw new ConversationApiError(errorMsg, 'SERVER_ERROR', response.status);
      }

      // 본문 파싱 완료까지 데드라인 타이머를 유지하여 늦은 body 수신 지연도 타임아웃 차단
      const data = await this.parseJsonResponse(response, controller.signal);
      return { response, data };
    };

    try {
      return await Promise.race([fetchAndParse(), abortPromise]);
    } catch (err: unknown) {
      // controller가 abort된 상태라면 다른 오류(INVALID_JSON 등)보다 항상 TIMEOUT을 최우선 판정
      if (controller.signal.aborted) {
        throw new ConversationApiError('요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.', 'TIMEOUT');
      }
      if (err instanceof ConversationApiError) {
        throw err;
      }
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new ConversationApiError('요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.', 'TIMEOUT');
      }
      throw new ConversationApiError(`네트워크 통신 오류: ${e.message}`, 'OFFLINE');
    } finally {
      clearTimeout(timeoutId);
      if (onTimeoutAbort) {
        controller.signal.removeEventListener('abort', onTimeoutAbort);
      }
      if (activeController && onActiveAbort) {
        activeController.signal.removeEventListener('abort', onActiveAbort);
      }
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async parseJsonResponse(response: Response, signal?: AbortSignal): Promise<any> {
    try {
      return await response.json();
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        throw new ConversationApiError(
          '요청이 시간 초과되었거나 사용자에 의해 중단되었습니다.',
          'TIMEOUT'
        );
      }
      throw new ConversationApiError(
        '서버 응답을 JSON으로 파싱할 수 없습니다.',
        'INVALID_JSON'
      );
    }
  }
}

export const conversationApi = new ConversationApiClient();

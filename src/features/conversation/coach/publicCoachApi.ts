// src/features/conversation/coach/publicCoachApi.ts
// 공개 AI 회화 코치 클라이언트 API 모듈
// [원칙]
// 1. 같은 origin 상대경로 /api/conversation/coach에만 POST 요청.
// 2. adultConfirmed !== true 시 요청 0회 즉시 차단.
// 3. transcriptConfirmed 불필요 (직접 평가 방식), 1~500자 trim.
// 4. 요청 25초 abort 상한, 동시 새 요청은 이전 요청 취소 + generation 관리.
// 5. credentials: 'same-origin', cache: 'no-store', redirect: 'error' (리다이렉트 로그인 응답을 성공으로 수용 금지).
// 6. 응답 16 KiB bounded stream reader(초과 시 cancel, AbortSignal 연동), meaning/sentenceComplete/한국어 feedbackKo/영문 modelAnswerEn 엄격 검증.
// 7. 타임아웃 발생 시 '초과' 에러 우선 reject, 사용자 명시 취소 시 '취소' 에러 유지.
// 8. crypto.randomUUID 필수 검증 (임의 고정 fallback 금지).

import {
  COACH_POLICY_VERSION,
  CoachBudgetError,
  CAFE_SCENARIO_ID,
  CAFE_QUESTIONS,
  COACH_QUESTIONS,
  type CoachEvaluation,
  type CoachInputContext,
  type CoachRecentContextItem,
} from './coachProtocol';

/**
 * 응답 본문을 최대 16 KiB까지만 스트림으로 안전하게 읽기 (초과 또는 abort 시 즉시 cancel)
 */
async function readBoundedText(
  response: Response,
  signal: AbortSignal,
  maxBytes = 16 * 1024
): Promise<string> {
  if (signal.aborted) {
    throw new Error('요청이 취소되었습니다.');
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    let totalBytes = 0;
    const chunks: Uint8Array[] = [];

    const onAbort = () => {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (signal.aborted) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          throw new Error('요청이 취소되었습니다.');
        }

        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              // ignore
            }
            throw new Error('응답 크기가 최대 허용치(16 KiB)를 초과했습니다.');
          }
          chunks.push(value);
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(combined);
  }

  // ReadableStream getReader가 없는 환경 폴백
  if (signal.aborted) {
    throw new Error('요청이 취소되었습니다.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error('응답 크기가 최대 허용치(16 KiB)를 초과했습니다.');
  }
  return text;
}

export class PublicCoachApiClient {
  private currentAbortController: AbortController | null = null;
  private currentGen = 0;

  constructor(private customFetch?: typeof fetch) {}

  /**
   * 진행 중인 요청 즉시 취소
   */
  public cancel(): void {
    this.currentGen++;
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {
        // ignore
      }
      this.currentAbortController = null;
    }
  }

  /**
   * 단일 답변에 대한 AI 코칭 평가 요청
   */
  public async evaluate(
    questionId: string,
    answer: string,
    adultConfirmed: boolean,
    context?: CoachInputContext
  ): Promise<CoachEvaluation> {
    // 1. 사전 유효성 검사 (타이머/fetch 호출 전 즉시 검증)
    if (adultConfirmed !== true) {
      throw new Error('만 18세 이상 성인 사용자 확인이 필요합니다.');
    }

    if (!questionId || typeof questionId !== 'string') {
      throw new Error('유효하지 않은 질문 ID입니다.');
    }

    const isCafeQuestion = CAFE_QUESTIONS.some((q) => q.id === questionId);
    const isLegacyQuestion = COACH_QUESTIONS.some((q) => q.id === questionId);
    if (!isCafeQuestion && !isLegacyQuestion) {
      throw new Error('유효하지 않은 질문 ID입니다.');
    }

    if (isCafeQuestion && (!context || context.scenarioId !== CAFE_SCENARIO_ID)) {
      throw new Error('카페 질문에는 올바른 시나리오 ID가 필요합니다.');
    }
    if (isLegacyQuestion && context?.scenarioId !== undefined) {
      throw new Error('레거시 질문에는 시나리오 ID를 지정할 수 없습니다.');
    }

    if (typeof answer !== 'string') {
      throw new Error('답변 내용이 올바른 문자열이 아닙니다.');
    }

    const trimmedAnswer = answer.trim();
    if (trimmedAnswer.length < 1 || trimmedAnswer.length > 500) {
      throw new Error('답변 내용은 공백을 제외하고 1자 이상 500자 이하여야 합니다.');
    }

    // 1-1. context 사전 유효성 검사 및 방어적 복사 (crypto, cancel, timer 생성 전에 수행)
    let validatedCandidates: string[] | undefined = undefined;
    let validatedInputSource: 'voice' | 'text' | undefined = undefined;
    let validatedScenarioId: string | undefined = undefined;
    let validatedRecentContext: CoachRecentContextItem[] | undefined = undefined;

    if (context) {
      if (context.inputSource !== 'voice' && context.inputSource !== 'text') {
        throw new Error('유효하지 않은 입력 방식(inputSource)입니다.');
      }
      validatedInputSource = context.inputSource;
      if (context.inputSource === 'text' && context.candidates) {
        throw new Error('텍스트 입력 방식에는 후보군을 전달할 수 없습니다.');
      }
      if (context.candidates !== undefined) {
        if (!Array.isArray(context.candidates) || context.candidates.length < 2 || context.candidates.length > 3) {
          throw new Error('후보군은 2개 이상 3개 이하의 배열이어야 합니다.');
        }
        const seen = new Set<string>();
        const clonedCandidates: string[] = [];
        for (const c of context.candidates) {
          if (typeof c !== 'string' || c.trim().length === 0 || c.length > 500) {
            throw new Error('후보군 항목은 공백이 아닌 1자 이상 500자 이하의 문자열이어야 합니다.');
          }
          if (seen.has(c)) {
            throw new Error('후보군에 중복된 항목이 존재합니다.');
          }
          seen.add(c);
          clonedCandidates.push(c);
        }
        if (clonedCandidates[0] !== trimmedAnswer) {
          throw new Error('후보군의 첫 번째 항목은 제출 답변과 정확히 일치해야 합니다.');
        }
        validatedCandidates = clonedCandidates;
      }

      if (context.scenarioId !== undefined) {
        if (typeof context.scenarioId !== 'string' || context.scenarioId !== CAFE_SCENARIO_ID) {
          throw new Error('유효하지 않은 시나리오 ID입니다.');
        }
        validatedScenarioId = context.scenarioId;
      }

      if (context.recentContext !== undefined) {
        if (!Array.isArray(context.recentContext)) {
          throw new Error('최근 대화 맥락(recentContext)은 배열이어야 합니다.');
        }
        if (context.recentContext.length > 2) {
          throw new Error('최근 대화 맥락은 최대 2턴까지만 허용됩니다.');
        }

        const validCatalogQuestionIds = new Set(
          validatedScenarioId === CAFE_SCENARIO_ID
            ? CAFE_QUESTIONS.map((q) => q.id)
            : COACH_QUESTIONS.map((q) => q.id)
        );

        const checkedContext: CoachRecentContextItem[] = [];
        for (const item of context.recentContext) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error('대화 맥락 항목이 올바른 객체가 아닙니다.');
          }
          const qId = item.questionId;
          const ans = item.answer;
          if (typeof qId !== 'string' || !validCatalogQuestionIds.has(qId)) {
            throw new Error('대화 맥락에 유효하지 않은 질문 ID가 포함되어 있습니다.');
          }
          if (typeof ans !== 'string' || ans.trim().length === 0 || ans.length > 500) {
            throw new Error('대화 맥락 답변은 1자 이상 500자 이하의 문자열이어야 합니다.');
          }
          checkedContext.push({ questionId: qId, answer: ans.trim() });
        }

        const contextBytes = new TextEncoder().encode(JSON.stringify(checkedContext)).byteLength;
        if (contextBytes > 1024) {
          throw new Error('대화 맥락 직렬화 크기가 최대 허용치(1024B)를 초과했습니다.');
        }
        validatedRecentContext = checkedContext;
      }
    }

    // crypto.randomUUID 필수 검증 (임의 고정 fallback 금지)
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      throw new Error('암호화 기능을 지원하지 않는 환경입니다.');
    }
    const requestId = crypto.randomUUID();

    // 2. 동시 새 요청 취소 및 generation 증가
    this.cancel();
    const gen = ++this.currentGen;

    const controller = new AbortController();
    this.currentAbortController = controller;

    // 3. 25초 타임아웃 및 취소 경합 프로미스 준비 (타임아웃 우선 판정)
    let isTimedOut = false;
    let timerId: any = null;
    let abortListener: (() => void) | null = null;

    const deadlinePromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        isTimedOut = true;
        reject(new Error('AI 평가 요청 시간이 초과되었습니다 (25초).'));
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }, 25000);

      abortListener = () => {
        if (!isTimedOut) {
          reject(new Error('요청이 취소되었습니다.'));
        }
      };
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });

    const payload: Record<string, unknown> = {
      requestId,
      adultConfirmed: true,
      policyVersion: COACH_POLICY_VERSION,
      questionId,
      answer: trimmedAnswer,
    };
    if (validatedInputSource) {
      payload.inputSource = validatedInputSource;
    }
    if (validatedCandidates) {
      payload.candidates = validatedCandidates;
    }
    if (validatedScenarioId) {
      payload.scenarioId = validatedScenarioId;
    }
    if (validatedRecentContext) {
      payload.recentContext = validatedRecentContext;
    }

    const fetchFn = this.customFetch || fetch;

    const networkPipeline = (async (): Promise<CoachEvaluation> => {
      const response = await fetchFn('/api/conversation/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          try {
            const rawErrText = await readBoundedText(response, controller.signal, 16 * 1024);
            const errJson = JSON.parse(rawErrText);
            if (errJson && typeof errJson === 'object') {
              if (
                errJson.errorCode === 'COACH_MINUTE_LIMIT' &&
                Number.isSafeInteger(errJson.retryAfterSeconds) &&
                errJson.retryAfterSeconds >= 1 &&
                errJson.retryAfterSeconds <= 61
              ) {
                const msg = typeof errJson.errorMessage === 'string' && errJson.errorMessage.trim()
                  ? errJson.errorMessage
                  : '잠시 요청이 집중되었습니다. 잠시 후 자동으로 다시 시도합니다.';
                throw new CoachBudgetError(msg, 'COACH_MINUTE_LIMIT', errJson.retryAfterSeconds);
              }
              if (errJson.errorCode === 'COACH_DAILY_LIMIT') {
                const msg = typeof errJson.errorMessage === 'string' && errJson.errorMessage.trim()
                  ? errJson.errorMessage
                  : '하루 무료 평가 한도를 사용했어요. 한도 초기화 후 다시 이용해 주세요.';
                throw new CoachBudgetError(msg, 'COACH_DAILY_LIMIT');
              }
            }
          } catch (e) {
            if (e instanceof CoachBudgetError) {
              throw e;
            }
          }
          throw new Error('AI 서비스 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.');
        }
        if (response.status === 503) {
          throw new Error('AI 서비스가 일시적으로 원활하지 않습니다. 잠시 후 다시 시도해 주세요.');
        }
        throw new Error('AI 평가 서비스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }

      const rawText = await readBoundedText(response, controller.signal, 16 * 1024);

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error('AI 서비스 응답 형식이 올바르지 않습니다.');
      }

      if (!data || typeof data !== 'object' || data.success !== true || !data.evaluation) {
        throw new Error('AI 평가 결과를 받아오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }

      const ev = data.evaluation;
      const validMeanings = ['relevant', 'needs_help', 'uncertain'];
      if (!validMeanings.includes(ev.meaning)) {
        throw new Error('평가 결과(meaning)가 유효하지 않습니다.');
      }

      if (typeof ev.sentenceComplete !== 'boolean') {
        throw new Error('평가 결과(sentenceComplete)가 유효하지 않습니다.');
      }

      if (
        typeof ev.feedbackKo !== 'string' ||
        ev.feedbackKo.trim().length === 0 ||
        ev.feedbackKo.length > 500 ||
        !/[가-힣]/.test(ev.feedbackKo)
      ) {
        throw new Error('평가 피드백(feedbackKo)이 유효하지 않습니다.');
      }

      if (
        typeof ev.modelAnswerEn !== 'string' ||
        ev.modelAnswerEn.trim().length === 0 ||
        ev.modelAnswerEn.length > 200 ||
        !/[a-zA-Z]/.test(ev.modelAnswerEn) ||
        /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ev.modelAnswerEn)
      ) {
        throw new Error('모범 답안(modelAnswerEn)이 유효하지 않습니다.');
      }

      if (this.currentGen !== gen) {
        throw new Error('요청이 취소되었습니다.');
      }

      let recognizedCandidateIndex: number | undefined = undefined;
      if (validatedCandidates && validatedCandidates.length > 0) {
        if (
          typeof ev.recognizedCandidateIndex !== 'number' ||
          !Number.isInteger(ev.recognizedCandidateIndex) ||
          ev.recognizedCandidateIndex < 0 ||
          ev.recognizedCandidateIndex >= validatedCandidates.length
        ) {
          throw new Error('평가 결과의 후보 인덱스(recognizedCandidateIndex)가 유효하지 않습니다.');
        }
        recognizedCandidateIndex = ev.recognizedCandidateIndex;
      } else if (
        ev.recognizedCandidateIndex !== undefined &&
        ev.recognizedCandidateIndex !== 0
      ) {
        throw new Error('후보군이 없을 때 유효하지 않은 인덱스 응답입니다.');
      }

      // adaptive scenario nextQuestionId 클라이언트 정밀 검증
      let nextQuestionId: string | undefined = undefined;
      if (validatedScenarioId === CAFE_SCENARIO_ID) {
        const currentNode = CAFE_QUESTIONS.find((q) => q.id === questionId);
        if (currentNode) {
          if (
            typeof ev.nextQuestionId !== 'string' ||
            !currentNode.allowedNextQuestionIds.includes(ev.nextQuestionId)
          ) {
            throw new Error('평가 결과의 다음 질문 ID(nextQuestionId)가 허용 목록에 없습니다.');
          }
          nextQuestionId = ev.nextQuestionId;
        }
      } else if (ev.nextQuestionId !== undefined) {
        if (typeof ev.nextQuestionId !== 'string') {
          throw new Error('유효하지 않은 다음 질문 ID 응답입니다.');
        }
        nextQuestionId = ev.nextQuestionId;
      }

      return {
        meaning: ev.meaning,
        sentenceComplete: ev.sentenceComplete,
        feedbackKo: ev.feedbackKo.trim(),
        modelAnswerEn: ev.modelAnswerEn.trim(),
        recognizedCandidateIndex,
        ...(nextQuestionId ? { nextQuestionId } : {}),
      };
    })();

    // unhandled rejection 방지: fetch가 지연되거나 무시되어도 상위 race 탈출 후 백그라운드 에러 삼킴
    networkPipeline.catch(() => {});

    try {
      return await Promise.race([networkPipeline, deadlinePromise]);
    } finally {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      if (abortListener) {
        controller.signal.removeEventListener('abort', abortListener);
      }
      // 오래된 완료가 새 요청의 abortController를 지우지 않도록 generation 체크
      if (this.currentGen === gen && this.currentAbortController === controller) {
        this.currentAbortController = null;
      }
    }
  }
}

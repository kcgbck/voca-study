// src/features/conversation/coach/CoachTutorController.ts
// 한국어 가이드 성인 초보 영어 회화 튜터 컨트롤러
// [원칙]
// 1. 한국어 진행/피드백 + 영어 질문/예문. 마이크는 TTS 종료 후에만 활성화.
// 2. 질문 종료 즉시 마이크 준비 및 10초 바운디드 인식 창 활성화 (옵션 thinkingMs 지원).
// 3. 답변 창 10초(answerWindowMs) 동안 바운디드 윈도우 캡처(BrowserSpeechInputService 내부 조기종료 재시작 관리).
// 4. 초기 답변 및 변경된 답변은 추가 확인 절차 없이 즉시 AI 평가(evaluate)로 진행.
// 5. 반복 연습(repeat)에서 직전 AI 승인된 정답과 대소문자/말미문장부호 정규화 후 일치 시에만 재호출 없이 안전 재사용. 교재 정답 단순 일치 채점 금지.
// 6. relevant + sentenceComplete인 경우 목표 1회, 단답/미완성인 경우 2회 연습.
// 7. pause 시 즉시 cancel() 호출 및 모든 타이머 정리, 진행 중인 실행 즉시 settle.
// 8. 모든 비동기 단계(TTS 15초, 평가 25초, 영어 듣기 10초+상한)는 상한과 AbortSignal 결합.
// 9. 음성 출력 실패(speak resolves false) 시 에러 상태로 즉시 종료하며 마이크/평가 0회.

import {
  type CoachEvaluation,
  type CoachQuestion,
  CoachBudgetError,
} from './coachProtocol';
import type { BrowserSpeechInputOptions } from '../services/browserSpeechInput';

export type CoachPhase =
  | 'ready'
  | 'preparing'
  | 'speaking'
  | 'thinking'
  | 'listening'
  | 'evaluating'
  | 'waiting'
  | 'practicing'
  | 'complete'
  | 'paused'
  | 'error';

export interface CoachSnapshot {
  phase: CoachPhase;
  question?: CoachQuestion;
  recognizedText: string;
  feedbackKo: string;
  modelAnswerEn: string;
  practiceDone: number;
  practiceTarget: number;
  message: string;
}

export interface CoachTutorControllerDeps {
  speak: (text: string, lang: string) => Promise<boolean>;
  listen: (lang: string, options?: BrowserSpeechInputOptions) => Promise<string>;
  cancel: () => void;
  evaluate: (questionId: string, answer: string) => Promise<CoachEvaluation>;
  emit: (state: CoachSnapshot) => void;
  isTextMode?: () => boolean;
}

export interface CoachTutorControllerOptions {
  thinkingMs?: number;
  answerWindowMs?: number;
}

/**
 * 안전한 보수적 정답 재사용 키 정규화 (대소문자 및 말미 문장부호 허용, 내부 구두점 보존)
 * - 양 끝 공백 제거 및 연속 공백 1칸 축약
 * - 굽은 아포스트로피(’/‘)를 곧은 아포스트로피(')로 통일 (아포스트로피 제거 절대 금지)
 * - 소문자화
 * - 문장 끝 종결 문장부호(., !, ?)만 제거 (내부 쉼표, 하이픈, 소수점 등 의미 변경 부호 완전 보존)
 * - 문장부호 제거 후 빈 문자열이 되는 경우(구두점만 입력된 경우) 빈 키 반환 (재사용 불가)
 */
export function normalizeRepeatAnswerKey(rawText: string): string {
  if (typeof rawText !== 'string') return '';
  let text = rawText.trim();
  if (text.length === 0) return '';

  // 1. 굽은 따옴표/아포스트로피 통일 (제거하지 않음)
  text = text.replace(/[\u2018\u2019]/g, "'");

  // 2. 연속 공백 1칸 축약
  text = text.replace(/\s+/g, ' ');

  // 3. 소문자화
  text = text.toLowerCase();

  // 4. 문장 말미 종결부호(., !, ?)만 반복 제거
  text = text.replace(/[.!?]+$/g, '').trim();

  return text;
}

export class CoachTutorController {
  private currentAbortController: AbortController | null = null;
  private currentQuestion?: CoachQuestion;
  private currentPhase: CoachPhase = 'ready';
  private recognizedText = '';
  private feedbackKo = '';
  private modelAnswerEn = '';
  private practiceDone = 0;
  private practiceTarget = 1;
  private currentMode: 'initial' | 'repeat' = 'initial';
  private pendingTextResolver: ((text: string) => void) | null = null;
  private lastValidatedEntry: {
    questionId: string;
    answer: string;
    normalizedKey: string;
    evaluation: CoachEvaluation;
  } | null = null;

  constructor(
    private deps: CoachTutorControllerDeps,
    private options?: CoachTutorControllerOptions
  ) {}

  /**
   * 취소 및 타임아웃 경합 헬퍼 (모의/네이티브 프로미스가 취소를 무시해도 즉시 settle)
   */
  private raceStep<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<
    | { status: 'ok'; value: T }
    | { status: 'aborted' }
    | { status: 'timeout' }
    | { status: 'error'; error: any }
  > {
    if (signal.aborted) {
      return Promise.resolve({ status: 'aborted' });
    }

    return new Promise((resolve) => {
      let settled = false;
      let timerId: any = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        signal.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ status: 'aborted' });
      };

      signal.addEventListener('abort', onAbort, { once: true });

      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timerId = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            this.deps.cancel();
          } catch {
            // ignore
          }
          resolve({ status: 'timeout' });
        }, timeoutMs);
      }

      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({ status: 'ok', value });
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({ status: 'error', error });
        }
      );
    });
  }

  /**
   * 중단 가능한 안전 지연(Sleep)
   */
  private safeSleep(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || ms <= 0) return Promise.resolve(!signal.aborted);

    return new Promise((resolve) => {
      let timerId: any = null;

      const onAbort = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        signal.removeEventListener('abort', onAbort);
        resolve(false);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      timerId = setTimeout(() => {
        timerId = null;
        signal.removeEventListener('abort', onAbort);
        resolve(!signal.aborted);
      }, ms);
    });
  }

  /**
   * 상태 스냅샷 발행
   */
  private emitSnapshot(partial: Partial<CoachSnapshot> & { phase: CoachPhase }): void {
    this.currentPhase = partial.phase;
    const snapshot: CoachSnapshot = {
      phase: partial.phase,
      question: this.currentQuestion,
      recognizedText: partial.recognizedText ?? this.recognizedText,
      feedbackKo: partial.feedbackKo ?? this.feedbackKo,
      modelAnswerEn: partial.modelAnswerEn ?? this.modelAnswerEn,
      practiceDone: partial.practiceDone ?? this.practiceDone,
      practiceTarget: partial.practiceTarget ?? this.practiceTarget,
      message: partial.message ?? '',
    };
    this.deps.emit(snapshot);
  }

  /**
   * 취소 및 15초 상한이 보장된 TTS 발화
   */
  private async safeSpeak(text: string, lang: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;

    const res = await this.raceStep(this.deps.speak(text, lang), 15000, signal);
    if (signal.aborted || res.status === 'aborted') {
      return false;
    }

    if (res.status === 'timeout') {
      this.emitSnapshot({
        phase: 'error',
        message: '음성 출력 시간이 초과되었습니다.',
      });
      return false;
    }

    if (res.status === 'error' || res.value === false) {
      this.emitSnapshot({
        phase: 'error',
        message: '음성 출력에 실패했습니다.',
      });
      return false;
    }

    return true;
  }

  /**
   * 취소 및 25초 상한이 보장된 AI 평가 (최대 3회: 1회 최초 시도 + 분당 한도에 한해 최대 2회 대기 후 자동 재시도)
   */
  private async safeEvaluate(
    questionId: string,
    answer: string,
    signal: AbortSignal
  ): Promise<CoachEvaluation | null> {
    if (signal.aborted) return null;

    let retryCount = 0;
    let spokenWaitNotice = false;

    while (!signal.aborted && retryCount <= 2) {
      const res = await this.raceStep(
        this.deps.evaluate(questionId, answer),
        25000,
        signal
      );

      if (signal.aborted || res.status === 'aborted') {
        return null;
      }

      if (res.status === 'ok' && res.value) {
        if (
          !signal.aborted &&
          res.value.meaning === 'relevant' &&
          res.value.sentenceComplete === true
        ) {
          const normKey = normalizeRepeatAnswerKey(answer);
          if (normKey.length > 0) {
            this.lastValidatedEntry = {
              questionId,
              answer: answer.trim(),
              normalizedKey: normKey,
              evaluation: { ...res.value },
            };
          }
        }
        return res.value;
      }

      if (res.status === 'timeout') {
        this.emitSnapshot({
          phase: 'error',
          message: '평가 응답 시간이 초과되었습니다.',
        });
        return null;
      }

      if (res.status === 'error') {
        const err = res.error;
        if (err instanceof CoachBudgetError) {
          if (err.code === 'COACH_DAILY_LIMIT') {
            this.emitSnapshot({
              phase: 'error',
              message: err.message || '하루 무료 평가 한도를 사용했어요. 한도 초기화 후 다시 이용해 주세요.',
            });
            return null;
          }

          if (
            err.code === 'COACH_MINUTE_LIMIT' &&
            Number.isSafeInteger(err.retryAfterSeconds) &&
            err.retryAfterSeconds! >= 1 &&
            err.retryAfterSeconds! <= 61
          ) {
            if (retryCount >= 2) {
              this.emitSnapshot({
                phase: 'error',
                message: '서비스 이용이 많아 처리가 지연되고 있습니다. 잠시 후 다시 이용해 주세요.',
              });
              return null;
            }

            retryCount++;
            const waitTotal = err.retryAfterSeconds!;

            if (!spokenWaitNotice) {
              spokenWaitNotice = true;
              this.emitSnapshot({
                phase: 'waiting',
                message: `잠시 이용량이 많아 ${waitTotal}초 후 자동으로 평가합니다.`,
              });
              // 첫 대기 시 1회만 한국어 안내 발화 (실패 시 즉시 null 반환하여 safeSpeak의 error 보존)
              const spokeNotice = await this.safeSpeak(
                '잠시 이용량이 많아 잠시 후 자동으로 평가합니다.',
                'ko-KR',
                signal
              );
              if (!spokeNotice || signal.aborted) {
                return null;
              }
            }

            // 1초 단위로 안전하게 카운트다운 진행 (진행 중 언제든 pause/abort 가능)
            for (let sec = waitTotal; sec > 0; sec--) {
              if (signal.aborted) return null;
              this.emitSnapshot({
                phase: 'waiting',
                message: `잠시 이용량이 많아 ${sec}초 후 자동으로 평가합니다.`,
              });
              const sleepOk = await this.safeSleep(1000, signal);
              if (!sleepOk || signal.aborted) return null;
            }

            if (signal.aborted) return null;
            this.emitSnapshot({ phase: 'evaluating', message: '답변을 분석하고 있습니다.' });
            continue;
          }
        }

        // 일반 오류는 유용한 서버 에러 메시지 보존
        const errMsg = err?.message || '평가 서비스 연결에 실패했습니다.';
        this.emitSnapshot({
          phase: 'error',
          message: errMsg,
        });
        return null;
      }

      return null;
    }

    return null;
  }

  /**
   * 텍스트 모드 전용 답변 대기 (음성 마이크, 타이머, 무음 폴백 없음)
   */
  private waitForTextAnswer(
    signal: AbortSignal
  ): Promise<
    | { status: 'ok'; text: string }
    | { status: 'fatal_error' }
    | { status: 'timeout' }
    | { status: 'aborted' }
  > {
    if (signal.aborted) {
      return Promise.resolve({ status: 'aborted' });
    }

    this.recognizedText = '';
    this.emitSnapshot({
      phase: 'thinking',
      recognizedText: '',
      message: '영어 답변을 입력해 주세요.',
    });

    return new Promise((resolve) => {
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        this.pendingTextResolver = null;
        resolve({ status: 'aborted' });
      };

      signal.addEventListener('abort', onAbort, { once: true });

      this.pendingTextResolver = (submittedText: string) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        this.pendingTextResolver = null;
        const trimmed = submittedText.trim();
        if (trimmed.length > 0) {
          resolve({ status: 'ok', text: trimmed });
        } else {
          resolve({ status: 'timeout' });
        }
      };
    });
  }

  /**
   * 영어 답변 듣기 (기본 10초 바운디드 윈도우 단일 세션, 조기종료 복구는 음성서비스가 전담)
   */
  private async listenEnglishWithSilenceRetry(
    signal: AbortSignal
  ): Promise<
    | { status: 'ok'; text: string }
    | { status: 'fatal_error' }
    | { status: 'timeout' }
    | { status: 'aborted' }
  > {
    if (signal.aborted) {
      return { status: 'aborted' };
    }

    if (this.deps.isTextMode?.()) {
      return this.waitForTextAnswer(signal);
    }

    const windowMs = this.options?.answerWindowMs ?? 10000;
    const windowSec = Math.round(windowMs / 1000);
    const listeningMsg = `${windowSec}초 동안 듣는 중`;
    this.recognizedText = '';
    this.emitSnapshot({
      phase: 'preparing',
      recognizedText: '',
      message: '마이크 준비 중',
    });

    let active = true;
    let res: Awaited<ReturnType<typeof this.raceStep<string>>>;
    try {
      res = await this.raceStep(
        this.deps.listen('en-US', {
          windowMs,
          onReady: () => {
            if (!signal.aborted && active) {
              this.emitSnapshot({
                phase: 'listening',
                message: listeningMsg,
              });
            }
          },
          onPartial: (partial: string) => {
            if (!signal.aborted && active) {
              this.recognizedText = partial;
              this.emitSnapshot({
                phase: 'listening',
                recognizedText: partial,
                message: listeningMsg,
              });
            }
          },
        }),
        windowMs + 6500,
        signal
      );
    } finally {
      active = false;
    }

    if (signal.aborted || res.status === 'aborted') {
      return { status: 'aborted' };
    }

    if (res.status === 'timeout') {
      return { status: 'timeout' };
    }

    if (res.status === 'ok') {
      const text = (res.value || '').trim();
      if (text.length > 0) {
        return { status: 'ok', text };
      }
      return { status: 'timeout' };
    }

    if (res.status === 'error') {
      const code = res.error?.code;
      if (code === 'no-speech' || code === 'empty-result') {
        return { status: 'timeout' };
      }

      // 권한, 네트워크 등 치명적 오류 (paused로 덮어쓰지 않고 error 보존)
      this.emitSnapshot({
        phase: 'error',
        message: res.error?.message || '음성 인식 중 오류가 발생했습니다.',
      });
      return { status: 'fatal_error' };
    }

    return { status: 'timeout' };
  }

  /**
   * 코칭 세션 시작
   */
  public async start(question: CoachQuestion): Promise<void> {
    this.currentAbortController?.abort();
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const signal = abortController.signal;

    try {
      this.deps.cancel();
    } catch {
      // ignore
    }

    this.currentQuestion = question;
    this.recognizedText = '';
    this.feedbackKo = '';
    this.modelAnswerEn = '';
    this.practiceDone = 0;
    this.practiceTarget = 1;
    this.currentMode = 'initial';
    this.lastValidatedEntry = null;

    // 1. 한국어 상황 설명
    this.emitSnapshot({ phase: 'speaking', message: question.scenarioKo });
    if (!(await this.safeSpeak(question.scenarioKo, 'ko-KR', signal))) return;

    // 하위 호환 테스트를 위한 옵션 지연 (기본값 0: 딜레이 없이 즉시 진행)
    const thinkingMs = this.options?.thinkingMs ?? 0;
    if (thinkingMs > 0) {
      this.emitSnapshot({ phase: 'thinking', message: '답변 준비 시간' });
      if (!(await this.safeSleep(thinkingMs, signal))) return;
    }

    // 2. 영어 질문 발화 (질문 종료 즉시 10초 마이크 청취 시작)
    this.emitSnapshot({ phase: 'speaking', message: question.questionEn });
    if (!(await this.safeSpeak(question.questionEn, 'en-US', signal))) return;

    // 3. 초기 답변 듣기 (영어 10초 바운디드 캡처 후 직접 평가)
    const listenRes = await this.listenEnglishWithSilenceRetry(signal);
    if (signal.aborted || listenRes.status === 'aborted') return;

    if (listenRes.status === 'fatal_error') {
      return;
    }

    if (listenRes.status === 'timeout') {
      // 초기 무음/빈 결과: 가짜 채점 없이 고정 교재 예문 기반 한국어 도움말 제공 후 2회 반복 연습 진행
      this.feedbackKo = '괜찮아요. 예문을 듣고 함께 연습해 볼까요?';
      this.modelAnswerEn = question.exampleAnswerEn;
      this.practiceTarget = 2;
      this.practiceDone = 0;
      this.currentMode = 'repeat';

      this.currentPhase = 'speaking';
      this.emitSnapshot({
        phase: 'speaking',
        feedbackKo: this.feedbackKo,
        modelAnswerEn: this.modelAnswerEn,
        message: '답변을 듣지 못했습니다. 예문으로 연습을 시작합니다.',
      });

      if (!(await this.safeSpeak(this.feedbackKo, 'ko-KR', signal))) return;

      await this.runPracticeLoop(signal);
      return;
    }

    const transcript = listenRes.text;
    this.recognizedText = transcript;

    // 4. 초기 평가 및 피드백 직접 진행
    await this.processEvaluationAndContinue(transcript, signal);
  }

  /**
   * 평가 실행 및 이후 반복 연습 진행
   */
  private async processEvaluationAndContinue(answer: string, signal: AbortSignal): Promise<void> {
    if (!this.currentQuestion || signal.aborted) return;

    this.emitSnapshot({ phase: 'evaluating', message: '답변을 분석하고 있습니다.' });
    const evaluation = await this.safeEvaluate(this.currentQuestion.id, answer, signal);
    if (signal.aborted || !evaluation) return;

    this.feedbackKo = evaluation.feedbackKo;
    this.modelAnswerEn = evaluation.modelAnswerEn;

    this.emitSnapshot({
      phase: 'speaking',
      feedbackKo: this.feedbackKo,
      modelAnswerEn: this.modelAnswerEn,
      message: this.feedbackKo,
    });
    if (!(await this.safeSpeak(this.feedbackKo, 'ko-KR', signal))) return;

    // uncertain 판정 시 즉시 paused (진도 0)
    if (evaluation.meaning === 'uncertain') {
      this.emitSnapshot({ phase: 'paused', message: '뜻을 확실하게 이해하지 못했어요.' });
      return;
    }

    // relevant + sentenceComplete인 경우 목표 1회, 단답/미완성은 2회
    if (evaluation.meaning === 'relevant' && evaluation.sentenceComplete === true) {
      this.practiceTarget = 1;
    } else {
      this.practiceTarget = 2;
    }

    // 7. 반복 연습 모드 진입
    this.currentMode = 'repeat';
    await this.runPracticeLoop(signal);
  }

  /**
   * 반복 연습 루프 실행
   */
  private async runPracticeLoop(signal: AbortSignal): Promise<void> {
    if (!this.currentQuestion || signal.aborted) return;

    while (!signal.aborted && this.practiceDone < this.practiceTarget) {
      let attemptFailCount = 0;
      let stepSuccess = false;

      while (!signal.aborted && !stepSuccess && attemptFailCount < 3) {
        // 따라하기 안내 (한국어 - 영어 모델 발화 전에 먼저 안내)
        this.emitSnapshot({ phase: 'speaking', message: '따라 말해 볼까요?' });
        if (!(await this.safeSpeak('따라 말해 볼까요?', 'ko-KR', signal))) return;

        // 모범 예문 읽기 (영어 - 종료 즉시 마이크 청취 시작)
        this.emitSnapshot({ phase: 'speaking', message: this.modelAnswerEn });
        if (!(await this.safeSpeak(this.modelAnswerEn, 'en-US', signal))) return;

        // 영어 발화 듣기
        const listenRes = await this.listenEnglishWithSilenceRetry(signal);
        if (signal.aborted || listenRes.status === 'aborted') return;

        if (listenRes.status === 'fatal_error') return;

        if (listenRes.status === 'timeout') {
          this.emitSnapshot({ phase: 'paused', message: '답변을 감지하지 못했습니다.' });
          return;
        }

        const repeatTranscript = listenRes.text;
        this.recognizedText = repeatTranscript;

        // 반복 발화 평가
        const trimmedRepeat = repeatTranscript.trim();
        const repeatKey = normalizeRepeatAnswerKey(trimmedRepeat);
        let repeatEval: CoachEvaluation | null = null;

        if (
          !signal.aborted &&
          this.currentMode === 'repeat' &&
          this.lastValidatedEntry &&
          this.lastValidatedEntry.questionId === this.currentQuestion.id &&
          repeatKey.length > 0 &&
          this.lastValidatedEntry.normalizedKey === repeatKey
        ) {
          repeatEval = { ...this.lastValidatedEntry.evaluation };
        } else {
          this.emitSnapshot({ phase: 'evaluating', message: '반복 발화를 평가하고 있습니다.' });
          repeatEval = await this.safeEvaluate(this.currentQuestion.id, repeatTranscript, signal);
        }

        if (signal.aborted || !repeatEval) return;

        this.feedbackKo = repeatEval.feedbackKo;
        this.modelAnswerEn = repeatEval.modelAnswerEn;

        this.emitSnapshot({
          phase: 'speaking',
          feedbackKo: this.feedbackKo,
          modelAnswerEn: this.modelAnswerEn,
          message: repeatEval.feedbackKo,
        });
        if (!(await this.safeSpeak(repeatEval.feedbackKo, 'ko-KR', signal))) return;

        // 반복 연습 중 uncertain인 경우 크레딧 없이 paused
        if (repeatEval.meaning === 'uncertain') {
          this.emitSnapshot({ phase: 'paused', message: '뜻을 확실하게 이해하지 못했어요.' });
          return;
        }

        if (repeatEval.meaning === 'relevant' && repeatEval.sentenceComplete === true) {
          this.practiceDone++;
          stepSuccess = true;
        } else {
          attemptFailCount++;
          if (attemptFailCount >= 3) {
            this.emitSnapshot({ phase: 'paused', message: '반복 연습 시도 횟수를 초과했습니다.' });
            return;
          }
        }
      }
    }

    if (signal.aborted) return;

    if (this.practiceDone >= this.practiceTarget) {
      this.emitSnapshot({
        phase: 'speaking',
        message: '이번 연습을 마쳤어요. 다음 질문을 눌러주세요.',
      });
      // 완료 안내 발화 실패 시 complete로 전환 금지
      const speechOk = await this.safeSpeak(
        '이번 연습을 마쳤어요. 다음 질문을 눌러주세요.',
        'ko-KR',
        signal
      );
      if (!speechOk || signal.aborted) return;

      this.emitSnapshot({ phase: 'complete', message: '연습 완료' });
    }
  }

  /**
   * 일시정지 (즉시 취소 및 타이머 해제)
   */
  public pause(): void {
    this.pendingTextResolver = null;
    this.lastValidatedEntry = null;
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    try {
      this.deps.cancel();
    } catch {
      // ignore
    }
    this.emitSnapshot({ phase: 'paused', message: '일시정지되었습니다.' });
  }

  /**
   * 텍스트 직접 제출 (STT 확인 생략, 현재 모드에서 즉시 평가)
   * complete 이후이거나 평가/대기 진행 중(evaluating, waiting), 또는 목표 횟수를 달성한 상태에서는 동작하지 않음
   */
  public async submitText(text: string): Promise<void> {
    if (!this.currentQuestion || typeof text !== 'string') return;
    if (
      this.currentPhase === 'complete' ||
      this.currentPhase === 'evaluating' ||
      this.currentPhase === 'waiting' ||
      this.practiceDone >= this.practiceTarget
    ) {
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 500) return;

    if (this.pendingTextResolver) {
      const resolver = this.pendingTextResolver;
      this.pendingTextResolver = null;
      resolver(trimmed);
      return;
    }

    this.currentAbortController?.abort();
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const signal = abortController.signal;

    try {
      this.deps.cancel();
    } catch {
      // ignore
    }

    this.recognizedText = trimmed;

    if (this.currentMode === 'initial') {
      await this.processEvaluationAndContinue(trimmed, signal);
    } else {
      const repeatKey = normalizeRepeatAnswerKey(trimmed);
      let repeatEval: CoachEvaluation | null = null;
      if (
        !signal.aborted &&
        this.currentMode === 'repeat' &&
        this.lastValidatedEntry &&
        this.lastValidatedEntry.questionId === this.currentQuestion.id &&
        repeatKey.length > 0 &&
        this.lastValidatedEntry.normalizedKey === repeatKey
      ) {
        repeatEval = { ...this.lastValidatedEntry.evaluation };
      } else {
        this.emitSnapshot({ phase: 'evaluating', message: '반복 발화를 평가하고 있습니다.' });
        repeatEval = await this.safeEvaluate(this.currentQuestion.id, trimmed, signal);
      }
      if (signal.aborted || !repeatEval) return;

      this.feedbackKo = repeatEval.feedbackKo;
      this.modelAnswerEn = repeatEval.modelAnswerEn;

      this.emitSnapshot({
        phase: 'speaking',
        feedbackKo: this.feedbackKo,
        modelAnswerEn: this.modelAnswerEn,
        message: repeatEval.feedbackKo,
      });
      if (!(await this.safeSpeak(repeatEval.feedbackKo, 'ko-KR', signal))) return;

      if (repeatEval.meaning === 'uncertain') {
        this.emitSnapshot({ phase: 'paused', message: '뜻을 확실하게 이해하지 못했어요.' });
        return;
      }

      if (repeatEval.meaning === 'relevant' && repeatEval.sentenceComplete === true) {
        this.practiceDone++;
      }

      await this.runPracticeLoop(signal);
    }
  }
}

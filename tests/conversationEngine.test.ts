// tests/conversationEngine.test.ts
// 교육 규칙 엔진, 상태 머신, 100개 골든셋, 복습 스케줄러 및 보안 검증 테스트

import { describe, it, expect } from 'vitest';
import { evaluateUserUtterance } from '../src/features/conversation/engine/pedagogyEvaluator';
import { checkSituationConsistency } from '../src/features/conversation/engine/consistencyChecker';
import { LessonStateMachine } from '../src/features/conversation/engine/lessonStateMachine';
import {
  scheduleNextReviewOnSuccess,
  scheduleNextReviewOnFailure,
  isReviewDue,
  toKSTDateString,
} from '../src/features/conversation/engine/reviewScheduler';
import { validateAndSanitizeEvaluationResult } from '../src/features/conversation/engine/responseValidator';
import { getLessonById } from '../src/features/conversation/content/lessons';
import { GOLDEN_TEST_CASES } from './fixtures/conversationGolden';
import type { ConversationReviewItem } from '../src/features/conversation/types';

describe('100개 교육 평가 골든셋 전수 검증', () => {
  it('골든셋 총 케이스가 정확히 100개(5개 범주 각 20개)여야 한다', () => {
    expect(GOLDEN_TEST_CASES).toHaveLength(100);

    const categories = [
      'short_answer',
      'error_correction',
      'transcript_uncertain',
      'situation_conflict',
      'stuck_hint',
    ];

    for (const cat of categories) {
      const count = GOLDEN_TEST_CASES.filter((c) => c.category === cat).length;
      expect(count, `범주 ${cat}의 개수가 20이어야 함`).toBe(20);
    }
  });

  describe('범주 1: 단답 20건 검증 (문법 오류 오판 0건)', () => {
    const shortCases = GOLDEN_TEST_CASES.filter((c) => c.category === 'short_answer');

    shortCases.forEach((tc) => {
      it(`[${tc.id}] ${tc.level} - "${tc.userInput}" 문법 오류 판정 금지`, () => {
        const lesson = getLessonById(tc.lessonId);
        expect(lesson, `수업 ${tc.lessonId}을 찾을 수 없음`).toBeDefined();

        const result = evaluateUserUtterance(tc.userInput, lesson!);
        expect(
          result.evaluation,
          `단답 "${tc.userInput}"이 ERROR_CORRECTION으로 오판되지 않아야 함`
        ).not.toBe('ERROR_CORRECTION');

        expect(['ACCEPT', 'OPTIONAL_EXPANSION']).toContain(result.evaluation);
        expect(result.isSafeText).toBe(true);
      });
    });
  });

  describe('범주 2: 명확한 언어 오류 20건 교정 검증', () => {
    const errorCases = GOLDEN_TEST_CASES.filter((c) => c.category === 'error_correction');

    errorCases.forEach((tc) => {
      it(`[${tc.id}] ${tc.level} - "${tc.userInput}" -> ERROR_CORRECTION 교정 및 피드백`, () => {
        const lesson = getLessonById(tc.lessonId);
        expect(lesson).toBeDefined();

        const result = evaluateUserUtterance(tc.userInput, lesson!);
        expect(result.evaluation).toBe('ERROR_CORRECTION');
        expect(result.onePointFeedbackKo).toBeTruthy();
        expect(result.selfCorrectionPromptKo).toBeTruthy();
        expect(result.isSafeText).toBe(true);
      });
    });
  });

  describe('범주 3: 전사 불확실성 20건 감점 없는 확인 검증', () => {
    const uncertainCases = GOLDEN_TEST_CASES.filter((c) => c.category === 'transcript_uncertain');

    uncertainCases.forEach((tc) => {
      it(`[${tc.id}] ${tc.level} - 불확실 발화 감점 없이 재확인 기회 부여`, () => {
        const lesson = getLessonById(tc.lessonId);
        expect(lesson).toBeDefined();

        const result = evaluateUserUtterance(tc.userInput, lesson!);
        expect(result.evaluation).toBe('TRANSCRIPT_UNCERTAIN');
        expect(result.onePointFeedbackKo).toContain('감점 없이');
        expect(result.isSafeText).toBe(true);
      });
    });
  });

  describe('범주 4: 상황 고정 사실 왜곡 및 충돌 20건 차단 검증', () => {
    const conflictCases = GOLDEN_TEST_CASES.filter((c) => c.category === 'situation_conflict');

    conflictCases.forEach((tc) => {
      it(`[${tc.id}] ${tc.level} - 상황 모순/사실 왜곡 검출`, () => {
        const lesson = getLessonById(tc.lessonId);
        expect(lesson).toBeDefined();

        if (tc.id === 'gold-con-06') {
          // 이미 two iced american를 주문했을 때 AI가 hot or iced 재질문하는 경우 차단
          const check = checkSituationConsistency(
            'Would you like that hot or iced?',
            tc.userInput,
            lesson!.scenario.facts
          );
          expect(check.consistent).toBe(false);
          expect(check.violatedFactKey).toBe('temperature');
        } else if (tc.id === 'gold-con-07') {
          // 이미 2잔임을 명시했을 때 AI가 how many 재질문하는 경우 차단
          const check = checkSituationConsistency(
            'How many cups would you like?',
            tc.userInput,
            lesson!.scenario.facts
          );
          expect(check.consistent).toBe(false);
          expect(check.violatedFactKey).toBe('quantity');
        } else {
          // 수업 고정 목표와 전혀 다른 엉뚱한 발화인 경우 OFF_TOPIC (임의 MASTERED 금지)
          const result = evaluateUserUtterance(tc.userInput, lesson!);
          expect(result.evaluation).toBe('OFF_TOPIC');
          expect(result.isSafeText).toBe(true);
        }
      });
    });
  });

  describe('범주 5: 대답 막힘 20건 단계별 힌트 제공 검증', () => {
    const stuckCases = GOLDEN_TEST_CASES.filter((c) => c.category === 'stuck_hint');

    stuckCases.forEach((tc) => {
      it(`[${tc.id}] ${tc.level} - "${tc.userInput}" -> NEEDS_HINT 단계별 힌트 안내`, () => {
        const lesson = getLessonById(tc.lessonId);
        expect(lesson).toBeDefined();

        const result = evaluateUserUtterance(tc.userInput, lesson!, 'roleplay', 0);
        expect(result.evaluation).toBe('NEEDS_HINT');
        expect(result.offeredHintLevel).toBe(1);
        expect(result.hintContent).toBeTruthy();
        expect(result.isSafeText).toBe(true);
      });
    });
  });
});

describe('상황 일관성 검사기(checkSituationConsistency) 단위 검증', () => {
  it('학습자가 iced를 언급했을 때 튜터가 hot or iced를 물어보면 위반으로 판정해야 한다', () => {
    const check = checkSituationConsistency(
      'Sure, hot or iced?',
      'Two iced Americanos, please.',
      { temperature: 'iced' }
    );
    expect(check.consistent).toBe(false);
    expect(check.violatedFactKey).toBe('temperature');
  });

  it('고정 목적지가 Vancouver일 때 Tokyo 비행기로 왜곡하면 위반으로 판정해야 한다', () => {
    const check = checkSituationConsistency(
      'Here is your flight to Tokyo.',
      'Thank you.',
      { destination: 'Vancouver' }
    );
    expect(check.consistent).toBe(false);
    expect(check.violatedFactKey).toBe('destination');
  });

  it('일관된 정상 대화는 위반 없이 통과해야 한다', () => {
    const check = checkSituationConsistency(
      'Two iced Americanos coming right up. For here or to go?',
      'Two iced Americanos, please.',
      { temperature: 'iced', quantity: '2' }
    );
    expect(check.consistent).toBe(true);
  });
});

describe('수업 상태 머신(LessonStateMachine) 전이 및 2상황 규칙 검증', () => {
  it('표준 상태 전이(intro -> expressions -> practice -> roleplay -> transfer_assessment -> result)가 정상 작동해야 한다', () => {
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const sm = new LessonStateMachine(session, lesson);

    expect(sm.getSession().phase).toBe('intro');
    expect(sm.advancePhase()).toBe('expressions');
    expect(sm.advancePhase()).toBe('practice');
    expect(sm.advancePhase()).toBe('roleplay');
    expect(sm.advancePhase()).toBe('transfer_assessment');
    expect(sm.advancePhase()).toBe('result');
    expect(sm.getSession().isCompleted).toBe(true);
  });

  it('단일 상황에서만 발화했을 때는 목표가 마스터되지 않아야 한다 (2개 상황 규칙)', () => {
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const sm = new LessonStateMachine(session, lesson);

    const evalResult = evaluateUserUtterance('Hello, nice to meet you.', lesson);
    // 상황 1에서 노힌트 발화
    sm.recordTurn('Hello, nice to meet you.', evalResult, 'situation-lobby', false);

    const obs = sm.getSession().observedObjectives[evalResult.matchedObjectiveId!];
    // 1개 상황이므로 아직 isMasteredByRule은 false여야 함
    expect(obs.isMasteredByRule).toBe(false);
  });

  it('서로 다른 2개 상황에서 노힌트로 발화 성공 시만 마스터(isMasteredByRule = true)되어야 한다', () => {
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const sm = new LessonStateMachine(session, lesson);

    const evalResult = evaluateUserUtterance('Hello, nice to meet you.', lesson);

    // 상황 1 (Lobby)
    sm.recordTurn('Hello, nice to meet you.', evalResult, 'situation-lobby', false);
    expect(sm.getSession().observedObjectives[evalResult.matchedObjectiveId!].isMasteredByRule).toBe(false);

    // 상황 2 (Hallway) - 서로 다른 상황에서 노힌트 성공
    sm.recordTurn('Hi, nice to meet you too.', evalResult, 'situation-hallway', false);
    expect(sm.getSession().observedObjectives[evalResult.matchedObjectiveId!].isMasteredByRule).toBe(true);
  });

  it('힌트를 사용한 발화는 마스터 카운트에 포함되지 않아야 한다', () => {
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const sm = new LessonStateMachine(session, lesson);

    const evalResult = evaluateUserUtterance('Hello, nice to meet you.', lesson);

    // 상황 1: 힌트 사용
    sm.recordTurn('Hello, nice to meet you.', evalResult, 'situation-lobby', true);
    // 상황 2: 노힌트
    sm.recordTurn('Hello, nice to meet you.', evalResult, 'situation-hallway', false);

    const obs = sm.getSession().observedObjectives[evalResult.matchedObjectiveId!];
    expect(obs.isMasteredByRule).toBe(false); // 힌트 1회, 노힌트 1회이므로 마스터 미달
  });

  it('세션 완료 처리는 중복 실행되어도 최초 완료 기록을 보존해야 한다 (완료 중복 방지)', () => {
    const lesson = getLessonById('intro-u01-l01')!;
    const session = LessonStateMachine.createSession(lesson);
    const sm = new LessonStateMachine(session, lesson);

    // result 단계까지 전이하여 완료 처리
    sm.advancePhase(); // expressions
    sm.advancePhase(); // practice
    sm.advancePhase(); // roleplay
    sm.advancePhase(); // transfer_assessment
    sm.advancePhase(); // result

    const firstCompletedAt = sm.getSession().completedAt;
    expect(sm.getSession().isCompleted).toBe(true);
    expect(firstCompletedAt).toBeTruthy();

    // 다시 전이 시도
    sm.advancePhase();
    expect(sm.getSession().completedAt).toBe(firstCompletedAt);
  });
});

describe('복습 스케줄러(reviewScheduler) 간격반복 및 실패 가속 검증', () => {
  const baseItem: ConversationReviewItem = {
    id: 'rev-01',
    lessonId: 'intro-u01-l01',
    expressionEn: 'Nice to meet you.',
    meaningKo: '만나서 반갑습니다.',
    targetObjectiveId: 'obj-intro-01',
    repetitionCount: 0,
    intervalDays: 1,
    nextReviewDate: '2026-10-21',
    consecutiveSuccessCount: 0,
    isDue: true,
  };

  it('성공 시 1일 -> 3일 -> 7일 -> 14일 순서로 간격이 증가해야 한다', () => {
    const baseDate = new Date('2026-10-21T12:00:00Z');

    // 1회차 성공 -> 3일 후
    const step1 = scheduleNextReviewOnSuccess(baseItem, baseDate);
    expect(step1.intervalDays).toBe(3);
    expect(step1.repetitionCount).toBe(1);
    expect(step1.nextReviewDate).toBe('2026-10-24');

    // 2회차 성공 -> 7일 후
    const step2 = scheduleNextReviewOnSuccess(step1, new Date('2026-10-24T12:00:00Z'));
    expect(step2.intervalDays).toBe(7);
    expect(step2.repetitionCount).toBe(2);
    expect(step2.nextReviewDate).toBe('2026-10-31');

    // 3회차 성공 -> 14일 후
    const step3 = scheduleNextReviewOnSuccess(step2, new Date('2026-10-31T12:00:00Z'));
    expect(step3.intervalDays).toBe(14);
    expect(step3.repetitionCount).toBe(3);
    expect(step3.nextReviewDate).toBe('2026-11-14');
  });

  it('복습 실패 시 간격이 1일로 즉시 앞당겨져(Expedite) 취약점을 재점검해야 한다', () => {
    const advancedItem: ConversationReviewItem = {
      ...baseItem,
      repetitionCount: 3,
      intervalDays: 14,
      nextReviewDate: '2026-11-14',
      consecutiveSuccessCount: 3,
    };

    const failResult = scheduleNextReviewOnFailure(advancedItem, new Date('2026-11-14T12:00:00Z'));
    expect(failResult.intervalDays).toBe(1);
    expect(failResult.repetitionCount).toBe(0);
    expect(failResult.nextReviewDate).toBe('2026-11-15');
    expect(failResult.consecutiveSuccessCount).toBe(0);
  });

  it('오늘 날짜 이전 또는 오늘 복습 예정인 경우 isReviewDue가 true여야 한다', () => {
    const today = new Date('2026-10-21T12:00:00Z');
    expect(isReviewDue(baseItem, today)).toBe(true);

    const futureItem = { ...baseItem, nextReviewDate: '2026-10-25' };
    expect(isReviewDue(futureItem, today)).toBe(false);
  });

  it('한국 시간(KST) 자정 직후 경계에서 UTC 날짜 오판 없이 정상 복습 예정 판정되어야 한다', () => {
    // 2026-10-21 15:05:00 UTC == 2026-10-22 00:05:00 KST (자정 5분 후)
    const kstMidnightJustAfter = new Date('2026-10-21T15:05:00Z');
    expect(toKSTDateString(kstMidnightJustAfter)).toBe('2026-10-22');

    // 2026-10-22 예정인 복습 항목
    const itemDueOn22nd: ConversationReviewItem = {
      ...baseItem,
      nextReviewDate: '2026-10-22',
    };

    // UTC 기준이면 아직 10월 21일이어서 false가 될 위험이 있으나, KST 기준이므로 10월 22일 도래로 true여야 함
    expect(isReviewDue(itemDueOn22nd, kstMidnightJustAfter)).toBe(true);

    // 첫 회상 성공 후 다음 간격은 3일이므로 KST 기준 2026-10-25으로 산출되어야 함
    const nextSuccess = scheduleNextReviewOnSuccess(itemDueOn22nd, kstMidnightJustAfter);
    expect(nextSuccess.nextReviewDate).toBe('2026-10-25');
  });
});

describe('응답 검증기(responseValidator) 보안 및 HTML 인젝션 차단 검증', () => {
  it('응답 텍스트에 포함된 <script> 및 HTML 태그는 렌더링되지 않고 제거되어야 한다', () => {
    const rawWithInjection = {
      evaluation: 'ACCEPT',
      userSpokenText: 'Hello <script>alert("xss")</script>',
      tutorResponseEn: 'Great job! <img src=x onerror=alert(1)> What next?',
      onePointFeedbackKo: '<b>좋아요</b>',
    };

    const res = validateAndSanitizeEvaluationResult(rawWithInjection);
    expect(res.isValid).toBe(true);
    expect(res.sanitizedResult?.userSpokenText).not.toContain('<script>');
    expect(res.sanitizedResult?.tutorResponseEn).not.toContain('<img');
    expect(res.sanitizedResult?.tutorResponseEn).not.toContain('onerror');
    expect(res.sanitizedResult?.onePointFeedbackKo).toBe('좋아요');
    expect(res.sanitizedResult?.isSafeText).toBe(false); // 악성 요소가 탐지되었으므로 isSafeText는 false 플래그
  });

  it('유효하지 않은 Enum이 들어오면 검증 실패를 반환해야 한다', () => {
    const invalidRaw = {
      evaluation: 'INVALID_STATUS',
      userSpokenText: 'hi',
      tutorResponseEn: 'hello',
    };

    const res = validateAndSanitizeEvaluationResult(invalidRaw);
    expect(res.isValid).toBe(false);
    expect(res.errors[0]).toContain('유효한 6대 평가 Enum이 아닙니다');
  });
});

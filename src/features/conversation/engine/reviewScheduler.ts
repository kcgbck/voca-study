// src/features/conversation/engine/reviewScheduler.ts
// 회화 표현 간격 반복 복습 스케줄러 (1 -> 3 -> 7 -> 14일 및 실패 시 단축)

import type { ConversationReviewItem } from '../types';

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;

/**
 * 한국 표준시(KST, UTC+9) 기준 'YYYY-MM-DD' 날짜 문자열
 * 기존 프로젝트의 datekey 및 attendanceService KST 정책과 일치
 */
export function toKSTDateString(date: Date = new Date()): string {
  const kstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstTime.toISOString().slice(0, 10);
}

/**
 * 복습 성공 시 다음 간격 및 일자 계산
 */
export function scheduleNextReviewOnSuccess(
  item: ConversationReviewItem,
  currentDate: Date = new Date()
): ConversationReviewItem {
  const nextRepetition = item.repetitionCount + 1;
  const intervalIndex = Math.min(nextRepetition, REVIEW_INTERVAL_DAYS.length - 1);
  const nextIntervalDays = REVIEW_INTERVAL_DAYS[intervalIndex];

  const nextDate = new Date(currentDate.getTime() + nextIntervalDays * 24 * 60 * 60 * 1000);

  return {
    ...item,
    repetitionCount: nextRepetition,
    intervalDays: nextIntervalDays,
    nextReviewDate: toKSTDateString(nextDate),
    lastReviewedAt: currentDate.toISOString(),
    consecutiveSuccessCount: item.consecutiveSuccessCount + 1,
    isDue: false,
  };
}

/**
 * 복습 실패 시 간격 앞당김(Expedite): 1일 후로 리셋하여 취약점 집중 보완
 */
export function scheduleNextReviewOnFailure(
  item: ConversationReviewItem,
  currentDate: Date = new Date()
): ConversationReviewItem {
  const nextDate = new Date(currentDate.getTime() + 1 * 24 * 60 * 60 * 1000);

  return {
    ...item,
    repetitionCount: 0,
    intervalDays: 1,
    nextReviewDate: toKSTDateString(nextDate),
    lastReviewedAt: currentDate.toISOString(),
    consecutiveSuccessCount: 0,
    isDue: false,
  };
}

/**
 * 현재 날짜 기준 복습 대상(Due) 여부 판정 (KST 기준)
 */
export function isReviewDue(
  item: ConversationReviewItem,
  currentDate: Date = new Date()
): boolean {
  const todayStr = toKSTDateString(currentDate);
  return item.nextReviewDate <= todayStr;
}

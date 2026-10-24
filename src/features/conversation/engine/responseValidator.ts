// src/features/conversation/engine/responseValidator.ts
// 응답 스키마 런타임 유효성 검증 및 HTML/JS 인젝션 차단기

import type { TurnEvaluationResult } from '../types';

export interface ResponseValidationResult {
  isValid: boolean;
  sanitizedResult?: TurnEvaluationResult;
  errors: string[];
}

/**
 * 텍스트에서 악성 HTML/스크립트 요소를 제거하고 안전한 일반 텍스트로 정제
 * 입력이 문자열이 아닐 경우 예외 없이 안전하게 빈 문자열 처리
 */
export function sanitizePlainText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/(javascript:|data:text\/html|onload=|onerror=|onclick=|<script|<\/script)/gi, '')
    .trim();
}

/**
 * 평가 결과 객체가 6대 Enum 및 필수 계약을 준수하는지 검증
 * RegExp /g 플래그의 lastIndex 상태 버그를 원천 배제
 */
export function validateAndSanitizeEvaluationResult(
  raw: unknown
): ResponseValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { isValid: false, errors: ['평가 응답이 유효한 객체가 아닙니다.'] };
  }

  const r = raw as Partial<TurnEvaluationResult>;

  const validEnums = [
    'ACCEPT',
    'OPTIONAL_EXPANSION',
    'ERROR_CORRECTION',
    'TRANSCRIPT_UNCERTAIN',
    'NEEDS_HINT',
    'OFF_TOPIC',
  ];

  if (!r.evaluation || typeof r.evaluation !== 'string' || !validEnums.includes(r.evaluation)) {
    errors.push(`유효한 6대 평가 Enum이 아닙니다: ${String(r.evaluation)}`);
  }

  if (typeof r.userSpokenText !== 'string') {
    errors.push('userSpokenText는 필수 문자열이어야 합니다.');
  }

  if (typeof r.tutorResponseEn !== 'string' || r.tutorResponseEn.trim() === '') {
    errors.push('tutorResponseEn은 비어있지 않은 필수 문자열이어야 합니다.');
  }

  if (r.matchedObjectiveId !== undefined && typeof r.matchedObjectiveId !== 'string') {
    errors.push('matchedObjectiveId는 문자열이어야 합니다.');
  }

  if (r.onePointFeedbackKo !== undefined && typeof r.onePointFeedbackKo !== 'string') {
    errors.push('onePointFeedbackKo는 문자열이어야 합니다.');
  }

  if (r.selfCorrectionPromptKo !== undefined && typeof r.selfCorrectionPromptKo !== 'string') {
    errors.push('selfCorrectionPromptKo는 문자열이어야 합니다.');
  }

  if (r.recommendedExpansionEn !== undefined && typeof r.recommendedExpansionEn !== 'string') {
    errors.push('recommendedExpansionEn은 문자열이어야 합니다.');
  }

  if (r.nextQuestionEn !== undefined && typeof r.nextQuestionEn !== 'string') {
    errors.push('nextQuestionEn은 문자열이어야 합니다.');
  }

  if (r.hintContent !== undefined && typeof r.hintContent !== 'string') {
    errors.push('hintContent는 문자열이어야 합니다.');
  }

  if (
    r.factualConsistency !== undefined &&
    (typeof r.factualConsistency !== 'object' || r.factualConsistency === null || typeof r.factualConsistency.consistent !== 'boolean')
  ) {
    errors.push('factualConsistency는 boolean consistent 필드를 가진 객체여야 합니다.');
  }

  // HTML / Script 주입 검사 (/g 플래그 없이 매번 독립 검사하여 lastIndex 상태 버그 제거)
  const containsHtmlOrScript = (text: unknown): boolean => {
    if (typeof text !== 'string') return false;
    return /<[^>]+>/.test(text) || /(javascript:|data:text\/html|onload=|onerror=|onclick=|<script|<\/script)/i.test(text);
  };

  const hasMaliciousContent =
    containsHtmlOrScript(r.userSpokenText) ||
    containsHtmlOrScript(r.tutorResponseEn) ||
    containsHtmlOrScript(r.onePointFeedbackKo) ||
    containsHtmlOrScript(r.selfCorrectionPromptKo) ||
    containsHtmlOrScript(r.recommendedExpansionEn);

  const sanitized: TurnEvaluationResult = {
    evaluation: (validEnums.includes(r.evaluation as string) ? r.evaluation : 'OFF_TOPIC') as TurnEvaluationResult['evaluation'],
    intentId: typeof r.intentId === 'string' ? r.intentId : undefined,
    matchedObjectiveId: typeof r.matchedObjectiveId === 'string' ? r.matchedObjectiveId : undefined,
    userSpokenText: sanitizePlainText(r.userSpokenText),
    isShortAnswer: Boolean(r.isShortAnswer),
    onePointFeedbackKo: r.onePointFeedbackKo ? sanitizePlainText(r.onePointFeedbackKo) : undefined,
    selfCorrectionPromptKo: r.selfCorrectionPromptKo ? sanitizePlainText(r.selfCorrectionPromptKo) : undefined,
    recommendedExpansionEn: r.recommendedExpansionEn ? sanitizePlainText(r.recommendedExpansionEn) : undefined,
    tutorResponseEn: sanitizePlainText(r.tutorResponseEn || 'Could you please say that again?'),
    nextQuestionEn: r.nextQuestionEn ? sanitizePlainText(r.nextQuestionEn) : undefined,
    offeredHintLevel: typeof r.offeredHintLevel === 'number' ? r.offeredHintLevel : undefined,
    hintContent: r.hintContent ? sanitizePlainText(r.hintContent) : undefined,
    factualConsistency: r.factualConsistency && typeof r.factualConsistency.consistent === 'boolean'
      ? r.factualConsistency
      : { consistent: true },
    isSafeText: !hasMaliciousContent,
  };

  return {
    isValid: errors.length === 0,
    sanitizedResult: sanitized,
    errors,
  };
}

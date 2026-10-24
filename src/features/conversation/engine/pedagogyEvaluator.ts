// src/features/conversation/engine/pedagogyEvaluator.ts
// 교육 규칙 엔진 — 의미 우선 발화 평가기 (Conservative Meaning Evaluator)

import type {
  LessonContent,
  TurnEvaluationResult,
  HintLevel,
  AcceptableIntent,
  ErrorPattern,
} from '../types';
import { checkSituationConsistency } from './consistencyChecker';
import { validateAndSanitizeEvaluationResult } from './responseValidator';

const RAW_UNCERTAIN_TRIGGERS = [
  '[inaudible]',
  '[unclear]',
  'fifteen/fifty',
  'fifty/fifteen',
  '???',
  '...',
];

const STUCK_TRIGGERS = [
  'i dont know',
  'i do not know',
  'help me',
  'hint please',
  'what should i say',
  'i am stuck',
  'i have no idea',
  'i am not sure',
  '모르겠어요',
  '힌트',
];

const NEGATION_WORDS = ['not', 'refuse', 'refuses', 'refused', 'never', 'unrelated', 'dont', 'cant', 'wont'];

function normalizeCurlyApostrophe(text: string): string {
  return text.replace(/[\u2018\u2019`´]/g, "'");
}

function normalizeText(text: string): string {
  return normalizeCurlyApostrophe(text)
    .toLowerCase()
    .replace(/[.,?!'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 사용자 발화에 대한 교육적 의미 평가를 로컬 규칙으로 정밀 수행
 */
export function evaluateUserUtterance(
  userText: string,
  lesson: LessonContent,
  phaseContext: 'controlled_practice' | 'roleplay' | 'transfer_assessment' = 'roleplay',
  currentHintLevel: HintLevel = 0,
  recentTurns: Array<{ speaker: 'tutor' | 'user'; text: string }> = [],
  currentTargetObjectiveId?: string
): TurnEvaluationResult {
  const trimmed = typeof userText === 'string' ? userText.trim() : '';
  const normalizedWithApostrophe = normalizeCurlyApostrophe(trimmed).toLowerCase();

  // 1. 구두점 제거 전 원문 기반 불확실성 마커(???, ..., [inaudible] 등) 감지 (감점 없이 재확인 유도)
  if (!trimmed || RAW_UNCERTAIN_TRIGGERS.some((t) => trimmed.includes(t) || normalizedWithApostrophe.includes(t))) {
    const rawResult: TurnEvaluationResult = {
      evaluation: 'TRANSCRIPT_UNCERTAIN',
      userSpokenText: userText,
      isShortAnswer: false,
      tutorResponseEn: "I couldn't catch that clearly. Could you please say that one more time?",
      onePointFeedbackKo: '음성이 명확하지 않아 감점 없이 다시 확인할 기회를 드립니다.',
      selfCorrectionPromptKo: '조금 더 천천히 또박또박 말씀해 주시겠어요?',
      factualConsistency: { consistent: true },
      isSafeText: true,
    };
    return validateAndSanitizeEvaluationResult(rawResult).sanitizedResult!;
  }

  const normalizedUser = normalizeText(trimmed);

  // 2. 학습자가 막혔거나 힌트를 요청한 경우 (NEEDS_HINT)
  // curl apostrophe 정규화 및 구두점 제거 후 동일하게 검사
  if (STUCK_TRIGGERS.some((t) => normalizedUser.includes(t))) {
    const nextHintLevel = Math.min(3, currentHintLevel + 1) as HintLevel;
    let hintText = lesson.hints.keywordHintKo;
    if (nextHintLevel === 2) hintText = lesson.hints.frameHintEn;
    if (nextHintLevel === 3) hintText = lesson.hints.modelSentenceEn;

    const rawResult: TurnEvaluationResult = {
      evaluation: 'NEEDS_HINT',
      userSpokenText: userText,
      isShortAnswer: false,
      offeredHintLevel: nextHintLevel,
      hintContent: hintText,
      tutorResponseEn: "No worries at all! Here is a helpful hint for you.",
      onePointFeedbackKo: `힌트 ${nextHintLevel}단계: ${hintText}`,
      selfCorrectionPromptKo: '힌트를 참고하여 다시 한번 말해볼까요?',
      factualConsistency: { consistent: true },
      isSafeText: true,
    };
    return validateAndSanitizeEvaluationResult(rawResult).sanitizedResult!;
  }

  // 3. 고정 사실(Facts) 충돌 및 왜곡 검사
  const consistency = checkSituationConsistency(
    '',
    userText,
    phaseContext === 'transfer_assessment' ? { ...lesson.scenario.facts, [lesson.transferTask.contextFactKey]: lesson.transferTask.expectedFactValue } : lesson.scenario.facts,
    recentTurns
  );

  // 4. 허용 답변 후보군 구성 (전이 평가 시에는 transferTask만 독립 검사)
  const oldFact = lesson.scenario.facts[lesson.transferTask.contextFactKey];
  const adaptTransferText = (text: string): string => oldFact
    ? text.replace(new RegExp(String(oldFact).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => String(lesson.transferTask.expectedFactValue))
    : text;
  const transferObjectiveIntents = lesson.acceptableIntents.map(intent => ({
    ...intent,
    exactMatches: intent.exactMatches.map(adaptTransferText),
    allowedShortAnswers: intent.allowedShortAnswers.map(adaptTransferText),
    recommendedExpansion: intent.recommendedExpansion ? adaptTransferText(intent.recommendedExpansion) : undefined,
  }));
  const candidateIntents: AcceptableIntent[] =
    phaseContext === 'transfer_assessment'
      ? [...lesson.transferTask.acceptableIntents, ...transferObjectiveIntents]
      : lesson.acceptableIntents;

  // 5. 허용 답변(Acceptable Intents) 우선 대조
  const orderedIntents = currentTargetObjectiveId ? [...candidateIntents.filter(i => i.targetObjectiveId === currentTargetObjectiveId), ...candidateIntents.filter(i => i.targetObjectiveId !== currentTargetObjectiveId)] : candidateIntents;
  const matchedIntent = findMatchingIntent(normalizedUser, orderedIntents);

  if (matchedIntent) {
    const isShort = isShortAnswerMatch(normalizedUser, matchedIntent.intent);

    const intentTargetObjId =
      matchedIntent.intent.targetObjectiveId ||
      (phaseContext === 'transfer_assessment'
        ? lesson.transferTask?.targetObjectiveId
        : undefined);

    let targetObjId: string | undefined = undefined;

    if (currentTargetObjectiveId) {
      // 현재 목표가 지정된 경우: 매칭된 의도의 목표 ID와 일치할 때만 해당 목표 성취 증거 인정
      // 현재 목표와 다르면 ACCEPT 판정은 유지하되 성취 증거는 부여하지 않음 (강제 귀속 금지)
      if (intentTargetObjId && intentTargetObjId === currentTargetObjectiveId) {
        targetObjId = currentTargetObjectiveId;
      } else {
        targetObjId = undefined;
      }
    } else {
      // 현재 목표가 지정되지 않은 경우: 의도에 명시된 목표 ID만 유지 (첫 번째 목표로 강제 귀속 금지)
      targetObjId = intentTargetObjId || undefined;
    }

    const evalType =
      isShort && matchedIntent.intent.recommendedExpansion && matchedIntent.intent.recommendedExpansion !== matchedIntent.matchedPhrase
        ? 'OPTIONAL_EXPANSION'
        : 'ACCEPT';

    let tutorResponse = 'Great job! That communicates your point clearly.';
    if (phaseContext === 'roleplay' && lesson.exampleDialogue.length > 0) {
      const userTurnCount = recentTurns.filter((t) => t.speaker === 'user').length;
      const nextTutorTurnIdx = (userTurnCount + 1) * 2;
      if (nextTutorTurnIdx < lesson.exampleDialogue.length && lesson.exampleDialogue[nextTutorTurnIdx]?.speaker === 'tutor') {
        tutorResponse = `${lesson.exampleDialogue[nextTutorTurnIdx].textEn}`;
      } else {
        tutorResponse = 'Excellent! We have completed our roleplay dialogue. (교재 대본)';
      }
    }

    const rawResult: TurnEvaluationResult = {
      evaluation: evalType,
      intentId: matchedIntent.intent.intentId,
      matchedObjectiveId: targetObjId,
      userSpokenText: userText,
      isShortAnswer: isShort,
      recommendedExpansionEn: matchedIntent.intent.recommendedExpansion,
      onePointFeedbackKo:
        evalType === 'OPTIONAL_EXPANSION'
          ? `자연스러운 대답입니다! "${matchedIntent.intent.recommendedExpansion}"처럼 한 문장으로도 확장해볼 수 있어요.`
          : '훌륭합니다! 의도가 명확하게 전달되었습니다.',
      tutorResponseEn: tutorResponse,
      nextQuestionEn: 'Shall we move on to the next part?',
      factualConsistency: consistency,
      isSafeText: true,
    };
    return validateAndSanitizeEvaluationResult(rawResult).sanitizedResult!;
  }

  // 6. 허용 답변에 부합하지 않은 경우, 알려진 오류 패턴 매칭 (시제, 수일치, 어휘 등)
  const errorMatch = findErrorPattern(userText, normalizedUser, lesson.commonErrorPatterns);
  if (errorMatch) {
    const rawResult: TurnEvaluationResult = {
      evaluation: 'ERROR_CORRECTION',
      userSpokenText: userText,
      isShortAnswer: false,
      onePointFeedbackKo: errorMatch.onePointFeedbackKo,
      selfCorrectionPromptKo: errorMatch.selfCorrectionPromptKo,
      recommendedExpansionEn: errorMatch.targetCorrectionEn,
      tutorResponseEn: `Let's practice that part. Could you try saying: "${errorMatch.targetCorrectionEn}"?`,
      factualConsistency: consistency,
      isSafeText: true,
    };
    return validateAndSanitizeEvaluationResult(rawResult).sanitizedResult!;
  }

  // 7. 일치하지 않는 무관한 답변 (임의 MASTERED 판정 금지 -> OFF_TOPIC)
  const rawResult: TurnEvaluationResult = {
    evaluation: 'OFF_TOPIC',
    userSpokenText: userText,
    isShortAnswer: false,
    tutorResponseEn: "I hear what you're saying, but let's focus on our lesson goal. Could you try answering the question again?",
    onePointFeedbackKo: '수업 과제와 다소 다른 표현입니다. 목표 표현을 사용해 다시 시도해보세요.',
    selfCorrectionPromptKo: `힌트: ${lesson.hints.keywordHintKo}`,
    factualConsistency: consistency,
    isSafeText: true,
  };
  return validateAndSanitizeEvaluationResult(rawResult).sanitizedResult!;
}

function findErrorPattern(
  rawText: string,
  normText: string,
  errorPatterns: ErrorPattern[]
): ErrorPattern | undefined {
  for (const ep of errorPatterns) {
    if (Array.isArray(ep.patternTrigger)) {
      for (const trigger of ep.patternTrigger) {
        if (typeof trigger === 'string') {
          if (normText.includes(normalizeText(trigger))) {
            return ep;
          }
        } else if (trigger instanceof RegExp) {
          if (trigger.test(rawText) || trigger.test(normText)) {
            return ep;
          }
        }
      }
    } else if (typeof ep.patternTrigger === 'string') {
      if (normText.includes(normalizeText(ep.patternTrigger))) {
        return ep;
      }
    } else if (ep.patternTrigger instanceof RegExp) {
      if (ep.patternTrigger.test(rawText) || ep.patternTrigger.test(normText)) {
        return ep;
      }
    }
  }
  return undefined;
}

function containsUnmatchedNegation(normUser: string, normTarget: string): boolean {
  const userWords = normUser.split(' ');
  const targetWords = normTarget.split(' ');
  for (const neg of NEGATION_WORDS) {
    if (userWords.includes(neg) && !targetWords.includes(neg)) {
      return true;
    }
  }
  return false;
}

function findMatchingIntent(
  normUser: string,
  intents: AcceptableIntent[]
): { intent: AcceptableIntent; matchedPhrase: string } | undefined {
  // 1. 완전 일치 (Exact Matches)
  for (const intent of intents) {
    for (const em of intent.exactMatches) {
      const normEm = normalizeText(em);
      if (containsUnmatchedNegation(normUser, normEm)) {
        continue;
      }
      if (normUser === normEm) {
        return { intent, matchedPhrase: em };
      }
    }
  }

  // 2. 단답 허용 (Allowed Short Answers)
  for (const intent of intents) {
    for (const sa of intent.allowedShortAnswers) {
      const normSa = normalizeText(sa);
      if (containsUnmatchedNegation(normUser, normSa)) {
        continue;
      }
      if (isShortAnswerMatch(normUser, intent)) {
        return { intent, matchedPhrase: sa };
      }
    }
  }

  return undefined;
}

function isShortAnswerMatch(normUser: string, intent: AcceptableIntent): boolean {
  for (const sa of intent.allowedShortAnswers) {
    const normSa = normalizeText(sa);
    if (containsUnmatchedNegation(normUser, normSa)) {
      continue;
    }

    // 완전 일치
    if (normUser === normSa) return true;

    // 공손 표현 및 감탄사 결합만 허용 (예: "yes minho", "hello please", "coffee please")
    const validPrefixes = ['oh', 'yes', 'sure', 'well', 'hi', 'hello', 'ah', 'um'];
    const validSuffixes = ['please', 'thanks', 'thank you', 'too'];

    for (const p of validPrefixes) {
      if (normUser === `${p} ${normSa}`) return true;
    }
    for (const s of validSuffixes) {
      if (normUser === `${normSa} ${s}`) return true;
    }
    for (const p of validPrefixes) {
      for (const s of validSuffixes) {
        if (normUser === `${p} ${normSa} ${s}`) return true;
      }
    }
  }
  return false;
}

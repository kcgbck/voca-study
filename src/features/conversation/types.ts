export const CONVERSATION_POLICY_VERSION = 'v2.2-20261021';
// src/features/conversation/types.ts
// 보카 스터디 AI 회화 — 도메인 타입 정의 (UI / 서버 / 저장소 공통 계약)

export type ConversationLevel = 'intro' | 'beginner' | 'intermediate' | 'advanced';

export type LessonPhase =
  | 'intro'
  | 'expressions'
  | 'practice'
  | 'roleplay'
  | 'transfer_assessment'
  | 'result';

export type LessonContentStatus =
  | 'PREPARING'
  | 'HUMAN_CURRICULUM_REVIEW_PENDING'
  | 'HUMAN_CURRICULUM_REVIEW_PASS';

export type EvaluationCategory =
  | 'ACCEPT'
  | 'OPTIONAL_EXPANSION'
  | 'ERROR_CORRECTION'
  | 'TRANSCRIPT_UNCERTAIN'
  | 'NEEDS_HINT'
  | 'OFF_TOPIC';

export type EvaluationEngineMode = 'local_rule_engine' | 'mock_gemini_tutor' | 'offline_fixed';

export type HintLevel = 0 | 1 | 2 | 3; // 0: 없음, 1: 키워드, 2: 문장 틀, 3: 전체 모범 예문

export interface KeyExpression {
  expressionEn: string;
  meaningKo: string;
  usageTipKo?: string;
}

export interface DialogueTurn {
  speaker: 'tutor' | 'user';
  textEn: string;
  translationKo?: string;
}

export interface AcceptableIntent {
  intentId: string;
  descriptionKo: string;
  targetObjectiveId?: string;
  exactMatches: string[];
  allowedShortAnswers: string[];
  recommendedExpansion?: string;
  requiredKeywords?: string[];
}

export interface ErrorPattern {
  id: string;
  patternTrigger: string | RegExp | Array<string | RegExp>;
  errorType: 'tense' | 'agreement' | 'preposition' | 'word_choice' | 'missing_element';
  onePointFeedbackKo: string;
  selfCorrectionPromptKo: string;
  targetCorrectionEn: string;
}

export interface TransferTask {
  taskId: string;
  titleKo: string;
  promptKo: string;
  contextFactKey: string;
  expectedFactValue: string;
  targetObjectiveId: string;
  acceptableIntents: AcceptableIntent[];
  hints: {
    keywordHintKo: string;
    frameHintEn: string;
    modelSentenceEn: string;
  };
}

export interface LessonContent {
  id: string; // e.g., "intro-u01-l01"
  level: ConversationLevel;
  unitNumber: number; // 1~8
  unitTitleKo: string;
  lessonNumber: number; // 1~4
  lessonType: 'comprehension' | 'controlled_practice' | 'roleplay' | 'transfer_assessment';
  titleKo: string;
  contentRevision: number; // 콘텐츠 개정 번호
  status: LessonContentStatus;
  scenario: {
    settingKo: string;
    aiRoleKo: string;
    userRoleKo: string;
    facts: Record<string, string>; // 대화 일관성 검증용 고정 사실
  };
  learningObjectives: Array<{
    id: string;
    descriptionKo: string;
    targetPatternEn: string;
  }>;
  keyExpressions: KeyExpression[]; // 최소 3개
  exampleDialogue: DialogueTurn[]; // 최소 4턴
  acceptableIntents: AcceptableIntent[];
  hints: {
    keywordHintKo: string;
    frameHintEn: string;
    modelSentenceEn: string;
  };
  transferTask: TransferTask;
  commonErrorPatterns: ErrorPattern[];
  reviewTags: string[];
}

export interface ManifestLessonItem {
  id: string;
  level: ConversationLevel;
  unitNumber: number;
  unitTitleKo: string;
  lessonNumber: number;
  lessonType: 'comprehension' | 'controlled_practice' | 'roleplay' | 'transfer_assessment';
  titleKo: string;
  status: LessonContentStatus;
  contentRevision: number;
  hasDetailedContent: boolean;
  reviewTags: string[];
}

export interface CurriculumManifest {
  version: string;
  totalLessons: number; // 128
  totalUnits: number; // 32 (레벨당 8개)
  activeDraftLessons: number; // 32
  levels: Record<ConversationLevel, {
    titleKo: string;
    cefrReference: string;
    unitCount: number;
    lessonCount: number;
    units: Array<{
      unitNumber: number;
      unitTitleKo: string;
      lessons: ManifestLessonItem[];
    }>;
  }>;
}

export interface TurnEvaluationResult {
  evaluation: EvaluationCategory;
  intentId?: string;
  matchedObjectiveId?: string;
  userSpokenText: string;
  isShortAnswer: boolean;
  onePointFeedbackKo?: string;
  selfCorrectionPromptKo?: string;
  recommendedExpansionEn?: string;
  tutorResponseEn: string;
  nextQuestionEn?: string;
  offeredHintLevel?: HintLevel;
  hintContent?: string;
  factualConsistency: {
    consistent: boolean;
    violatedFactKey?: string;
    reasonKo?: string;
  };
  isSafeText: boolean; // HTML/JS injection 차단 여부
}

export interface ObjectiveObservation {
  objectiveId: string;
  evidences: Array<{
    situationContext: string;
    userResponse: string;
    usedHint: boolean;
    observedAt: string;
  }>;
  isMasteredByRule: boolean; // 서로 다른 2개 상황에서 노힌트 발화 성공 시만 true
}

export interface ConversationSession {
  sessionId: string;
  lessonId: string;
  contentRevision: number;
  level: ConversationLevel;
  phase: LessonPhase;
  currentTaskIndex: number;
  hintLevel: HintLevel;
  draftUtterance?: string;
  turns: Array<{
    turnId: string;
    speaker: 'tutor' | 'user';
    text: string;
    timestamp: string;
    evaluation?: TurnEvaluationResult;
    phase?: LessonPhase;
  }>;
  observedObjectives: Record<string, ObjectiveObservation>;
  completedTaskIds: string[];
  sessionStartedAt: string;
  lastActiveAt: string;
  isCompleted: boolean;
  completedAt?: string;
  rulePassed: boolean;
  needsReReview?: boolean;
}

export interface LessonProgress {
  lessonId: string;
  level: ConversationLevel;
  unitNumber: number;
  lessonNumber: number;
  status: 'not_started' | 'in_progress' | 'completed';
  contentRevision: number;
  masteredObjectiveIds: string[];
  totalStudySeconds: number;
  lastStudiedAt: string;
  completedAt?: string;
  reviewScheduledDate?: string;
}

export interface ConversationReviewItem {
  id: string; // uuid 또는 식별자
  lessonId: string;
  expressionEn: string;
  meaningKo: string;
  targetObjectiveId: string;
  repetitionCount: number; // 0, 1, 2, 3, 4
  intervalDays: number; // 1 -> 3 -> 7 -> 14
  nextReviewDate: string; // ISO Date YYYY-MM-DD
  lastReviewedAt?: string;
  consecutiveSuccessCount: number;
  isDue: boolean;
}

export interface CloudConsent {
  isAdult: boolean;
  sendCurrentTurnOnlyAgreed: boolean;
  googleReviewDisclosureAgreed: boolean;
  noSensitiveInfoAgreed: boolean;
  policyVersion: string;
  consentedAt?: string;
}

export interface ConversationSettings {
  allowExternalFreeGeminiCalls: boolean; // 기본값 false (명시 동의 전 비활성)
  cloudConsent?: CloudConsent;
  useSpeechInput: boolean;
  speechConfirmationRequired: boolean; // 전사 텍스트 항상 확인 후 제출
  audioAutoPlay: boolean;
  engineMode: EvaluationEngineMode;
}

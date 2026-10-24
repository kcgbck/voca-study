// src/features/conversation/coach/coachProtocol.ts
// 공개 AI 회화 코치 프로토콜 정의 (인증 없는 성인 초보 1문1답 전용)

export const COACH_POLICY_VERSION = 'coach-2026-10-23';

export interface CoachQuestion {
  id: string;
  scenarioKo: string;
  questionEn: string;
  exampleAnswerEn: string;
  objectiveKo: string;
}

export interface CoachEvaluation {
  meaning: 'relevant' | 'needs_help' | 'uncertain';
  sentenceComplete: boolean;
  feedbackKo: string;
  modelAnswerEn: string;
}

export class CoachBudgetError extends Error {
  public readonly code: 'COACH_MINUTE_LIMIT' | 'COACH_DAILY_LIMIT';
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    code: 'COACH_MINUTE_LIMIT' | 'COACH_DAILY_LIMIT',
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'CoachBudgetError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface CoachRequest {
  requestId: string;
  adultConfirmed: boolean;
  policyVersion: string;
  questionId: string;
  answer: string;
}

/**
 * 성인 초보 5종 고정 질문 목록 (서버 고정 id, 실제 개인정보 대신 가명 예시)
 */
export const COACH_QUESTIONS: readonly CoachQuestion[] = [
  {
    id: 'name',
    scenarioKo: '처음 만난 사람과 가볍게 인사를 나누는 상황입니다.',
    questionEn: 'What is your name?',
    exampleAnswerEn: 'My name is Alex.',
    objectiveKo: '이름을 묻는 질문에 가명으로 자연스럽게 소개할 수 있다.',
  },
  {
    id: 'age',
    scenarioKo: '나이를 묻고 답하는 상황입니다.',
    questionEn: 'How old are you?',
    exampleAnswerEn: 'I am 28 years old.',
    objectiveKo: '나이를 묻는 질문에 완전한 영어 문장으로 대답할 수 있다.',
  },
  {
    id: 'cafe',
    scenarioKo: '카페에서 마실 음료를 주문하는 상황입니다.',
    questionEn: 'What would you like to drink?',
    exampleAnswerEn: 'I would like an iced americano, please.',
    objectiveKo: '카페에서 원하는 음료를 정중하게 주문할 수 있다.',
  },
  {
    id: 'breakfast',
    scenarioKo: '오늘 아침 식사로 무엇을 먹었는지 묻는 상황입니다.',
    questionEn: 'What did you have for breakfast today?',
    exampleAnswerEn: 'I had toast and a cup of coffee.',
    objectiveKo: '오늘 아침 식사 메뉴를 과거 시제로 표현할 수 있다.',
  },
  {
    id: 'hobby',
    scenarioKo: '여가 시간에 주로 무엇을 하는지 취미를 묻는 상황입니다.',
    questionEn: 'What do you like to do in your free time?',
    exampleAnswerEn: 'I like listening to music and watching movies.',
    objectiveKo: '자신의 취미나 여가 활동을 영어로 자연스럽게 표현할 수 있다.',
  },
] as const;

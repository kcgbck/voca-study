// src/features/conversation/coach/coachProtocol.ts
// 공개 AI 회화 코치 프로토콜 정의 (인증 없는 성인 초보 1문1답 전용)

export const COACH_POLICY_VERSION = 'coach-2026-10-23';

export const CAFE_SCENARIO_ID = 'cafe_order_v1';
export const SCENARIO_COMPLETE_SENTINEL = 'complete';

export interface CoachQuestion {
  id: string;
  scenarioKo: string;
  questionEn: string;
  exampleAnswerEn: string;
  objectiveKo: string;
}

export interface CoachRecentContextItem {
  questionId: string;
  answer: string;
}

export interface CoachNextQuestionCandidate {
  id: string;
  questionEn: string;
  selectionCriterionKo: string;
}

export interface CoachScenarioNode extends CoachQuestion {
  allowedNextQuestionIds: readonly string[];
  selectionCriterionKo?: string;
}

export interface CoachInputContext {
  inputSource: 'voice' | 'text';
  candidates?: string[];
  scenarioId?: string;
  recentContext?: CoachRecentContextItem[];
}

export interface CoachEvaluation {
  meaning: 'relevant' | 'needs_help' | 'uncertain';
  sentenceComplete: boolean;
  feedbackKo: string;
  modelAnswerEn: string;
  recognizedCandidateIndex?: number;
  nextQuestionId?: string;
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
  inputSource?: 'voice' | 'text';
  candidates?: string[];
  scenarioId?: string;
  recentContext?: CoachRecentContextItem[];
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

/**
 * 카페 주문 시나리오 (기본 6문항 / 온도 선제시 시 5문항) 서버/클라이언트 공유 권위 카탈로그
 */
export const CAFE_QUESTIONS: readonly CoachScenarioNode[] = [
  {
    id: 'cafe_drink',
    scenarioKo: '카페에 들어가 직원의 첫 음료 주문 질문에 답하는 상황입니다.',
    questionEn: 'Hi! What would you like to drink today?',
    exampleAnswerEn: 'I would like an iced tea, please.',
    objectiveKo: '원하는 음료 메뉴를 정중하게 주문할 수 있다.',
    allowedNextQuestionIds: ['cafe_temp', 'cafe_size'],
    selectionCriterionKo: '카페 주문의 첫 시작 노드',
  },
  {
    id: 'cafe_temp',
    scenarioKo: '주문한 음료의 온도를 선택하는 상황입니다.',
    questionEn: 'Would you like that hot or iced?',
    exampleAnswerEn: "I'd like it iced, please.",
    objectiveKo: '음료의 따뜻함 또는 차가움을 명확히 밝힐 수 있다.',
    allowedNextQuestionIds: ['cafe_size'],
    selectionCriterionKo: '음료의 온도(hot/iced)가 아직 지정되지 않은 경우',
  },
  {
    id: 'cafe_size',
    scenarioKo: '음료 컵 크기를 선택하는 상황입니다.',
    questionEn: 'What size would you like: small, medium, or large?',
    exampleAnswerEn: "I'd like a medium, please.",
    objectiveKo: '원하는 컵 크기를 선택해 말할 수 있다.',
    allowedNextQuestionIds: ['cafe_dine_in'],
    selectionCriterionKo: '음료와 온도가 확인되었거나 답변에 이미 온도가 명시된 경우',
  },
  {
    id: 'cafe_dine_in',
    scenarioKo: '매장에서 마실지 포장해 갈지 묻는 상황입니다.',
    questionEn: 'Is this for here or to go?',
    exampleAnswerEn: "I'd like it to go, please.",
    objectiveKo: '매장 이용 또는 테이크아웃 여부를 밝힐 수 있다.',
    allowedNextQuestionIds: ['cafe_option'],
    selectionCriterionKo: '컵 크기 선택이 완료된 후 매장 이용 여부 확인',
  },
  {
    id: 'cafe_option',
    scenarioKo: '컵 홀더나 캐리어 등 추가 옵션 필요 여부를 묻는 상황입니다.',
    questionEn: 'Do you need a cup sleeve or a carrier?',
    exampleAnswerEn: 'I do not need a carrier, thank you.',
    objectiveKo: '추가 소모품이나 포장 용품 필요 여부를 말할 수 있다.',
    allowedNextQuestionIds: ['cafe_payment'],
    selectionCriterionKo: '매장/포장 여부 확인 후 추가 옵션 필요 여부 확인',
  },
  {
    id: 'cafe_payment',
    scenarioKo: '결제 방식을 선택하는 마지막 상황입니다.',
    questionEn: 'How would you like to pay today?',
    exampleAnswerEn: 'I will pay by credit card.',
    objectiveKo: '카드 또는 현금 등 결제 수단을 말하고 주문을 마칠 수 있다.',
    allowedNextQuestionIds: [SCENARIO_COMPLETE_SENTINEL],
    selectionCriterionKo: '주문 내용이 모두 확정된 후 최종 결제 수단 확인',
  },
] as const;

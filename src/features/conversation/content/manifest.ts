// src/features/conversation/content/manifest.ts
// 128차시 전체 교육과정 목차 (4단계 × 8단원 × 4차시)

import type { CurriculumManifest, ConversationLevel, ManifestLessonItem } from '../types';

interface UnitDefinition {
  unitNumber: number;
  unitTitleKo: string;
  lessonTitles: [string, string, string, string];
  tags: string[];
}

const LEVEL_DEFINITIONS: Record<ConversationLevel, {
  titleKo: string;
  cefrReference: string;
  units: UnitDefinition[];
}> = {
  intro: {
    titleKo: '입문 (Intro)',
    cefrReference: 'Pre-A1 ~ A1',
    units: [
      {
        unitNumber: 1,
        unitTitleKo: '인사·첫 만남',
        lessonTitles: ['인사 표현 듣기와 인지', '기본 인사와 이름 말하기', '처음 만난 상대와 인사 나누기', '새로운 장소에서 첫인사 나누기'],
        tags: ['greeting', 'first_meeting', 'intro_basics'],
      },
      {
        unitNumber: 2,
        unitTitleKo: '이름·출신·나이',
        lessonTitles: ['출신 국가와 나이 표현 듣기', '출신과 나이 답하기', '상대 정보 묻고 내 정보 말하기', '국제 행사에서 자기소개하기'],
        tags: ['origin', 'age', 'personal_info'],
      },
      {
        unitNumber: 3,
        unitTitleKo: '기분·상태 표현',
        lessonTitles: ['기분/건강 상태 듣기', '오늘 컨디션 표현하기', '안부 주고받기', '상대 상태 묻고 위로하기'],
        tags: ['feelings', 'condition', 'small_talk'],
      },
      {
        unitNumber: 4,
        unitTitleKo: '음식·취미·좋아하는 것',
        lessonTitles: ['좋아하는 음식과 취미 듣기', '선호 표현 말하기', '취미 대화 주고받기', '새 친구와 관심사 맞추기'],
        tags: ['food', 'hobby', 'preference'],
      },
      {
        unitNumber: 5,
        unitTitleKo: '가족·직업·사물 묘사',
        lessonTitles: ['직업과 가족 표현 듣기', '직업과 소지품 묘사하기', '가족/동료 소개하기', '사진 속 인물과 사물 묘사'],
        tags: ['family', 'job', 'description'],
      },
      {
        unitNumber: 6,
        unitTitleKo: '일상 활동·빈도',
        lessonTitles: ['하루 일과와 빈도 표현 듣기', '나의 일과 설명하기', '주말 활동 대화', '상대의 일상 인터뷰하기'],
        tags: ['routine', 'frequency', 'daily_life'],
      },
      {
        unitNumber: 7,
        unitTitleKo: '예/아니오·의문사 질문',
        lessonTitles: ['기본 의문문 패턴 듣기', '예/아니오 및 단답 응답하기', '질문 던지고 대답 받기', '안내소에서 정보 질문하기'],
        tags: ['questions', 'yes_no', 'information'],
      },
      {
        unitNumber: 8,
        unitTitleKo: '되묻기·도움 요청·종합',
        lessonTitles: ['다시 말해달라고 요청하기', '쉬운 표현으로 부탁하기', '외국인과의 기본 대화 종합', '입문 실전 종합 상황 테스트'],
        tags: ['clarification', 'help', 'review_comprehensive'],
      },
    ],
  },
  beginner: {
    titleKo: '초급 (Beginner)',
    cefrReference: 'A1 ~ A2',
    units: [
      {
        unitNumber: 1,
        unitTitleKo: '카페·식당 주문',
        lessonTitles: ['음료와 식사 주문 표현 듣기', '수량/옵션 지정해 주문하기', '카페 점원과 주문 롤플레잉', '새로운 식당에서 식사 주문 및 포장'],
        tags: ['cafe', 'ordering', 'food_service'],
      },
      {
        unitNumber: 2,
        unitTitleKo: '길 찾기·교통편',
        lessonTitles: ['방향과 대중교통 표현 듣기', '목적지까지 가는 방법 묻기', '지하철/버스 매표소 대화', '낯선 도시에서 길 묻고 찾아가기'],
        tags: ['directions', 'transportation', 'city_travel'],
      },
      {
        unitNumber: 3,
        unitTitleKo: '공항·호텔 체크인',
        lessonTitles: ['탑승수속과 체크인 질문 듣기', '예약 확인 및 방 배정 요청', '호텔 프런트 데스크 상황극', '수하물 분실 및 룸 교체 요청'],
        tags: ['airport', 'hotel', 'travel_checkin'],
      },
      {
        unitNumber: 4,
        unitTitleKo: '쇼핑·교환·환불',
        lessonTitles: ['가격과 치수 문의 듣기', '사이즈 교환 및 결제 요청', '상점 직원과 가격 협의/구매', '물품 하자 교환 및 환불 요구'],
        tags: ['shopping', 'refund', 'payment'],
      },
      {
        unitNumber: 5,
        unitTitleKo: '약속·날짜·시간 조율',
        lessonTitles: ['일정 제안과 시간 표현 듣기', '가능한 시간대 말하기', '친구와 만날 약속 정하기', '일정 변경 및 양해 구하기'],
        tags: ['schedule', 'appointment', 'calendar'],
      },
      {
        unitNumber: 6,
        unitTitleKo: '전화·메시지·요청',
        lessonTitles: ['전화 통화 기본 표현 듣기', '메시지 남기기 및 용건 말하기', '식당/병원 전화 예약 롤플레잉', '잘못 걸린 전화와 재확인 대화'],
        tags: ['phone_call', 'message', 'reservation'],
      },
      {
        unitNumber: 7,
        unitTitleKo: '길 잃음·긴급 도움 요청',
        lessonTitles: ['긴급 상황과 도움 표현 듣기', '분실물/위급 상황 설명하기', '경찰/안내원에게 도움 요청', '응급약 구매 및 진료소 찾기'],
        tags: ['emergency', 'lost_found', 'urgency'],
      },
      {
        unitNumber: 8,
        unitTitleKo: '여행 종합 실전',
        lessonTitles: ['여행 중 돌발 상황 듣기', '스스로 문제 해결 말하기', '공항-숙소-여행지 연속 롤플레잉', '초급 실전 종합 여행 평가'],
        tags: ['travel_comprehensive', 'roleplay', 'review'],
      },
    ],
  },
  intermediate: {
    titleKo: '중급 (Intermediate)',
    cefrReference: 'B1 ~ B2',
    units: [
      {
        unitNumber: 1,
        unitTitleKo: '과거 경험과 사건 설명',
        lessonTitles: ['과거 시제 경험 서술 듣기', '지난 주말/사건 정확히 말하기', '기억에 남는 여행 경험 대화', '예기치 못한 사고 상황 서술'],
        tags: ['past_experience', 'narrative', 'storytelling'],
      },
      {
        unitNumber: 2,
        unitTitleKo: '계획·예정 변경 설명',
        lessonTitles: ['계획 변경과 사유 설명 듣기', '지연/취소 원인 조리있게 말하기', '동료에게 일정 변경 전달하기', '비행기 결항에 따른 대안 조율'],
        tags: ['schedule_change', 'delay_explanation', 'plans'],
      },
      {
        unitNumber: 3,
        unitTitleKo: '선호·선택과 비교',
        lessonTitles: ['비교급/최상급 비교 담화 듣기', '장단점 비교하여 의견 말하기', '두 제품 중 선택 토의', '이사 갈 지역 비교 평가하기'],
        tags: ['comparison', 'pros_cons', 'choice'],
      },
      {
        unitNumber: 4,
        unitTitleKo: '의견과 이유·근거',
        lessonTitles: ['주장과 뒷받침 근거 듣기', '내 의견과 이유 2가지 말하기', '재택근무 찬반 대화', '새 프로젝트 도입 제안하기'],
        tags: ['opinion', 'reasons', 'arguments'],
      },
      {
        unitNumber: 5,
        unitTitleKo: '고장·민원·문제 해결',
        lessonTitles: ['장비 고장 및 민원 신고 듣기', '문제 원인과 요구사항 말하기', '서비스 센터 고객 응대 롤플레잉', '임대 계약 문제 원만한 항의'],
        tags: ['troubleshooting', 'complaint', 'customer_service'],
      },
      {
        unitNumber: 6,
        unitTitleKo: '업무 공유·회의·협업',
        lessonTitles: ['프로젝트 진행 현황 듣기', '진척도 보고 및 이슈 공유', '주간 업무 회의 발언하기', '업무 우선순위 조율 협의'],
        tags: ['business_meeting', 'status_update', 'collaboration'],
      },
      {
        unitNumber: 7,
        unitTitleKo: '동의·반대·대안 제시',
        lessonTitles: ['정중한 반대와 대안 표현 듣기', '동의 정도와 조건부 의견 말하기', '기획안 수정 논의하기', '예산 삭감 제안에 대한 절충안 제시'],
        tags: ['agreement', 'disagreement', 'alternatives'],
      },
      {
        unitNumber: 8,
        unitTitleKo: '장문 의견·종합 대화',
        lessonTitles: ['3분 이상 복합 담화 듣기', '구조화된 1분 발화하기', '중급 종합 모의 토론', '중급 실전 인증 평가'],
        tags: ['extended_speech', 'structured_talk', 'review_comprehensive'],
      },
    ],
  },
  advanced: {
    titleKo: '고급 (Advanced)',
    cefrReference: 'C1 ~ C2',
    units: [
      {
        unitNumber: 1,
        unitTitleKo: '발표·설명 구조화',
        lessonTitles: ['도입-전개-결론 발표 담화 분석', '핵심 메시지 강조 프레젠테이션', 'Q&A 질의응답 대응 롤플레잉', '투자 설명회 오프닝 및 위기 설명'],
        tags: ['presentation', 'structuring', 'public_speaking'],
      },
      {
        unitNumber: 2,
        unitTitleKo: '주장·설득·논증',
        lessonTitles: ['설득적 논거와 수사적 표현 듣기', '논리적 반론과 근거 제시', '마케팅 전략 설득 토론', '의사결정권자 설득 브리핑'],
        tags: ['persuasion', 'logical_argument', 'influence'],
      },
      {
        unitNumber: 3,
        unitTitleKo: '협상·양보·조건 제시',
        lessonTitles: ['협상 조건과 마지노선 담화 분석', '조건부 제안 및 단계적 양보', '파트너사 계약 협상 시뮬레이션', '위약금 분쟁 원만한 합의 도출'],
        tags: ['negotiation', 'concession', 'conditional_proposals'],
      },
      {
        unitNumber: 4,
        unitTitleKo: '면접·심화 질문 답변',
        lessonTitles: ['압박 면접 질문 분석', 'STAR 기법 역량 답변', '경력/실패 극복 인터뷰 롤플레잉', '임원 면접 전략적 가치 어필'],
        tags: ['job_interview', 'star_method', 'career'],
      },
      {
        unitNumber: 5,
        unitTitleKo: '갈등 조정·외교적 거절',
        lessonTitles: ['완곡한 어조와 외교적 거절 듣기', '관계 손상 없는 비토 표명', '팀 내 이해관계 충돌 중재', '무리한 고객 요구 품격있게 거절'],
        tags: ['conflict_resolution', 'diplomatic_refusal', 'tact'],
      },
      {
        unitNumber: 6,
        unitTitleKo: '가정·위험·불확실성',
        lessonTitles: ['가정법과 리스크 분석 담화', '시나리오별 리스크 평가 말하기', '비상 대책 회의 시뮬레이션', '블랙스완 사태 비상 경영 플랜 브리핑'],
        tags: ['hypothetical', 'risk_analysis', 'crisis_management'],
      },
      {
        unitNumber: 7,
        unitTitleKo: '격식·문화 맥락에 따른 표현',
        lessonTitles: ['격식체와 영미권 에티켓 담화', '상황별 톤앤매너 조절 발화', 'VIP 의전 및 공식 만찬 대화', '다국적 파트너 간 문화적 오해 해소'],
        tags: ['formality', 'cultural_nuance', 'protocol'],
      },
      {
        unitNumber: 8,
        unitTitleKo: '사회·기술 주제 심층 토론',
        lessonTitles: ['AI 윤리와 신기술 쟁점 분석', '다면적 시각의 논평 발화', '글로벌 라운드테이블 모의 토론', '고급 실전 종합 토론 마스터 평가'],
        tags: ['deep_discussion', 'ethics_technology', 'master_evaluation'],
      },
    ],
  },
};

const LESSON_TYPES: Array<'comprehension' | 'controlled_practice' | 'roleplay' | 'transfer_assessment'> = [
  'comprehension',
  'controlled_practice',
  'roleplay',
  'transfer_assessment',
];

export function buildCurriculumManifest(): CurriculumManifest {
  const levels = {} as CurriculumManifest['levels'];
  let totalLessons = 0;
  let activeDraftLessons = 0;

  const levelKeys: ConversationLevel[] = ['intro', 'beginner', 'intermediate', 'advanced'];

  for (const lvl of levelKeys) {
    const def = LEVEL_DEFINITIONS[lvl];
    const units = def.units.map((unit) => {
      const lessons: ManifestLessonItem[] = unit.lessonTitles.map((title, idx) => {
        const lessonNumber = idx + 1;
        const id = `${lvl}-u0${unit.unitNumber}-l0${lessonNumber}`;
        const lessonType = LESSON_TYPES[idx];
        const isDraftActive = unit.unitNumber <= 2; // 각 레벨의 1, 2단원 총 8과씩 = 32과

        totalLessons++;
        if (isDraftActive) {
          activeDraftLessons++;
        }

        return {
          id,
          level: lvl,
          unitNumber: unit.unitNumber,
          unitTitleKo: unit.unitTitleKo,
          lessonNumber,
          lessonType,
          titleKo: title,
          status: isDraftActive ? 'HUMAN_CURRICULUM_REVIEW_PENDING' : 'PREPARING',
          contentRevision: 1,
          hasDetailedContent: isDraftActive,
          reviewTags: unit.tags,
        };
      });

      return {
        unitNumber: unit.unitNumber,
        unitTitleKo: unit.unitTitleKo,
        lessons,
      };
    });

    levels[lvl] = {
      titleKo: def.titleKo,
      cefrReference: def.cefrReference,
      unitCount: 8,
      lessonCount: 32,
      units,
    };
  }

  return {
    version: '2.2.0',
    totalLessons,
    totalUnits: 32,
    activeDraftLessons,
    levels,
  };
}

export const CURRICULUM_MANIFEST: CurriculumManifest = buildCurriculumManifest();

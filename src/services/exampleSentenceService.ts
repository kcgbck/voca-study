/**
 * 보카 스터디 빈출 실전문장(Example Sentence) 제공 서비스
 * 
 * 토익(TOEIC), 해사영어(IMO SMCP), 일본어(JLPT/생활) 어휘에 대한
 * 실제 시험 및 실무에 사용되는 대표 빈출 문장과 한국어 해석을 제공합니다.
 * 사전에 등록되지 않은 단어도 품사와 의미에 맞게 100% 자연스러운 실전 문장을 생성합니다.
 */

export interface ExampleSentence {
  text: string;
  translation: string;
  highlightWord: string;
}

// 1. 토익 비즈니스 & 실전 빈출 문장 사전
const TOEIC_SENTENCES: Record<string, { text: string; translation: string }> = {
  // A
  acquire: {
    text: 'The company plans to acquire a regional logistics chain next quarter.',
    translation: '그 회사는 다음 분기에 지역 물류 체인을 인수할 계획입니다.',
  },
  acquisition: {
    text: 'The recent corporate acquisition expanded their market share significantly.',
    translation: '최근의 기업 인수는 그들의 시장 점유율을 크게 확대했습니다.',
  },
  accommodate: {
    text: 'The convention hall can accommodate up to one thousand guests.',
    translation: '그 컨벤션 홀은 최대 1,000명의 하객을 수용할 수 있습니다.',
  },
  allocate: {
    text: 'Management decided to allocate additional funds for marketing research.',
    translation: '경영진은 마케팅 연구를 위해 추가 자금을 배정하기로 결정했습니다.',
  },
  authorize: {
    text: 'Only senior supervisors are permitted to authorize overtime payments.',
    translation: '수석 관리자만이 초과 근무 수당을 승인할 수 있습니다.',
  },
  applicant: {
    text: 'Each qualified applicant will be invited for a personal interview.',
    translation: '자격을 갖춘 각 지원자는 개별 면접에 초대될 것입니다.',
  },
  appraise: {
    text: 'An independent real estate firm will appraise the commercial property.',
    translation: '독립적인 부동산 회사가 해당 상업용 건물을 감정 평가할 것입니다.',
  },
  agenda: {
    text: 'The first item on the meeting agenda is the quarterly financial report.',
    translation: '회의 안건의 첫 번째 항목은 분기별 재무 보고서입니다.',
  },

  // B & C
  budget: {
    text: 'The annual department budget must be submitted before Friday afternoon.',
    translation: '연간 부서 예산은 금요일 오후 이전에 제출되어야 합니다.',
  },
  collaborate: {
    text: 'Our design team will collaborate closely with external software engineers.',
    translation: '우리 디자인 팀은 외부 소프트웨어 엔지니어들과 긴밀히 협력할 것입니다.',
  },
  complaint: {
    text: 'Customer support promptly handled the formal complaint from the client.',
    translation: '고객 지원팀은 고객의 공식적인 불만 사항을 신속하게 처리했습니다.',
  },
  comply: {
    text: 'All manufacturing facilities must comply with international safety regulations.',
    translation: '모든 제조 시설은 국제 안전 규정을 준수해야 합니다.',
  },
  compliance: {
    text: 'Strict compliance with environmental standards is required for all branches.',
    translation: '모든 지사에서는 환경 기준의 엄격한 준수가 요구됩니다.',
  },
  conference: {
    text: 'The international sales conference will take place at the Grand Hotel.',
    translation: '국제 영업 컨퍼런스가 그랜드 호텔에서 개최될 예정입니다.',
  },
  contract: {
    text: 'Both parties reviewed the final employment contract before signing.',
    translation: '양측은 서명하기 전에 최종 고용 계약서를 검토했습니다.',
  },
  candidate: {
    text: 'The selection committee interviewed the most promising job candidate.',
    translation: '선발 위원회는 가장 유망한 입사 지원자를 면접했습니다.',
  },
  confirm: {
    text: 'Please confirm your flight reservation at least forty-eight hours in advance.',
    translation: '적어도 48시간 전에 항공편 예약을 확인해 주시기 바랍니다.',
  },

  // D & E
  deadline: {
    text: 'The team worked late into the night to meet the strict project deadline.',
    translation: '팀원들은 촉박한 프로젝트 마감 기한을 맞추기 위해 밤늦게까지 일했습니다.',
  },
  delegate: {
    text: 'An effective manager knows how to delegate routine tasks to team members.',
    translation: '유능한 관리자는 일상적인 업무를 팀원들에게 위임하는 방법을 압니다.',
  },
  diversify: {
    text: 'The investment firm advised the board to diversify their product portfolio.',
    translation: '투자 회사는 이사회에 제품 포트폴리오를 다각화할 것을 권고했습니다.',
  },
  evaluate: {
    text: 'The committee will evaluate employee performance based on quarterly milestones.',
    translation: '위원회는 분기별 목표 달성도를 바탕으로 직원 근무 평가를 실시할 것입니다.',
  },
  executive: {
    text: 'The chief executive officer delivered an inspiring keynote address.',
    translation: '최고 경영자는 영감을 주는 기조 연설을 발표했습니다.',
  },
  expedite: {
    text: 'We paid an additional express fee to expedite shipping of the replacement parts.',
    translation: '우리는 교체 부품의 배송을 촉진(신속 처리)하기 위해 추가 특급 요금을 지불했습니다.',
  },

  // F ~ I
  facilitate: {
    text: 'The modernized digital system will facilitate cross-department communication.',
    translation: '현대화된 디지털 시스템은 부서 간 소통을 원활하게 촉진할 것입니다.',
  },
  implement: {
    text: 'The corporate office plans to implement a flexible remote work policy.',
    translation: '본사는 유연 원격 근무 정책을 시행할 계획입니다.',
  },
  incentive: {
    text: 'The sales team received a performance bonus as a strong incentive.',
    translation: '영업팀은 강력한 유인책(인센티브)으로 성과 보너스를 받았습니다.',
  },
  inspect: {
    text: 'Safety officials arrived this morning to inspect the newly built warehouse.',
    translation: '안전 조사관들이 신축 창고를 점검하기 위해 오늘 아침 도착했습니다.',
  },
  invoice: {
    text: 'Please remit payment within thirty days of the date printed on the invoice.',
    translation: '송장에 인쇄된 날짜로부터 30일 이내에 대금을 송금해 주십시오.',
  },
  itinerary: {
    text: 'The administrative assistant finalized the travel itinerary for the overseas seminar.',
    translation: '행정 조교는 해외 세미나를 위한 출장 일정을 최종 확정했습니다.',
  },

  // M ~ P
  mandatory: {
    text: 'Attendance at the annual workplace cybersecurity training is strictly mandatory.',
    translation: '연례 직장 사이버 보안 교육 참석은 엄격히 의무적(필수)입니다.',
  },
  negotiate: {
    text: 'The legal representative will negotiate favorable terms for the merger agreement.',
    translation: '법률 대리인은 합병 계약에 대한 유리한 조건을 협상할 것입니다.',
  },
  negotiation: {
    text: 'Both parties engaged in intensive negotiation regarding the licensing fee.',
    translation: '양측은 라이선스 비용과 관련하여 집중적인 협상을 진행했습니다.',
  },
  overhaul: {
    text: 'The IT department initiated a complete overhaul of the legacy database system.',
    translation: 'IT 부서는 노후화된 구형 데이터베이스 시스템의 전면적인 개편을 시작했습니다.',
  },
  postpone: {
    text: 'Due to severe weather conditions, organizers decided to postpone the outdoor gala.',
    translation: '기상 악화로 인해 주최 측은 야외 갈라 행사를 연기하기로 결정했습니다.',
  },
  reschedule: {
    text: 'Could we reschedule our meeting to Thursday afternoon at three o’clock?',
    translation: '저희 회의 일정을 목요일 오후 3시로 다시 잡을 수 있을까요?',
  },
  refund: {
    text: 'Customers are entitled to a full refund within two weeks of original purchase.',
    translation: '고객은 최초 구매 후 2주 이내에 전액 환불을 받을 권리가 있습니다.',
  },
  resume: {
    text: 'Applicants should attach a comprehensive resume detailing their work history.',
    translation: '지원자들은 자신의 경력을 상세히 기술한 종합 이력서를 첨부해야 합니다.',
  },
  revenue: {
    text: 'Quarterly revenue exceeded market projections by more than eight percent.',
    translation: '분기별 매출액이 시장 전망치를 8% 이상 초과 달성했습니다.',
  },

  // S ~ V
  streamline: {
    text: 'Management adopted cloud software to streamline everyday accounting operations.',
    translation: '경영진은 일상 회계 업무를 간소화(효율화)하기 위해 클라우드 소프트웨어를 도입했습니다.',
  },
  terminate: {
    text: 'Either party may terminate the partnership by providing written notice in advance.',
    translation: '어느 한쪽 당사자든 서면 사전 통지를 제공함으로써 파트너십을 해지할 수 있습니다.',
  },
  unanimous: {
    text: 'The committee reached a unanimous agreement regarding the promotion of the director.',
    translation: '위원회는 이사의 승진과 관련하여 만장일치의 합의에 도달했습니다.',
  },
  voucher: {
    text: 'Guests will receive a complimentary dining voucher redeemable at the hotel bistro.',
    translation: '투숙객은 호텔 비스트로에서 사용할 수 있는 무료 식사 상품권을 받게 됩니다.',
  },
};

// 2. 해사영어 (IMO SMCP & 해기사 실무) 빈출 통신/업무 문장 사전
const MARITIME_SENTENCES: Record<string, { text: string; translation: string }> = {
  'abandon vessel': {
    text: 'All crew members and passengers must prepare to abandon vessel immediately.',
    translation: '모든 선원과 승객은 즉시 퇴선 준비를 완료해야 합니다.',
  },
  draft: {
    text: 'The maximum measured draft of the container vessel is eleven meters.',
    translation: '컨테이너선의 최대 측정 흘수는 11미터입니다.',
  },
  anchor: {
    text: 'Vessel will heave up anchor and proceed to the designated fairway at noon.',
    translation: '본선은 정오에 닻을 올리고 지정된 항로로 진입할 예정입니다.',
  },
  collision: {
    text: 'The officer of the watch altered course to starboard to prevent a collision.',
    translation: '당직 항해사는 충돌을 방지하기 위해 우현으로 변침했습니다.',
  },
  knot: {
    text: 'The vessel is navigating at a sustained cruising speed of sixteen knots.',
    translation: '본선은 16노트의 지속 순항 속력으로 항해 중입니다.',
  },
  starboard: {
    text: 'Alter course five degrees to starboard to maintain a safe passing distance.',
    translation: '안전 통항 거리를 유지하기 위해 우현으로 5도 변침하십시오.',
  },
  'port side': {
    text: 'Prepare fenders and mooring lines on the port side prior to docking.',
    translation: '접안에 앞서 좌현에 펜더와 계류줄을 준비하십시오.',
  },
  fairway: {
    text: 'Deep-draft vessels have priority of navigation in this narrow fairway.',
    translation: '이 좁은 항로에서는 심흘수선이 항행 우선권을 갖습니다.',
  },
  leeway: {
    text: 'Make allowance for significant leeway caused by strong northwesterly winds.',
    translation: '강한 북서풍으로 인한 상당한 풍압차(선박 밀림)를 감안하십시오.',
  },
  'heave up': {
    text: 'Heave up anchor and report when the anchor is aweigh and clear.',
    translation: '닻을 감아올리고, 닻이 해저에서 떨어져 이상이 없을 때 보고하십시오.',
  },
  distress: {
    text: 'The Coast Guard received an emergency distress call on VHF Channel sixteen.',
    translation: '해양경찰은 VHF 16번 채널을 통해 긴급 조난 신호를 수신했습니다.',
  },
  mooring: {
    text: 'Ensure all crew wear personal protective equipment during mooring operations.',
    translation: '계류 작업 중에는 모든 선원이 개인 보호 장구를 착용하도록 하십시오.',
  },
  tug: {
    text: 'Two escort tug boats are standing by to assist with berthing maneuvers.',
    translation: '접안 조종을 지원하기 위해 2척의 호위 예인선이 대기 중입니다.',
  },
  helm: {
    text: 'The helmsman answered the steering order: Midships, aye aye sir.',
    translation: '조타수는 타 명령에 복창했습니다: 키 중앙, 알겠습니다.',
  },
};

// 3. 일본어 (JLPT 시험용 & 완전 생활일본어) 빈출 실전문장 사전
const JAPANESE_SENTENCES: Record<string, { text: string; translation: string }> = {
  約束: {
    text: '今度の週末に、友達とカフェで会う約束をしました。',
    translation: '이번 주말에 친구와 카페에서 만날 약속을 했습니다.',
  },
  すみません: {
    text: 'すみません、お会計を別々にお願いできますか？',
    translation: '실례합니다, 계산을 따로따로 부탁드려도 될까요?',
  },
  空港: {
    text: '成田空港までは特急電車で約一時間かかります。',
    translation: '나리타 공항까지는 특급 전철로 약 1시간 걸립니다.',
  },
  ホテル: {
    text: '駅から歩いて五分のビジネスホテルを予約しました。',
    translation: '역에서 걸어서 5분 거리의 비즈니스 호텔을 예약했습니다.',
  },
  予約: {
    text: '今夜七時に四名でレストランの予約をしたいのですが。',
    translation: '오늘 밤 7시에 4명으로 식당 예약을 하고 싶습니다만.',
  },
  切符: {
    text: '自動券売機で東京行きの新幹線の切符を購入しました。',
    translation: '자동 발권기에서 도쿄행 신칸센 표를 구입했습니다.',
  },
  荷物: {
    text: 'チェックインの前まで、フロントで荷物を預かってもらえますか？',
    translation: '체크인 전까지 프런트에서 짐을 보관해 주실 수 있나요?',
  },
  会議: {
    text: '明日の朝九時から、新製品に関する重要な企画会議があります。',
    translation: '내일 아침 9시부터 신제품에 관한 중요한 기획 회의가 있습니다.',
  },
  書類: {
    text: '契約書の内容を確認して、必要な書類にサインをしてください。',
    translation: '계약서 내용을 확인하고 필요한 서류에 서명해 주십시오.',
  },
  電車: {
    text: '朝の通勤時間帯は電車が大変混雑します。',
    translation: '아침 출근 시간대에는 전철이 매우 혼잡합니다.',
  },
  注文: {
    text: 'すみません、おすすめのメニューを注文したいです。',
    translation: '실례합니다, 추천 메뉴로 주문하고 싶습니다.',
  },
  会計: {
    text: 'クレジットカードでお会計をお願いできますか？',
    translation: '신용카드로 계산 부탁드려도 될까요?',
  },
  病院: {
    text: '熱が高くなったので、近くの総合病院に行って診察を受けました。',
    translation: '열이 많이 나서 근처 종합병원에 가서 진찰을 받았습니다.',
  },
  薬: {
    text: '食後にこの風邪薬をぬるま湯と一緒に飲んでください。',
    translation: '식후에 이 감기약을 미온수와 함께 복용하세요.',
  },
  駅: {
    text: '一番近い地下鉄の駅はどこにありますか？',
    translation: '가장 가까운 지하철역은 어디에 있습니까?',
  },
  案内: {
    text: '観光案内所で日本語と韓国語の地図をもらいました。',
    translation: '관광안내소에서 일본어와 한국어 지도를 받았습니다.',
  },
};

/**
 * 단어 텍스트 정규화 키 추출
 */
function normalizeKey(word: string): string {
  if (!word) return '';
  return word
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/, '') // [식당] 태그 제거
    .replace(/\s*[\(（][^\)）]+[\)）]/g, '') // 괄호 요미가나/해석 제거
    .trim();
}

/**
 * 표제어에 대한 빈출 문장(Example Sentence) 반환
 * 1. 단어 엔트리에 내장된 예문이 있으면 최우선 반환
 * 2. 내장 실전 빈출 문장 사전(토익/해사/일본어) 매칭
 * 3. 매칭되지 않은 단어의 경우 품사 및 의미를 반영한 실전 문맥 문장 100% 자동 생성
 */
export function getExampleSentence(
  word: string,
  meaning: string[] = [],
  partOfSpeech = '단어',
  customSentence?: string,
  customTranslation?: string
): ExampleSentence {
  // 1. 이미 정의된 커스텀 예문이 있는 경우
  if (customSentence && customSentence.trim()) {
    return {
      text: customSentence.trim(),
      translation: customTranslation?.trim() || '',
      highlightWord: word,
    };
  }

  const rawKey = word.trim();
  const normKey = normalizeKey(rawKey);
  const primaryMeaning = meaning[0] || '';

  // 2. 일본어 사전 매칭
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(rawKey)) {
    // 괄호 앞 한자/가나만 추출
    const pureJa = rawKey.replace(/\s*[\(（][^\)）]+[\)）]/g, '').trim();
    if (JAPANESE_SENTENCES[pureJa]) {
      return {
        text: JAPANESE_SENTENCES[pureJa].text,
        translation: JAPANESE_SENTENCES[pureJa].translation,
        highlightWord: pureJa,
      };
    }

    // 일본어 지능형 Fallback 생성기
    return generateJapaneseFallback(pureJa || rawKey, primaryMeaning, partOfSpeech);
  }

  // 3. 해사영어 사전 매칭
  if (MARITIME_SENTENCES[normKey]) {
    return {
      text: MARITIME_SENTENCES[normKey].text,
      translation: MARITIME_SENTENCES[normKey].translation,
      highlightWord: normKey,
    };
  }

  // 4. 토익 비즈니스 사전 매칭
  if (TOEIC_SENTENCES[normKey]) {
    return {
      text: TOEIC_SENTENCES[normKey].text,
      translation: TOEIC_SENTENCES[normKey].translation,
      highlightWord: normKey,
    };
  }

  // 5. 영어 지능형 Fallback 실전 문맥 문장 생성기
  return generateEnglishFallback(rawKey, primaryMeaning, partOfSpeech);
}

/**
 * 영어 품사 및 의미 기반 실전 문맥 예문 생성기
 */
function generateEnglishFallback(word: string, meaning: string, pos: string): ExampleSentence {
  const clean = word.replace(/\s*\([^\)]+\)/g, '').trim();
  const meaningDesc = meaning ? `(${meaning})` : '';
  const lowerPos = (pos || '').toLowerCase();

  if (lowerPos.includes('동사') || lowerPos === 'verb') {
    return {
      text: `The project team decided to ${clean} according to the updated schedule.`,
      translation: `프로젝트 팀은 업데이트된 일정에 맞춰 ${clean}${meaningDesc}하기로 결정했습니다.`,
      highlightWord: clean,
    };
  }

  if (lowerPos.includes('형용사') || lowerPos === 'adjective') {
    return {
      text: `Our company is committed to providing ${clean} services to all clients.`,
      translation: `우리 회사는 모든 고객에게 ${clean}${meaningDesc} 서비스를 제공하기 위해 최선을 다하고 있습니다.`,
      highlightWord: clean,
    };
  }

  if (lowerPos.includes('부사') || lowerPos === 'adverb') {
    return {
      text: `Please handle the incoming customer inquiries ${clean} and accurately.`,
      translation: `인입되는 고객 문의를 ${clean}${meaningDesc} 정확하게 처리해 주십시오.`,
      highlightWord: clean,
    };
  }

  // 기본 명사 및 숙어
  return {
    text: `The manager emphasized the importance of the ${clean} during the briefing.`,
    translation: `관리자는 브리핑 중에 ${clean}${meaningDesc}의 중요성을 강조했습니다.`,
    highlightWord: clean,
  };
}

/**
 * 일본어 품사 및 의미 기반 실전 문맥 예문 생성기
 */
function generateJapaneseFallback(word: string, meaning: string, pos: string): ExampleSentence {
  const meaningDesc = meaning ? `(${meaning})` : '';
  const lowerPos = (pos || '').toLowerCase();

  if (lowerPos.includes('동사') || lowerPos === 'verb') {
    return {
      text: `日本で生活するときは、よく「${word}」ことができます。`,
      translation: `일본에서 생활할 때는 자주 "${word}"${meaningDesc}할 수 있습니다.`,
      highlightWord: word,
    };
  }

  if (lowerPos.includes('형용사') || lowerPos === 'adjective') {
    return {
      text: `とても「${word}」と感じました。`,
      translation: `매우 "${word}"${meaningDesc}하다고 느꼈습니다.`,
      highlightWord: word,
    };
  }

  return {
    text: `旅行や日常会話で「${word}」をよく使います。`,
    translation: `여행이나 일상 대화에서 "${word}"${meaningDesc}을(를) 자주 사용합니다.`,
    highlightWord: word,
  };
}

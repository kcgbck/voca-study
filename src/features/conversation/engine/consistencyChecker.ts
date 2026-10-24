// src/features/conversation/engine/consistencyChecker.ts
// 상황 고정 사실(Facts) 일관성 검사기 (상황 왜곡 및 불필요한 재질문 방지)

export interface ConsistencyCheckResult {
  consistent: boolean;
  violatedFactKey?: string;
  reasonKo?: string;
}

/**
 * AI 응답이나 대화 흐름이 기선언된 고정 사실(scenario.facts)과 모순되는지 검사
 * 예: 이미 2 iced americanos가 주문 사실에 등록되어 있는데 AI가 "Hot or iced?" 또는 "How many?"를 재질문하는 경우 차단
 */
export function checkSituationConsistency(
  tutorResponseText: string,
  userUtterance: string,
  scenarioFacts: Record<string, string>,
  recentTurns: Array<{ speaker: 'tutor' | 'user'; text: string }> = []
): ConsistencyCheckResult {
  const tutorLower = (tutorResponseText || '').toLowerCase();
  const userLower = (userUtterance || '').toLowerCase();
  const allHistory = recentTurns.map((t) => t.text.toLowerCase()).join(' ');

  // 1. 온도(temperature / iced / hot) 재질문 방지
  if (
    scenarioFacts.temperature === 'iced' ||
    userLower.includes('iced') ||
    allHistory.includes('iced')
  ) {
    if (
      tutorLower.includes('hot or iced') ||
      tutorLower.includes('iced or hot') ||
      tutorLower.includes('would you like that hot')
    ) {
      return {
        consistent: false,
        violatedFactKey: 'temperature',
        reasonKo: '학습자가 이미 아이스(iced)로 주문했으므로 핫/아이스 여부를 다시 물어볼 수 없습니다.',
      };
    }
  }

  // 2. 수량(quantity / two / three) 재질문 방지
  if (
    scenarioFacts.quantity === '2' ||
    userLower.includes('two') ||
    allHistory.includes('two iced')
  ) {
    if (
      tutorLower.includes('how many cups') ||
      tutorLower.includes('how many would you like')
    ) {
      return {
        consistent: false,
        violatedFactKey: 'quantity',
        reasonKo: '학습자가 이미 2잔(two)임을 명시했으므로 수량을 다시 질문할 수 없습니다.',
      };
    }
  }

  // 3. 목적지(destination) 사실 왜곡 방지
  if (scenarioFacts.destination) {
    const dest = scenarioFacts.destination.toLowerCase().trim();

    // 튜터 발화에서의 목적지 왜곡 검사
    const tutorMatch = tutorLower.match(/(?:flight|train|bus|ticket|welcome|heading|going|trip)\s+to\s+([a-z]+)/i);
    if (tutorMatch) {
      const mentionedCity = tutorMatch[1].toLowerCase().trim();
      if (mentionedCity !== dest && !dest.includes(mentionedCity)) {
        return {
          consistent: false,
          violatedFactKey: 'destination',
          reasonKo: `고정 목적지는 ${scenarioFacts.destination}이나 다른 목적지(${tutorMatch[1]})로 왜곡되었습니다.`,
        };
      }
    }

    // 사용자 발화에서의 목적지 왜곡 검사
    const userMatch = userLower.match(/(?:flight|train|bus|ticket|going|trip)\s+to\s+([a-z]+)/i);
    if (userMatch) {
      const userCity = userMatch[1].toLowerCase().trim();
      if (userCity !== dest && !dest.includes(userCity)) {
        return {
          consistent: false,
          violatedFactKey: 'destination',
          reasonKo: `고정 목적지는 ${scenarioFacts.destination}이나 다른 목적지(${userMatch[1]})를 발화했습니다.`,
        };
      }
    }
  }

  return { consistent: true };
}

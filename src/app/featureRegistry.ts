// src/app/featureRegistry.ts
// 보카 스터디 모듈형 기능 등록소 (새 모듈 추가 시 한 곳에서 등록, App.tsx 리라이트 방지)

import React from 'react';
import { CoachTutorView } from '../features/conversation/components/CoachTutorView';

export interface ModularFeature {
  id: string;
  tabKey: string;
  menuTitle: string;
  menuIcon: string;
  menuSubtitle: string;
  badge?: string;
  cardClassName?: string;
  cardStyle?: React.CSSProperties;
  isVisible: () => boolean;
  Component: React.ComponentType<{
    onBack: () => void;
    onOpenRanking?: () => void;
  }>;
}

/**
 * 신규 등록 모듈 목록 (7번째 홈 카드 AI 영어 회화 및 향후 확장 모듈)
 */
export const registeredFeatures: ModularFeature[] = [
  {
    id: 'ai_conversation',
    tabKey: 'ai_conversation',
    menuTitle: 'AI 영어 회화',
    menuIcon: '🗣️',
    menuSubtitle: '영어 질문 · 한국어 안내 · 말하기 반복 연습',
    badge: '초급 회화',
    cardClassName: 'menu-card',
    cardStyle: {
      borderLeft: '4px solid #10b981',
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.05))',
    },
    isVisible: () => true,
    Component: CoachTutorView,
  },
];

/**
 * 탭 키로 등록된 모듈 조회
 */
export function getRegisteredFeature(tabKey: string): ModularFeature | undefined {
  return registeredFeatures.find((f) => f.tabKey === tabKey);
}

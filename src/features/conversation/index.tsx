// src/features/conversation/index.ts
// 보카 스터디 AI 영어 회화 서브시스템 통합 진입점

import React, { useState, useEffect } from 'react';
import type { ConversationLevel } from './types';
import { ConversationHomeView } from './components/ConversationHomeView';
import { ConversationCurriculumView } from './components/ConversationCurriculumView';
import { ConversationLessonView } from './components/ConversationLessonView';
import { ConversationReviewView } from './components/ConversationReviewView';
import { ConversationSettingsModal } from './components/ConversationSettingsModal';
import { HandsFreeSpeechCheck } from './components/HandsFreeSpeechCheck';
import './conversation.css';

export type ConversationSubView = 'home' | 'curriculum' | 'lesson' | 'review';

export interface ConversationFeatureProps {
  onBack: () => void;
  onOpenRanking?: () => void;
}

const STORAGE_VIEW_KEY = 'voca_conversation_current_view';

export const ConversationFeatureMain: React.FC<ConversationFeatureProps> = ({
  onBack,
}) => {
  const [subView, setSubView] = useState<ConversationSubView>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.subView) return parsed.subView;
      }
    } catch {
      // ignore
    }
    return 'home';
  });

  const [selectedLevel, setSelectedLevel] = useState<ConversationLevel>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.level) return parsed.level;
      }
    } catch {
      // ignore
    }
    return 'intro';
  });

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.lessonId) return parsed.lessonId;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sessionId) return parsed.sessionId;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showSpeechCheck, setShowSpeechCheck] = useState(false);

  // 뷰 상태 로컬 저장 (새로고침 복원 지원)
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_VIEW_KEY,
        JSON.stringify({
          subView,
          level: selectedLevel,
          lessonId: selectedLessonId,
          sessionId: selectedSessionId,
        })
      );
    } catch {
      // ignore
    }
  }, [subView, selectedLevel, selectedLessonId, selectedSessionId]);

  // 브라우저 뒤로가기(popstate) 연동
  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return;
      }
      const st = e.state;
      if (st && st.convSubView) {
        setSubView(st.convSubView);
        if (st.convLevel) setSelectedLevel(st.convLevel);
        if (st.convLessonId) setSelectedLessonId(st.convLessonId);
        if (st.convSessionId) setSelectedSessionId(st.convSessionId);
      } else if (subView !== 'home') {
        setSubView('home');
      }
    };

    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [isSettingsOpen, subView]);

  const navigateSubView = (
    view: ConversationSubView,
    level?: ConversationLevel,
    lessonId?: string,
    sessionId?: string,
    pushHistory = true
  ) => {
    if (level) setSelectedLevel(level);
    if (lessonId) setSelectedLessonId(lessonId);
    setSelectedSessionId(sessionId || null);
    setSubView(view);

    if (pushHistory) {
      window.history.pushState(
        {
          tab: 'ai_conversation',
          convSubView: view,
          convLevel: level || selectedLevel,
          convLessonId: lessonId || selectedLessonId,
          convSessionId: sessionId || null,
        },
        '',
        window.location.pathname
      );
    }
  };

  // 음성 연결 확인 (S25 실기기 Web Speech API 단독 검증)
  if (showSpeechCheck) {
    return <HandsFreeSpeechCheck onBack={() => setShowSpeechCheck(false)} />;
  }

  // 1. 회화 홈 화면
  if (subView === 'home') {
    return (
      <>
        <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="conv-btn conv-btn-secondary conv-touch-target"
            onClick={() => setShowSpeechCheck(true)}
            style={{ width: '100%', maxWidth: '640px', minHeight: '44px', fontWeight: 700 }}
          >
            🎙️ 음성 연결 확인
          </button>
        </div>
        <ConversationHomeView
          onSelectLevel={(lvl) => navigateSubView('curriculum', lvl)}
          onResumeSession={(lId) => navigateSubView('lesson', undefined, lId)}
          onOpenReview={() => navigateSubView('review')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onBackToAppHome={onBack}
        />
        <ConversationSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </>
    );
  }

  // 2. 커리큘럼 단원 및 차시 목록 화면
  if (subView === 'curriculum') {
    return (
      <>
        <ConversationCurriculumView
          initialLevel={selectedLevel}
          onSelectLesson={(lId) => navigateSubView('lesson', undefined, lId)}
          onBackToConvHome={() => navigateSubView('home')}
        />
        <ConversationSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </>
    );
  }

  // 3. 개별 수업 진행 화면 (소개/표현/연습/역할극/전이과제/결과)
  if (subView === 'lesson' && selectedLessonId) {
    return (
      <>
        <ConversationLessonView
          lessonId={selectedLessonId}
          initialSessionId={selectedSessionId || undefined}
          onOpenReview={() => navigateSubView('review')}
          onBackToCurriculum={() => navigateSubView('curriculum', selectedLevel)}
          onBackToConvHome={() => navigateSubView('home')}
        />
        <ConversationSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </>
    );
  }

  // 4. 오늘의 간격 복습 화면
  if (subView === 'review') {
    return (
      <>
        <ConversationReviewView onBackToConvHome={() => navigateSubView('home')} />
        <ConversationSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </>
    );
  }

  return (
    <ConversationHomeView
      onSelectLevel={(lvl) => navigateSubView('curriculum', lvl)}
      onResumeSession={(lId) => navigateSubView('lesson', undefined, lId)}
      onOpenReview={() => navigateSubView('review')}
      onOpenSettings={() => setIsSettingsOpen(true)}
      onBackToAppHome={onBack}
    />
  );
};

export default ConversationFeatureMain;

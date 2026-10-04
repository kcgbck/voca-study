import React, { useState, useEffect } from 'react';
import { QuizPreviewView } from './components/QuizPreviewView';
import { CustomVocabularyUnifiedView } from './components/CustomVocabularyUnifiedView';
import { GeneralQuizImportView } from './components/GeneralQuizImportView';
import { GeneralQuizPlayerView } from './components/GeneralQuizPlayerView';
import { RankingView } from './components/RankingView';
import { SettingsModal, ThemeMode } from './components/SettingsModal';
import { AttendanceModal } from './components/AttendanceModal';
import { userService } from '../services/userService';
import type { WordEntry } from '../types/word';
import type { UserProfile } from '../types/user';
import './App.css';

type ActiveTab = 'home' | 'quiz' | 'custom_vocab' | 'general_import' | 'general_quiz' | 'ranking';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedQuestionBookId, setSelectedQuestionBookId] = useState<string | null>(null);
  const [customWords, setCustomWords] = useState<WordEntry[] | undefined>(undefined);
  const [customTitle, setCustomTitle] = useState<string | undefined>(undefined);
  const [customSourceType, setCustomSourceType] = useState<
    'builtin' | 'maritime' | 'japanese_exam' | 'japanese_life' | 'wrong_notes' | 'photo' | 'pdf'
  >('builtin');

  // 테마 상태 ('dark' | 'light' | 'system')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('voca_study_theme') as ThemeMode) || 'dark';
  });

  // 즉시 채점 설정 (기본: false - 실수 방지 모드)
  const [instantGrading, setInstantGrading] = useState<boolean>(() => {
    return localStorage.getItem('voca_study_instant_grading') === 'true';
  });

  // 문제 출제 순서 매번 랜덤 섞기 설정 (기본: true)
  const [shuffleOrder, setShuffleOrder] = useState<boolean>(() => {
    return localStorage.getItem('voca_study_shuffle_order') !== 'false';
  });

  // 설정 모달 열림 상태
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 출석체크 모달 열림 상태
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false);

  // 사용자 세션 프로필 상태
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  // PWA 업데이트 및 캐시 삭제 상태
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateToast, setUpdateToast] = useState<string | null>(null);

  useEffect(() => {
    userService.initSession().then(setCurrentUser).catch(console.error);
  }, []);

  // 테마 적용 이펙트
  useEffect(() => {
    const applyResolvedTheme = () => {
      let resolved = themeMode;
      if (themeMode === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolved);
    };

    applyResolvedTheme();
    localStorage.setItem('voca_study_theme', themeMode);

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyResolvedTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [themeMode]);

  // 스마트폰 물리/제스처 뒤로가기 키(popstate) 및 히스토리 연동
  useEffect(() => {
    // 최초 진입 시 홈 상태를 history에 기록
    if (!window.history.state) {
      window.history.replaceState({ tab: 'home' }, '', window.location.pathname);
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as {
        tab?: ActiveTab;
        quizSource?: 'builtin' | 'maritime' | 'japanese_exam' | 'japanese_life' | 'wrong_notes';
      } | null;
      if (state && state.tab) {
        if (state.quizSource) {
          setCustomSourceType(state.quizSource);
          setCustomWords(undefined);
          setCustomTitle(undefined);
        }
        setActiveTab(state.tab);
      } else {
        // 히스토리의 시작점이거나 상태가 없으면 메인 홈 대시보드로 이동
        setActiveTab('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 화면 전환 및 히스토리 푸시 헬퍼
  const navigateToTab = (
    tab: ActiveTab,
    pushHistory = true,
    quizSource?: 'builtin' | 'maritime' | 'japanese_exam' | 'japanese_life' | 'wrong_notes'
  ) => {
    if (quizSource) {
      setCustomSourceType(quizSource);
      setCustomWords(undefined);
      setCustomTitle(undefined);
    }
    if (tab === activeTab && (!quizSource || quizSource === customSourceType)) return;

    setActiveTab(tab);
    if (pushHistory) {
      window.history.pushState(
        { tab, quizSource: quizSource || (tab === 'quiz' ? customSourceType : undefined) },
        '',
        window.location.pathname
      );
    }
  };

  // 공통 뒤로가기 처리: 히스토리가 있으면 이전으로, 없으면 홈 대시보드로 복귀
  const handleGoBack = () => {
    if (window.history.state && window.history.state.tab !== 'home') {
      window.history.back();
    } else {
      navigateToTab('home', false);
    }
  };

  const handleInstantGradingChange = (enabled: boolean) => {
    setInstantGrading(enabled);
    localStorage.setItem('voca_study_instant_grading', enabled ? 'true' : 'false');
  };

  const handleShuffleOrderChange = (enabled: boolean) => {
    setShuffleOrder(enabled);
    localStorage.setItem('voca_study_shuffle_order', enabled ? 'true' : 'false');
  };

  // PWA 캐시 삭제 및 서비스 워커 강제 업데이트 후 새로고침
  const handleForceAppUpdate = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    setUpdateToast('오프라인 캐시 정리 및 최신 버전 확인 중...');

    try {
      // 1. Service Worker 캐시 스토리지 전체 삭제
      if ('caches' in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }

      // 2. 등록된 Service Worker 업데이트 및 메시지 전송
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          reg.active?.postMessage({ type: 'CLEAR_CACHE' });
          reg.active?.postMessage({ type: 'SKIP_WAITING' });
          await reg.update().catch(() => {});
        }
      }

      setUpdateToast('최신 버전 업데이트 완료! 화면을 새로고침합니다.');
      setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (err) {
      console.error('캐시 새로고침 오류:', err);
      window.location.reload();
    }
  };

  const handleStartQuizWithWords = (
    words: Array<{ word: string; meaning: string[] }>,
    title?: string,
    sourceType: 'photo' | 'pdf' = 'photo'
  ) => {
    const entries: WordEntry[] = words.map((w) => ({
      word: w.word,
      meaning: w.meaning,
      partOfSpeech: '단어',
      difficulty: 'medium',
      topic: 'custom',
    }));
    setCustomWords(entries);
    setCustomTitle(title || `추출 단어장 (${entries.length}단어)`);
    setCustomSourceType(sourceType);
    navigateToTab('quiz', true);
  };

  return (
    <div className="app-container">
      {/* 헤더: 1행(브랜드 좌측 + 🏆 랭킹, 🔄 새로고침, ⚙️ 설정 우측 끝 나란히 정렬) */}
      <header className="app-header">
        <div className="header-top-row">
          <div className="header-brand" onClick={() => navigateToTab('home')}>
            <span className="brand-icon">📖</span>
            <h1 className="brand-title">보카 스터디</h1>
          </div>
          <div className="header-actions">
            <button
              className="header-btn header-btn-ranking"
              onClick={() => navigateToTab('ranking')}
              title="실시간 랭킹"
            >
              <span>🏆</span>
              <span>랭킹</span>
            </button>
            <button
              className="header-btn header-btn-icon"
              onClick={handleForceAppUpdate}
              disabled={isUpdating}
              title="캐시 삭제 후 최신 버전 새로고침"
              aria-label="새로고침"
            >
              <span className={isUpdating ? 'spin-animation' : ''}>🔄</span>
            </button>
            <button
              className="header-btn header-btn-icon"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="설정"
              title="설정"
            >
              ⚙️
            </button>
          </div>
        </div>

        {/* 상단 4개 탭 1줄 그리드 네비게이션 (토익·해사영어 통합) */}
        <nav className="header-nav">
          <button
            className={`nav-btn ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => navigateToTab('home')}
          >
            홈
          </button>
          <button
            className={`nav-btn ${activeTab === 'quiz' ? 'active' : ''}`}
            onClick={() => navigateToTab('quiz', true, 'builtin')}
          >
            기본 문제
          </button>
          <button
            className={`nav-btn ${activeTab === 'general_import' || activeTab === 'general_quiz' ? 'active' : ''}`}
            onClick={() => navigateToTab('general_import')}
          >
            문제집
          </button>
          <button
            className={`nav-btn ${activeTab === 'custom_vocab' ? 'active' : ''}`}
            onClick={() => navigateToTab('custom_vocab')}
          >
            영단어
          </button>
        </nav>
      </header>

      {/* 본문 콘텐츠 */}
      <main className="app-main">
        {activeTab === 'home' && (
          <div className="home-dashboard">
            {/* 상단 모바일 핏 내 학습 랭킹 요약 배너 */}
            <div
              onClick={() => navigateToTab('ranking')}
              style={{
                background: 'linear-gradient(135deg, #3730a3, #581c87)',
                borderRadius: '14px',
                padding: '12px 14px',
                color: '#ffffff',
                cursor: 'pointer',
                marginBottom: '12px',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '14px' }}>🏆</span>
                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#c7d2fe' }}>
                    {currentUser?.nickname || '학습자'}
                  </span>
                  <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.2)', padding: '1px 5px', borderRadius: '4px' }}>
                    #{currentUser?.deviceCode?.split('-').pop() || 'ID'}
                  </span>
                  <span style={{ fontSize: '10px', background: 'rgba(245, 158, 11, 0.3)', color: '#fef3c7', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                    🔥 {currentUser?.attendanceStreak || 0}일 연속
                  </span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: '900', color: '#fde047' }}>
                  {currentUser?.totalScore || 0}점
                  <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#e0e7ff', marginLeft: '6px' }}>
                    (맞춤 {currentUser?.correctCount || 0} / 틀림 {currentUser?.incorrectCount || 0})
                  </span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '10px', color: '#c7d2fe', display: 'block' }}>전체 랭킹</span>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#ffffff' }}>
                  확인하기 →
                </span>
              </div>
            </div>

            {/* 홈 핵심 메뉴 그리드 (이모지와 제목을 동일 크기 한 줄로 배치) */}
            <div className="action-menu-grid">
              {/* 1번째: TOEIC 문제풀이 */}
              <button className="menu-card primary" onClick={() => navigateToTab('quiz', true, 'builtin')}>
                <div className="menu-header-line">
                  <span className="menu-icon">📝</span>
                  <span className="menu-title">TOEIC(1800단어) 문제풀이</span>
                </div>
                <span className="menu-sub">검증된 빈출 어휘 4지선다 실전 문제학습</span>
              </button>

              {/* 2번째: 해사영어 문제풀이 */}
              <button className="menu-card maritime" onClick={() => navigateToTab('quiz', true, 'maritime')}>
                <div className="menu-header-line">
                  <span className="menu-icon">⚓</span>
                  <span className="menu-title">해사영어(451단어) 문제풀이</span>
                </div>
                <span className="menu-sub">SMCP · 해기사 3·4급 · 국제협약(COLREGs/SOLAS/MARPOL)</span>
              </button>

              {/* 3번째: 일본어 단어 문제집 (시험용 vs 생활일본어) */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #ef4444' }}
                onClick={() => navigateToTab('quiz', true, 'japanese_exam')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">🇯🇵</span>
                  <span className="menu-title">일본어 단어 문제집 (321단어)</span>
                </div>
                <span className="menu-sub">시험용(JLPT N5~N3) · 완전 생활일본어(여행·실전) 2탭</span>
              </button>

              {/* 4번째: 출석체크 캘린더 & 연속 출석 */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #f59e0b' }}
                onClick={() => setIsAttendanceOpen(true)}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📅</span>
                  <span className="menu-title">출석체크 캘린더 (연속 {currentUser?.attendanceStreak || 0}일 🔥)</span>
                </div>
                <span className="menu-sub">매일 출석 도장 찍고 연속 출석 랭킹 도전!</span>
              </button>

              {/* 5번째: 틀린 문제 모음집 (오답노트) */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #f97316' }}
                onClick={() => navigateToTab('quiz', true, 'wrong_notes')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📝</span>
                  <span className="menu-title">틀린 문제 모음집 (오답노트)</span>
                </div>
                <span className="menu-sub">틀렸던 단어만 모아서 집중 복습 및 4지선다 다시 풀기</span>
              </button>

              {/* 6번째: 내가 만드는 문제집 */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #8b5cf6' }}
                onClick={() => navigateToTab('general_import')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📚</span>
                  <span className="menu-title">내가 만드는 문제집</span>
                </div>
                <span className="menu-sub">사진·스캔·PDF로 4/5지선다 제작 및 풀이</span>
              </button>

              {/* 7번째: 내가 만드는 영단어 문제집 */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #06b6d4' }}
                onClick={() => navigateToTab('custom_vocab')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">🔤</span>
                  <span className="menu-title">내가 만드는 영단어 문제집</span>
                </div>
                <span className="menu-sub">사진·스캔·PDF로 영단어 제작 및 풀이</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ranking' && (
          <RankingView
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'quiz' && (
          <QuizPreviewView
            key={customSourceType + (customTitle || '')}
            initialWords={customWords}
            bookTitle={customTitle}
            sourceType={customSourceType}
            instantGrading={instantGrading}
            shuffleOrder={shuffleOrder}
            onOpenRanking={() => navigateToTab('ranking')}
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'custom_vocab' && (
          <CustomVocabularyUnifiedView
            onStartQuizWithWords={(words, title, sourceType) =>
              handleStartQuizWithWords(words, title, sourceType)
            }
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'general_import' && (
          <GeneralQuizImportView
            onBackToHome={handleGoBack}
            onStartQuiz={(bookId) => {
              setSelectedQuestionBookId(bookId);
              navigateToTab('general_quiz');
            }}
          />
        )}

        {activeTab === 'general_quiz' && selectedQuestionBookId && (
          <GeneralQuizPlayerView
            bookId={selectedQuestionBookId}
            onBackToHome={handleGoBack}
            onOpenRanking={() => navigateToTab('ranking')}
          />
        )}
      </main>

      {/* 설정 모달 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        instantGrading={instantGrading}
        onInstantGradingChange={handleInstantGradingChange}
        shuffleOrder={shuffleOrder}
        onShuffleOrderChange={handleShuffleOrderChange}
        onOpenRanking={() => {
          setIsSettingsOpen(false);
          navigateToTab('ranking');
        }}
      />

      {/* 출석체크 캘린더 모달 */}
      <AttendanceModal
        isOpen={isAttendanceOpen}
        onClose={() => {
          setIsAttendanceOpen(false);
          const p = userService.getProfile();
          if (p) setCurrentUser({ ...p });
        }}
        onOpenRanking={() => {
          setIsAttendanceOpen(false);
          navigateToTab('ranking');
        }}
      />

      {/* 업데이트 토스트 알림 */}
      {updateToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e1b4b',
            color: '#ffffff',
            border: '1px solid #6366f1',
            borderRadius: '12px',
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 'bold',
            zIndex: 9999,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="spin-animation">🔄</span>
          <span>{updateToast}</span>
        </div>
      )}
    </div>
  );
};

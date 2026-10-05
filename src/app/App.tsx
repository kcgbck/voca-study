import React, { useState, useEffect } from 'react';
import { QuizPreviewView } from './components/QuizPreviewView';
import { CustomMakerUnifiedView } from './components/CustomMakerUnifiedView';
import { GeneralQuizPlayerView } from './components/GeneralQuizPlayerView';
import { RankingView } from './components/RankingView';
import { SettingsModal, ThemeMode } from './components/SettingsModal';
import { AttendanceModal } from './components/AttendanceModal';
import { userService } from '../services/userService';
import type { WordEntry } from '../types/word';
import type { UserProfile } from '../types/user';
import './App.css';

type ActiveTab = 'home' | 'quiz_en' | 'quiz_ja' | 'custom_maker' | 'general_quiz' | 'ranking';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedQuestionBookId, setSelectedQuestionBookId] = useState<string | null>(null);
  const [customWords, setCustomWords] = useState<WordEntry[] | undefined>(undefined);
  const [customTitle, setCustomTitle] = useState<string | undefined>(undefined);
  const [customSourceType, setCustomSourceType] = useState<
    'builtin' | 'maritime' | 'maritime_comm' | 'japanese_exam' | 'japanese_life' | 'wrong_notes' | 'photo' | 'pdf'
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

  // 스마트폰 물리/제스처 뒤로가기 키(popstate) 및 계층형 히스토리 연동
  useEffect(() => {
    // 최초 진입 시 루트 홈 상태를 history에 기록
    if (!window.history.state || !window.history.state.tab) {
      window.history.replaceState({ tab: 'home' }, '', window.location.pathname);
    }

    const handlePopState = (event: PopStateEvent) => {
      // 1. 모달이 열려있다면 모달 닫기 우선 처리
      if (isAttendanceOpen || isSettingsOpen) {
        setIsAttendanceOpen(false);
        setIsSettingsOpen(false);
        return;
      }

      const state = event.state as {
        tab?: ActiveTab;
        quizSource?: 'builtin' | 'maritime' | 'maritime_comm' | 'japanese_exam' | 'japanese_life' | 'wrong_notes';
        modal?: string;
      } | null;

      if (state && state.tab) {
        if (state.quizSource) {
          setCustomSourceType(state.quizSource);
          setCustomWords(undefined);
          setCustomTitle(undefined);
        }
        setActiveTab(state.tab);
      } else {
        // 히스토리의 시작점이거나 상태가 없으면 메인 홈 대시보드로 복귀
        setActiveTab('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAttendanceOpen, isSettingsOpen]);

  // 화면 전환 및 히스토리 푸시 헬퍼 (계층형 내비게이션: 홈 = Level 0, 하위 탭 = Level 1)
  const navigateToTab = (
    tab: ActiveTab,
    pushHistory = true,
    quizSource?: 'builtin' | 'maritime' | 'maritime_comm' | 'japanese_exam' | 'japanese_life' | 'wrong_notes'
  ) => {
    if (quizSource) {
      setCustomSourceType(quizSource);
      setCustomWords(undefined);
      setCustomTitle(undefined);
    }
    if (tab === activeTab && (!quizSource || quizSource === customSourceType)) return;

    setActiveTab(tab);

    if (pushHistory) {
      const targetState = {
        tab,
        quizSource: quizSource || ((tab === 'quiz_en' || tab === 'quiz_ja') ? customSourceType : undefined),
      };

      if (tab === 'home') {
        // 홈으로 복귀 시: 히스토리 스택을 비우고 루트 홈으로 replace
        window.history.replaceState({ tab: 'home' }, '', window.location.pathname);
      } else if (activeTab === 'home') {
        // 홈에서 하위 화면으로 진입할 때만 1회 pushState
        window.history.pushState(targetState, '', window.location.pathname);
      } else {
        // 이미 하위 화면에 있는 상태에서 다른 하위 화면으로 전환할 때는 히스토리를 누적하지 않고 replaceState
        window.history.replaceState(targetState, '', window.location.pathname);
      }
    }
  };

  // 출석체크 모달 열기/닫기 (히스토리 연동)
  const openAttendanceModal = () => {
    setIsAttendanceOpen(true);
    window.history.pushState({ modal: 'attendance', tab: activeTab }, '', window.location.pathname);
  };

  const closeAttendanceModal = () => {
    setIsAttendanceOpen(false);
    if (window.history.state?.modal === 'attendance') {
      window.history.back();
    }
  };

  // 설정 모달 열기/닫기 (히스토리 연동)
  const openSettingsModal = () => {
    setIsSettingsOpen(true);
    window.history.pushState({ modal: 'settings', tab: activeTab }, '', window.location.pathname);
  };

  const closeSettingsModal = () => {
    setIsSettingsOpen(false);
    if (window.history.state?.modal === 'settings') {
      window.history.back();
    }
  };

  // 공통 뒤로가기 처리: 직전 상위 메뉴(홈)로 즉시 이동
  const handleGoBack = () => {
    if (isAttendanceOpen || isSettingsOpen) {
      setIsAttendanceOpen(false);
      setIsSettingsOpen(false);
      return;
    }
    if (activeTab !== 'home') {
      navigateToTab('home');
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
    navigateToTab('quiz_en', true);
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
              onClick={openSettingsModal}
              aria-label="설정"
              title="설정"
            >
              ⚙️
            </button>
          </div>
        </div>

        {/* 상단 3대 메인 탭 그리드 네비게이션: 홈 / 영어 / 일본어 */}
        <nav className="header-nav" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          <button
            className={`nav-btn ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => navigateToTab('home')}
          >
            🏠 홈
          </button>
          <button
            className={`nav-btn ${activeTab === 'quiz_en' ? 'active' : ''}`}
            onClick={() => navigateToTab('quiz_en', true, 'builtin')}
          >
            🔤 영어
          </button>
          <button
            className={`nav-btn ${activeTab === 'quiz_ja' ? 'active' : ''}`}
            onClick={() => navigateToTab('quiz_ja', true, 'japanese_exam')}
          >
            🇯🇵 일본어
          </button>
        </nav>
      </header>

      {/* 본문 콘텐츠 */}
      <main className="app-main">
        {activeTab === 'home' && (
          <div className="home-dashboard">
            {/* 1. 홈 최상단: 내 학습 랭킹 요약 배너 */}
            <div
              onClick={() => navigateToTab('ranking')}
              style={{
                background: 'linear-gradient(135deg, #3730a3, #581c87)',
                borderRadius: '14px',
                padding: '12px 14px',
                color: '#ffffff',
                cursor: 'pointer',
                marginBottom: '10px',
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

            {/* 2. 랭킹 바로 아래: 1줄 슬림 출석체크 버튼 */}
            <button
              className="menu-card"
              style={{
                borderLeft: '4px solid #f59e0b',
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.1))',
                marginBottom: '12px',
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onClick={openAttendanceModal}
            >
              <div className="menu-header-line" style={{ margin: 0 }}>
                <span className="menu-icon" style={{ fontSize: '18px' }}>📅</span>
                <span className="menu-title" style={{ color: '#fbbf24', fontSize: '15px' }}>
                  출석체크 (연속 {currentUser?.attendanceStreak || 0}일 출석 중 🔥)
                </span>
              </div>
              <span style={{ color: '#fde68a', fontSize: '12px', fontWeight: 'bold' }}>출석하기 →</span>
            </button>

            {/* 홈 핵심 메뉴 그리드 (이모지와 제목을 동일 크기 한 줄로 배치) */}
            <div className="action-menu-grid">
              {/* 1번째: TOEIC 문제풀이 */}
              <button className="menu-card primary" onClick={() => navigateToTab('quiz_en', true, 'builtin')}>
                <div className="menu-header-line">
                  <span className="menu-icon">📝</span>
                  <span className="menu-title">TOEIC(1800단어) 문제풀이</span>
                </div>
                <span className="menu-sub">검증된 빈출 어휘 4지선다 실전 문제학습</span>
              </button>

              {/* 2번째: 해사영어 문제풀이 */}
              <button className="menu-card maritime" onClick={() => navigateToTab('quiz_en', true, 'maritime')}>
                <div className="menu-header-line">
                  <span className="menu-icon">⚓</span>
                  <span className="menu-title">해사영어 문제풀이</span>
                </div>
                <span className="menu-sub">SMCP · 해기사 3·4급 · 국제협약(COLREGs/SOLAS/MARPOL)</span>
              </button>

              {/* 3번째: 실전 해사 통신 문장 퀴즈 */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #38bdf8' }}
                onClick={() => navigateToTab('quiz_en', true, 'maritime_comm')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📻</span>
                  <span className="menu-title">실전 해사 통신 문장</span>
                </div>
                <span className="menu-sub">VHF 무선통신 · VTS 관제 · 조난/긴급/도선/조타 지령 4지선다</span>
              </button>

              {/* 4번째: 일본어 단어 문제집 (시험용 vs 생활일본어) */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #ef4444' }}
                onClick={() => navigateToTab('quiz_ja', true, 'japanese_exam')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">🇯🇵</span>
                  <span className="menu-title">일본어 단어 문제집 (437단어)</span>
                </div>
                <span className="menu-sub">시험용(JLPT N5~N3) · 완전 생활일본어(여행·실전) 2탭</span>
              </button>

              {/* 5번째: 내가 만드는 문제집 (커스텀 통합 메뉴) */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #8b5cf6' }}
                onClick={() => navigateToTab('custom_maker')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📚</span>
                  <span className="menu-title">내가 만드는 문제집 (4·5지선다 & 영단어)</span>
                </div>
                <span className="menu-sub">사진·스캔·PDF로 4/5지선다 문제집 및 영단어장 제작</span>
              </button>

              {/* 6번째: 틀린 문제 모음집 (오답노트) */}
              <button
                className="menu-card"
                style={{ borderLeft: '4px solid #f97316' }}
                onClick={() => navigateToTab('quiz_en', true, 'wrong_notes')}
              >
                <div className="menu-header-line">
                  <span className="menu-icon">📝</span>
                  <span className="menu-title">틀린 문제 모음집 (오답노트)</span>
                </div>
                <span className="menu-sub">틀렸던 단어만 모아서 집중 복습 및 4지선다 다시 풀기</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ranking' && (
          <RankingView
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'quiz_en' && (
          <QuizPreviewView
            key={'en_' + customSourceType + (customTitle || '')}
            initialWords={customWords}
            bookTitle={customTitle}
            sourceType={customSourceType}
            languageMode="en"
            instantGrading={instantGrading}
            shuffleOrder={shuffleOrder}
            onOpenRanking={() => navigateToTab('ranking')}
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'quiz_ja' && (
          <QuizPreviewView
            key={'ja_' + (customSourceType === 'builtin' ? 'japanese_exam' : customSourceType) + (customTitle || '')}
            initialWords={customWords}
            bookTitle={customTitle}
            sourceType={customSourceType === 'builtin' ? 'japanese_exam' : customSourceType}
            languageMode="ja"
            instantGrading={instantGrading}
            shuffleOrder={shuffleOrder}
            onOpenRanking={() => navigateToTab('ranking')}
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'custom_maker' && (
          <CustomMakerUnifiedView
            onBackToHome={handleGoBack}
            onStartGeneralQuiz={(bookId) => {
              setSelectedQuestionBookId(bookId);
              navigateToTab('general_quiz');
            }}
            onStartVocabQuiz={(words, title, sourceType) =>
              handleStartQuizWithWords(words, title, sourceType)
            }
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
        onClose={closeSettingsModal}
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        instantGrading={instantGrading}
        onInstantGradingChange={handleInstantGradingChange}
        shuffleOrder={shuffleOrder}
        onShuffleOrderChange={handleShuffleOrderChange}
        onOpenRanking={() => {
          closeSettingsModal();
          navigateToTab('ranking');
        }}
      />

      {/* 출석체크 캘린더 모달 */}
      <AttendanceModal
        isOpen={isAttendanceOpen}
        onClose={() => {
          closeAttendanceModal();
          const p = userService.getProfile();
          if (p) setCurrentUser({ ...p });
        }}
        onOpenRanking={() => {
          closeAttendanceModal();
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

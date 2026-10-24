// src/features/conversation/components/ConversationHomeView.tsx
// AI 회화 홈 대시보드 (요약 배너, 이어하기, 복습 큐, 4단계 레벨 선택, 안전 안내)

import React, { useState, useEffect } from 'react';
import type { ConversationLevel, ConversationSession, ConversationReviewItem } from '../types';
import { storageService } from '../services/storageService';
import { getLessonById } from '../content/lessons';

interface ConversationHomeViewProps {
  onSelectLevel: (level: ConversationLevel) => void;
  onResumeSession: (lessonId: string) => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
  onBackToAppHome: () => void;
}

export const ConversationHomeView: React.FC<ConversationHomeViewProps> = ({
  onSelectLevel,
  onResumeSession,
  onOpenReview,
  onOpenSettings,
  onBackToAppHome,
}) => {
  const [completedCount, setCompletedCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [dueReviews, setDueReviews] = useState<ConversationReviewItem[]>([]);
  const [activeSession, setActiveSession] = useState<ConversationSession | undefined>(undefined);
  const [activeLessonTitle, setActiveLessonTitle] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    Promise.all([
      storageService.getAllProgress(),
      storageService.getDueReviewItems(),
      storageService.getLatestActiveSession(),
    ]).then(([progressList, dueList, session]) => {
      if (!mounted) return;
      const completed = progressList.filter((p) => p.status === 'completed');
      setCompletedCount(completed.length);

      const allMasteredObjSet = new Set<string>();
      progressList.forEach((p) => {
        p.masteredObjectiveIds?.forEach((id) => allMasteredObjSet.add(id));
      });
      setMasteredCount(allMasteredObjSet.size);

      setDueReviews(dueList);
      setActiveSession(session);

      if (session) {
        const lesson = getLessonById(session.lessonId);
        if (lesson) {
          setActiveLessonTitle(lesson.titleKo);
        }
      }
    }).catch(console.error);

    return () => {
      mounted = false;
    };
  }, []);

  const levelConfigs: Array<{
    level: ConversationLevel;
    titleKo: string;
    cefr: string;
    desc: string;
    availableLessons: number;
    totalLessons: number;
  }> = [
    {
      level: 'intro',
      titleKo: '입문 (Intro)',
      cefr: 'Pre-A1 ~ A1',
      desc: '기본 인사, 자기소개, 숫자, 일상 기초 표현부터 짧은 질의응답까지',
      availableLessons: 8,
      totalLessons: 32,
    },
    {
      level: 'beginner',
      titleKo: '초급 (Beginner)',
      cefr: 'A1 ~ A2',
      desc: '카페 주문, 쇼핑, 길 찾기, 예약 등 해외 여행 및 생활 생존 회화',
      availableLessons: 8,
      totalLessons: 32,
    },
    {
      level: 'intermediate',
      titleKo: '중급 (Intermediate)',
      cefr: 'B1 ~ B2',
      desc: '의견 표현, 이유 설명, 문제 해결, 경험 공유 등 문장 단위 의사소통',
      availableLessons: 8,
      totalLessons: 32,
    },
    {
      level: 'advanced',
      titleKo: '고급 (Advanced)',
      cefr: 'C1 ~ C2',
      desc: '비즈니스 미팅, 협상, 세부 조건 조율, 공손한 요청 등 고난도 담화',
      availableLessons: 8,
      totalLessons: 32,
    },
  ];

  return (
    <div className="conv-container">
      {/* 1. 상단 타이틀 바 */}
      <div className="conv-top-bar">
        <button
          type="button"
          className="conv-back-btn conv-touch-target"
          onClick={onBackToAppHome}
          aria-label="보카 스터디 메인 홈으로 돌아가기"
        >
          ← 보카 홈
        </button>
        <h2>🗣️ AI 영어 회화</h2>
        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{ padding: '8px 12px', fontSize: '13px', minHeight: '44px', minWidth: '44px' }}
          onClick={onOpenSettings}
          aria-label="회화 설정"
          title="회화 설정"
        >
          ⚙️ 설정
        </button>
      </div>

      {/* 2. 대시보드 진도 및 통계 요약 배너 */}
      <div className="conv-summary-banner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#c7d2fe', fontWeight: 600 }}>총 128차시 체계적 커리큘럼</span>
            <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '2px' }}>
              128목차 (32차시 초안 검수 대기 · 96차시 준비 중)
            </div>
          </div>
          <span style={{ fontSize: '24px' }}>🎯</span>
        </div>

        <div className="conv-stats-row">
          <div>
            <div className="conv-stat-value">{completedCount} / 32</div>
            <div className="conv-stat-label">규칙 통과 차시</div>
          </div>
          <div>
            <div className="conv-stat-value">{masteredCount}</div>
            <div className="conv-stat-label">마스터한 목표</div>
          </div>
          <div>
            <div className="conv-stat-value" style={{ color: dueReviews.length > 0 ? '#f87171' : '#34d399' }}>
              {dueReviews.length}
            </div>
            <div className="conv-stat-label">오늘 복습 대기</div>
          </div>
        </div>
      </div>

      {/* 3. 오늘의 복습 바로가기 (복습 대기 아이템이 있는 경우 최우선 배치) */}
      {dueReviews.length > 0 && (
        <button
          type="button"
          className="conv-btn conv-btn-primary conv-touch-target"
          style={{
            width: '100%',
            marginBottom: '12px',
            background: 'linear-gradient(135deg, #b91c1c, #dc2626)',
            boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)',
            justifyContent: 'space-between',
            padding: '14px 16px',
          }}
          onClick={onOpenReview}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🔔</span>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>
              오늘의 간격 복습 ({dueReviews.length}개 표현 대기)
            </span>
          </div>
          <span style={{ fontSize: '13px' }}>복습하기 →</span>
        </button>
      )}

      {/* 4. 이어하기 배너 (진행 중인 세션이 있는 경우) */}
      {activeSession && (
        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{
            width: '100%',
            marginBottom: '16px',
            border: '1px solid var(--conv-accent)',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'rgba(99, 102, 241, 0.1)',
          }}
          onClick={() => onResumeSession(activeSession.lessonId)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
            <span style={{ fontSize: '18px' }}>▶️</span>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--conv-accent)', fontWeight: 700 }}>
                이어서 학습하기 ({activeSession.level.toUpperCase()} - {activeSession.phase})
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--conv-text-primary)' }}>
                {activeLessonTitle || activeSession.lessonId}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '13px', color: 'var(--conv-accent)', fontWeight: 700 }}>계속하기 →</span>
        </button>
      )}

      {/* 5. 안전 모드 안내 카드 */}
      <div className="conv-notice-card">
        <span style={{ fontSize: '18px' }}>🛡️</span>
        <div>
          <strong>안전한 오프라인 고정 교재 모드 기본 동작</strong>
          <p style={{ margin: '4px 0 0 0', lineHeight: 1.4 }}>
            텍스트 입력 기본 지원. 음성 입력/출력은 브라우저·마이크 권한·동의·서버 설정 환경이 필요합니다. 외부 종량제 API 과금 없이 내장된 정밀 교육 규칙 엔진으로 동작하며, 사용자 사진·PDF·개인 단어장 등은 외부로 절대 전송되지 않습니다. (CEFR 등급은 공인 인증이 아닌 콘텐츠 참고 난도입니다)
          </p>
        </div>
      </div>

      {/* 6. 4단계 레벨 선택 카드 그리드 */}
      <div style={{ marginBottom: '10px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--conv-text-primary)' }}>
          📚 난이도별 회화 커리큘럼 선택
        </h3>
      </div>

      <div className="conv-level-grid">
        {levelConfigs.map((cfg) => (
          <button
            key={cfg.level}
            type="button"
            className="conv-level-card conv-touch-target"
            onClick={() => onSelectLevel(cfg.level)}
            aria-label={`${cfg.titleKo} 커리큘럼 열기`}
          >
            <div>
              <div className="conv-level-header">
                <span className="conv-level-title">{cfg.titleKo}</span>
                <span className="conv-level-cefr">{cfg.cefr}</span>
              </div>
              <div className="conv-level-desc">{cfg.desc}</div>
            </div>

            <div className="conv-level-meta">
              <span style={{ color: 'var(--conv-success)', fontWeight: 700 }}>
                ✓ {cfg.availableLessons}차시 즉시 학습
              </span>
              <span>(총 {cfg.totalLessons}차시)</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

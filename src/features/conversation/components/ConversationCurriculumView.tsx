// src/features/conversation/components/ConversationCurriculumView.tsx
// 4개 레벨 x 8개 단원 x 4개 차시 (128목차 중 32차시 검수대기, 96차시 준비중 차단)

import React, { useState, useEffect } from 'react';
import type { ConversationLevel, LessonProgress, ManifestLessonItem } from '../types';
import { CURRICULUM_MANIFEST } from '../content/manifest';
import { storageService } from '../services/storageService';

interface ConversationCurriculumViewProps {
  initialLevel?: ConversationLevel;
  onSelectLesson: (lessonId: string) => void;
  onBackToConvHome: () => void;
}

export const ConversationCurriculumView: React.FC<ConversationCurriculumViewProps> = ({
  initialLevel = 'intro',
  onSelectLesson,
  onBackToConvHome,
}) => {
  const [currentLevel, setCurrentLevel] = useState<ConversationLevel>(initialLevel);
  const [progressMap, setProgressMap] = useState<Map<string, LessonProgress>>(new Map());
  const [preparingNotice, setPreparingNotice] = useState<string | null>(null);

  useEffect(() => {
    storageService.getAllProgress().then((list) => {
      const map = new Map<string, LessonProgress>();
      list.forEach((p) => map.set(p.lessonId, p));
      setProgressMap(map);
    });
  }, []);

  const levelTabs: Array<{ level: ConversationLevel; label: string }> = [
    { level: 'intro', label: '🌱 입문' },
    { level: 'beginner', label: '🌿 초급' },
    { level: 'intermediate', label: '🌳 중급' },
    { level: 'advanced', label: '💎 고급' },
  ];

  const levelData = CURRICULUM_MANIFEST.levels[currentLevel];

  const getLessonTypeLabel = (type: ManifestLessonItem['lessonType']): string => {
    switch (type) {
      case 'comprehension':
        return '이해';
      case 'controlled_practice':
        return '패턴 연습';
      case 'roleplay':
        return '실전 역할극';
      case 'transfer_assessment':
        return '전이 과제';
      default:
        return '수업';
    }
  };

  const handleLessonClick = (lesson: ManifestLessonItem) => {
    if (lesson.status === 'PREPARING') {
      setPreparingNotice(`[준비 중] "${lesson.titleKo}" 차시는 현재 커리큘럼 개발 중입니다. 1~2단원 8차시를 먼저 학습해주세요.`);
      setTimeout(() => setPreparingNotice(null), 3500);
      return;
    }
    onSelectLesson(lesson.id);
  };

  return (
    <div className="conv-container">
      {/* 1. 상단 네비게이션 */}
      <div className="conv-top-bar">
        <button
          type="button"
          className="conv-back-btn conv-touch-target"
          onClick={onBackToConvHome}
          aria-label="회화 홈으로 돌아가기"
        >
          ← 회화 홈
        </button>
        <h2>{levelData.titleKo} ({levelData.cefrReference})</h2>
        <span style={{ fontSize: '12px', color: 'var(--conv-text-muted)' }}>총 32차시</span>
      </div>

      {/* 2. 레벨 탭 바 */}
      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px',
          marginBottom: '16px',
        }}
        aria-label="회화 난이도 레벨 선택"
      >
        {levelTabs.map((tab) => (
          <button
            key={tab.level}
            type="button"
            className={`conv-btn ${currentLevel === tab.level ? 'conv-btn-primary' : 'conv-btn-secondary'} conv-touch-target`}
            style={{ padding: '8px 4px', fontSize: '13px' }}
            onClick={() => setCurrentLevel(tab.level)}
            aria-selected={currentLevel === tab.level}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* 준비 중 알림 토스트 */}
      {preparingNotice && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            background: 'var(--conv-warning-bg)',
            border: '1px solid var(--conv-warning)',
            color: 'var(--conv-text-primary)',
            padding: '10px 14px',
            borderRadius: '10px',
            marginBottom: '14px',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          🔒 {preparingNotice}
        </div>
      )}

      {/* 3. 단원별 카드 (1~8단원) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {levelData.units.map((unit) => {
          const isPreparingUnit = unit.unitNumber > 2;

          return (
            <section key={unit.unitNumber} className="conv-unit-card" aria-labelledby={`unit-heading-${unit.unitNumber}`}>
              <div className="conv-unit-header">
                <div>
                  <span id={`unit-heading-${unit.unitNumber}`} className="conv-unit-title">
                    {`${unit.unitNumber}단원: ${unit.unitTitleKo}`}
                  </span>
                </div>
                <div>
                  {isPreparingUnit ? (
                    <span className="conv-badge conv-badge-preparing">🔒 준비 중</span>
                  ) : (
                    <span className="conv-badge conv-badge-review-pending">초안 검수 대기</span>
                  )}
                </div>
              </div>

              <div className="conv-lesson-list">
                {unit.lessons.map((lesson) => {
                  const progress = progressMap.get(lesson.id);
                  const isCompleted = progress?.status === 'completed';
                  const isPreparing = lesson.status === 'PREPARING';

                  return (
                    <button
                      key={lesson.id}
                      type="button"
                      className="conv-lesson-item conv-touch-target"
                      disabled={isPreparing}
                      onClick={() => handleLessonClick(lesson)}
                      aria-label={`${lesson.lessonNumber}과 ${lesson.titleKo} ${isPreparing ? '(준비 중, 진입 불가)' : ''}`}
                    >
                      <div className="conv-lesson-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--conv-accent)' }}>
                            {lesson.lessonNumber}과
                          </span>
                          <span className="conv-lesson-name">
                            {lesson.titleKo}
                          </span>
                        </div>

                        <div className="conv-badge-group">
                          <span className="conv-badge conv-badge-type">
                            {getLessonTypeLabel(lesson.lessonType)}
                          </span>

                          {isPreparing ? (
                            <span className="conv-badge conv-badge-preparing">🔒 준비 중</span>
                          ) : (
                            <span className="conv-badge conv-badge-review-pending">초안 검수 대기</span>
                          )}

                          {isCompleted && (
                            <span className="conv-badge conv-badge-mastered">
                              ✓ 완료
                            </span>
                          )}

                          {progress && (progress.masteredObjectiveIds?.length || 0) > 0 && (
                            <span className="conv-badge conv-badge-mastered">
                              🌟 {progress.masteredObjectiveIds.length}개 마스터
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: '16px', color: isPreparing ? 'var(--conv-text-muted)' : 'var(--conv-accent)' }}>
                        {isPreparing ? '🔒' : '→'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

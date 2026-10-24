// src/features/conversation/components/ConversationResultView.tsx
// 수업 완료 결과 화면 (progress 검증값 우선, AI 공인 점수/랭킹 가산 없음, 복습 안내, 44px 터치 규격)

import React from 'react';
import type { LessonContent, ConversationSession, LessonProgress } from '../types';

interface ConversationResultViewProps {
  onRestart?: () => void;
  lesson: LessonContent;
  session: ConversationSession;
  progress?: LessonProgress;
  onOpenReview: () => void;
  onBackToCurriculum: () => void;
  onBackToConvHome: () => void;
}

export const ConversationResultView: React.FC<ConversationResultViewProps> = ({
  onRestart,
  lesson,
  session,
  progress,
  onOpenReview,
  onBackToCurriculum,
  onBackToConvHome,
}) => {
  // DB 검증값 우선 (progress가 없으면 세션 내부 판단에만 의존하지 않고 보수적 평가)
  const masteredIds = new Set(progress?.masteredObjectiveIds || []);

  // progress가 없거나 저장 전인 경우 경고 표시
  const isProgressSaved = Boolean(progress);

  return (
    <div className="conv-container">
      {/* 1. 상단 바 */}
      <p>콘텐츠 초안 · 사람 검수 대기</p>
      {onRestart && <button type="button" className="conv-btn conv-btn-secondary" onClick={onRestart} style={{minHeight:44}}>다시 연습하기</button>}
      <div className="conv-top-bar">
        <h2>🎉 단계 진행 종료 (목표 검증 별도)</h2>
        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{ minHeight: '44px', minWidth: '44px', padding: '8px 14px', fontSize: '13px' }}
          onClick={onBackToCurriculum}
        >
          목록으로
        </button>
      </div>

      {/* 2. 완료 배너 */}
      <div
        className="conv-summary-banner"
        style={{
          background: 'linear-gradient(135deg, #065f46, #047857)',
          borderColor: '#10b981',
          marginBottom: '20px',
        }}
      >
        <div style={{ fontSize: '13px', color: '#a7f3d0', fontWeight: 600 }}>
          {lesson.level.toUpperCase()} 단원 {lesson.unitNumber} - {lesson.lessonNumber}과
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>
          {lesson.titleKo}
        </div>
        <div style={{ fontSize: '13px', color: '#d1fae5', marginTop: '6px' }}>
          수업의 전체 학습 단계(소개·표현·연습·역할극·전이과제) 진행이 종료되었습니다. 아래의 객관적 규칙 검증 성취도를 확인하세요.
        </div>
      </div>

      {!isProgressSaved && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: 'var(--conv-warning-bg)',
            border: '1px solid var(--conv-warning)',
            color: 'var(--conv-text-primary)',
            padding: '10px 14px',
            borderRadius: '10px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          ⚠️ 진도 저장 확인 중: 로컬 데이터베이스에 진도가 확정 기록된 후 최종 마스터가 반영됩니다.
        </div>
      )}

      {/* 3. 목표별 관찰 및 규칙 마스터 달성 평가 */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--conv-text-primary)' }}>
          🎯 학습 목표 달성 분석 (규칙 검증 기준)
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {lesson.learningObjectives.map((obj) => {
            const isMastered = masteredIds.has(obj.id);
            const obs = session.observedObjectives?.[obj.id];
            const noHintCount = obs?.evidences?.filter((e) => !e.usedHint).length || 0;

            return (
              <div
                key={obj.id}
                style={{
                  background: 'var(--conv-bg-card)',
                  border: `1px solid ${isMastered ? 'var(--conv-success)' : 'var(--conv-border)'}`,
                  borderRadius: '12px',
                  padding: '14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--conv-text-primary)' }}>
                      {obj.descriptionKo}
                    </span>
                    <div style={{ fontSize: '12px', color: 'var(--conv-text-secondary)', marginTop: '2px' }}>
                      패턴: <code style={{ color: 'var(--conv-accent)' }}>{obj.targetPatternEn}</code>
                    </div>
                  </div>

                  <div>
                    {isMastered ? (
                      <span className="conv-badge conv-badge-mastered" style={{ fontSize: '12px', padding: '4px 8px' }}>
                        🌟 마스터 달성
                      </span>
                    ) : (
                      <span className="conv-badge conv-badge-review-pending" style={{ fontSize: '12px', padding: '4px 8px' }}>
                        🔄 복습 권장
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--conv-text-muted)', marginTop: '8px', borderTop: '1px solid var(--conv-border)', paddingTop: '6px' }}>
                  {isMastered ? (
                    <span style={{ color: 'var(--conv-success)' }}>
                      ✓ 2개 이상의 서로 다른 상황에서 힌트 없이 성공적으로 발화했습니다.
                    </span>
                  ) : (
                    <span>
                      노힌트 발화 {noHintCount}회 (마스터 기준: 2개 이상 다른 상황에서 노힌트 발화 검증 필요. 에빙하우스 간격 복습으로 보강하세요.)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 점수 왜곡 배제 안내 및 복습 등록 알림 */}
      <div className="conv-notice-card" style={{ marginBottom: '20px' }}>
        <span style={{ fontSize: '18px' }}>ℹ️</span>
        <div>
          <strong>임의 AI 점수 및 랭킹 가산 배제 원칙</strong>
          <p style={{ margin: '4px 0 0 0', lineHeight: 1.4 }}>
            본 시스템은 부정확한 임의의 AI 환각 점수를 매기지 않으며, 기존 랭킹 점수에 임의 가산되지 않습니다. 취약 표현은 에빙하우스 간격 복습(1일→3일→7일→14일) 큐에 등록되었습니다.
          </p>
        </div>
      </div>

      {/* 5. 하단 액션 버튼 그룹 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          type="button"
          className="conv-btn conv-btn-primary conv-touch-target"
          style={{ width: '100%', minHeight: '44px', fontSize: '15px' }}
          onClick={onOpenReview}
        >
          🔔 오답·취약 표현 복습 큐 확인하기
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button
            type="button"
            className="conv-btn conv-btn-secondary conv-touch-target"
            style={{ minHeight: '44px' }}
            onClick={onBackToCurriculum}
          >
            목록으로
          </button>
          <button
            type="button"
            className="conv-btn conv-btn-secondary conv-touch-target"
            style={{ minHeight: '44px' }}
            onClick={onBackToConvHome}
          >
            회화 홈으로
          </button>
        </div>
      </div>
    </div>
  );
};

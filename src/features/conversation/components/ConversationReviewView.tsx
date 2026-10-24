// src/features/conversation/components/ConversationReviewView.tsx
// 에빙하우스 간격 복습 화면 (1/3/7/14일, 회상 입력 필수, 정답만 보고 누르는 버튼 꼼수 방지)

import React, { useState, useEffect } from 'react';
import type { ConversationReviewItem } from '../types';
import { storageService } from '../services/storageService';
import { MicRecorderButton } from './MicRecorderButton';
import { AudioPlayerButton } from './AudioPlayerButton';

interface ConversationReviewViewProps {
  onBackToConvHome: () => void;
}

export const ConversationReviewView: React.FC<ConversationReviewViewProps> = ({
  onBackToConvHome,
}) => {
  const [reviewItems, setReviewItems] = useState<ConversationReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [completedCount, setCompletedCount] = useState(0);

  useEffect(() => {
    loadDueItems();
  }, []);

  const loadDueItems = async () => {
    setIsLoading(true);
    try {
      const items = await storageService.getDueReviewItems();
      setReviewItems(items);
      setCurrentIndex(0);
      setUserInput('');
      setIsAnswerRevealed(false);
    } finally {
      setIsLoading(false);
    }
  };

  const currentItem = reviewItems[currentIndex];

  const handleReveal = () => {
    if (!userInput.trim()) {
      alert('표현을 먼저 타이핑하거나 음성으로 말한 뒤 정답을 확인해주세요.');
      return;
    }
    setIsAnswerRevealed(true);
  };

  const handleResult = async (success: boolean) => {
    if (!currentItem) return;

    try {
      await storageService.recordReviewResult(currentItem.id, success);
      setCompletedCount((prev) => prev + 1);

      if (currentIndex + 1 < reviewItems.length) {
        setCurrentIndex((prev) => prev + 1);
        setUserInput('');
        setIsAnswerRevealed(false);
      } else {
        // 모든 큐 소진
        loadDueItems();
      }
    } catch (err: any) {
      alert(`복습 결과 저장 실패: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="conv-container" style={{ textAlign: 'center', padding: '40px 14px' }}>
        <p style={{ color: 'var(--conv-text-secondary)' }}>복습 큐를 확인하는 중...</p>
      </div>
    );
  }

  // 복습할 항목이 없는 경우
  if (!currentItem || reviewItems.length === 0) {
    return (
      <div className="conv-container">
        <div className="conv-top-bar">
          <button
            type="button"
            className="conv-back-btn conv-touch-target"
            onClick={onBackToConvHome}
            aria-label="회화 홈으로 돌아가기"
          >
            ← 회화 홈
          </button>
          <h2>🔔 오늘의 복습</h2>
          <span />
        </div>

        <div
          className="conv-summary-banner"
          style={{
            textAlign: 'center',
            padding: '30px 20px',
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
          }}
        >
          <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>
            {completedCount > 0 ? '🎉' : '📅'}
          </span>
          <div style={{ fontSize: '18px', fontWeight: 800 }}>
            {completedCount > 0
              ? '오늘 예정된 간격 복습이 모두 완료되었습니다!'
              : '오늘 예정된 복습 항목이 없습니다.'}
          </div>
          <p style={{ fontSize: '13px', color: '#c7d2fe', marginTop: '8px', lineHeight: 1.4 }}>
            {completedCount > 0
              ? '에빙하우스 망각 곡선 주기에 맞춰(1일 → 3일 → 7일 → 14일) 다음 복습 일정이 되면 자동으로 대기열에 나타납니다.'
              : '새로운 차시를 학습하여 목표를 통과하면 에빙하우스 간격 복습 일정(1일 → 3일 → 7일 → 14일)이 자동으로 생성됩니다.'}
          </p>
          {completedCount > 0 && (
            <div style={{ marginTop: '14px', fontSize: '14px', color: '#fde047', fontWeight: 700 }}>
              오늘 완료한 복습 표현: {completedCount}개
            </div>
          )}
        </div>

        <button
          type="button"
          className="conv-btn conv-btn-primary conv-touch-target"
          style={{ width: '100%', marginTop: '16px' }}
          onClick={onBackToConvHome}
        >
          회화 홈으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="conv-container">
      {/* 1. 상단 바 */}
      <div className="conv-top-bar">
        <button
          type="button"
          className="conv-back-btn conv-touch-target"
          onClick={onBackToConvHome}
          aria-label="회화 홈으로 돌아가기"
        >
          ← 회화 홈
        </button>
        <h2>🔔 오늘의 간격 복습</h2>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--conv-accent)' }}>
          {currentIndex + 1} / {reviewItems.length}
        </span>
      </div>

      {/* 2. 복습 메타 카드 */}
      <div
        style={{
          background: 'var(--conv-bg-card)',
          border: '1px solid var(--conv-border)',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span className="conv-badge conv-badge-type">
            간격 {currentItem.intervalDays}일차 복습 (연속 {currentItem.consecutiveSuccessCount}회 성공)
          </span>
          <span style={{ fontSize: '11px', color: 'var(--conv-text-muted)' }}>
            차시: {currentItem.lessonId}
          </span>
        </div>

        {/* 상황/의미 제시 */}
        <div style={{ margin: '14px 0' }}>
          <span style={{ fontSize: '12px', color: 'var(--conv-text-muted)', fontWeight: 600 }}>
            한국어 상황 및 의미
          </span>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--conv-text-primary)', marginTop: '4px' }}>
            "{currentItem.meaningKo}"
          </div>
        </div>

        {/* 회상 입력창 */}
        <div style={{ marginTop: '16px' }}>
          <label
            htmlFor="review-input"
            style={{ fontSize: '12px', color: 'var(--conv-text-secondary)', display: 'block', marginBottom: '6px' }}
          >
            기억나는 영어 표현을 입력하거나 음성으로 말해보세요:
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              id="review-input"
              type="text"
              className="conv-text-input conv-touch-target"
              placeholder="영어 표현 입력..."
              value={userInput}
              disabled={isAnswerRevealed}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isAnswerRevealed) {
                  handleReveal();
                }
              }}
            />
            <MicRecorderButton
              onTranscribed={(txt) => setUserInput(txt)}
              disabled={isAnswerRevealed}
            />
          </div>
        </div>

        {/* 확인 / 정답 공개 버튼 (회상 입력 필수) */}
        {!isAnswerRevealed && (
          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            style={{ width: '100%', minHeight: '44px', marginTop: '16px' }}
            onClick={handleReveal}
          >
            정답 확인하기 →
          </button>
        )}

        {/* 정답 공개 영역 */}
        {isAnswerRevealed && (
          <div
            style={{
              marginTop: '20px',
              paddingTop: '16px',
              borderTop: '1px solid var(--conv-border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--conv-text-muted)', fontWeight: 600 }}>
                정답 모범 표현
              </span>
              <AudioPlayerButton text={currentItem.expressionEn} isKeyExpression={true} />
            </div>

            <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--conv-accent)', marginBottom: '14px' }}>
              {currentItem.expressionEn}
            </div>

            <div style={{ fontSize: '12px', color: 'var(--conv-text-secondary)', marginBottom: '16px' }}>
              내가 입력한 답변: <strong style={{ color: 'var(--conv-text-primary)' }}>{userInput || '(미입력)'}</strong>
            </div>

            {/* 정직한 피드백 선택 버튼 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                className="conv-btn conv-btn-secondary conv-touch-target"
                style={{ minHeight: '44px', borderColor: 'var(--conv-error)', color: 'var(--conv-error)' }}
                onClick={() => handleResult(false)}
              >
                헷갈림 (1일 후 다시)
              </button>
              <button
                type="button"
                className="conv-btn conv-btn-success conv-touch-target"
                style={{ minHeight: '44px' }}
                onClick={() => handleResult(true)}
              >
                기억남 (다음 간격으로)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

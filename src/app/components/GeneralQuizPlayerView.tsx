// 일반 객관식 문제 퀴즈 풀이 뷰어 (GEN-01 지시서 7, 9, 43, 47항 준수)
import React, { useState, useEffect, useRef } from 'react';
import {
  createGeneralQuizSession,
  type GeneralQuizQuestion,
} from '../../quiz/generalQuizEngine';
import { db } from '../../storage/db';
import { userService } from '../../services/userService';

interface Props {
  bookId: string;
  onBackToHome: () => void;
  onOpenRanking?: () => void;
}

export const GeneralQuizPlayerView: React.FC<Props> = ({ bookId, onBackToHome, onOpenRanking }) => {
  const [questions, setQuestions] = useState<GeneralQuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [bookTitle, setBookTitle] = useState<string>('일반 문제집');
  const [syncedScore, setSyncedScore] = useState<number | null>(null);
  const hasSyncedRef = useRef(false);

  // 문제 데이터 로드 및 세션 생성
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const book = await db.questionBooks.get(bookId);
        if (book) setBookTitle(book.title);

        const rawQuestions = await db.questions
          .where('bookId')
          .equals(bookId)
          .toArray();

        // 설정 읽기
        const randomSetting = await db.appSettings.get('quiz_random_order');
        const shuffleQuestions = randomSetting ? Boolean(randomSetting.value) : true;

        const session = createGeneralQuizSession(rawQuestions, {
          shuffleQuestions,
          shuffleChoices: true,
        });

        setQuestions(session);
      } catch (err) {
        console.error('문제 로드 실패:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [bookId]);

  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#93c5fd' }}>
        문제를 불러오는 중입니다...
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div style={{ padding: '30px', textAlign: 'center', color: '#f87171' }}>
        <p style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
          출제 가능한 문제가 없습니다.
        </p>
        <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '16px' }}>
          정답이 확인된 문항이 최소 1개 이상 필요합니다. 검토 화면에서 정답을 지정해 주세요.
        </p>
        <button
          onClick={onBackToHome}
          style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
        >
          홈으로 돌아가기
        </button>
      </div>
    );
  }

  const curQ = questions[currentIndex];

  const handleSelectChoice = (choiceId: string) => {
    if (isAnswered) return;
    setSelectedChoiceId(choiceId);
    setIsAnswered(true);

    const isCorrect = choiceId === curQ.correctChoiceId;
    if (isCorrect) {
      setCorrectCount((prev) => prev + 1);
    }

    // 학습 기록 비동기 저장
    db.questionStudyHistory.add({
      questionId: curQ.id,
      bookId,
      isCorrect,
      selectedChoiceId: choiceId,
      studiedAt: new Date().toISOString(),
    }).catch(console.error);
  };

  const handleNext = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedChoiceId(null);
      setIsAnswered(false);
    } else {
      setIsCompleted(true);
    }
  };

  // 완료 결과 화면
  useEffect(() => {
    if (isCompleted && questions.length > 0 && !hasSyncedRef.current) {
      hasSyncedRef.current = true;
      const wrongCount = questions.length - correctCount;
      const earned = Math.max(0, correctCount * 10 - wrongCount * 2);
      setSyncedScore(earned);
      const isJapanese = Boolean(
        (bookTitle && /[\u3040-\u309F\u30A0-\u30FF]/.test(bookTitle)) ||
        questions.some((q) => /[\u3040-\u309F\u30A0-\u30FF]/.test(q.stem))
      );
      userService.addQuizResult(correctCount, wrongCount, isJapanese ? 'ja' : 'en').catch(console.error);
    }
  }, [isCompleted, questions.length, correctCount, bookTitle, questions]);

  if (isCompleted) {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    const wrongCount = questions.length - correctCount;
    const earned = syncedScore !== null ? syncedScore : Math.max(0, correctCount * 10 - wrongCount * 2);

    return (
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px', textAlign: 'center' }}>
        <div style={{ background: '#1f2937', padding: '24px', borderRadius: '16px', border: '1px solid #374151' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#60a5fa', marginBottom: '8px' }}>
            🎉 퀴즈 완료!
          </h2>
          <p style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '16px' }}>{bookTitle}</p>

          {/* 랭킹 점수 반영 배너 */}
          <div style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '14px', padding: '14px', maxWidth: '320px', margin: '0 auto 16px' }}>
            <span style={{ fontSize: '12px', color: '#a5b4fc', display: 'block', fontWeight: 'bold' }}>🏆 랭킹 점수 반영</span>
            <span style={{ fontSize: '26px', fontWeight: '900', color: '#fbbf24', display: 'block', margin: '4px 0' }}>
              +{earned}점
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              (맞춤 +10점 / 틀림 -2점 적용)
            </span>
          </div>

          <div style={{ fontSize: '32px', fontWeight: '800', color: accuracy >= 80 ? '#34d399' : accuracy >= 60 ? '#fbbf24' : '#f87171', marginBottom: '8px' }}>
            정답률 {accuracy}%
          </div>
          <p style={{ fontSize: '15px', color: '#e5e7eb', marginBottom: '24px' }}>
            총 {questions.length}문제 중 <strong style={{ color: '#34d399' }}>{correctCount}문제</strong> 정답 (오답: {wrongCount}문제)
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setCurrentIndex(0);
                setSelectedChoiceId(null);
                setIsAnswered(false);
                setCorrectCount(0);
                setSyncedScore(null);
                hasSyncedRef.current = false;
                setIsCompleted(false);
              }}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
            >
              다시 풀기 🔄
            </button>
            {onOpenRanking && (
              <button
                type="button"
                onClick={onOpenRanking}
                style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
              >
                🏆 랭킹 확인
              </button>
            )}
            <button
              onClick={onBackToHome}
              style={{ background: '#374151', color: '#e5e7eb', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
            >
              홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '16px' }}>
      {/* 상단 프로그레스 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#93c5fd' }}>
          {currentIndex + 1} / {questions.length}
        </span>
        <span style={{ fontSize: '12px', color: '#10b981' }}>정답: {correctCount}</span>
      </div>

      <div style={{ height: '4px', background: '#374151', borderRadius: '2px', marginBottom: '16px', overflow: 'hidden' }}>
        <div style={{ width: `${((currentIndex + 1) / questions.length) * 100}%`, height: '100%', background: '#3b82f6', transition: 'width 0.3s' }} />
      </div>

      {/* 문제 카드 */}
      <div style={{ background: '#1f2937', padding: '20px', borderRadius: '14px', border: '1px solid #374151', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 'bold', marginBottom: '6px' }}>
          {curQ.originalQuestionNumber ? `[원본 ${curQ.originalQuestionNumber}번]` : `[문제 ${currentIndex + 1}]`}
        </div>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#f3f4f6', lineHeight: '1.6', marginBottom: '16px' }}>
          {curQ.stem}
        </h3>

        {/* 선택지 목록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {curQ.choices.map((c) => {
            const isSelected = selectedChoiceId === c.id;
            const isCorrect = isAnswered && c.id === curQ.correctChoiceId;
            const isWrong = isAnswered && isSelected && !isCorrect;

            let bgColor = '#111827';
            let borderColor = '#374151';
            let textColor = '#e5e7eb';

            if (isCorrect) {
              bgColor = 'rgba(16, 185, 129, 0.25)';
              borderColor = '#10b981';
              textColor = '#34d399';
            } else if (isWrong) {
              bgColor = 'rgba(239, 68, 68, 0.25)';
              borderColor = '#ef4444';
              textColor = '#f87171';
            } else if (isSelected) {
              bgColor = '#1e3a8a';
              borderColor = '#3b82f6';
            }

            return (
              <button
                key={c.id}
                onClick={() => handleSelectChoice(c.id)}
                disabled={isAnswered}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: bgColor,
                  border: `1px solid ${borderColor}`,
                  color: textColor,
                  textAlign: 'left',
                  cursor: isAnswered ? 'default' : 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ fontWeight: 'bold', minWidth: '24px', color: isCorrect ? '#34d399' : '#9ca3af' }}>
                  {c.displayLabel}
                </span>
                <span style={{ flexGrow: 1 }}>{c.text}</span>
                {isCorrect && <span style={{ fontWeight: 'bold', fontSize: '13px' }}>✓</span>}
                {isWrong && <span style={{ fontWeight: 'bold', fontSize: '13px' }}>✕</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 채점 피드백 및 다음 버튼 */}
      {isAnswered && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
            {selectedChoiceId === curQ.correctChoiceId ? (
              <span style={{ color: '#34d399' }}>정답입니다! 👏</span>
            ) : (
              <span style={{ color: '#f87171' }}>
                오답입니다. (정답: {curQ.choices[curQ.displayCorrectIndex].displayLabel})
              </span>
            )}
          </div>
          <button
            onClick={handleNext}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            {currentIndex + 1 < questions.length ? '다음 문제 →' : '결과 보기 →'}
          </button>
        </div>
      )}
    </div>
  );
};

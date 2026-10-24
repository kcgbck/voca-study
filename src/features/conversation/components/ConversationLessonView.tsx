// src/features/conversation/components/ConversationLessonView.tsx
// 6단계 학습 흐름 플레이어 (소개 -> 표현듣기 -> 목표별연습 -> 역할극 -> 전이과제 -> 결과)
// 세션 직렬화 저장 큐, 텍스트/전사/인덱스 즉각 반영, 교재 기반 투명 표기, 44px 터치 규격

import React, { useState, useEffect, useRef } from 'react';
import type {
  LessonContent,
  LessonPhase,
  ConversationSession,
  TurnEvaluationResult,
  ConversationSettings,
  LessonProgress,
} from '../types';
import { getLessonById } from '../content/lessons';
import { LessonStateMachine } from '../engine/lessonStateMachine';
import { evaluateUserUtterance } from '../engine/pedagogyEvaluator';
import { storageService } from '../services/storageService';
import { conversationApi } from '../services/conversationApi';
import { MicRecorderButton } from './MicRecorderButton';
import { AudioPlayerButton } from './AudioPlayerButton';
import { ConversationResultView } from './ConversationResultView';

interface ConversationLessonViewProps {
  lessonId: string;
  initialSessionId?: string;
  onOpenReview: () => void;
  onBackToCurriculum: () => void;
  onBackToConvHome: () => void;
}

export const ConversationLessonView: React.FC<ConversationLessonViewProps> = ({
  lessonId,
  initialSessionId,
  onOpenReview,
  onBackToCurriculum,
  onBackToConvHome,
}) => {
  const lesson: LessonContent | undefined = getLessonById(lessonId);

  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [session, setSession] = useState<ConversationSession | null>(null);
  const [phase, setPhase] = useState<LessonPhase>('intro');
  const [showTranslations, setShowTranslations] = useState(true);
  const [currentPracticeIndex, setCurrentPracticeIndex] = useState(0);

  // 입력 및 피드백 상태
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<TurnEvaluationResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [completedProgress, setCompletedProgress] = useState<LessonProgress | undefined>(undefined);
  const [settings, setSettings] = useState<ConversationSettings | undefined>(undefined);

  // 저장 직렬화 큐, Stale 방지 및 상태 머신 Ref
  const stateMachineRef = useRef<LessonStateMachine | null>(null);
  const currentLessonIdRef = useRef<string>(lessonId);
  const saveSequenceRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isLoadedRef = useRef<boolean>(false);
  const isUnmountedRef = useRef<boolean>(false);

  useEffect(() => {
    currentLessonIdRef.current = lessonId;
    setUserInput('');
  }, [lessonId]);

  // 언마운트 정리 (진행 중인 비동기 요청, 녹음, 발화 즉시 정지)
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      conversationApi.abortCurrentRequest();
    };
  }, []);

  // 세션 로드 및 복원 (sessionId 전달 시 해당 완료 세션 복원 지원)
  useEffect(() => {
    if (!lesson) {
      setIsLoadingSession(false);
      return;
    }

    let isCurrentEffect = true;
    setIsLoadingSession(true);
    isLoadedRef.current = false;

    Promise.all([
      initialSessionId
        ? storageService.getSessionById(initialSessionId)
        : storageService.getActiveSession(lesson.id),
      storageService.getLatestSessionByLessonId(lesson.id),
      storageService.getSettings(),
      storageService.getProgress(lesson.id),
    ])
      .then(([sessionFound, latestSess, appSettings, progressData]) => {
        if (!isCurrentEffect || isUnmountedRef.current) return;
        setSettings(appSettings);

        let activeSession: ConversationSession;

        if (sessionFound && sessionFound.lessonId === lesson.id) {
          if (sessionFound.contentRevision !== lesson.contentRevision) {
            activeSession = LessonStateMachine.createSession(lesson);
          } else {
            activeSession = sessionFound;
            if (activeSession.isCompleted) {
              setCompletedProgress(progressData);
            }
          }
        } else if (latestSess && latestSess.isCompleted && latestSess.contentRevision === lesson.contentRevision) {
          // 새로고침 시 이미 완료된 최근 세션 복원 (새 수업 intro로 임의 리셋 방지)
          activeSession = latestSess;
          setCompletedProgress(progressData);
        } else {
          activeSession = LessonStateMachine.createSession(lesson);
        }

        const machine = new LessonStateMachine(activeSession, lesson);
        stateMachineRef.current = machine;

        const currentSession = machine.getSession();
        setSession(currentSession);
        setPhase(currentSession.phase);
        setCurrentPracticeIndex(currentSession.currentTaskIndex || 0);
        if (currentSession.draftUtterance) {
          setUserInput(currentSession.draftUtterance);
        } else {
          setUserInput('');
        }

        isLoadedRef.current = true;
        setIsLoadingSession(false);
      })
      .catch((err) => {
        if (!isCurrentEffect || isUnmountedRef.current) return;
        setSaveError(`세션 로드 오류: ${err.message}`);
        setIsLoadingSession(false);
      });

    return () => {
      isCurrentEffect = false;
    };
  }, [lessonId, initialSessionId]);

  // 세션 직렬화 저장 큐 (언마운트되어도 저장은 완수하되 React setState만 skip)
  const enqueueSave = (sessionToSave: ConversationSession) => {
    if (!isLoadedRef.current) return;
    const sequence = ++saveSequenceRef.current;
    setSaveStatus('saving');
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      try {
        await storageService.saveSession(sessionToSave);
        if (!isUnmountedRef.current && sequence === saveSequenceRef.current) {
          setSaveError(null);
          setSaveStatus('saved');
        }
      } catch (err: any) {
        if (!isUnmountedRef.current && sequence === saveSequenceRef.current) {
          setSaveError(`진도 자동 저장 실패: ${err.message}`);
          setSaveStatus('error');
        }
      }
    });
  };

  // 사용자 입력 변경 시 machine + React + IDB 큐 즉시 동기화
  const handleInputChange = (val: string) => {
    setUserInput(val);
    if (stateMachineRef.current) {
      stateMachineRef.current.updateDraft(val);
      const updated = stateMachineRef.current.getSession();
      setSession(updated);
      enqueueSave(updated);
    }
  };

  // 연습 과제 인덱스 전환 시 machine + React + IDB 큐 즉시 동기화
  const handlePracticeIndexChange = async (newIndex: number) => {
    await saveQueueRef.current;
    setCurrentPracticeIndex(newIndex);
    if (stateMachineRef.current) {
      stateMachineRef.current.updateTaskIndex(newIndex);
      stateMachineRef.current.updateDraft('');
      const updated = stateMachineRef.current.getSession();
      setSession(updated);
      enqueueSave(updated);
    }
    setCurrentFeedback(null);
    setUserInput('');
  };

  // 단계(Phase) 전이 핸들러
  const handleAdvancePhase = async () => {
    if (!stateMachineRef.current || !lesson) return;
    await saveQueueRef.current;
    stateMachineRef.current.updateDraft('');
    const nextPhase = stateMachineRef.current.advancePhase();
    const updatedSession = stateMachineRef.current.getSession();

    setSession(updatedSession);
    setPhase(nextPhase);
    setCurrentFeedback(null);
    setUserInput('');

    if (nextPhase === 'result') {
      try {
        const completeResult = await storageService.completeSession(updatedSession, lesson);
        if (!isUnmountedRef.current) {
          setCompletedProgress(completeResult.progress);
        }
      } catch (err: any) {
        if (!isUnmountedRef.current) setSaveError(`수업 완료 저장 오류: ${err.message}`);
      }
    } else {
      enqueueSave(updatedSession);
    }
  };

  // 목록 뒤로가기 핸들러 (진행 중인 저장 큐 대기 후 안전 이동)
  const handleBackToCurriculum = async () => {
    await saveQueueRef.current;
    onBackToCurriculum();
  };

  // 힌트 요청 핸들러
  const handleRequestHint = () => {
    if (!stateMachineRef.current) return;
    stateMachineRef.current.requestHint();
    const updated = stateMachineRef.current.getSession();
    setSession(updated);
    enqueueSave(updated);
  };

  // 발화 평가 및 턴 기록
  const handleSubmitUtterance = async (
    _contextName: string,
    phaseContext: 'controlled_practice' | 'roleplay' | 'transfer_assessment'
  ) => {
    const textToSend = userInput.trim();
    if (!textToSend || isSubmitting || !stateMachineRef.current || !lesson) return;

    setIsSubmitting(true);
    setCurrentFeedback(null);
    setSaveError(null);
    setCloudNotice(null);

    try {
      let evaluationResult: TurnEvaluationResult;
      const targetObjId =
        phaseContext === 'controlled_practice'
          ? lesson.learningObjectives[currentPracticeIndex]?.id
          : undefined;

      const turnPhase: LessonPhase = phaseContext === 'controlled_practice' ? 'practice' : phaseContext;
      const phaseTurns = (session?.turns || []).filter(t => t.phase === turnPhase);
      // 클라우드 모드가 활성화되어 있다면 API 전송, 아니면 로컬 교육 규칙 엔진
      if (settings?.allowExternalFreeGeminiCalls) {
        try {
          const recentTurnsPayload = phaseTurns.slice(-6).map((t) => ({
            turnId: t.turnId,
            speaker: t.speaker,
            text: t.text,
            timestamp: t.timestamp,
          }));

          evaluationResult = await conversationApi.sendTurn(
            {
              lessonId: lesson.id,
              contentRevision: lesson.contentRevision,
              userSpokenText: textToSend,
              currentPhase: phase,
              currentTaskId: targetObjId,
              requestedHintLevel: session?.hintLevel,
              recentTurns: recentTurnsPayload,
            },
            settings.cloudConsent
          );
        } catch (apiErr: any) {
          // 클라우드 실패 시 사유를 명시적으로 표시하고 고정 교재 엔진으로 안전 폴백
          setCloudNotice(`[클라우드 API 연결 안내: ${apiErr.message}] 오프라인 고정 교재 규칙 엔진으로 자동 전환하여 평가를 진행했습니다.`);
          evaluationResult = evaluateUserUtterance(
            textToSend,
            lesson,
            phaseContext,
            session?.hintLevel || 0,
            phaseTurns,
            targetObjId
          );
        }
      } else {
        // 로컬 고정 교재 모드
        evaluationResult = evaluateUserUtterance(
          textToSend,
          lesson,
          phaseContext,
          session?.hintLevel || 0,
          phaseTurns,
          targetObjId
        );
      }

      // Stale 체크: 응답 수신 시점에 사용자가 이미 다른 수업으로 이동했으면 버림
      if (currentLessonIdRef.current !== lesson.id || isUnmountedRef.current || stateMachineRef.current.getSession().phase !== phase) {
        return;
      }

      // 상태 머신에 턴 기록
      const usedHint = (session?.hintLevel || 0) > 0;
const actualContext = phaseContext === 'transfer_assessment' ? `${lesson.id}:transfer:${lesson.transferTask.taskId}` : `${lesson.id}:scenario`;
      stateMachineRef.current.recordTurn(textToSend, evaluationResult, actualContext, usedHint, turnPhase);
      stateMachineRef.current.updateDraft('');

      const updated = stateMachineRef.current.getSession();
      setSession(updated);
      setCurrentFeedback(evaluationResult);
      setUserInput('');

      enqueueSave(updated);
    } catch (err: any) {
      if (!isUnmountedRef.current) {
        setSaveError(`평가 처리 중 오류 발생: ${err.message}`);
      }
    } finally {
      if (!isUnmountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  if (!lesson) {
    return (
      <div className="conv-container" style={{ textAlign: 'center', padding: '40px 14px' }}>
        <p style={{ color: 'var(--conv-error)' }}>수업 콘텐츠를 찾을 수 없습니다: {lessonId}</p>
        <button
          type="button"
          className="conv-btn conv-btn-primary conv-touch-target"
          style={{ minHeight: '44px' }}
          onClick={onBackToCurriculum}
        >
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  if (isLoadingSession) {
    return (
      <div className="conv-container" style={{ textAlign: 'center', padding: '40px 14px' }}>
        <p style={{ color: 'var(--conv-text-secondary)' }}>수업 세션을 불러오는 중...</p>
      </div>
    );
  }

  // Phase 6: 결과 화면
  if (phase === 'result' && session) {
    return (
      <ConversationResultView
        lesson={lesson}
        session={session}
        progress={completedProgress}
        onRestart={() => {
          const fresh = LessonStateMachine.createSession(lesson);
          stateMachineRef.current = new LessonStateMachine(fresh, lesson);
          setSession(fresh); setPhase('intro'); setCurrentPracticeIndex(0);
          setUserInput(''); setCurrentFeedback(null); setCompletedProgress(undefined);
          enqueueSave(fresh);
        }}
        onOpenReview={onOpenReview}
        onBackToCurriculum={onBackToCurriculum}
        onBackToConvHome={onBackToConvHome}
      />
    );
  }

  const phaseSteps: Array<{ key: LessonPhase; label: string }> = [
    { key: 'intro', label: '1. 소개' },
    { key: 'expressions', label: '2. 표현' },
    { key: 'practice', label: '3. 연습' },
    { key: 'roleplay', label: '4. 역할극' },
    { key: 'transfer_assessment', label: '5. 전이과제' },
    { key: 'result', label: '6. 결과' },
  ];

  return (
    <div className="conv-container">
      {/* 1. 상단 바 */}
      <div className="conv-top-bar">
        <button
          type="button"
          className="conv-back-btn conv-touch-target"
          style={{ minHeight: '44px' }}
          onClick={handleBackToCurriculum}
          aria-label="커리큘럼 목록으로 돌아가기"
        >
          ← 목록
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--conv-text-muted)' }}>
            {lesson.level.toUpperCase()} 단원 {lesson.unitNumber} - {lesson.lessonNumber}과
          </div>
          <h2 style={{ fontSize: '15px', margin: '2px 0' }}>{lesson.titleKo}</h2>
          <small>콘텐츠 초안 · 사람 검수 대기</small>
          <div style={{ minHeight: '16px' }}>
            {saveStatus === 'saving' && <span style={{ fontSize: '11px', color: 'var(--conv-text-muted)' }}>💾 저장 중...</span>}
            {saveStatus === 'saved' && <span style={{ fontSize: '11px', color: 'var(--conv-accent)', fontWeight: 600 }}>✓ 저장됨</span>}
            {saveStatus === 'error' && <span style={{ fontSize: '11px', color: 'var(--conv-error)', fontWeight: 600 }}>⚠️ 저장 실패</span>}
          </div>
        </div>
        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{ padding: '8px 12px', fontSize: '12px', minHeight: '44px' }}
          onClick={() => setShowTranslations((prev) => !prev)}
          title="한글 번역 보기/숨기기"
        >
          {showTranslations ? '번역 숨김' : '번역 보기'}
        </button>
      </div>

      {/* 브라우저 비동기 저장 특성 정직 안내 */}
      <div style={{ fontSize: '11px', color: 'var(--conv-text-muted)', marginBottom: '8px', lineHeight: 1.4, textAlign: 'center' }}>
        ※ 브라우저 강제 종료나 탭 닫기 시 웹 비동기 저장 특성상 직전 1~2초 내 입력 내용이 저장되지 않을 수 있습니다. 상단 &apos;✓ 저장됨&apos; 상태를 확인하세요.
      </div>

      {/* 2. 단계 스텝퍼 */}
      <div className="conv-phase-stepper" aria-label="수업 단계 진행도">
        {phaseSteps.map((step, idx) => {
          const isCurrent = phase === step.key;
          const isDone = phaseSteps.findIndex((s) => s.key === phase) > idx;

          return (
            <span
              key={step.key}
              className={`conv-phase-step ${isCurrent ? 'active' : ''} ${isDone ? 'done' : ''}`}
            >
              {isDone ? `✓ ${step.label.slice(3)}` : step.label}
            </span>
          );
        })}
      </div>

      {cloudNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: 'var(--conv-warning-bg)',
            border: '1px solid var(--conv-warning)',
            color: 'var(--conv-text-primary)',
            padding: '10px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            marginBottom: '10px',
            lineHeight: 1.4,
          }}
        >
          ℹ️ {cloudNotice}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            background: 'var(--conv-error-bg)',
            border: '1px solid var(--conv-error)',
            color: 'var(--conv-error)',
            padding: '10px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            marginBottom: '10px',
          }}
        >
          ⚠️ {saveError}
        </div>
      )}

      {/* Phase 1: 수업 소개 (Intro) */}
      {phase === 'intro' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="conv-notice-card">
            <span>ℹ️</span>
            <div>
              <strong>수업 진행 안내 (고정 교재 기반)</strong>
              <p style={{ margin: '4px 0 0 0', lineHeight: 1.4 }}>
                본 수업은 정형화된 교육 커리큘럼 대본을 기반으로 하며, AI 생성 대화로 위장하지 않습니다. 텍스트 타이핑과 음성 녹음 모두 100% 지원됩니다.
              </p>
            </div>
          </div>

          {/* 상황 및 역할 */}
          <div style={{ background: 'var(--conv-bg-card)', border: '1px solid var(--conv-border)', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ fontSize: '15px', margin: '0 0 10px 0', color: 'var(--conv-text-primary)' }}>
              📍 상황 설정 및 역할
            </h3>
            <div style={{ fontSize: '14px', lineHeight: 1.5, marginBottom: '10px' }}>
              <strong>상황:</strong> {lesson.scenario.settingKo}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
              <div style={{ background: 'var(--conv-bg-subtle)', padding: '8px 10px', borderRadius: '8px' }}>
                <span style={{ color: 'var(--conv-text-muted)', display: 'block', fontSize: '11px' }}>튜터 역할</span>
                <strong>{lesson.scenario.aiRoleKo}</strong>
              </div>
              <div style={{ background: 'var(--conv-bg-subtle)', padding: '8px 10px', borderRadius: '8px' }}>
                <span style={{ color: 'var(--conv-text-muted)', display: 'block', fontSize: '11px' }}>학습자 역할</span>
                <strong>{lesson.scenario.userRoleKo}</strong>
              </div>
            </div>
          </div>

          {/* 학습 목표 */}
          <div style={{ background: 'var(--conv-bg-card)', border: '1px solid var(--conv-border)', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ fontSize: '15px', margin: '0 0 10px 0', color: 'var(--conv-text-primary)' }}>
              🎯 이번 시간 학습 목표
            </h3>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.6 }}>
              {lesson.learningObjectives.map((obj) => (
                <li key={obj.id}>
                  <strong>{obj.descriptionKo}</strong> (패턴: <code>{obj.targetPatternEn}</code>)
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            style={{ width: '100%', minHeight: '44px', fontSize: '15px', marginTop: '10px' }}
            onClick={handleAdvancePhase}
          >
            핵심 표현 학습 시작하기 →
          </button>
        </div>
      )}

      {/* Phase 2: 핵심 표현 듣기 (Expressions) */}
      {phase === 'expressions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: 'var(--conv-text-secondary)' }}>
            이번 차시의 핵심 표현 {lesson.keyExpressions.length}개를 음성(0.8x / 1.0x / 1.2x)으로 듣고 소리 내어 따라 읽어보세요.
          </div>

          {lesson.keyExpressions.map((exp, idx) => (
            <div
              key={idx}
              style={{
                background: 'var(--conv-bg-card)',
                border: '1px solid var(--conv-border)',
                borderRadius: '12px',
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span className="conv-badge conv-badge-type">표현 {idx + 1}</span>
                <AudioPlayerButton text={exp.expressionEn} isKeyExpression={true} showSpeedSelector={true} />
              </div>

              <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--conv-text-primary)', marginBottom: '4px' }}>
                {exp.expressionEn}
              </div>

              {showTranslations && (
                <div style={{ fontSize: '13px', color: 'var(--conv-accent)', fontWeight: 600 }}>
                  {exp.meaningKo}
                </div>
              )}

              {exp.usageTipKo && (
                <div style={{ fontSize: '11px', color: 'var(--conv-text-muted)', marginTop: '6px' }}>
                  💡 팁: {exp.usageTipKo}
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            style={{ width: '100%', minHeight: '44px', fontSize: '15px', marginTop: '10px' }}
            onClick={handleAdvancePhase}
          >
            목표별 연습 단계로 이동하기 →
          </button>
        </div>
      )}

      {/* Phase 3: 목표별 제어 연습 (Practice) */}
      {phase === 'practice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {(() => {
            const currentObj = lesson.learningObjectives[currentPracticeIndex] || lesson.learningObjectives[0];

            return (
              <>
                <div style={{ background: 'var(--conv-bg-card)', border: '1px solid var(--conv-border)', borderRadius: '12px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span className="conv-badge conv-badge-type">
                      연습 과제 {currentPracticeIndex + 1} / {lesson.learningObjectives.length}
                    </span>
                    <button
                      type="button"
                      className="conv-btn conv-btn-secondary conv-touch-target"
                      style={{ padding: '6px 10px', fontSize: '12px', minHeight: '44px' }}
                      onClick={handleRequestHint}
                    >
                      💡 힌트 요청 ({(session?.hintLevel || 0)}/3)
                    </button>
                  </div>

                  <h3 style={{ fontSize: '15px', margin: '0 0 6px 0', color: 'var(--conv-text-primary)' }}>
                    {currentObj.descriptionKo}
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--conv-text-muted)' }}>
                    패턴: <code style={{ color: 'var(--conv-accent)' }}>{currentObj.targetPatternEn}</code>
                  </div>

                  {/* 힌트 표시 */}
                  {(session?.hintLevel || 0) > 0 && (
                    <div style={{ marginTop: '12px', padding: '10px', background: 'var(--conv-warning-bg)', borderRadius: '8px', fontSize: '12px' }}>
                      {(session?.hintLevel || 0) === 1 && <span>🔑 <strong>키워드 힌트:</strong> {lesson.hints.keywordHintKo}</span>}
                      {(session?.hintLevel || 0) === 2 && <span>📐 <strong>문장 틀:</strong> {lesson.hints.frameHintEn}</span>}
                      {(session?.hintLevel || 0) >= 3 && <span>🌟 <strong>모범 예문:</strong> {lesson.hints.modelSentenceEn}</span>}
                    </div>
                  )}
                </div>

                {/* 피드백 박스 */}
                {currentFeedback && (
                  <div
                    className={`conv-feedback-box ${
                      currentFeedback.evaluation === 'ACCEPT' || currentFeedback.evaluation === 'OPTIONAL_EXPANSION'
                        ? 'accept'
                        : currentFeedback.evaluation === 'ERROR_CORRECTION'
                        ? 'correction'
                        : 'uncertain'
                    }`}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                      {currentFeedback.evaluation === 'ACCEPT' && '✅ 훌륭합니다! 의도가 정확하게 전달되었습니다.'}
                      {currentFeedback.evaluation === 'OPTIONAL_EXPANSION' && '👍 자연스러운 답변입니다! (확장 표현 팁 제공)'}
                      {currentFeedback.evaluation === 'ERROR_CORRECTION' && '💬 스스로 고쳐보기 기회:'}
                      {currentFeedback.evaluation === 'TRANSCRIPT_UNCERTAIN' && '🎙️ 음성 인식 불확실 (감점 없음):'}
                      {currentFeedback.evaluation === 'OFF_TOPIC' && '🎯 수업 목표에 집중해볼까요?'}
                    </div>

                    <div>{currentFeedback.onePointFeedbackKo}</div>

                    {currentFeedback.selfCorrectionPromptKo && (
                      <div style={{ marginTop: '6px', color: 'var(--conv-warning)', fontWeight: 600 }}>
                        {currentFeedback.selfCorrectionPromptKo}
                      </div>
                    )}
                  </div>
                )}

                {/* 입력 바 */}
                <div className="conv-input-bar">
                  <div className="conv-input-row">
                    <input
                      type="text"
                      className="conv-text-input conv-touch-target"
                      placeholder="목표 표현을 영어로 입력해보세요..."
                      value={userInput}
                      disabled={isSubmitting}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSubmitUtterance(`practice-task-${currentPracticeIndex + 1}`, 'controlled_practice');
                        }
                      }}
                    />
                    <MicRecorderButton
                      onTranscribed={(txt) => handleInputChange(txt)}
                      disabled={isSubmitting}
                      settings={settings}
                    />
                    <button
                      type="button"
                      className="conv-btn conv-btn-primary conv-touch-target"
                      style={{ minHeight: '44px', minWidth: '64px' }}
                      disabled={isSubmitting || !userInput.trim()}
                      onClick={() => handleSubmitUtterance(`practice-task-${currentPracticeIndex + 1}`, 'controlled_practice')}
                    >
                      {isSubmitting ? '...' : '전송'}
                    </button>
                  </div>
                </div>

                {/* 다음 과제 또는 다음 단계 이동 버튼 */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  {currentPracticeIndex < lesson.learningObjectives.length - 1 ? (
                    <button
                      type="button"
                      className="conv-btn conv-btn-secondary conv-touch-target"
                      style={{ flex: 1, minHeight: '44px' }}
                      onClick={() => handlePracticeIndexChange(currentPracticeIndex + 1)}
                    >
                      다음 목표 과제로 넘어가기 →
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="conv-btn conv-btn-primary conv-touch-target"
                      style={{ flex: 1, minHeight: '44px' }}
                      onClick={handleAdvancePhase}
                    >
                      실전 역할극 단계로 이동하기 →
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Phase 4: 실전 역할극 (Roleplay) */}
      {phase === 'roleplay' && (() => {
        const roleplayTurns = (session?.turns || []).filter(
          (t) => t.phase === 'roleplay' || (!t.phase && t.turnId.includes('roleplay'))
        );

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="conv-notice-card">
            <span>🎭</span>
            <div>
              <strong>교재 기반 역할극 대화 (AI 생성 대화로 위장하지 않음)</strong>
              <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--conv-text-muted)' }}>
                상황: {lesson.scenario.settingKo} | 목표: {lesson.learningObjectives[0]?.descriptionKo} | 턴: {roleplayTurns.length} / {lesson.exampleDialogue.length}
              </div>
            </div>
          </div>

          {/* 대화 흐름 렌더링 */}
          <div className="conv-dialogue-flow" role="log" aria-live="polite">
            {/* 기본 튜터 최초 인사 / 대사 (역할극 턴이 0개일 때 교재 첫 대사로 시작) */}
            {roleplayTurns.length === 0 && lesson.exampleDialogue[0] && (
              <div className="conv-bubble-row tutor">
                <span className="conv-speaker-name">{lesson.scenario.aiRoleKo} (튜터 - 교재 대본)</span>
                <div className="conv-bubble">
                  {lesson.exampleDialogue[0].textEn}
                  {showTranslations && lesson.exampleDialogue[0].translationKo && (
                    <div style={{ fontSize: '12px', color: 'var(--conv-accent)', marginTop: '4px' }}>
                      {lesson.exampleDialogue[0].translationKo}
                    </div>
                  )}
                </div>
                <div className="conv-bubble-actions">
                  <AudioPlayerButton text={lesson.exampleDialogue[0].textEn} />
                </div>
              </div>
            )}

            {/* 기록된 역할극 전용 턴들 */}
            {roleplayTurns.map((t, idx) => (
              <div key={t.turnId || idx} className={`conv-bubble-row ${t.speaker}`}>
                <span className="conv-speaker-name">
                  {t.speaker === 'tutor' ? `${lesson.scenario.aiRoleKo} (튜터)` : '나 (학습자)'}
                </span>
                <div className="conv-bubble">
                  {t.text}
                </div>
                {t.speaker === 'tutor' && (
                  <div className="conv-bubble-actions">
                    <AudioPlayerButton text={t.text} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 피드백 박스 */}
          {currentFeedback && (
            <div
              className={`conv-feedback-box ${
                currentFeedback.evaluation === 'ACCEPT' || currentFeedback.evaluation === 'OPTIONAL_EXPANSION'
                  ? 'accept'
                  : currentFeedback.evaluation === 'ERROR_CORRECTION'
                  ? 'correction'
                  : 'uncertain'
              }`}
            >
              <div>{currentFeedback.onePointFeedbackKo}</div>
              {currentFeedback.selfCorrectionPromptKo && (
                <div style={{ marginTop: '4px', color: 'var(--conv-warning)' }}>
                  {currentFeedback.selfCorrectionPromptKo}
                </div>
              )}
            </div>
          )}

          {/* 입력창 */}
          <div className="conv-input-bar">
            <div className="conv-input-row">
              <input
                type="text"
                className="conv-text-input conv-touch-target"
                placeholder="튜터에게 영어로 답해보세요..."
                value={userInput}
                disabled={isSubmitting}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmitUtterance('roleplay-conversation', 'roleplay');
                  }
                }}
              />
              <MicRecorderButton
                onTranscribed={(txt) => handleInputChange(txt)}
                disabled={isSubmitting}
                settings={settings}
              />
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                style={{ minHeight: '44px', minWidth: '64px' }}
                disabled={isSubmitting || !userInput.trim()}
                onClick={() => handleSubmitUtterance('roleplay-conversation', 'roleplay')}
              >
                {isSubmitting ? '...' : '전송'}
              </button>
            </div>
          </div>

          {/* 역할극 완료 및 다음 전이 단계 이동 버튼 */}
          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            style={{ width: '100%', minHeight: '44px', marginTop: '10px' }}
            onClick={handleAdvancePhase}
          >
            새로운 상황 전이 과제 단계로 이동하기 →
          </button>
        </div>
        );
      })()}

      {/* Phase 5: 새로운 상황 전이 과제 (Transfer Assessment) */}
      {phase === 'transfer_assessment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ background: 'var(--conv-bg-card)', border: '1px solid var(--conv-accent)', borderRadius: '12px', padding: '16px' }}>
            <span className="conv-badge conv-badge-type" style={{ marginBottom: '8px' }}>
              새로운 상황 적용 과제
            </span>
            <h3 style={{ fontSize: '16px', margin: '6px 0 10px 0', color: 'var(--conv-text-primary)' }}>
              {lesson.transferTask.titleKo}
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.5, margin: 0, color: 'var(--conv-text-secondary)' }}>
              {lesson.transferTask.promptKo}
            </p>
            <p>새로운 이 상황에서 아래 목표를 각각 말해보세요. 같은 원래 상황의 연습·역할극 반복은 추가 상황으로 세지 않습니다.</p>
            <ul>{lesson.learningObjectives.map(objective => <li key={objective.id}>{objective.descriptionKo}</li>)}</ul>
          </div>

          {/* 피드백 박스 */}
          {currentFeedback && (
            <div
              className={`conv-feedback-box ${
                currentFeedback.evaluation === 'ACCEPT' || currentFeedback.evaluation === 'OPTIONAL_EXPANSION'
                  ? 'accept'
                  : currentFeedback.evaluation === 'ERROR_CORRECTION'
                  ? 'correction'
                  : 'uncertain'
              }`}
            >
              <div>{currentFeedback.onePointFeedbackKo}</div>
              {currentFeedback.selfCorrectionPromptKo && (
                <div style={{ marginTop: '4px', color: 'var(--conv-warning)' }}>
                  {currentFeedback.selfCorrectionPromptKo}
                </div>
              )}
            </div>
          )}

          {/* 입력창 */}
          <div className="conv-input-bar">
            <div className="conv-input-row">
              <input
                type="text"
                className="conv-text-input conv-touch-target"
                placeholder="새로운 상황에 맞게 영어로 답해보세요..."
                value={userInput}
                disabled={isSubmitting}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSubmitUtterance(lesson.transferTask.contextFactKey, 'transfer_assessment');
                  }
                }}
              />
              <MicRecorderButton
                onTranscribed={(txt) => handleInputChange(txt)}
                disabled={isSubmitting}
                settings={settings}
              />
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                style={{ minHeight: '44px', minWidth: '64px' }}
                disabled={isSubmitting || !userInput.trim()}
                onClick={() => handleSubmitUtterance(lesson.transferTask.contextFactKey, 'transfer_assessment')}
              >
                {isSubmitting ? '...' : '전송'}
              </button>
            </div>
          </div>

          <button
            type="button"
            className="conv-btn conv-btn-success conv-touch-target"
            style={{ width: '100%', minHeight: '44px', fontSize: '15px', marginTop: '10px' }}
            onClick={handleAdvancePhase}
          >
            수업 완료 및 최종 결과 확인하기 →
          </button>
        </div>
      )}
    </div>
  );
};

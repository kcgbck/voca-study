// src/features/conversation/components/CoachTutorView.tsx
// 공개 초급 AI 영어 회화 튜터 뷰 컴포넌트
// [원칙]
// 1. 초급(Beginner) 일상 질문 5종 명시. 기술적 id 노출 금지, 한글 헤딩(영어 질문) 적용.
// 2. 만 18세 이상 확인 1개 체크 필수. 미체크 시 시작/제출 불가하며, 저장된 경우 숨김 처리.
// 3. 브라우저 음성 처리 및 인식/제출된 영문 답변의 Google AI 직접 평가 전송 고지 표시.
// 4. 기존 4동의/내부시험/로그인/128목차 표시 금지.
// 5. 다음 질문 버튼 누르기 전 자동 재생 금지, 5개 완료 시 '오늘 연습을 마쳤어요'로 종료 (점수/수료 금지).
// 6. 음성 미지원 시 Chrome 권장 상시 표시. 텍스트 모드 전환 지원(동기 ref 설정 및 네이티브 pause).
// 7. 텍스트 모드에서는 매 제출마다 접히지 않고 입력창 유지, 음성/마이크 0회, 명시적 모드 표시.
// 8. 360px 모바일 가로 넘침 방지(flexWrap, minWidth 0, overflowWrap), 모든 버튼 최소 44px 터치 규격.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  COACH_POLICY_VERSION,
  COACH_QUESTIONS,
  type CoachInputContext,
} from '../coach/coachProtocol';
import {
  CoachTutorController,
  type CoachSnapshot,
} from '../coach/CoachTutorController';
import { PublicCoachApiClient } from '../coach/publicCoachApi';
import {
  BrowserSpeechInputService,
  type BrowserSpeechInputOptions,
  type BrowserSpeechTrace,
} from '../services/browserSpeechInput';
import { VoiceOutputService } from '../services/voiceOutput';
import {
  CoachDiagnosticStore,
  type CoachDiagnosticRecord,
} from '../coach/coachDiagnostics';
import { WhisperBenchmarkPanel } from './WhisperBenchmarkPanel';

export interface CoachTutorViewProps {
  onBack: () => void;
}

const STORAGE_ADULT_KEY = `coach_adult_confirmed_${COACH_POLICY_VERSION}`;

export const CoachTutorView: React.FC<CoachTutorViewProps> = ({ onBack }) => {
  // 성인 확인 상태
  const [adultConfirmed, setAdultConfirmed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(STORAGE_ADULT_KEY) === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });

  // 질문 인덱스 (0 ~ 4)
  const [questionIndex, setQuestionIndex] = useState(0);

  // 음성 지원 여부 (SSR 정적 초기 렌더링 시 false로 단정하지 않음)
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const [isTextMode, setIsTextMode] = useState<boolean>(false);

  // 텍스트 답하기 접기 상태 및 입력값
  const [showTextInput, setShowTextInput] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');

  // 코치 스냅샷 상태
  const [snapshot, setSnapshot] = useState<CoachSnapshot>({
    phase: 'ready',
    recognizedText: '',
    feedbackKo: '',
    modelAnswerEn: '',
    practiceDone: 0,
    practiceTarget: 1,
    message: '',
  });

  // 전체 5개 세션 완료 여부
  const [allFinished, setAllFinished] = useState(false);

  // 음성 진단 모드 (?speech-debug=1 쿼리 존재 시에만 활성화되는 휘발성 디버깅)
  const isSpeechDebug =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('speech-debug') === '1';
  const [speechTraces, setSpeechTraces] = useState<BrowserSpeechTrace[]>([]);
  const [copyStatus, setCopyStatus] = useState<string>('');

  // 상시 로컬 진단 기록 상태 (저장소 ref 1회 생성, 마운트 시 로드)
  const diagStoreRef = useRef<CoachDiagnosticStore | null>(null);
  if (!diagStoreRef.current) {
    diagStoreRef.current = new CoachDiagnosticStore();
  }
  const [diagRecords, setDiagRecords] = useState<CoachDiagnosticRecord[]>([]);
  const [diagCopyStatus, setDiagCopyStatus] = useState<string>('');
  const [manualReportText, setManualReportText] = useState<string>('');

  // 벤치마크 패널 실행 중 코칭 상호 배제 상태 (동기 ref 즉시 갱신 + stable callback)
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const benchmarkBusyRef = useRef(false);

  const handleBenchmarkBusyChange = useCallback((busy: boolean) => {
    benchmarkBusyRef.current = busy;
    setBenchmarkBusy(busy);
  }, []);

  // 참조값 보관
  const adultRef = useRef(adultConfirmed);
  adultRef.current = adultConfirmed;

  const isTextModeRef = useRef(isTextMode);
  isTextModeRef.current = isTextMode;

  const isMountedRef = useRef(true);
  const hasStartedRef = useRef(false);

  // 서비스 인스턴스
  const speechInputRef = useRef<BrowserSpeechInputService | null>(null);
  const voiceOutputRef = useRef<VoiceOutputService | null>(null);
  const apiClientRef = useRef<PublicCoachApiClient | null>(null);
  const controllerRef = useRef<CoachTutorController | null>(null);

  // 컨트롤러 초기화 (1회)
  if (!controllerRef.current) {
    const input = new BrowserSpeechInputService();
    const output = new VoiceOutputService();
    const api = new PublicCoachApiClient();

    speechInputRef.current = input;
    voiceOutputRef.current = output;
    apiClientRef.current = api;

    controllerRef.current = new CoachTutorController({
      speak: async (text: string, lang: string) => {
        if (isTextModeRef.current) {
          // 텍스트 모드에서는 음성 출력을 실행하지 않고 정상 성공으로 반환하여 화면 텍스트 안내로 진행
          return true;
        }
        const res = await output.speak(text, { lang });
        return res.success;
      },
      listen: async (lang: string, options?: BrowserSpeechInputOptions) => {
        if (isTextModeRef.current) {
          // 텍스트 모드에서는 listen을 대기 상태로 두어 submitText만으로 진행
          return new Promise<string>(() => {});
        }
        if (isSpeechDebug && lang === 'en-US') {
          // 다음 영어 캡처 시작 시 이전 진단 기록 및 복사 상태 초기화
          setSpeechTraces([]);
          setCopyStatus('');
          const debugOptions: BrowserSpeechInputOptions = {
            ...options,
            onTrace: (record) => {
              options?.onTrace?.(record);
              setSpeechTraces((prev) => (prev.length >= 40 ? prev : [...prev, record]));
            },
          };
          return await input.start(lang, debugOptions);
        }
        return await input.start(lang, options);
      },
      evaluate: async (questionId: string, answer: string, context?: CoachInputContext) => {
        if (context) {
          return await api.evaluate(questionId, answer, adultRef.current, context);
        }
        return await api.evaluate(questionId, answer, adultRef.current);
      },
      cancel: () => {
        output.cancel();
        input.cancel();
        api.cancel();
      },
      emit: (nextState: CoachSnapshot) => {
        if (!isMountedRef.current) return;
        setSnapshot(nextState);
      },
      isTextMode: () => isTextModeRef.current,
      onDiagnostic: (record: CoachDiagnosticRecord) => {
        if (!diagStoreRef.current) return;
        diagStoreRef.current.append(record);
        if (isMountedRef.current) {
          setDiagRecords(diagStoreRef.current.list());
          setDiagCopyStatus('');
          setManualReportText('');
        }
      },
    });
  }

  // 마운트 시 브라우저 지원 여부 확인 및 생명주기 리스너 등록
  useEffect(() => {
    isMountedRef.current = true;
    if (diagStoreRef.current) {
      setDiagRecords(diagStoreRef.current.list());
    }

    if (speechInputRef.current) {
      const supported = speechInputRef.current.isSupported();
      setSpeechSupported(supported);
      if (!supported) {
        isTextModeRef.current = true;
        setIsTextMode(true);
      }
    }

    const handleVisibility = () => {
      if (document.hidden && controllerRef.current) {
        controllerRef.current.pause();
      }
    };

    const handlePageHide = () => {
      if (controllerRef.current) {
        controllerRef.current.pause();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      if (controllerRef.current) {
        controllerRef.current.pause();
      }
      if (voiceOutputRef.current) {
        voiceOutputRef.current.cancel();
      }
      if (speechInputRef.current) {
        speechInputRef.current.cancel();
      }
      if (apiClientRef.current) {
        apiClientRef.current.cancel();
      }
    };
  }, []);

  // 성인 확인 체크 토글
  const handleToggleAdult = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAdultConfirmed(checked);
    adultRef.current = checked;
    try {
      localStorage.setItem(STORAGE_ADULT_KEY, String(checked));
    } catch {
      // ignore
    }
    if (!checked && controllerRef.current) {
      controllerRef.current.pause();
    }
  }, []);

  // 텍스트 모드 전환
  const handleEnableTextMode = useCallback(() => {
    if (benchmarkBusyRef.current || benchmarkBusy) return;
    isTextModeRef.current = true;
    setIsTextMode(true);
    setShowTextInput(true);
    if (controllerRef.current) {
      if (hasStartedRef.current) {
        controllerRef.current.pause();
      }
    }
    if (voiceOutputRef.current) {
      voiceOutputRef.current.cancel();
    }
    if (speechInputRef.current) {
      speechInputRef.current.cancel();
    }
  }, [benchmarkBusy]);

  // 코칭 시작
  const handleStart = useCallback(() => {
    if (!adultRef.current || !controllerRef.current || benchmarkBusyRef.current || benchmarkBusy) return;
    hasStartedRef.current = true;
    const currentQ = COACH_QUESTIONS[questionIndex];
    controllerRef.current.start(currentQ);
  }, [questionIndex, benchmarkBusy]);

  // 일시정지
  const handlePause = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.pause();
    }
  }, []);

  // 다음 질문 이동 (완료 상태에서 사용자가 명시적으로 클릭할 때만)
  const handleNextQuestion = useCallback(() => {
    if (benchmarkBusyRef.current || benchmarkBusy) return;
    if (questionIndex < COACH_QUESTIONS.length - 1) {
      const nextIdx = questionIndex + 1;
      setQuestionIndex(nextIdx);
      setSnapshot((prev) => ({
        ...prev,
        phase: 'ready',
        recognizedText: '',
        feedbackKo: '',
        modelAnswerEn: '',
        practiceDone: 0,
        practiceTarget: 1,
        message: '',
      }));
      if (controllerRef.current && adultRef.current) {
        controllerRef.current.start(COACH_QUESTIONS[nextIdx]);
      }
    } else {
      setAllFinished(true);
    }
  }, [questionIndex, benchmarkBusy]);

  // 텍스트 직접 제출
  const handleSubmitText = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      // 성인 미확인, 벤치마크 진행 중, 시작 전, 완료, 평가 또는 대기 진행 중에는 제출 차단
      if (
        !adultRef.current ||
        !hasStartedRef.current ||
        benchmarkBusyRef.current ||
        benchmarkBusy ||
        snapshot.phase === 'ready' ||
        snapshot.phase === 'complete' ||
        snapshot.phase === 'evaluating' ||
        snapshot.phase === 'waiting'
      ) {
        return;
      }
      const trimmed = typedAnswer.trim();
      if (!trimmed || trimmed.length > 500 || !controllerRef.current) return;
      controllerRef.current.submitText(trimmed);
      setTypedAnswer('');
      // 텍스트 전용 모드가 아닐 때만 제출 후 접기
      if (!isTextModeRef.current) {
        setShowTextInput(false);
      }
    },
    [typedAnswer, snapshot.phase, benchmarkBusy]
  );

  const currentQ = COACH_QUESTIONS[questionIndex];
  const phase = snapshot.phase;

  // 진단 페이로드 (진단 모드 시 화면 표시 및 클립보드 복사용 동일 규격)
  const traceEnvelope = {
    diagnosticVersion: 'paced-coach-10s-v9',
    events: speechTraces,
  };

  const handleCopyTrace = useCallback(async () => {
    const payload = JSON.stringify(traceEnvelope, null, 2);
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(payload);
        setCopyStatus('클립보드에 복사했습니다.');
      } catch {
        setCopyStatus('클립보드에 복사하지 못했습니다. 아래 내용을 직접 복사해 주세요.');
      }
    } else {
      setCopyStatus('클립보드를 지원하지 않는 환경입니다. 복사하지 못했습니다. 아래 내용을 직접 복사해 주세요.');
    }
  }, [traceEnvelope]);

  // 상시 로컬 진단 기록 핸들러
  const handleCopyDiagReport = useCallback(async () => {
    if (!diagStoreRef.current) return;
    const report = diagStoreRef.current.exportText();

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(report);
        if (isMountedRef.current) {
          setDiagCopyStatus('클립보드에 복사했습니다.');
          setManualReportText('');
        }
      } catch {
        if (isMountedRef.current) {
          setDiagCopyStatus('클립보드에 복사하지 못했습니다. 아래 내용을 길게 눌러 직접 복사해 주세요.');
          setManualReportText(report);
        }
      }
    } else {
      if (isMountedRef.current) {
        setDiagCopyStatus('클립보드를 지원하지 않는 환경입니다. 아래 내용을 길게 눌러 직접 복사해 주세요.');
        setManualReportText(report);
      }
    }
  }, []);

  const handleClearDiagReport = useCallback(() => {
    if (!diagStoreRef.current) return;
    const success = diagStoreRef.current.clear();
    if (isMountedRef.current) {
      setDiagRecords(diagStoreRef.current.list());
      setManualReportText('');
      if (!success) {
        setDiagCopyStatus('저장소 삭제 중 오류가 발생하여 화면 메모리만 비웠습니다.');
      } else {
        setDiagCopyStatus('');
      }
    }
  }, []);

  const handleAnnotateDiag = useCallback((id: string, value: string) => {
    if (!diagStoreRef.current) return;
    diagStoreRef.current.annotate(id, value);
    if (isMountedRef.current) {
      setDiagRecords(diagStoreRef.current.list());
      setDiagCopyStatus('');
      setManualReportText('');
    }
  }, []);

  // 진단 패널 렌더 헬퍼 (초기/학습 중 화면 및 학습 완료 화면 공통 표시)
  const isClearDisabled = !(
    phase === 'ready' ||
    phase === 'paused' ||
    phase === 'error' ||
    phase === 'complete' ||
    allFinished
  );

  const renderDiagnosticPanel = () => {
    const records = diagRecords;
    const hasRecords = records.length > 0;
    const isPersistenceAvailable = diagStoreRef.current?.persistenceAvailable ?? true;

    return (
      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && diagStoreRef.current && isMountedRef.current) {
            setDiagRecords(diagStoreRef.current.list());
          }
        }}
        style={{
          marginTop: '20px',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '12px 14px',
          minWidth: 0,
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            color: '#94a3b8',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          인식·평가 기록 ({records.length})
        </summary>

        <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          💡 최근 20건 / 24시간 동안의 회화 음성 인식 및 AI 평가 결과가 기기 로컬에만 보관됩니다. 이 진단 기록 자체의 자동 외부 전송이나 오디오 녹음 저장은 일체 없으며(일반 회화 진행을 위한 브라우저 음성 인식 및 AI 평가는 정상 동작), 복사하기 전 이름 등 개인정보가 포함되어 있는지 확인하세요.
        </div>

        {!isPersistenceAvailable && (
          <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', fontSize: '12px', color: '#f87171' }}>
            ⚠️ 브라우저 로컬 저장소를 사용할 수 없어 현재 화면 메모리에만 임시 보관 중입니다. (새로고침 시 초기화될 수 있습니다)
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleCopyDiagReport}
            disabled={!hasRecords}
            style={{
              ...secondaryButtonStyle,
              minHeight: '44px',
              padding: '0 16px',
              opacity: hasRecords ? 1 : 0.4,
              cursor: hasRecords ? 'pointer' : 'not-allowed',
            }}
          >
            진단 기록 복사
          </button>

          <button
            type="button"
            onClick={handleClearDiagReport}
            disabled={isClearDisabled}
            style={{
              ...secondaryButtonStyle,
              minHeight: '44px',
              padding: '0 16px',
              color: '#f87171',
              opacity: isClearDisabled ? 0.4 : 1,
              cursor: isClearDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            진단 기록 지우기
          </button>
        </div>

        {diagCopyStatus && (
          <p
            style={{
              margin: '8px 0 0 0',
              fontSize: '12px',
              color: diagCopyStatus.includes('못했습니다') || diagCopyStatus.includes('오류') ? '#f87171' : '#34d399',
            }}
          >
            {diagCopyStatus}
          </p>
        )}

        {manualReportText && (
          <div style={{ marginTop: '10px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>수동 복사용 텍스트 (길게 눌러 복사):</span>
            <textarea
              readOnly
              value={manualReportText}
              style={{
                ...textInputStyle,
                width: '100%',
                height: '140px',
                marginTop: '4px',
                fontSize: '11px',
                fontFamily: 'monospace',
                lineHeight: 1.4,
              }}
            />
          </div>
        )}

        {hasRecords && (
          <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {records.map((rec) => {
              const selectedIdx = rec.evaluation?.recognizedCandidateIndex ?? 0;
              const selectedText = rec.candidates && rec.candidates[selectedIdx] ? rec.candidates[selectedIdx] : rec.rawText;

              return (
                <details
                  key={rec.id}
                  style={{
                    background: '#1e293b',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    border: '1px solid #334155',
                    fontSize: '12px',
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      color: '#cbd5e1',
                      fontWeight: 600,
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    [{rec.questionId}] {rec.stage === 'initial' ? '초기' : '반복'} · &ldquo;{rec.rawText || '(무음/실패)'}&rdquo;
                  </summary>

                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      color: '#94a3b8',
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    <div><span style={{ color: '#64748b' }}>시각 / 입력·평가 소요:</span> {rec.timestamp} ({rec.elapsedMs}ms)</div>
                    <div><span style={{ color: '#64748b' }}>질문:</span> [{rec.questionId}] {rec.questionEn}</div>
                    <div><span style={{ color: '#64748b' }}>입력 방식:</span> {rec.inputSource === 'voice' ? '음성인식' : '텍스트 직접입력'} ({rec.stage === 'initial' ? '초기 답변' : '반복 연습'})</div>
                    <div><span style={{ color: '#64748b' }}>원본 인식(Raw):</span> <strong style={{ color: '#f8fafc' }}>&ldquo;{rec.rawText}&rdquo;</strong></div>

                    {rec.candidates && rec.candidates.length > 0 && (
                      <div>
                        <span style={{ color: '#64748b' }}>대안 후보군:</span>
                        {rec.candidates.map((c, i) => {
                          const isSelected = Boolean(rec.evaluation && i === selectedIdx);
                          return (
                            <div key={i} style={{ marginLeft: '12px', color: isSelected ? '#38bdf8' : '#94a3b8', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                              ({i}) &ldquo;{c}&rdquo; {isSelected ? '← 채택' : ''}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div>
                      <span style={{ color: '#64748b' }}>평가 출처:</span>{' '}
                      {rec.evaluationSource === 'ai'
                        ? `AI 평가 요청 (앱 ${rec.evaluationRequests}회 시도, 제공사/예산 차감 횟수와 다를 수 있음)`
                        : rec.evaluationSource === 'reuse'
                        ? '로컬 승인 답안 안전 재사용 (AI 0회)'
                        : '평가 미실행'}
                    </div>

                    {rec.evaluation && (
                      <div
                        style={{
                          background: '#0f172a',
                          padding: '8px',
                          borderRadius: '6px',
                          marginTop: '4px',
                          minWidth: 0,
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        <div><span style={{ color: '#38bdf8' }}>AI 채택:</span> &ldquo;{selectedText}&rdquo; (인덱스 {selectedIdx})</div>
                        <div>
                          <span style={{ color: '#34d399' }}>판정:</span>{' '}
                          의미 [{rec.evaluation.meaning === 'relevant' ? '뜻이 통함 (relevant)' : rec.evaluation.meaning === 'needs_help' ? '다시 연습 (needs_help)' : '인식/의미 불확실 (uncertain)'}],{' '}
                          문장 완성 [{rec.evaluation.sentenceComplete ? '완전' : '미완성/단답'}]
                        </div>
                        <div><span style={{ color: '#e2e8f0' }}>피드백:</span> {rec.evaluation.feedbackKo}</div>
                        <div><span style={{ color: '#60a5fa' }}>모범 예문:</span> {rec.evaluation.modelAnswerEn}</div>
                      </div>
                    )}

                    {rec.errorCode && (
                      <div style={{ color: '#f87171' }}><span style={{ color: '#ef4444' }}>오류 코드:</span> {rec.errorCode}</div>
                    )}

                    <div style={{ marginTop: '8px' }}>
                      <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                        내가 말한 내용 (선택, 음성인식 원문과 비교용):
                      </label>
                      <textarea
                        value={rec.intendedText ?? ''}
                        maxLength={500}
                        placeholder="실제로 발화한 영어나 의도를 적어두면 복사 시 함께 기록됩니다 (최대 500자)"
                        onChange={(e) => handleAnnotateDiag(rec.id, e.target.value)}
                        aria-label="내가 말한 내용 (선택)"
                        style={{
                          ...textInputStyle,
                          width: '100%',
                          height: '56px',
                          fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </details>
    );
  };

  // 전체 완료 화면
  if (allFinished) {
    return (
      <div style={containerStyle}>
        <div style={headerNavStyle}>
          <button onClick={onBack} style={backButtonStyle}>
            ← 돌아가기
          </button>
        </div>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <span style={{ fontSize: '48px' }}>🎉</span>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981', marginTop: '16px' }}>
              오늘 연습을 마쳤어요
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.6, marginTop: '8px' }}>
              초급 일상 질문 5가지에 대해 한국어 코칭과 함께 말하기 연습을 모두 완료했습니다.
              내일도 가벼운 마음으로 다시 연습해 보세요!
            </p>
            <button onClick={onBack} style={primaryButtonStyle}>
              종료하기
            </button>
          </div>
        </div>
        {renderDiagnosticPanel()}
        <WhisperBenchmarkPanel
          adultConfirmed={adultConfirmed}
          coachingActive={false}
          onBusyChange={handleBenchmarkBusyChange}
        />
      </div>
    );
  }

  // Phase별 한글 상태 라벨
  const getPhaseBadge = () => {
    switch (phase) {
      case 'preparing':
        return <span style={badgeStyle('#6366f1')}>{isTextMode ? '답변 입력 준비 중' : '마이크 준비 중'}</span>;
      case 'speaking':
        return <span style={badgeStyle('#3b82f6')}>AI 음성 안내 중</span>;
      case 'thinking':
        return <span style={badgeStyle('#eab308')}>{isTextMode ? '답변 입력 대기 중' : '답변 준비 중'}</span>;
      case 'listening':
        return <span style={badgeStyle('#ef4444')}>{snapshot.message.includes('초 동안 듣는 중') ? snapshot.message : '10초 동안 듣는 중'}</span>;
      case 'evaluating':
        return <span style={badgeStyle('#ec4899')}>AI 코칭 분석 중</span>;
      case 'waiting':
        return <span style={badgeStyle('#f59e0b')}>잠시 대기 중</span>;
      case 'practicing':
        return <span style={badgeStyle('#10b981')}>반복 따라하기 연습 중</span>;
      case 'complete':
        return <span style={badgeStyle('#10b981')}>연습 완료</span>;
      case 'paused':
        return <span style={badgeStyle('#64748b')}>일시정지</span>;
      case 'error':
        return <span style={badgeStyle('#ef4444')}>오류 발생</span>;
      default:
        return <span style={badgeStyle('#475569')}>준비 완료</span>;
    }
  };

  const isTextSubmitAllowed =
    adultConfirmed &&
    hasStartedRef.current &&
    phase !== 'ready' &&
    phase !== 'complete' &&
    phase !== 'evaluating' &&
    phase !== 'waiting' &&
    Boolean(typedAnswer.trim());

  return (
    <div style={containerStyle}>
      {/* 헤더 네비게이션 */}
      <div style={headerNavStyle}>
        <button onClick={onBack} style={backButtonStyle}>
          ← 나가기
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap' }}>
            AI 영어 회화 (초급)
          </span>
        </div>
        <span style={{ fontSize: '13px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {questionIndex + 1} / {COACH_QUESTIONS.length}
        </span>
      </div>

      {/* 음성 미지원 시 Chrome 권장 상시 안내 */}
      {!speechSupported && (
        <div style={warningNoticeStyle}>
          <p style={{ fontWeight: 'bold', margin: '0 0 6px 0', color: '#f59e0b' }}>
            ⚠️ 브라우저 음성 인식이 지원되지 않습니다
          </p>
          <p style={{ fontSize: '13px', color: '#cbd5e1', margin: '0 0 10px 0', lineHeight: 1.5 }}>
            마이크 음성 인식을 이용하시려면 Chrome 브라우저 사용을 권장합니다.
            현재 텍스트 직접 입력 모드로 학습을 진행할 수 있습니다.
          </p>
          {!isTextMode && (
            <button
              onClick={handleEnableTextMode}
              style={{ ...secondaryButtonStyle, width: 'auto', padding: '0 16px', minHeight: '44px' }}
            >
              텍스트 모드로 전환
            </button>
          )}
        </div>
      )}

      {/* 텍스트 전용 모드 표시기 */}
      {isTextMode && (
        <div style={infoNoticeStyle}>
          <span>⌨️ 텍스트 전용 학습 모드로 진행 중입니다 (음성/마이크 비활성)</span>
        </div>
      )}

      {/* 질문 카드 */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '8px',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: '13px', color: '#10b981', fontWeight: 600 }}>
            질문 {questionIndex + 1}
          </span>
          {getPhaseBadge()}
        </div>

        {/* 상황 한국어 */}
        <div style={scenarioBoxStyle}>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', lineHeight: 1.5, overflowWrap: 'break-word' }}>
            💡 {currentQ.scenarioKo}
          </p>
        </div>

        {/* 자동 인식 또는 텍스트 입력 진행 안내 */}
        <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 12px', marginTop: '10px', borderLeft: '3px solid #38bdf8' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5, overflowWrap: 'break-word' }}>
            {isTextMode
              ? '⌨️ 질문을 확인하신 후 아래 입력창에 영어로 답변을 작성하고 제출해 주세요. 즉시 AI 코칭 피드백을 드립니다.'
              : '🎙️ 질문 음성이 끝나면 10초 동안 마이크가 자동으로 켜집니다. 영어로 답변해 주시면 추가 확인 절차 없이 AI 평가 후 한국어 피드백을 드립니다.'}
          </p>
        </div>

        {/* 영어 질문 (헤딩 한글화) */}
        <div style={{ margin: '16px 0 20px 0', minWidth: 0 }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
            영어 질문
          </span>
          <h3
            style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#f8fafc',
              margin: '4px 0 0 0',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
            }}
          >
            {currentQ.questionEn}
          </h3>
        </div>

        {/* 텍스트 모드 안내 */}
        {isTextMode && phase !== 'ready' && phase !== 'complete' && (
          <div style={{ background: '#0f172a', padding: '10px', borderRadius: '8px', marginBottom: '12px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#38bdf8', lineHeight: 1.4 }}>
              💡 아래 입력창에 영어 답변을 입력한 후 &apos;제출&apos; 버튼을 눌러주세요.
            </p>
          </div>
        )}

        {/* 학습자 발화 인식 문장 또는 제출 답변 */}
        {snapshot.recognizedText && (
          <div style={recognizedBoxStyle}>
            <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }}>
              {isTextMode
                ? '입력한 답변:'
                : phase === 'listening'
                ? '인식 중 (아직 확정 전):'
                : '인식된 답변:'}
            </span>
            <p
              style={{
                margin: '4px 0 0 0',
                fontSize: '16px',
                color: '#f8fafc',
                fontWeight: 500,
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            >
              &ldquo;{snapshot.recognizedText}&rdquo;
            </p>
            {snapshot.understoodText && snapshot.understoodText !== snapshot.recognizedText && (
              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed rgba(56, 189, 248, 0.3)' }}>
                <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 600 }}>
                  문맥으로 이해한 답변:
                </span>
                <p
                  style={{
                    margin: '2px 0 0 0',
                    fontSize: '14px',
                    color: '#6ee7b7',
                    fontWeight: 500,
                    overflowWrap: 'break-word',
                  }}
                >
                  &ldquo;{snapshot.understoodText}&rdquo;
                </p>
              </div>
            )}
          </div>
        )}

        {/* 한국어 피드백 및 모범 영문 예문 */}
        {snapshot.feedbackKo && (
          <div style={feedbackBoxStyle}>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: '#a7f3d0', fontWeight: 600 }}>원포인트 코칭:</span>
              <p style={{ margin: '4px 0 0 0', fontSize: '15px', color: '#f8fafc', lineHeight: 1.5, overflowWrap: 'break-word' }}>
                {snapshot.feedbackKo}
              </p>
            </div>
            {snapshot.modelAnswerEn && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: '12px', color: '#93c5fd', fontWeight: 600 }}>추천 모범 표현:</span>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '16px',
                    color: '#60a5fa',
                    fontWeight: 'bold',
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                  }}
                >
                  {snapshot.modelAnswerEn}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 반복 진행 현황 */}
        {snapshot.practiceTarget > 0 && phase !== 'ready' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px 0' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>말하기 반복 연습</span>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#10b981' }}>
              {snapshot.practiceDone} / {snapshot.practiceTarget} 회 완료
            </span>
          </div>
        )}

        {/* 상태 메시지 */}
        {snapshot.message && (
          <p style={{ fontSize: '13px', color: '#cbd5e1', textAlign: 'center', margin: '12px 0 0 0', overflowWrap: 'break-word' }}>
            {snapshot.message}
          </p>
        )}
      </div>

      {/* 18세 확인 체크박스 (미확인 시에만 노출, 체크 즉시 및 재방문 시 숨김) */}
      {!adultConfirmed && (
        <div style={consentBoxStyle}>
          <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer', gap: '10px' }}>
            <input
              type="checkbox"
              checked={adultConfirmed}
              onChange={handleToggleAdult}
              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#10b981' }}
            />
            <span style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
              <strong>[필수] 만 18세 이상 성인 사용자 본인 확인</strong>
            </span>
          </label>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '8px 0 0 28px', lineHeight: 1.4, overflowWrap: 'break-word' }}>
            브라우저 음성 서비스가 음성을 서버에서 처리할 수 있습니다. 인식 또는 제출된 영어 답변은 Google AI로 전송되며 서비스 개선과 사람 검토에 사용될 수 있습니다. 가상의 이름·나이로 연습하고 민감정보는 말하지 마세요.
          </p>
        </div>
      )}

      {/* 텍스트 답하기 섹션 (텍스트 모드일 땐 항상 노출, 아닐 땐 접이식) */}
      <div style={{ margin: '14px 0', minWidth: 0 }}>
        {!isTextMode && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              style={toggleButtonStyle}
            >
              {showTextInput ? '▲ 텍스트 입력창 접기' : '▼ 텍스트로 답하기 (키보드 직접 입력)'}
            </button>
            <button
              onClick={handleEnableTextMode}
              style={{ ...toggleButtonStyle, color: '#60a5fa' }}
            >
              텍스트 모드로 전환
            </button>
          </div>
        )}

        {(isTextMode || showTextInput) && (
          <form onSubmit={handleSubmitText} style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              placeholder={
                !adultConfirmed
                  ? '만 18세 이상 확인 후 입력 가능합니다'
                  : phase === 'ready'
                  ? '코칭 시작 후 답변을 입력해 주세요'
                  : phase === 'evaluating'
                  ? '답변을 분석하고 있습니다...'
                  : phase === 'waiting'
                  ? '잠시 후 자동으로 평가합니다...'
                  : '영어로 답변 입력 (최대 500자)'
              }
              maxLength={500}
              disabled={
                !adultConfirmed ||
                !hasStartedRef.current ||
                phase === 'ready' ||
                phase === 'complete' ||
                phase === 'evaluating' ||
                phase === 'waiting'
              }
              style={{
                ...textInputStyle,
                opacity:
                  !adultConfirmed ||
                  !hasStartedRef.current ||
                  phase === 'ready' ||
                  phase === 'complete' ||
                  phase === 'evaluating' ||
                  phase === 'waiting'
                    ? 0.6
                    : 1,
              }}
            />
            <button
              type="submit"
              disabled={!isTextSubmitAllowed || benchmarkBusy}
              style={{
                ...secondaryButtonStyle,
                width: 'auto',
                minWidth: '70px',
                opacity: isTextSubmitAllowed && !benchmarkBusy ? 1 : 0.4,
                cursor: isTextSubmitAllowed && !benchmarkBusy ? 'pointer' : 'not-allowed',
              }}
            >
              제출
            </button>
          </form>
        )}
      </div>

      {/* 하단 주 조작 버튼 */}
      <div style={footerStyle}>
        {phase === 'ready' && (
          <button
            onClick={handleStart}
            disabled={!adultConfirmed || benchmarkBusy}
            style={{
              ...primaryButtonStyle,
              opacity: adultConfirmed && !benchmarkBusy ? 1 : 0.4,
              cursor: adultConfirmed && !benchmarkBusy ? 'pointer' : 'not-allowed',
            }}
          >
            {adultConfirmed ? '코칭 시작' : '만 18세 이상 확인 후 시작'}
          </button>
        )}

        {(phase === 'preparing' ||
          phase === 'speaking' ||
          phase === 'thinking' ||
          phase === 'listening' ||
          phase === 'evaluating' ||
          phase === 'waiting' ||
          phase === 'practicing') && (
          <button onClick={handlePause} style={dangerButtonStyle}>
            일시정지
          </button>
        )}

        {phase === 'paused' && (
          <button
            onClick={handleStart}
            disabled={!adultConfirmed || benchmarkBusy}
            style={{
              ...primaryButtonStyle,
              opacity: adultConfirmed && !benchmarkBusy ? 1 : 0.4,
              cursor: adultConfirmed && !benchmarkBusy ? 'pointer' : 'not-allowed',
            }}
          >
            다시 시작
          </button>
        )}

        {phase === 'error' && (
          <button
            onClick={handleStart}
            disabled={!adultConfirmed || benchmarkBusy}
            style={{
              ...primaryButtonStyle,
              background: '#ef4444',
              opacity: adultConfirmed && !benchmarkBusy ? 1 : 0.4,
              cursor: adultConfirmed && !benchmarkBusy ? 'pointer' : 'not-allowed',
            }}
          >
            다시 시도
          </button>
        )}

        {phase === 'complete' && (
          <button
            onClick={handleNextQuestion}
            disabled={benchmarkBusy}
            style={{
              ...primaryButtonStyle,
              opacity: !benchmarkBusy ? 1 : 0.4,
              cursor: !benchmarkBusy ? 'pointer' : 'not-allowed',
            }}
          >
            {questionIndex < COACH_QUESTIONS.length - 1 ? '다음 질문으로 →' : '연습 마치기'}
          </button>
        )}
      </div>

      {/* 상시 로컬 회화 진단 패널 (일반 회화 화면 및 세션 완료 화면 공통) */}
      {renderDiagnosticPanel()}

      {/* 기기 내 음성 비교 (Web Speech API vs In-Browser Whisper) 패널 */}
      <WhisperBenchmarkPanel
        adultConfirmed={adultConfirmed}
        coachingActive={
          phase === 'preparing' ||
          phase === 'speaking' ||
          phase === 'listening' ||
          phase === 'evaluating' ||
          phase === 'waiting' ||
          phase === 'practicing'
        }
        onBusyChange={handleBenchmarkBusyChange}
      />

      {/* URL 쿼리 speech-debug=1 일 때만 활성화되는 휘발성 음성 진단 UI */}
      {isSpeechDebug && (
        <details
          style={{
            marginTop: '16px',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '8px 12px',
          }}
        >
          <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#94a3b8', fontWeight: 600 }}>
            음성 진단 결과 (이 화면에서만 표시)
          </summary>
          <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600, marginTop: '8px' }}>
            진단 버전: paced-coach-10s-v9
          </div>
          <p style={{ margin: '8px 0 4px 0', fontSize: '12px', color: '#64748b' }}>
            음성인식 원본과 앱 결과 비교용입니다. 서버에 저장하지 않습니다.
          </p>
          <button
            type="button"
            onClick={handleCopyTrace}
            disabled={speechTraces.length === 0}
            style={{
              ...secondaryButtonStyle,
              minHeight: '44px',
              marginTop: '8px',
              width: 'auto',
              opacity: speechTraces.length === 0 ? 0.5 : 1,
              cursor: speechTraces.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            진단 결과 복사
          </button>
          {copyStatus && (
            <p
              style={{
                margin: '6px 0 0 0',
                fontSize: '12px',
                color: copyStatus.includes('못했습니다') ? '#f87171' : '#34d399',
              }}
            >
              {copyStatus}
            </p>
          )}
          <pre
            style={{
              margin: '8px 0 0 0',
              padding: '8px',
              background: '#020617',
              borderRadius: '4px',
              maxWidth: '100%',
              overflow: 'auto',
              fontSize: '11px',
              color: '#38bdf8',
              lineHeight: 1.4,
            }}
          >
            {JSON.stringify(traceEnvelope, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

// --- 스타일 정의 ---

const containerStyle: React.CSSProperties = {
  maxWidth: '600px',
  width: '100%',
  margin: '0 auto',
  padding: '16px',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#f8fafc',
  display: 'flex',
  flexDirection: 'column',
};

const headerNavStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  minHeight: '44px',
  flexWrap: 'wrap',
  gap: '8px',
};

const backButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#94a3b8',
  padding: '8px 12px',
  fontSize: '13px',
  cursor: 'pointer',
  minHeight: '44px',
  minWidth: '44px',
  boxSizing: 'border-box',
};

const cardStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: '16px',
  padding: '20px',
  border: '1px solid #334155',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  minWidth: 0,
};

const scenarioBoxStyle: React.CSSProperties = {
  background: '#0f172a',
  borderRadius: '8px',
  padding: '10px 12px',
  borderLeft: '3px solid #10b981',
  minWidth: 0,
};

const recognizedBoxStyle: React.CSSProperties = {
  background: 'rgba(56, 189, 248, 0.08)',
  borderRadius: '10px',
  padding: '12px',
  marginTop: '12px',
  border: '1px solid rgba(56, 189, 248, 0.2)',
  minWidth: 0,
};

const feedbackBoxStyle: React.CSSProperties = {
  background: 'rgba(16, 185, 129, 0.08)',
  borderRadius: '10px',
  padding: '14px',
  marginTop: '12px',
  border: '1px solid rgba(16, 185, 129, 0.25)',
  minWidth: 0,
};

const badgeStyle = (bgColor: string): React.CSSProperties => ({
  background: bgColor,
  color: '#ffffff',
  fontSize: '11px',
  fontWeight: 'bold',
  padding: '4px 8px',
  borderRadius: '6px',
  whiteSpace: 'nowrap',
});

const consentBoxStyle: React.CSSProperties = {
  background: '#0f172a',
  borderRadius: '12px',
  padding: '14px',
  marginTop: '16px',
  border: '1px solid #1e293b',
  minWidth: 0,
};

const warningNoticeStyle: React.CSSProperties = {
  background: 'rgba(245, 158, 11, 0.1)',
  borderRadius: '12px',
  padding: '14px',
  marginBottom: '16px',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  minWidth: 0,
};

const infoNoticeStyle: React.CSSProperties = {
  background: 'rgba(148, 163, 184, 0.1)',
  borderRadius: '8px',
  padding: '10px 12px',
  marginBottom: '12px',
  fontSize: '13px',
  color: '#94a3b8',
  textAlign: 'center',
  minHeight: '44px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
};

const toggleButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  fontSize: '13px',
  cursor: 'pointer',
  padding: '8px 4px',
  minHeight: '44px',
  minWidth: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box',
};

const textInputStyle: React.CSSProperties = {
  flex: '1 1 200px',
  minWidth: 0,
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#f8fafc',
  padding: '10px 12px',
  fontSize: '14px',
  minHeight: '44px',
  boxSizing: 'border-box',
};

const footerStyle: React.CSSProperties = {
  marginTop: '16px',
};

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '48px',
  background: '#10b981',
  color: '#ffffff',
  border: 'none',
  borderRadius: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s',
  boxSizing: 'border-box',
};

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '44px',
  background: '#334155',
  color: '#f8fafc',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '0 16px',
  boxSizing: 'border-box',
};

const dangerButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '48px',
  background: '#334155',
  color: '#f87171',
  border: '1px solid #475569',
  borderRadius: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
};

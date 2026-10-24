// src/features/conversation/components/HandsFreeSpeechCheck.tsx
// S25 등 모바일 실기기 Web Speech API (TTS/STT) 핸즈프리 연결 검증 컴포넌트
// 실제 AI 수업 전 브라우저 음성 인식과 자동 음성 출력 루프를 단독 점검합니다.
// (AI 채점/학습 완료 위장 금지, Gemini 미호출, transcript 영구저장/서버전송 금지)

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserSpeechInputService } from '../services/browserSpeechInput';
import { VoiceOutputService } from '../services/voiceOutput';
import { HandsFreeVoiceLoopController, VoiceLoopState } from '../services/handsFreeVoiceLoop';

interface HandsFreeSpeechCheckProps {
  onBack: () => void;
}

const CHECK_QUESTIONS = [
  'What is your name?',
  'How old are you?',
  'What would you like to drink?',
];

export const HandsFreeSpeechCheck: React.FC<HandsFreeSpeechCheckProps> = ({ onBack }) => {
  const mountedRef = useRef(true);
  const echoGenRef = useRef(0);
  const echoTimeoutRef = useRef<any>(null);

  const [isAgeAgreed, setIsAgeAgreed] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [loopState, setLoopState] = useState<VoiceLoopState>('idle');
  const [isEchoing, setIsEchoing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isFinished, setIsFinished] = useState(false);

  // 인스턴스별 독립 서비스 생성
  const inputService = useMemo(() => new BrowserSpeechInputService(), []);
  const outputService = useMemo(() => new VoiceOutputService(), []);

  const isSupported = useMemo(() => inputService.isSupported(), [inputService]);

  const clearEchoTimer = () => {
    if (echoTimeoutRef.current) {
      clearTimeout(echoTimeoutRef.current);
      echoTimeoutRef.current = null;
    }
  };

  const cancelAllVoice = () => {
    echoGenRef.current++;
    clearEchoTimer();
    outputService.cancel();
    inputService.cancel();
  };

  // Controller 생성
  const controller = useMemo(() => {
    return new HandsFreeVoiceLoopController(
      {
        start: () => inputService.start(),
        cancel: () => inputService.cancel(),
      },
      {
        speak: async (text: string, lang: string) => {
          const res = await outputService.speak(text, { lang });
          return res.success;
        },
        cancel: () => outputService.cancel(),
      },
      (event) => {
        if (!mountedRef.current) return;
        setLoopState(event.state);

        if (event.state === 'speaking') {
          setErrorMessage('');
          setTranscript('');
          setIsEchoing(false);
        } else if (event.state === 'error') {
          setErrorMessage(event.message || '음성 처리 중 오류가 발생했습니다.');
          setIsEchoing(false);
        } else if (event.state === 'heard' && event.transcript) {
          const recognizedText = event.transcript;
          setTranscript(recognizedText);

          // heard 시점에 입력 재시작 없이 브라우저 TTS로 인식 결과 낭독 (echo)
          const currentEchoGen = ++echoGenRef.current;
          setIsEchoing(true);

          clearEchoTimer();
          echoTimeoutRef.current = setTimeout(() => {
            if (echoGenRef.current === currentEchoGen) {
              echoGenRef.current++; // 늦은 then/catch 무시
              outputService.cancel();
              if (mountedRef.current) {
                setErrorMessage('인식 결과 낭독 시간이 초과되었습니다.');
                setLoopState('error');
                setIsEchoing(false);
              }
            }
          }, 15000);

          outputService
            .speak(`I heard you say. ${recognizedText}`, { lang: 'en-US' })
            .then((res) => {
              if (echoGenRef.current !== currentEchoGen || !mountedRef.current) return;
              clearEchoTimer();
              if (res && res.success === true) {
                setIsEchoing(false);
                // loopState는 여전히 'heard' 유지 -> 다음 버튼 활성화 충족
              } else {
                setErrorMessage(res?.error || '인식 결과 낭독 음성 출력에 실패했습니다.');
                setLoopState('error');
                setIsEchoing(false);
              }
            })
            .catch((err) => {
              if (echoGenRef.current !== currentEchoGen || !mountedRef.current) return;
              clearEchoTimer();
              setErrorMessage(err?.message || '인식 결과 낭독 중 오류가 발생했습니다.');
              setLoopState('error');
              setIsEchoing(false);
            });
        }
      }
    );
  }, [inputService, outputService]);

  // 생명주기 및 브라우저 숨김/페이지 이탈 감지
  useEffect(() => {
    mountedRef.current = true;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancelAllVoice();
        controller.pause();
        if (mountedRef.current) {
          setIsEchoing(false);
        }
      }
    };

    const handlePageHide = () => {
      cancelAllVoice();
      controller.pause();
      if (mountedRef.current) {
        setIsEchoing(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      cancelAllVoice();
      controller.pause();
    };
  }, [controller]);

  // 질문 시작
  const handleStartQuestion = (idx: number) => {
    if (!isAgeAgreed || !isSupported || isBusy) return;
    setErrorMessage('');
    setIsFinished(false);
    cancelAllVoice();
    controller.start(CHECK_QUESTIONS[idx]);
  };

  // 일시정지
  const handlePause = () => {
    cancelAllVoice();
    controller.pause();
    setIsEchoing(false);
  };

  // 다음 질문 이동
  const handleNext = () => {
    if (isBusy) return;
    cancelAllVoice();
    const nextIdx = questionIndex + 1;
    if (nextIdx < CHECK_QUESTIONS.length) {
      setQuestionIndex(nextIdx);
      setTranscript('');
      setErrorMessage('');
      setLoopState('idle');
      handleStartQuestion(nextIdx);
    } else {
      setIsFinished(true);
      setLoopState('idle');
      setTranscript('');
    }
  };

  // 재시도 (오류 발생 시에만 활성화)
  const handleRetry = () => {
    if (isBusy) return;
    handleStartQuestion(questionIndex);
  };

  const isBusy = loopState === 'speaking' || loopState === 'listening' || isEchoing;
  const canGoNext = loopState === 'heard' && !isEchoing && !isFinished;

  return (
    <div className="conv-container" style={{ maxWidth: '640px', margin: '0 auto', padding: '16px', boxSizing: 'border-box' }}>
      {/* 상단 바 */}
      <div className="conv-top-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button
          type="button"
          className="conv-back-btn conv-touch-target"
          onClick={() => {
            cancelAllVoice();
            controller.pause();
            onBack();
          }}
          style={{ minHeight: '44px', minWidth: '44px', padding: '8px 12px' }}
          aria-label="이전 화면으로 돌아가기"
        >
          ← 돌아가기
        </button>
        <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, textAlign: 'center', flex: 1 }}>
          음성 연결 확인
        </h2>
        <div style={{ width: '44px' }} />
      </div>

      {/* 안내 카드 */}
      <div className="conv-card" style={{ padding: '16px', marginBottom: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <p style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#334155' }}>
          실제 AI 수업 전 마이크와 자동 듣기를 확인합니다.
        </p>
        <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
          브라우저 음성 서비스가 음성을 서버에서 처리할 수 있습니다. 이 연결 확인은 Gemini를 호출하지 않습니다.
        </p>
      </div>

      {/* 브라우저 미지원 안내 */}
      {!isSupported && (
        <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', marginBottom: '16px', color: '#991b1b', fontSize: '14px' }}>
          ⚠️ 현재 브라우저는 Web Speech API 음성 인식을 지원하지 않습니다. Android Chrome 또는 지원 브라우저를 이용해 주세요.
        </div>
      )}

      {/* 18세 이상 체크박스 */}
      <div style={{ marginBottom: '20px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#1e293b' }}>
          <input
            type="checkbox"
            checked={isAgeAgreed}
            onChange={(e) => setIsAgeAgreed(e.target.checked)}
            style={{ width: '20px', height: '20px', cursor: 'pointer' }}
          />
          만 18세 이상이며 위 음성 처리 고지 사항을 확인했습니다.
        </label>
      </div>

      {/* 질문 진행 영역 */}
      {!isFinished ? (
        <div className="conv-card" style={{ padding: '20px', marginBottom: '20px', background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#6366f1' }}>
              질문 {questionIndex + 1} / {CHECK_QUESTIONS.length}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {loopState === 'speaking' && '🗣️ 질문 읽는 중...'}
              {loopState === 'listening' && '🎙️ 듣는 중 (말씀하세요)...'}
              {isEchoing && '🔊 인식 결과 확인 낭독 중...'}
              {loopState === 'heard' && !isEchoing && '✅ 인식 완료'}
              {loopState === 'paused' && '⏸️ 일시정지됨'}
              {loopState === 'error' && '❌ 오류 발생'}
              {loopState === 'idle' && '대기 중'}
            </span>
          </div>

          <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '16px', wordBreak: 'break-word' }}>
            "{CHECK_QUESTIONS[questionIndex]}"
          </div>

          {/* 인식된 문장 표시 */}
          {transcript && (
            <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: '#166534', fontWeight: 600, marginBottom: '4px' }}>인식된 문장:</div>
              <div style={{ fontSize: '16px', color: '#15803d', fontWeight: 700, wordBreak: 'break-word' }}>"{transcript}"</div>
            </div>
          )}

          {/* 오류 메시지 표시 */}
          {errorMessage && (
            <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '16px', color: '#b91c1c', fontSize: '13px' }}>
              {errorMessage}
            </div>
          )}

          {/* 조작 버튼 영역 (flex-wrap, 터치 44px 이상) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
            {loopState === 'idle' && (
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                onClick={() => handleStartQuestion(questionIndex)}
                disabled={!isAgeAgreed || !isSupported}
                style={{ flex: '1 1 140px', minHeight: '44px', padding: '10px 16px', fontSize: '14px', fontWeight: 700 }}
              >
                {questionIndex === 0 ? '확인 시작' : '질문 재생'}
              </button>
            )}

            {isBusy && (
              <button
                type="button"
                className="conv-btn conv-btn-secondary conv-touch-target"
                onClick={handlePause}
                style={{ flex: '1 1 120px', minHeight: '44px', padding: '10px 16px', fontSize: '14px' }}
              >
                일시정지
              </button>
            )}

            {loopState === 'paused' && (
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                onClick={() => handleStartQuestion(questionIndex)}
                disabled={!isAgeAgreed || !isSupported}
                style={{ flex: '1 1 120px', minHeight: '44px', padding: '10px 16px', fontSize: '14px' }}
              >
                다시 시작
              </button>
            )}

            {loopState === 'error' && (
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                onClick={handleRetry}
                disabled={!isAgeAgreed || !isSupported}
                style={{ flex: '1 1 120px', minHeight: '44px', padding: '10px 16px', fontSize: '14px' }}
              >
                음성 인식 재시도
              </button>
            )}

            {questionIndex < CHECK_QUESTIONS.length - 1 ? (
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                onClick={handleNext}
                disabled={!canGoNext}
                style={{ flex: '1 1 140px', minHeight: '44px', padding: '10px 16px', fontSize: '14px', fontWeight: 700, opacity: canGoNext ? 1 : 0.5 }}
              >
                다음 질문 →
              </button>
            ) : (
              <button
                type="button"
                className="conv-btn conv-btn-primary conv-touch-target"
                onClick={handleNext}
                disabled={!canGoNext}
                style={{ flex: '1 1 140px', minHeight: '44px', padding: '10px 16px', fontSize: '14px', fontWeight: 700, opacity: canGoNext ? 1 : 0.5 }}
              >
                확인 완료
              </button>
            )}
          </div>
        </div>
      ) : (
        /* 완료 화면 */
        <div className="conv-card" style={{ padding: '24px', textAlign: 'center', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', marginBottom: '20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎉</div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#166534', margin: '0 0 8px 0' }}>
            질문 3개 확인 완료(음성 품질은 사용자 확인 필요)
          </h3>
          <p style={{ fontSize: '13px', color: '#15803d', margin: '0 0 20px 0', lineHeight: 1.5 }}>
            세 질문의 입력과 재생을 마쳤습니다. 실제 들린 음성은 직접 확인해 주세요.
          </p>
          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            onClick={() => {
              cancelAllVoice();
              onBack();
            }}
            style={{ minHeight: '44px', padding: '10px 24px', fontSize: '15px', fontWeight: 700 }}
          >
            확인 완료 및 홈으로
          </button>
        </div>
      )}
    </div>
  );
};

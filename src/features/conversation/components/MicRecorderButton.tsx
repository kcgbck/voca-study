import React, { useEffect, useRef, useState } from 'react';
import { voiceInput, type RecordedAudioResult } from '../services/voiceInput';
import { conversationApi } from '../services/conversationApi';
import { localSpeechInput } from '../services/localSpeechInput';
import { CONVERSATION_POLICY_VERSION, type ConversationSettings } from '../types';

interface MicRecorderButtonProps {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
  settings?: ConversationSettings;
}

type RecordingMode = 'local' | 'cloud' | null;

export const MicRecorderButton: React.FC<MicRecorderButtonProps> = ({ onTranscribed, disabled = false, settings }) => {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const starting = useRef(false);
  const processing = useRef(false);
  const installingRef = useRef(false);
  const mode = useRef<RecordingMode>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const consent = settings?.cloudConsent;
  const cloudEligible = Boolean(
    settings?.useSpeechInput &&
    settings.allowExternalFreeGeminiCalls &&
    consent?.policyVersion === CONVERSATION_POLICY_VERSION &&
    consent.isAdult &&
    consent.sendCurrentTurnOnlyAgreed &&
    consent.googleReviewDisclosureAgreed &&
    consent.noSensitiveInfoAgreed
  );
  const localEligible = Boolean(settings?.useSpeechInput);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      clearTimer();
      voiceInput.onAutoStop = undefined;
      voiceInput.cancelRecording();
      abort.current?.abort();
      localSpeechInput.cancel();
    };
  }, []);

  const processAudio = async (audio: RecordedAudioResult, id: number) => {
    if (!mounted.current || generation.current !== id || processing.current) return;
    processing.current = true;
    clearTimer();
    setRecording(false);
    setBusy(true);
    setMessage('음성 전사 중... 결과를 확인·편집한 뒤 직접 전송하세요.');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const transcript = await conversationApi.transcribeAudio(
        { audioBase64: audio.audioBase64, mimeType: audio.mimeType, durationSeconds: audio.durationSeconds },
        consent,
        controller.signal
      );
      if (mounted.current && generation.current === id) {
        onTranscribed(transcript);
        setMessage('전사 내용을 확인·수정한 뒤 전송하세요.');
      }
    } catch (error) {
      if (mounted.current && generation.current === id && !controller.signal.aborted) {
        setMessage(`음성 전사 불가: ${error instanceof Error ? error.message : '오류'}. 텍스트로 입력할 수 있습니다.`);
      }
    } finally {
      if (generation.current === id) {
        processing.current = false;
        if (mounted.current) setBusy(false);
        mode.current = null;
      }
      if (abort.current === controller) abort.current = null;
    }
  };

  const startLocal = async () => {
    if (disabled || !localEligible || starting.current || processing.current || recording || installingRef.current) return;
    starting.current = true;
    mode.current = 'local';
    const id = ++generation.current;
    setBusy(true);
    setMessage('음성을 듣는 중입니다... (말씀이 끝나면 완료 버튼을 누르거나 멈추세요)');
    setSeconds(0);
    try {
      setRecording(true);
      setBusy(false);
      starting.current = false;
      timer.current = setInterval(() => setSeconds(s => Math.min(30, s + 1)), 1000);
      const transcript = await localSpeechInput.start();
      if (!mounted.current || generation.current !== id) return;
      onTranscribed(transcript);
      setMessage('전사 내용을 확인·수정한 뒤 전송하세요.');
    } catch (error) {
      if (mounted.current && generation.current === id) {
        setMessage(`기기 음성 입력 불가: ${error instanceof Error ? error.message : '오류'}. 텍스트로 입력할 수 있습니다.`);
      }
    } finally {
      if (generation.current === id) {
        clearTimer();
        setRecording(false);
        setBusy(false);
        starting.current = false;
        mode.current = null;
      }
    }
  };

  const startCloud = async () => {
    if (disabled || !cloudEligible || starting.current || processing.current || recording || installingRef.current) return;
    starting.current = true;
    mode.current = 'cloud';
    const id = ++generation.current;
    setBusy(true);
    setMessage(null);
    setSeconds(0);
    voiceInput.onAutoStop = audio => { void processAudio(audio, id); };
    try {
      await voiceInput.startRecording();
      if (!mounted.current || generation.current !== id) return;
      setRecording(true);
      setBusy(false);
      timer.current = setInterval(() => setSeconds(s => Math.min(30, s + 1)), 1000);
    } catch (error) {
      if (mounted.current && generation.current === id) {
        setMessage(`${error instanceof Error ? error.message : '녹음 시작 실패'} 텍스트 입력을 사용하세요.`);
        setBusy(false);
        mode.current = null;
      }
    } finally {
      if (generation.current === id) starting.current = false;
    }
  };

  const installPack = async () => {
    if (disabled || busy || recording || installingRef.current || starting.current) return;
    installingRef.current = true;
    setInstalling(true);
    setMessage('영어 음성팩 설치 지원을 확인하고 다운로드를 요청합니다...');

    try {
      const Constructor =
        typeof window !== 'undefined'
          ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
          : typeof globalThis !== 'undefined'
          ? (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition
          : null;

      if (!Constructor) {
        throw new Error('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트 입력을 이용해 주세요.');
      }

      if (typeof Constructor.available !== 'function' || typeof Constructor.install !== 'function') {
        throw new Error('이 브라우저는 온디바이스 음성팩 설치 기능을 지원하지 않습니다. 최신 브라우저를 이용해 주세요.');
      }

      let probe: any;
      try {
        probe = new Constructor();
      } catch {
        throw new Error('음성 인식 초기화에 실패했습니다. 텍스트 입력을 이용해 주세요.');
      }

      if (!probe || !('processLocally' in probe)) {
        throw new Error('이 브라우저는 온디바이스(로컬) 음성 인식을 지원하지 않습니다.');
      }

      const installed = await Constructor.install({ langs: ['en-US'] });
      if (installed !== true) {
        throw new Error('영어 음성팩 설치에 실패했습니다.');
      }

      if (!mounted.current) return;
      setMessage('영어 음성팩 설치가 완료되었습니다. 이제 기기 입력을 사용할 수 있습니다.');
    } catch (error) {
      if (!mounted.current) return;
      setMessage(`음성팩 설치 불가: ${error instanceof Error ? error.message : '오류'}. 텍스트로 입력할 수 있습니다.`);
    } finally {
      installingRef.current = false;
      if (mounted.current) {
        setInstalling(false);
      }
    }
  };

  const stop = async () => {
    if (!recording) return;
    clearTimer();
    setRecording(false);
    setBusy(true);
    if (mode.current === 'local') {
      setMessage('음성 인식 정리 중...');
      try {
        localSpeechInput.stop();
      } catch (error) {
        if (mounted.current) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : '음성 인식 종료 실패');
        }
      }
    } else {
      try {
        await voiceInput.stopRecording();
      } catch (error) {
        if (mounted.current) {
          setBusy(false);
          setMessage(error instanceof Error ? error.message : '녹음 종료 실패');
        }
      }
    }
  };

  const cancel = () => {
    generation.current++;
    starting.current = false;
    processing.current = false;
    clearTimer();
    if (mode.current === 'local') {
      localSpeechInput.cancel();
    } else if (mode.current === 'cloud') {
      voiceInput.onAutoStop = undefined;
      voiceInput.cancelRecording();
      abort.current?.abort();
    } else {
      localSpeechInput.cancel();
      voiceInput.onAutoStop = undefined;
      voiceInput.cancelRecording();
      abort.current?.abort();
    }
    mode.current = null;
    setRecording(false);
    setBusy(false);
    setMessage('녹음을 취소했습니다.');
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, flex: '1 1 0', minWidth: 0, maxWidth: '100%' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {recording ? (
          <>
            <button
              type="button"
              className="conv-mic-btn recording"
              style={{
                width: 'auto',
                minWidth: '44px',
                minHeight: '44px',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
              onClick={stop}
              aria-label="녹음 완료 및 텍스트 변환"
            >
              ⏹️ 완료
            </button>
            <span>{seconds} / 30초</span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="conv-mic-btn"
              style={{
                width: 'auto',
                minWidth: '44px',
                minHeight: '44px',
                borderRadius: '8px',
                padding: '0 12px',
                fontSize: '14px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
              onClick={startLocal}
              disabled={disabled || busy || installing || !localEligible}
              aria-label="마이크 음성 녹음 시작"
            >
              🎤 기기 입력
            </button>
            <button
              type="button"
              className="conv-btn conv-btn-secondary"
              style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 12px' }}
              onClick={startCloud}
              disabled={disabled || busy || installing || !cloudEligible}
              aria-label="클라우드 음성 입력 (한도 사용)"
            >
              클라우드 음성 입력 (한도 사용)
            </button>
          </>
        )}
        <button
          type="button"
          className="conv-btn conv-btn-secondary"
          style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 12px' }}
          onClick={installPack}
          disabled={disabled || busy || recording || installing}
          aria-label="영어 음성팩 설치"
        >
          {installing ? '음성팩 설치 중...' : '영어 음성팩 설치'}
        </button>
        {(recording || busy) && (
          <button
            type="button"
            className="conv-btn conv-btn-secondary"
            style={{ minHeight: '44px' }}
            onClick={cancel}
          >
            녹음 취소
          </button>
        )}
      </div>
      <small style={{ color: 'var(--conv-text-secondary, #94a3b8)' }}>
        기기 입력은 Google 음성 인식 한도를 사용하지 않습니다. 지원 브라우저와 영어 음성팩이 필요합니다. (브라우저 영어 언어 데이터는 '영어 음성팩 설치' 버튼 클릭 시에만 다운로드됩니다.)
      </small>
      {!cloudEligible && (
        <small style={{ color: 'var(--conv-text-secondary, #94a3b8)' }}>
          클라우드 음성 입력은 별도 동의·서버 설정이 필요합니다.
        </small>
      )}
      {message && <small role="status" aria-live="polite">{message}</small>}
    </div>
  );
};

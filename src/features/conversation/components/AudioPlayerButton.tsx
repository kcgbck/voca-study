// src/features/conversation/components/AudioPlayerButton.tsx
// 음성 출력 및 배속 조절 컴포넌트 (공식 TTS 통합, 캐시 확인, 브라우저 안전 폴백, 44px 터치 규격)

import React, { useState, useEffect, useRef } from 'react';
import { voiceOutput } from '../services/voiceOutput';
import { conversationApi } from '../services/conversationApi';
import { storageService } from '../services/storageService';
import { CONVERSATION_POLICY_VERSION } from './ConversationSettingsModal';

interface AudioPlayerButtonProps {
  text: string;
  isKeyExpression?: boolean;
  showSpeedSelector?: boolean;
}

export const AudioPlayerButton: React.FC<AudioPlayerButtonProps> = ({
  text,
  isKeyExpression = false,
  showSpeedSelector = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<0.8 | 1.0 | 1.2>(1.0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      voiceOutput.cancel();
    };
  }, []);

  const handlePlay = async (useCloud: boolean = false) => {
    if (isMountedRef.current) setErrorMessage(null);

    if (isPlaying) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      voiceOutput.cancel();
      if (isMountedRef.current) setIsPlaying(false);
      return;
    }

    if (isMountedRef.current) setIsPlaying(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const settings = await storageService.getSettings();
      if (abortController.signal.aborted || !isMountedRef.current) return;
      const consent = settings.cloudConsent;
      const isCloudEligible =
        settings.allowExternalFreeGeminiCalls &&
        Boolean(
          consent?.isAdult &&
          consent?.sendCurrentTurnOnlyAgreed &&
          consent?.googleReviewDisclosureAgreed &&
          consent?.noSensitiveInfoAgreed &&
          consent?.policyVersion === CONVERSATION_POLICY_VERSION
        );

      let serverAudioBase64: string | undefined;
      let serverMimeType: string | undefined;

      if (useCloud) {
        if (!isCloudEligible) {
          if (isMountedRef.current) {
            setIsPlaying(false);
            setErrorMessage('클라우드 음성을 사용하려면 무료 API 동의 및 설정이 필요합니다.');
          }
          return;
        }

        // 1. 고정 표현 캐시 확인
        const cached = isKeyExpression ? voiceOutput.getCachedExpression(text) : undefined;
        if (cached) {
          serverAudioBase64 = cached.audioBase64;
          serverMimeType = cached.mimeType;
        } else {
          // 2. 캐시 미존재 시 same-origin 서버 TTS 1회 시도
          try {
            const ttsRes = await conversationApi.synthesizeSpeech(
              { text },
              {
                isAdult: true,
                sendCurrentTurnOnlyAgreed: true,
                googleReviewDisclosureAgreed: true,
                noSensitiveInfoAgreed: true,
              },
              abortController.signal
            );
            if (abortController.signal.aborted || !isMountedRef.current) return;
            serverAudioBase64 = ttsRes.audioBase64;
            serverMimeType = ttsRes.mimeType;
          } catch (ttsErr: any) {
            if (abortController.signal.aborted || !isMountedRef.current) return;
            // 실패 사유 고지 및 브라우저 fallback 명시
            setErrorMessage(`서버 TTS 호출 실패(${ttsErr?.message || '차단/한도'}). 브라우저 음성으로 대체합니다.`);
          }
        }
      }

      if (abortController.signal.aborted || !isMountedRef.current) return;

      const res = await voiceOutput.speak(text, {
        audioBase64: serverAudioBase64,
        mimeType: serverMimeType,
        isFixedKeyExpression: useCloud && isKeyExpression,
        lang: 'en-US',
        rate: playbackRate,
      });

      if (!isMountedRef.current || abortController.signal.aborted || abortControllerRef.current !== abortController) return;
      setIsPlaying(false);

      if (!res.success) {
        if (res.autoplayBlocked) {
          setErrorMessage('브라우저 정책으로 자동 재생이 차단되었습니다. 버튼을 다시 눌러주세요.');
        } else if (res.error) {
          setErrorMessage(res.error);
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current || abortController.signal.aborted || abortControllerRef.current !== abortController) return;
      setIsPlaying(false);
      setErrorMessage(err?.message || '음성 재생에 실패했습니다.');
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{ minHeight: '44px', padding: '8px 12px', fontSize: '13px' }}
          onClick={() => handlePlay(false)}
          aria-label={isPlaying ? '음성 재생 중지' : '음성 듣기'}
          title={isPlaying ? '음성 중지' : '발음 듣기'}
        >
          {isPlaying ? '⏹️ 중지' : '🔊 듣기'}
        </button>

        <button
          type="button"
          className="conv-btn conv-btn-secondary conv-touch-target"
          style={{ minHeight: '44px', padding: '8px 12px', fontSize: '13px' }}
          onClick={() => handlePlay(true)}
          disabled={isPlaying}
          aria-label="클라우드 음성 듣기 (한도 사용)"
          title="클라우드 음성 듣기 (한도 사용)"
        >
          클라우드 음성 듣기 (한도 사용)
        </button>

        {showSpeedSelector && (
          <div style={{ display: 'inline-flex', gap: '4px' }} aria-label="재생 속도 선택">
            {([0.8, 1.0, 1.2] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                className={`conv-btn ${playbackRate === rate ? 'conv-btn-primary' : 'conv-btn-secondary'} conv-touch-target`}
                style={{
                  minHeight: '44px',
                  minWidth: '44px',
                  padding: '6px 8px',
                  fontSize: '12px',
                }}
                onClick={() => setPlaybackRate(rate)}
                aria-label={`재생 속도 ${rate}배`}
              >
                {`${rate}x`}
              </button>
            ))}
          </div>
        )}
      </div>

      <span
        style={{ fontSize: '11px', color: 'var(--conv-text-muted, #666)', maxWidth: '320px', lineHeight: '1.4' }}
      >
        기본 듣기는 브라우저 음성을 사용합니다. 환경에 따라 브라우저 제공업체의 원격 음성 서비스가 사용될 수 있습니다.
      </span>

      {errorMessage && (
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: '11px', color: 'var(--conv-error)', maxWidth: '240px' }}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
};

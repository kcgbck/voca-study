// src/features/conversation/components/ConversationSettingsModal.tsx
// AI 회화 설정 모달 (로컬 고정교재 안내, 클라우드 동의 4종 명시 보존, 44px 터치 규격, ESC 닫기)

import React, { useState, useEffect, useRef } from 'react';
import type { ConversationSettings, CloudConsent } from '../types';
import { storageService } from '../services/storageService';

import { CONVERSATION_POLICY_VERSION } from '../types';
export { CONVERSATION_POLICY_VERSION } from '../types';

interface ConversationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: (newSettings: ConversationSettings) => void;
}

export const ConversationSettingsModal: React.FC<ConversationSettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<ConversationSettings>({
    allowExternalFreeGeminiCalls: false,
    useSpeechInput: true,
    speechConfirmationRequired: true,
    audioAutoPlay: false,
    engineMode: 'local_rule_engine',
  });

  // 클라우드 시험 참여를 위한 4대 필수 동의 상태 (임의 true 날조 금지, 저장된 데이터에서만 복원)
  const [isAdult, setIsAdult] = useState(false);
  const [sendCurrentTurnOnly, setSendCurrentTurnOnly] = useState(false);
  const [googleReviewDisclosure, setGoogleReviewDisclosure] = useState(false);
  const [noSensitiveInfo, setNoSensitiveInfo] = useState(false);
  const [validationNotice, setValidationNotice] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      storageService.getSettings().then((s) => {
        setSettings(s);
        // 정책 버전(v2.2-20261021) 일치 시에만 동의 유지, 구버전 동의는 자동 재활용 금지
        if (s.cloudConsent && s.cloudConsent.policyVersion === CONVERSATION_POLICY_VERSION) {
          setIsAdult(Boolean(s.cloudConsent.isAdult));
          setSendCurrentTurnOnly(Boolean(s.cloudConsent.sendCurrentTurnOnlyAgreed));
          setGoogleReviewDisclosure(Boolean(s.cloudConsent.googleReviewDisclosureAgreed));
          setNoSensitiveInfo(Boolean(s.cloudConsent.noSensitiveInfoAgreed));
        } else {
          setIsAdult(false);
          setSendCurrentTurnOnly(false);
          setGoogleReviewDisclosure(false);
          setNoSensitiveInfo(false);
        }
      });
      setValidationNotice(null);

      // 모달 열림 시 포커스 설정
      setTimeout(() => {
        modalRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      }, 0);
    } else if (previousActiveElementRef.current) {
      // 모달 닫힘 시 이전 포커스 복원
      previousActiveElementRef.current.focus();
    }
  }, [isOpen]);

  // Tab 키 트랩 및 ESC 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canEnableCloud =
    isAdult && sendCurrentTurnOnly && googleReviewDisclosure && noSensitiveInfo;

  const handleCloudToggle = (enabled: boolean) => {
    if (enabled && !canEnableCloud) {
      setValidationNotice('클라우드 AI 시험에 참여하려면 아래 4가지 필수 동의 항목에 모두 동의해야 합니다.');
      return;
    }
    setValidationNotice(null);
    setSettings((prev) => ({
      ...prev,
      allowExternalFreeGeminiCalls: enabled,
      engineMode: enabled ? 'mock_gemini_tutor' : 'local_rule_engine',
    }));
  };

  const handleSave = async () => {
    let cloudConsent: CloudConsent | undefined = undefined;

    if (canEnableCloud) {
      cloudConsent = {
        isAdult,
        sendCurrentTurnOnlyAgreed: sendCurrentTurnOnly,
        googleReviewDisclosureAgreed: googleReviewDisclosure,
        noSensitiveInfoAgreed: noSensitiveInfo,
        policyVersion: CONVERSATION_POLICY_VERSION,
        consentedAt: new Date().toISOString(),
      };
    }

    const updated = await storageService.saveSettings({
      ...settings,
      allowExternalFreeGeminiCalls: canEnableCloud && settings.allowExternalFreeGeminiCalls,
      cloudConsent,
      engineMode: canEnableCloud && settings.allowExternalFreeGeminiCalls ? 'mock_gemini_tutor' : 'local_rule_engine',
    });

    if (onSettingsSaved) onSettingsSaved(updated);
    onClose();
  };

  return (
    <div
      className="conv-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conv-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="conv-modal-content" ref={modalRef} tabIndex={-1}>
        <div className="conv-modal-header">
          <h3 id="conv-settings-title">⚙️ AI 회화 설정 및 이용 안내</h3>
          <button
            type="button"
            className="conv-btn conv-btn-secondary conv-touch-target"
            style={{ minHeight: '44px', minWidth: '44px', padding: '6px 12px' }}
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 1. 현재 모드 안내 */}
        <div className="conv-notice-card" style={{ marginBottom: '16px' }}>
          <div>
            <strong>🛡️ 현재: {settings.allowExternalFreeGeminiCalls ? '클라우드 요청 시도 모드 (무료 계정 적격/한도 미확인 · 기본 차단)' : '오프라인 고정 교재 모드 (규칙 엔진 기본)'}</strong>
            <p style={{ margin: '4px 0 0 0', lineHeight: 1.4 }}>
              {settings.allowExternalFreeGeminiCalls
                ? '외부 Gemini API 호출을 요청 시도합니다. 무료 계정 적격/한도는 미확인 상태이며 운영 서버는 기본 차단(403)되어 있습니다. 차단 시 오프라인 고정 교재 규칙 엔진으로 안전하게 자동 폴백됩니다.'
                : '외부 과금 및 개인정보 전송 없이 브라우저 로컬 규칙 엔진 및 32차시 교재 데이터로 안전하게 동작합니다.'}
            </p>
          </div>
        </div>

        {validationNotice && (
          <div
            role="alert"
            style={{
              background: 'var(--conv-warning-bg)',
              border: '1px solid var(--conv-warning)',
              color: 'var(--conv-text-primary)',
              padding: '10px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              marginBottom: '14px',
            }}
          >
            ⚠️ {validationNotice}
          </div>
        )}

        {/* 2. 클라우드 AI 외부 시험 동의 안내 */}
        <div style={{ marginBottom: '20px', padding: '14px', background: 'var(--conv-bg-subtle)', borderRadius: '12px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--conv-text-primary)' }}>
            🌐 클라우드 AI 시험 참여 동의 (선택 · 정책 v2.2)
          </h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--conv-text-secondary)', lineHeight: 1.4 }}>
            Google Gemini 모델 연결을 시험하려면 아래 4가지 항목에 모두 직접 동의해야 합니다. (무료 계정 적격/한도 미확인, 기본 차단 상태)
          </p>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={isAdult}
              onChange={(e) => {
                setIsAdult(e.target.checked);
                if (!e.target.checked) handleCloudToggle(false);
              }}
            />
            <span>만 19세 이상 성인 사용자 본인 확인</span>
          </label>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={sendCurrentTurnOnly}
              onChange={(e) => {
                setSendCurrentTurnOnly(e.target.checked);
                if (!e.target.checked) handleCloudToggle(false);
              }}
            />
            <span>현재 발화와 이 수업 최근 최대 6턴 최소 전송 동의 (기존 단어장, PDF, 사진 전송 절대 금지)</span>
          </label>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={googleReviewDisclosure}
              onChange={(e) => {
                setGoogleReviewDisclosure(e.target.checked);
                if (!e.target.checked) handleCloudToggle(false);
              }}
            />
            <span>Google 서비스 품질 개선 및 사람 검토 가능성 고지 확인</span>
          </label>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={noSensitiveInfo}
              onChange={(e) => {
                setNoSensitiveInfo(e.target.checked);
                if (!e.target.checked) handleCloudToggle(false);
              }}
            />
            <span>비밀번호, 주민번호 등 민감정보 및 개인정보 미포함 서약</span>
          </label>

          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>클라우드 AI 평가 연결 시도</span>
            <input
              type="checkbox"
              style={{ width: '22px', height: '22px', cursor: 'pointer' }}
              checked={settings.allowExternalFreeGeminiCalls}
              disabled={!canEnableCloud}
              onChange={(e) => handleCloudToggle(e.target.checked)}
            />
          </div>
          {!canEnableCloud && (
            <span style={{ fontSize: '11px', color: 'var(--conv-warning)', display: 'block', marginTop: '6px' }}>
              ※ 위 4개 항목에 모두 직접 동의해야 스위치를 활성화할 수 있습니다.
            </span>
          )}
        </div>

        {/* 3. 음성 및 편의 기능 */}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--conv-text-primary)' }}>
            🎙️ 음성 및 학습 편의
          </h4>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={settings.useSpeechInput}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  useSpeechInput: e.target.checked,
                }))
              }
            />
            <span>음성 입력(STT) 사용 (환경·마이크 권한 및 브라우저 지원 필요)</span>
          </label>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={settings.speechConfirmationRequired}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  speechConfirmationRequired: e.target.checked,
                }))
              }
            />
            <span>STT 음성 인식 후 텍스트 입력창에서 직접 확인·편집 후 전송 (체크 해제 시에도 무확인 자동 제출은 차단되며 사용자가 전송 버튼을 눌러야 전송됩니다)</span>
          </label>

          <label className="conv-checkbox-label">
            <input
              type="checkbox"
              checked={settings.audioAutoPlay}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  audioAutoPlay: e.target.checked,
                }))
              }
            />
            <span>튜터 응답 시 음성 자동 재생 (브라우저 자동 재생 정책에 따라 첫 클릭 전에는 소리가 차단될 수 있습니다)</span>
          </label>
        </div>

        {/* 저장 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            className="conv-btn conv-btn-secondary conv-touch-target"
            style={{ minHeight: '44px', minWidth: '80px' }}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="conv-btn conv-btn-primary conv-touch-target"
            style={{ minHeight: '44px', minWidth: '100px' }}
            onClick={handleSave}
          >
            설정 저장
          </button>
        </div>
      </div>
    </div>
  );
};

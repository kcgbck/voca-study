import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../storage/db';
import { downloadBackupFile, validateBackupFile, restoreBackupData, type BackupFileStructure } from '../../storage/backupService';
import { userService } from '../../services/userService';
import type { UserProfile } from '../../types/user';

export type ThemeMode = 'dark' | 'light' | 'system';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  instantGrading: boolean;
  onInstantGradingChange: (enabled: boolean) => void;
  shuffleOrder: boolean;
  onShuffleOrderChange: (enabled: boolean) => void;
  onOpenRanking?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  themeMode,
  onThemeChange,
  instantGrading,
  onInstantGradingChange,
  shuffleOrder,
  onShuffleOrderChange,
  onOpenRanking,
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showLinkSection, setShowLinkSection] = useState(false);
  const [inputDeviceCode, setInputDeviceCode] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [isSubmittingLink, setIsSubmittingLink] = useState(false);

  // 저장소 통계 및 상태
  const [storageStats, setStorageStats] = useState<{ words: number; books: number; history: number }>({
    words: 0,
    books: 0,
    history: 0,
  });
  const [storageMsg, setStorageMsg] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshStorageStats = async () => {
    try {
      const [w, b, h] = await Promise.all([
        db.words.count(),
        db.wordBooks.count(),
        db.studyHistory.count(),
      ]);
      setStorageStats({ words: w, books: b, history: h });
    } catch (e) {
      console.warn('저장소 통계 로드 실패:', e);
    }
  };

  useEffect(() => {
    // 1. standalone 모드 확인
    const checkStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(checkStandalone);

    // 2. iOS Safari 감지
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
    setIsIosSafari(isIos && isSafari && !checkStandalone);

    // 3. Chrome/Edge beforeinstallprompt 이벤트 캡처
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  useEffect(() => {
    if (isOpen) {
      refreshStorageStats();
      setStorageMsg('');
      const p = userService.getProfile();
      setUserProfile(p);
      setCodeCopied(false);
      setShowLinkSection(false);
      setInputDeviceCode('');
      setLinkError(null);
      setLinkSuccess(null);
    }
  }, [isOpen]);

  // 기기 코드 연동 처리
  const handleLinkDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    setLinkSuccess(null);

    const code = inputDeviceCode.trim().toUpperCase();
    if (!code) {
      setLinkError('기기 코드를 입력해 주세요.');
      return;
    }

    setIsSubmittingLink(true);
    const result = await userService.linkDeviceCode(code);
    setIsSubmittingLink(false);

    if (result.success && result.profile) {
      setUserProfile({ ...result.profile });
      setLinkSuccess(`계정 연동 완료! (${result.profile.nickname}님, ${result.profile.totalScore}점)`);
      setInputDeviceCode('');
      setTimeout(() => setShowLinkSection(false), 2200);
    } else {
      setLinkError(result.error || '기기 코드 연동에 실패했습니다.');
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // 백업 파일 다운로드
  const handleBackupExport = async () => {
    try {
      const fileName = await downloadBackupFile();
      setStorageMsg(`✓ 백업 완료: ${fileName}`);
    } catch (err) {
      setStorageMsg(`백업 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 백업 파일 복원 선택
  const handleRestoreFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as BackupFileStructure;
        const summary = validateBackupFile(parsed);
        if (!summary.valid) {
          setStorageMsg(`✕ 유효하지 않은 백업 파일: ${summary.errorMessage}`);
          return;
        }

        if (window.confirm(`백업 파일(${summary.wordsCount}개 단어, ${summary.wordBooksCount}개 단어장)을 복원하시겠습니까?`)) {
          const res = await restoreBackupData(parsed, 'merge');
          setStorageMsg(`✓ 복원 완료: ${res.restoredWords}개 단어 복원됨`);
          await refreshStorageStats();
        }
      } catch (err) {
        setStorageMsg(`복원 실패: ${err instanceof Error ? err.message : '파일 파싱 오류'}`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 저장소 초기화
  const handleStorageClear = async () => {
    if (!window.confirm('로컬에 저장된 모든 단어장과 학습 기록을 초기화하시겠습니까? (기본 1,800단어는 유지됩니다)')) return;
    try {
      await db.words.clear();
      await db.wordBooks.clear();
      await db.studyHistory.clear();
      setStorageMsg('✓ 로컬 데이터가 초기화되었습니다.');
      await refreshStorageStats();
    } catch (err) {
      setStorageMsg(`초기화 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">⚙️ 환경 설정</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* 내 학습자 계정 및 랭킹 연계 섹션 */}
          <div className="setting-section" style={{ background: 'rgba(99, 102, 241, 0.08)', borderRadius: '12px', padding: '12px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label className="setting-section-title" style={{ margin: 0, color: '#818cf8' }}>👤 내 학습자 계정</label>
              {onOpenRanking && (
                <button
                  type="button"
                  onClick={onOpenRanking}
                  style={{
                    background: '#4f46e5',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  🏆 랭킹 보드
                </button>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '6px' }}>
              <span style={{ color: '#94a3b8' }}>닉네임</span>
              <span style={{ fontWeight: 'bold' }}>{userProfile?.nickname || '학습자'}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '6px' }}>
              <span style={{ color: '#94a3b8' }}>기기 코드</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                  {userProfile?.deviceCode || '생성 중...'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (userProfile?.deviceCode) {
                      navigator.clipboard.writeText(userProfile.deviceCode);
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 2000);
                    }
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                  title="기기 코드 복사"
                >
                  {codeCopied ? '✅' : '📋'}
                </button>
              </div>
            </div>

            {/* 기기 코드 연동 섹션 (학습자 계정 하단) */}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: '1.4' }}>
                  스마트폰 변경 시 코드로 계정을 이어받을 수 있습니다.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowLinkSection(!showLinkSection);
                    setLinkError(null);
                    setLinkSuccess(null);
                  }}
                  className="btn-link-account"
                  style={{
                    padding: '5px 10px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    borderRadius: '6px',
                    flexShrink: 0,
                    background: showLinkSection ? '#3b82f6' : 'rgba(99, 102, 241, 0.25)',
                    color: '#ffffff',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🔗 기기 코드 연동
                </button>
              </div>

              {showLinkSection && (
                <form
                  onSubmit={handleLinkDevice}
                  style={{
                    marginTop: '10px',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                    이전 기기에서 발급된 코드를 입력하세요:
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={inputDeviceCode}
                      onChange={(e) => {
                        setInputDeviceCode(e.target.value.toUpperCase());
                        setLinkError(null);
                        setLinkSuccess(null);
                      }}
                      placeholder="예: VOCA-XXXX-XXXX"
                      style={{
                        flex: 1,
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: '#f8fafc',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        letterSpacing: '1px',
                        textTransform: 'uppercase',
                      }}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={isSubmittingLink}
                      style={{
                        background: '#2563eb',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: isSubmittingLink ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isSubmittingLink ? '연동 중...' : '계정 불러오기'}
                    </button>
                  </div>
                  {linkError && (
                    <p style={{ fontSize: '11px', color: '#f87171', margin: '6px 0 0 0' }}>
                      ⚠️ {linkError}
                    </p>
                  )}
                  {linkSuccess && (
                    <p style={{ fontSize: '11px', color: '#4ade80', margin: '6px 0 0 0', fontWeight: 'bold' }}>
                      🎉 {linkSuccess}
                    </p>
                  )}
                </form>
              )}
            </div>
          </div>

          {/* 테마 설정 */}
          <div className="setting-section">
            <label className="setting-section-title">🎨 화면 테마</label>
            <div className="theme-toggle-group">
              <button
                type="button"
                className={`theme-toggle-btn ${themeMode === 'dark' ? 'active' : ''}`}
                onClick={() => onThemeChange('dark')}
              >
                🌙 다크
              </button>
              <button
                type="button"
                className={`theme-toggle-btn ${themeMode === 'light' ? 'active' : ''}`}
                onClick={() => onThemeChange('light')}
              >
                ☀️ 라이트
              </button>
              <button
                type="button"
                className={`theme-toggle-btn ${themeMode === 'system' ? 'active' : ''}`}
                onClick={() => onThemeChange('system')}
              >
                📱 시스템
              </button>
            </div>
          </div>

          {/* 문제 풀이 설정 */}
          <div className="setting-section">
            <label className="setting-section-title">📝 문제 풀이 설정</label>
            
            {/* 랜덤 섞기 토글 */}
            <label className="checkbox-setting-label" style={{ marginBottom: '8px' }}>
              <input
                type="checkbox"
                checked={shuffleOrder}
                onChange={(e) => onShuffleOrderChange(e.target.checked)}
              />
              <span className="checkbox-text">🔀 문제 출제 순서 매번 랜덤 섞기</span>
            </label>
            <p className="setting-help-text" style={{ marginBottom: '12px' }}>
              퀴즈를 시작하거나 다시 풀 때마다 단어 순서가 무작위로 섞여 출제됩니다.
            </p>

            {/* 보기 즉시 채점 토글 */}
            <label className="checkbox-setting-label">
              <input
                type="checkbox"
                checked={instantGrading}
                onChange={(e) => onInstantGradingChange(e.target.checked)}
              />
              <span className="checkbox-text">보기 선택 즉시 채점 (빠른 풀이)</span>
            </label>
            <p className="setting-help-text">
              체크 해제 시(기본) 보기를 터치해도 바로 채점되지 않고 <strong>[정답 확인]</strong>을 눌러야 채점되어 터치 실수를 방지할 수 있습니다.
            </p>
          </div>

          {/* 저장소 관리 섹션 (사용자 지시: 저장소 탭을 없애고 설정창 안에 통합) */}
          <div className="setting-section">
            <label className="setting-section-title">💾 로컬 저장소 (IndexedDB)</label>
            <div className="storage-summary-box">
              <span>내 문제집: <strong>{storageStats.books}</strong>권</span>
              <span> | </span>
              <span>추출 단어: <strong>{storageStats.words}</strong>개</span>
              <span> | </span>
              <span>학습 기록: <strong>{storageStats.history}</strong>건</span>
            </div>

            <div className="storage-btn-group">
              <button
                type="button"
                className="btn btn-secondary btn-storage-action"
                onClick={handleBackupExport}
              >
                📥 백업 파일 저장
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-storage-action"
                onClick={() => fileInputRef.current?.click()}
              >
                📤 백업 파일 복원
              </button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".json"
                onChange={handleRestoreFileSelect}
              />
              <button
                type="button"
                className="btn btn-secondary btn-storage-action danger"
                onClick={handleStorageClear}
              >
                🗑️ 데이터 초기화
              </button>
            </div>

            {storageMsg && (
              <div className="storage-notice-msg">
                {storageMsg}
              </div>
            )}
          </div>

          {/* 홈 화면에 앱 설치하기 섹션 */}
          <div className="setting-section">
            <label className="setting-section-title">📲 앱 설치 (PWA)</label>
            {isStandalone ? (
              <div className="install-setting-box success">
                <span>✓ 현재 홈 화면 독립 앱으로 실행 중입니다.</span>
              </div>
            ) : deferredPrompt ? (
              <button className="btn-install" onClick={handleInstallClick}>
                ⬇ 홈 화면에 앱 설치하기
              </button>
            ) : isIosSafari ? (
              <div>
                <button
                  type="button"
                  className="btn-install-ios"
                  onClick={() => setShowIosGuide(!showIosGuide)}
                >
                  📱 iPhone 홈 화면에 추가하는 방법
                </button>
                {showIosGuide && (
                  <div className="ios-guide-box" style={{ marginTop: '8px' }}>
                    <p><strong>iPhone Safari 설치 방법:</strong></p>
                    <ol>
                      <li>하단 브라우저 메뉴의 <strong>공유 버튼 (⎋)</strong>을 누릅니다.</li>
                      <li>아래로 스크롤하여 <strong>'홈 화면에 추가 (⊞)'</strong>를 선택합니다.</li>
                      <li>우측 상단의 <strong>'추가'</strong>를 누르면 일반 앱처럼 실행됩니다.</li>
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="install-setting-box info">
                <span>💡 브라우저 메뉴의 [홈 화면에 추가] 또는 [앱 설치]를 선택하면 독립 앱으로 사용하실 수 있습니다.</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary modal-confirm-btn" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
};

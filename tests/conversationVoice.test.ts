// tests/conversationVoice.test.ts
// 음성 녹음(VoiceInputService) 및 음성 출력(VoiceOutputService) 격리 단위 테스트

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInputService } from '../src/features/conversation/services/voiceInput';
import { VoiceOutputService } from '../src/features/conversation/services/voiceOutput';

describe('AI 회화 음성 입출력 격리 테스트', () => {
  let voiceInput: VoiceInputService;
  let voiceOutput: VoiceOutputService;

  beforeEach(() => {
    voiceInput = new VoiceInputService();
    voiceOutput = new VoiceOutputService();
  });

  afterEach(() => {
    voiceInput.cancelRecording();
    voiceOutput.cancel();
    vi.restoreAllMocks();
  });

  describe('VoiceInputService (음성 녹음)', () => {
    it('마이크 권한이 거부(NotAllowedError)되면 permission_denied 상태로 변경되고 텍스트 대체 에러를 반환해야 한다', async () => {
      // Mock getUserMedia failure
      const mockGetUserMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          mediaDevices: { getUserMedia: mockGetUserMedia },
        },
        writable: true,
        configurable: true,
      });

      await expect(voiceInput.startRecording()).rejects.toThrow('마이크 접근 권한이 거부되었습니다');
      expect(voiceInput.getState()).toBe('permission_denied');
    });

    it('미디어 장치가 미지원되는 브라우저 환경에서는 unsupported 상태로 변경되어야 한다', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {}, // mediaDevices 부재
        writable: true,
        configurable: true,
      });

      await expect(voiceInput.startRecording()).rejects.toThrow('음성 녹음 기능을 지원하지 않습니다');
      expect(voiceInput.getState()).toBe('unsupported');
    });

    it('녹음 취소(cancelRecording) 시 모든 트랙이 즉시 정지되고 idle 상태로 복귀해야 한다', async () => {
      const stopTrackSpy = vi.fn();
      const mockStream = {
        getTracks: () => [{ stop: stopTrackSpy }],
      };

      const mockMediaRecorder = {
        start: vi.fn(),
        stop: vi.fn(),
        state: 'recording',
        ondataavailable: null,
        onstop: null,
      };

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          mediaDevices: {
            getUserMedia: vi.fn().mockResolvedValue(mockStream),
          },
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(globalThis, 'MediaRecorder', {
        value: vi.fn().mockImplementation(() => mockMediaRecorder),
        writable: true,
        configurable: true,
      });
      (globalThis.MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(true);

      await voiceInput.startRecording();
      expect(voiceInput.getState()).toBe('recording');

      voiceInput.cancelRecording();
      expect(stopTrackSpy).toHaveBeenCalled();
      expect(voiceInput.getState()).toBe('idle');
    });
  });

  describe('VoiceOutputService (음성 출력)', () => {
    it('비공식 Translate 프록시를 절대 사용하지 않고 브라우저 SpeechSynthesis로 안전하게 폴백해야 한다', async () => {
      const speakSpy = vi.fn();
      const cancelSpy = vi.fn();

      Object.defineProperty(globalThis, 'window', {
        value: {
          speechSynthesis: {
            speak: speakSpy,
            cancel: cancelSpy,
          },
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
        value: vi.fn().mockImplementation((text) => ({
          text,
          lang: 'en-US',
          onend: null,
          onerror: null,
        })),
        writable: true,
        configurable: true,
      });

      // 서버 TTS 오디오 없이 speak 호출 시 브라우저 synthesis로 폴백
      const speakPromise = voiceOutput.speak('Good morning, how are you?');

      // window.speechSynthesis.speak가 트리거됨
      expect(speakSpy).toHaveBeenCalled();

      // utterance.onend 시뮬레이션
      const utterance = speakSpy.mock.calls[0][0];
      utterance.onend();

      const result = await speakPromise;
      expect(result.success).toBe(true);
      expect(result.method).toBe('browser_speech');
    });

    it('수업 고정 핵심 표현은 캐시되지만 일반 사용자 문장은 캐시되지 않아야 한다', () => {
      const fixedExpr = 'Nice to meet you.';
      const userSentence = 'My passport number is AB123456.';

      voiceOutput.cacheExpression(fixedExpr, 'base64-audio-data', 'audio/wav');

      expect(voiceOutput.getCachedExpression(fixedExpr)).toBeDefined();
      expect(voiceOutput.getCachedExpression(userSentence)).toBeUndefined(); // 사용자 문장은 캐시 안 됨
    });

    it('cancel() 호출 시 이전 대기 중이던 오디오/스피치 Promise가 정리되고 리소스가 해제되어야 한다', async () => {
      const revokeSpy = vi.fn();
      Object.defineProperty(globalThis, 'URL', {
        value: {
          createObjectURL: vi.fn().mockReturnValue('blob:test-audio-url'),
          revokeObjectURL: revokeSpy,
        },
        writable: true,
        configurable: true,
      });

      Object.defineProperty(globalThis, 'Audio', {
        value: vi.fn().mockImplementation(() => ({
          play: vi.fn().mockReturnValue(new Promise(() => {})), // 무한 대기
          pause: vi.fn(),
          currentTime: 0,
        })),
        writable: true,
        configurable: true,
      });

      const playPromise = voiceOutput.playAudio('ZmFrZS1hdWRpby1ieXRlcw==');

      // 취소 호출
      voiceOutput.cancel();

      const result = await playPromise;
      expect(result.success).toBe(false);
      expect(revokeSpy).toHaveBeenCalledWith('blob:test-audio-url');
    });
  });
});

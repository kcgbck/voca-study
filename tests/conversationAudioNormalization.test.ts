// tests/conversationAudioNormalization.test.ts
// 기기 내 Web Audio 정규화 모듈 및 VoiceInputService 세션 경계 단위 테스트

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeRecordedAudio,
  AudioNormalizationError,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
} from '../src/features/conversation/services/audioNormalization';
import * as audioNormModule from '../src/features/conversation/services/audioNormalization';
import { VoiceInputService } from '../src/features/conversation/services/voiceInput';
import {
  parseAndValidateWavPcm16,
  calculateTranscribeEstimatedUnits,
} from '../src/features/conversation/server/budgetPolicy';
import { uint8ArrayToBase64 } from '../src/features/conversation/server/audioUtils';

describe('기기 내 오디오 정규화 (Audio Normalization)', () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow as any;
    }
  });

  it('1. Web Audio API 미지원 환경에서는 에러 없이 원본 Blob과 메타데이터를 fallback 반환해야 한다', async () => {
    // window.AudioContext 및 OfflineAudioContext 제거
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('OfflineAudioContext', undefined);
    vi.stubGlobal('window', {});

    const mockBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });
    const result = await normalizeRecordedAudio(mockBlob, 5);

    expect(result.normalized).toBe(false);
    expect(result.mimeType).toBe('audio/webm');
    expect(result.durationSeconds).toBe(5);
    expect(result.blob).toBe(mockBlob);
  });

  it('2. 정상 디코딩 시 16000Hz Mono 16-bit PCM WAV 헤더로 패키징되고 9000 유닛 이하로 서버 계량되어야 한다', async () => {
    const sampleRate = 16000;
    const durationSeconds = 1.0;
    const numFrames = sampleRate * durationSeconds;

    // 1초 분량의 440Hz 사인파 Float32Array 생성
    const floatSamples = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      floatSamples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const mockRenderedBuffer = {
      length: numFrames,
      duration: durationSeconds,
      sampleRate,
      numberOfChannels: 1,
      getChannelData: vi.fn().mockReturnValue(floatSamples),
    };

    const mockOfflineCtx = {
      createBufferSource: vi.fn().mockReturnValue({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
      }),
      destination: {},
      startRendering: vi.fn().mockResolvedValue(mockRenderedBuffer),
    };

    const mockAudioBuffer = {
      duration: durationSeconds,
      sampleRate: 48000,
      numberOfChannels: 2,
    };

    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const mockAudioCtx = {
      decodeAudioData: vi.fn().mockResolvedValue(mockAudioBuffer),
      close: closeSpy,
      state: 'running',
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioCtx));
    vi.stubGlobal('OfflineAudioContext', vi.fn().mockImplementation(() => mockOfflineCtx));
    vi.stubGlobal('window', {
      AudioContext: globalThis.AudioContext,
      OfflineAudioContext: globalThis.OfflineAudioContext,
    });

    const mockInputBlob = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });
    const result = await normalizeRecordedAudio(mockInputBlob, durationSeconds);

    expect(result.normalized).toBe(true);
    expect(result.mimeType).toBe('audio/wav');
    expect(result.durationSeconds).toBeCloseTo(durationSeconds, 2);
    expect(closeSpy).toHaveBeenCalled();

    // 서버 RIFF/WAV 헤더 구조 및 PCM 16-bit 검증
    const wavBytes = new Uint8Array(await result.blob.arrayBuffer());
    const wavInfo = parseAndValidateWavPcm16(wavBytes);
    expect(wavInfo.sampleRate).toBe(16000);
    expect(wavInfo.numChannels).toBe(1);
    expect(wavInfo.verifiedDuration).toBeCloseTo(durationSeconds, 2);

    // 서버 STT 계량 유닛(ceil(duration * 64) + 1024)이 9000 이하인지 확인
    const base64 = uint8ArrayToBase64(wavBytes);
    const estimatedUnits = calculateTranscribeEstimatedUnits({
      audioBase64: base64,
      mimeType: 'audio/wav',
      durationSeconds,
    });
    expect(estimatedUnits).toBeLessThanOrEqual(9000);
    expect(estimatedUnits).toBe(Math.ceil(durationSeconds * 64) + 1024);
  });

  it('3. 디코딩된 오디오 재생 시간이 30초를 초과하면 묵시적 truncate 없이 에러로 거절해야 한다', async () => {
    const mockAudioBuffer = {
      duration: 30.2, // 30초 초과
      sampleRate: 44100,
      numberOfChannels: 1,
    };

    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const mockAudioCtx = {
      decodeAudioData: vi.fn().mockResolvedValue(mockAudioBuffer),
      close: closeSpy,
      state: 'running',
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioCtx));
    vi.stubGlobal('OfflineAudioContext', vi.fn());
    vi.stubGlobal('window', {
      AudioContext: globalThis.AudioContext,
      OfflineAudioContext: globalThis.OfflineAudioContext,
    });

    const mockBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const assertion = normalizeRecordedAudio(mockBlob, 25);
    await expect(assertion).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(assertion).rejects.toThrow('디코딩된 오디오 시간(30.2초)이 최대 허용치(30초)를 초과했습니다');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('4. 입력 크기가 0이거나 2 MiB 초과, 지속시간이 0 이하이거나 30초 초과 시 즉시 거절해야 한다', async () => {
    const emptyBlob = new Blob([], { type: 'audio/webm' });
    await expect(normalizeRecordedAudio(emptyBlob, 5)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(emptyBlob, 5)).rejects.toThrow('오디오 데이터가 비어 있습니다');

    const oversizedBlob = { size: MAX_AUDIO_BYTES + 1, type: 'audio/webm' } as Blob;
    await expect(normalizeRecordedAudio(oversizedBlob, 5)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(oversizedBlob, 5)).rejects.toThrow('최대 허용치');

    const validBlob = new Blob([new Uint8Array(10)], { type: 'audio/webm' });
    await expect(normalizeRecordedAudio(validBlob, 0)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(validBlob, 0)).rejects.toThrow('유효하지 않은 녹음 시간');
    await expect(normalizeRecordedAudio(validBlob, -1)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(validBlob, NaN)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(validBlob, MAX_AUDIO_DURATION_SECONDS + 1)).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normalizeRecordedAudio(validBlob, MAX_AUDIO_DURATION_SECONDS + 1)).rejects.toThrow('최대 허용치(30초)를 초과');
  });

  it('5. 코덱 디코딩 실패 시 안전하게 압축 fallback을 반환하고 AudioContext를 정리해야 한다', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const mockAudioCtx = {
      decodeAudioData: vi.fn().mockRejectedValue(new Error('Unknown codec format')),
      close: closeSpy,
      state: 'running',
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioCtx));
    vi.stubGlobal('OfflineAudioContext', vi.fn());
    vi.stubGlobal('window', {
      AudioContext: globalThis.AudioContext,
      OfflineAudioContext: globalThis.OfflineAudioContext,
    });

    const mockBlob = new Blob([new Uint8Array(500)], { type: 'audio/ogg' });
    const result = await normalizeRecordedAudio(mockBlob, 3);

    expect(result.normalized).toBe(false);
    expect(result.mimeType).toBe('audio/ogg');
    expect(result.durationSeconds).toBe(3);
    expect(result.blob).toBe(mockBlob);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('6. 정규화 8초 데드라인 타임아웃 시 작업을 중단하고 AudioContext를 해제해야 한다', async () => {
    vi.useFakeTimers();

    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const mockAudioCtx = {
      decodeAudioData: vi.fn().mockImplementation(() => new Promise(() => {})), // 무한 지연
      close: closeSpy,
      state: 'running',
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioCtx));
    vi.stubGlobal('OfflineAudioContext', vi.fn());
    vi.stubGlobal('window', {
      AudioContext: globalThis.AudioContext,
      OfflineAudioContext: globalThis.OfflineAudioContext,
    });

    const mockBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const normPromise = normalizeRecordedAudio(mockBlob, 2);

    // 8000ms 시간 전진
    vi.advanceTimersByTime(8001);

    await expect(normPromise).rejects.toBeInstanceOf(AudioNormalizationError);
    await expect(normPromise).rejects.toThrow('8초 데드라인');
    expect(closeSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('7. Float32 샘플의 극값(1.0, -1.0, >1.0, <-1.0, NaN, Infinity)이 16-bit PCM으로 안전하게 클램핑되어야 한다', async () => {
    const testSamples = new Float32Array([1.0, -1.0, 1.8, -2.5, 0.0, NaN, Infinity, -Infinity]);
    const numFrames = testSamples.length;

    const mockRenderedBuffer = {
      length: numFrames,
      duration: numFrames / 16000,
      sampleRate: 16000,
      numberOfChannels: 1,
      getChannelData: vi.fn().mockReturnValue(testSamples),
    };

    const mockOfflineCtx = {
      createBufferSource: vi.fn().mockReturnValue({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
      }),
      destination: {},
      startRendering: vi.fn().mockResolvedValue(mockRenderedBuffer),
    };

    const mockAudioCtx = {
      decodeAudioData: vi.fn().mockResolvedValue({ duration: 0.1 }),
      close: vi.fn().mockResolvedValue(undefined),
      state: 'running',
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => mockAudioCtx));
    vi.stubGlobal('OfflineAudioContext', vi.fn().mockImplementation(() => mockOfflineCtx));
    vi.stubGlobal('window', {
      AudioContext: globalThis.AudioContext,
      OfflineAudioContext: globalThis.OfflineAudioContext,
    });

    const mockBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const result = await normalizeRecordedAudio(mockBlob, 0.1);

    const wavBytes = new Uint8Array(await result.blob.arrayBuffer());
    // 44바이트 헤더 이후 16-bit PCM 정수값 검증
    const pcmDataView = new DataView(wavBytes.buffer, 44, numFrames * 2);

    expect(pcmDataView.getInt16(0, true)).toBe(32767); // 1.0 -> 32767
    expect(pcmDataView.getInt16(2, true)).toBe(-32768); // -1.0 -> -32768
    expect(pcmDataView.getInt16(4, true)).toBe(32767); // 1.8 -> clamped 32767
    expect(pcmDataView.getInt16(6, true)).toBe(-32768); // -2.5 -> clamped -32768
    expect(pcmDataView.getInt16(8, true)).toBe(0); // 0.0 -> 0
    expect(pcmDataView.getInt16(10, true)).toBe(0); // NaN -> 0
    expect(pcmDataView.getInt16(12, true)).toBe(0); // Infinity -> 0
    expect(pcmDataView.getInt16(14, true)).toBe(0); // -Infinity -> 0
  });

  it.each([
    { action: 'resolve', outcome: '지연 decode 완료(성공)' },
    { action: 'reject', outcome: '지연 decode 실패(오류)' },
  ])(
    '8. 녹음 취소 후 이전 $outcome가 새 세션을 손상시키지 않아야 한다',
    async ({ action }) => {
      let resolveOldDecode!: (val: audioNormModule.NormalizedAudioResult) => void;
      let rejectOldDecode!: (err: Error) => void;
      const oldDecodePromise = new Promise<audioNormModule.NormalizedAudioResult>((resolve, reject) => {
        resolveOldDecode = resolve;
        rejectOldDecode = reject;
      });

      // normalizeRecordedAudio를 스파이하여 제어 가능한 지연 생성
      let callCount = 0;
      vi.spyOn(audioNormModule, 'normalizeRecordedAudio').mockImplementation(async (blob, dur) => {
        callCount++;
        if (callCount === 1) {
          return oldDecodePromise;
        }
        return {
          blob,
          mimeType: 'audio/wav',
          durationSeconds: dur,
          normalized: true,
        };
      });

      const service = new VoiceInputService();
      const trackStopSpy1 = vi.fn();
      const trackStopSpy2 = vi.fn();

      class MockRecorder {
        state = 'inactive';
        mimeType = 'audio/webm';
        onstop: (() => void) | null = null;
        ondataavailable: ((e: any) => void) | null = null;
        onerror: null = null;
        static isTypeSupported() {
          return true;
        }
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      }

      vi.stubGlobal('MediaRecorder', MockRecorder);
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi
            .fn()
            .mockResolvedValueOnce({ getTracks: () => [{ stop: trackStopSpy1 }] })
            .mockResolvedValueOnce({ getTracks: () => [{ stop: trackStopSpy2 }] }),
        },
      });

      // 세션 1 시작 및 stop 시도 (지연 decode 상태)
      await service.startRecording();
      const stopPromise1 = service.stopRecording();
      // 마이크 트랙은 즉시 정리되었음
      expect(trackStopSpy1).toHaveBeenCalledTimes(1);

      // 세션 1 대기 중에 cancel 호출 -> 새 세션 2 시작
      service.cancelRecording();
      await expect(stopPromise1).rejects.toThrow('녹음이 취소되었습니다');

      await service.startRecording();
      expect(service.getState()).toBe('recording');

      // 세션 1의 지연 decode 결과가 늦게 도착하여 resolve 또는 reject 발생
      if (action === 'resolve') {
        resolveOldDecode({
          blob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
          mimeType: 'audio/wav',
          durationSeconds: 1,
          normalized: true,
        });
      } else {
        rejectOldDecode(new Error('late decode failure'));
      }
      await Promise.resolve();
      await Promise.resolve();

      // 이전 세션 1의 지연 성공/실패가 새 세션 2의 recording 상태와 마이크 트랙을 건드리지 않아야 함
      expect(service.getState()).toBe('recording');
      expect(trackStopSpy2).not.toHaveBeenCalled();

      // 세션 2 정상 종료 확인
      const stopPromise2 = service.stopRecording();
      const result2 = await stopPromise2;
      expect(result2.mimeType).toBe('audio/wav');
      expect(service.getState()).toBe('idle');
    }
  );
});

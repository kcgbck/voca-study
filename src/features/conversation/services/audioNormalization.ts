// src/features/conversation/services/audioNormalization.ts
// 기기 내 Web Audio API 기반 오디오 정규화 모듈 (PCM 16-bit 16000Hz Mono WAV 변환)
// [원칙]
// 1. 외부 API, 네트워크, 외부 라이브러리, 다운로드 일체 없음 (브라우저 내장 Web Audio만 사용)
// 2. getUserMedia 호출 없음 (이미 녹음된 Blob만 처리)
// 3. AudioContext / OfflineAudioContext 미지원 환경에서는 원본 Blob을 보수적 fallback으로 반환 (Node 환경 mock 테스트 호환)
// 4. decodeAudioData 및 OfflineAudioContext 렌더링에 유한 데드라인(8초) 적용
// 5. 모든 정상/예외 경로에서 AudioContext close() 수행 (리소스 누수 방지)
// 6. 30초 초과, 빈 Blob, 2 MiB 초과 등 무효 오디오는 fallback으로 은폐하지 않고 즉시 에러 발생

import { pcm16ToWav } from '../server/audioUtils';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_AUDIO_DURATION_SECONDS = 30; // 30초
export const DECODE_TIMEOUT_MS = 8000; // 8초 유한 데드라인
export const TARGET_SAMPLE_RATE = 16000; // 16kHz
export const TARGET_CHANNELS = 1; // Mono

export interface NormalizedAudioResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  normalized: boolean;
}

export class AudioNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioNormalizationError';
  }
}

/**
 * 기기 내에서 녹음된 오디오 Blob을 16kHz 16-bit Mono Linear PCM WAV 포맷으로 정규화
 */
export async function normalizeRecordedAudio(
  blob: Blob,
  recordingDurationSeconds: number
): Promise<NormalizedAudioResult> {
  // 1. 기본 유효성 사전 검사 (무효 오디오는 fallback으로 은폐하지 않고 즉시 실패)
  if (!blob || blob.size === 0) {
    throw new AudioNormalizationError('오디오 데이터가 비어 있습니다.');
  }

  if (blob.size > MAX_AUDIO_BYTES) {
    throw new AudioNormalizationError(
      `오디오 파일 크기(${blob.size} 바이트)가 최대 허용치(${MAX_AUDIO_BYTES} 바이트)를 초과했습니다.`
    );
  }

  if (
    typeof recordingDurationSeconds !== 'number' ||
    !Number.isFinite(recordingDurationSeconds) ||
    Number.isNaN(recordingDurationSeconds) ||
    recordingDurationSeconds <= 0
  ) {
    throw new AudioNormalizationError('유효하지 않은 녹음 시간(duration)입니다.');
  }

  if (recordingDurationSeconds > MAX_AUDIO_DURATION_SECONDS) {
    throw new AudioNormalizationError(
      `녹음 시간(${recordingDurationSeconds}초)이 최대 허용치(${MAX_AUDIO_DURATION_SECONDS}초)를 초과했습니다.`
    );
  }

  // 2. Web Audio API 지원 여부 확인 (미지원 환경에서는 Blob 읽기 전에 원본 그대로 반환하여 기존 Node 환경 mock 시험 지원)
  const AudioCtxClass =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      : typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
      : undefined;

  const OfflineCtxClass =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
      : typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
      : undefined;

  if (!AudioCtxClass || !OfflineCtxClass) {
    return {
      blob,
      mimeType: blob.type || 'audio/webm',
      durationSeconds: recordingDurationSeconds,
      normalized: false,
    };
  }

  // 3. AudioContext 초기화 및 8초 유한 데드라인 설정
  let audioCtx: AudioContext | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isExpired = false;

  try {
    audioCtx = new AudioCtxClass();

    const normalizationPromise = (async (): Promise<NormalizedAudioResult> => {
      // 4. Blob을 ArrayBuffer로 읽기
      const arrayBuffer = await blob.arrayBuffer();
      if (isExpired) {
        throw new AudioNormalizationError('오디오 정규화 작업 시간이 초과되었습니다 (8초 데드라인).');
      }

      // 5. 오디오 디코딩
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioCtx!.decodeAudioData(arrayBuffer);
      } catch (decodeErr: unknown) {
        if (isExpired) {
          throw new AudioNormalizationError('오디오 정규화 작업 시간이 초과되었습니다 (8초 데드라인).');
        }
        // 브라우저 미지원 코덱 등으로 디코딩 실패 시 압축 원본 보수적 fallback (서버 예산 제약은 남음)
        return {
          blob,
          mimeType: blob.type || 'audio/webm',
          durationSeconds: recordingDurationSeconds,
          normalized: false,
        };
      }

      if (isExpired) {
        throw new AudioNormalizationError('오디오 정규화 작업 시간이 초과되었습니다 (8초 데드라인).');
      }

      const decodedDuration = audioBuffer.duration;
      if (
        typeof decodedDuration !== 'number' ||
        !Number.isFinite(decodedDuration) ||
        Number.isNaN(decodedDuration) ||
        decodedDuration <= 0
      ) {
        throw new AudioNormalizationError('디코딩된 오디오 재생 시간이 유효하지 않습니다.');
      }

      // 30초 초과 시 묵시적 truncate 금지 -> 즉시 실패
      if (decodedDuration > MAX_AUDIO_DURATION_SECONDS) {
        throw new AudioNormalizationError(
          `디코딩된 오디오 시간(${decodedDuration.toFixed(1)}초)이 최대 허용치(${MAX_AUDIO_DURATION_SECONDS}초)를 초과했습니다.`
        );
      }

      // 6. OfflineAudioContext로 Mono 16000Hz 리샘플링
      const targetFrames = Math.max(1, Math.round(decodedDuration * TARGET_SAMPLE_RATE));
      const offlineCtx = new OfflineCtxClass(TARGET_CHANNELS, targetFrames, TARGET_SAMPLE_RATE);

      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(offlineCtx.destination);
      sourceNode.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      if (isExpired) {
        throw new AudioNormalizationError('오디오 정규화 작업 시간이 초과되었습니다 (8초 데드라인).');
      }
      const resampledFrames = renderedBuffer.length;
      const verifiedDuration = resampledFrames / TARGET_SAMPLE_RATE;

      // 7. Float32Array를 16-bit Linear PCM Little-Endian 바이트로 변환 (클램핑 & 유한성 검사)
      const channelData = renderedBuffer.getChannelData(0);
      const pcmBytes = new Uint8Array(channelData.length * 2);
      const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

      for (let i = 0; i < channelData.length; i++) {
        let sample = channelData[i];
        if (!Number.isFinite(sample) || Number.isNaN(sample)) {
          sample = 0;
        } else if (sample > 1) {
          sample = 1;
        } else if (sample < -1) {
          sample = -1;
        }

        const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        const clampedInt = Math.max(-32768, Math.min(32767, intSample));
        view.setInt16(i * 2, clampedInt, true);
      }

      // 8. 44바이트 RIFF/WAV 헤더 패키징 (순수 유틸 pcm16ToWav 재사용)
      const wavBytes = pcm16ToWav(pcmBytes, TARGET_SAMPLE_RATE, TARGET_CHANNELS);

      // 9. owned copy로 ArrayBuffer 생성하여 Blob 생성
      const ownedBuffer = new Uint8Array(wavBytes).buffer;
      const normalizedBlob = new Blob([ownedBuffer], { type: 'audio/wav' });

      return {
        blob: normalizedBlob,
        mimeType: 'audio/wav',
        durationSeconds: verifiedDuration,
        normalized: true,
      };
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        isExpired = true;
        reject(new AudioNormalizationError('오디오 정규화 작업 시간이 초과되었습니다 (8초 데드라인).'));
      }, DECODE_TIMEOUT_MS);
    });

    return await Promise.race([normalizationPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (audioCtx) {
      try {
        if (typeof audioCtx.close === 'function' && audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      } catch {
        // ignore close error
      }
    }
  }
}

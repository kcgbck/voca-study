// src/features/conversation/whisper/whisperAudioRecorder.ts
// 마이크 getUserMedia 10초 캡처, 16kHz 모노 리샘플링, 에너지 VAD, 15초 권한 상한, 디코딩 15초 상한 및 취소 격리

export interface WhisperAudioRecorderDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: (options?: AudioContextOptions) => AudioContext;
  clockNow?: () => number;
}

export interface WhisperRecordOptions {
  maxDurationMs?: number; // 기본 10000ms, 최대 10000ms로 clamp
  onReady?: () => void;
  onEnergy?: (rms: number) => void;
}

export interface WhisperRecordResult {
  audio: Float32Array; // 16kHz 모노 PCM
  durationSec: number;
  isSilent: boolean;
  sampleCount: number;
}

/**
 * 16kHz 모노 Float32Array로 다운믹스, 선형 보간 리샘플링, 유한성 검사 및 클램핑 (순수 함수)
 */
export function resampleTo16kHzMono(audioBuffer: AudioBuffer): Float32Array {
  const srcRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const srcLength = audioBuffer.length;

  if (srcLength === 0 || numChannels === 0) {
    return new Float32Array(0);
  }

  // 모노 다운믹스
  const mono = new Float32Array(srcLength);
  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < srcLength; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  let rawSamples: Float32Array;
  if (srcRate === 16000) {
    rawSamples = mono;
  } else {
    // 선형 보간 리샘플링
    const targetLength = Math.round((srcLength * 16000) / srcRate);
    rawSamples = new Float32Array(targetLength);
    const ratio = srcRate / 16000;

    for (let i = 0; i < targetLength; i++) {
      const srcPos = i * ratio;
      const index = Math.floor(srcPos);
      const frac = srcPos - index;

      if (index + 1 < srcLength) {
        rawSamples[i] = mono[index] * (1 - frac) + mono[index + 1] * frac;
      } else {
        rawSamples[i] = mono[index] || 0;
      }
    }
  }

  // 최대 176,000 samples (11초) 상한 자르기
  const maxSamples = 176000;
  const finalLength = Math.min(rawSamples.length, maxSamples);
  const result = new Float32Array(finalLength);

  for (let i = 0; i < finalLength; i++) {
    const val = rawSamples[i];
    if (!Number.isFinite(val)) {
      result[i] = 0;
    } else if (val > 1) {
      result[i] = 1;
    } else if (val < -1) {
      result[i] = -1;
    } else {
      result[i] = val;
    }
  }

  return result;
}

/**
 * 단순 에너지 무음 필터 (기초 RMS 신호 검사, 정밀 VAD 아님)
 */
export function checkSilence(samples: Float32Array): boolean {
  if (samples.length < 3200) {
    // 0.2초(3,200 samples) 미만은 발화 신호 부족으로 판정
    return true;
  }

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);

  // RMS가 극히 낮으면 디지털 무음
  return rms < 0.003;
}

export class WhisperAudioRecorder {
  private activeStream: MediaStream | null = null;
  private activeAudioContext: AudioContext | null = null;
  private activeRecorder: MediaRecorder | null = null;
  private isRecording = false;
  private generation = 0;
  private recordTimeout: any = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(private deps: WhisperAudioRecorderDeps = {}) {}

  /**
   * 음성 녹음 시작 (최대 10초 또는 stop 호출 시 종료)
   */
  public async record(options: WhisperRecordOptions = {}): Promise<WhisperRecordResult> {
    if (this.isRecording) {
      throw new Error('이미 녹음이 진행 중입니다.');
    }

    const currentGen = ++this.generation;
    this.isRecording = true;

    // 최대 녹음 시간 10초(10000ms) clamp
    const requestedMs = options.maxDurationMs ?? 10000;
    const maxMs = Math.max(500, Math.min(10000, requestedMs));

    // 오퍼레이션 로컬 타이머 관리자
    let localPermissionTimer: any = null;
    let localDecodeTimer: any = null;

    return new Promise<WhisperRecordResult>(async (resolve, reject) => {
      this.pendingReject = reject;

      // 1. AudioContext 준비
      const AudioCtxConstructor =
        this.deps.createAudioContext ||
        ((opts?: AudioContextOptions) => {
          const Ctx = window.AudioContext || (window as any).webkitAudioContext;
          return new Ctx(opts);
        });

      let localCtx: AudioContext;
      try {
        localCtx = AudioCtxConstructor();
        this.activeAudioContext = localCtx;
        if (localCtx.state === 'suspended') {
          await localCtx.resume();
        }
      } catch (err: any) {
        if (this.generation !== currentGen) return;
        this.cleanup();
        reject(new Error(`오디오 컨텍스트 초기화 실패: ${err?.message || '오류'}`));
        return;
      }

      if (this.generation !== currentGen || !this.isRecording) {
        try {
          localCtx.close().catch(() => {});
        } catch {
          // ignore
        }
        reject(new Error('녹음이 취소되었습니다.'));
        return;
      }

      // 2. getUserMedia 권한 요청 (15초 상한, local timer로 다른 세대 타이머 건드림 방지)
      const getUserMediaFn =
        this.deps.getUserMedia ||
        ((constraints) => navigator.mediaDevices.getUserMedia(constraints));

      let permissionSettled = false;
      const permissionPromise = getUserMediaFn({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 15초 초과 후 늦게 도착한 스트림도 즉시 stop 처리하는 가드
      permissionPromise
        .then((stream) => {
          if (permissionSettled || this.generation !== currentGen || !this.isRecording) {
            try {
              stream.getTracks().forEach((t) => t.stop());
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {
          // ignore late error
        });

      let localStream: MediaStream;
      try {
        const deadlinePromise = new Promise<never>((_, rej) => {
          localPermissionTimer = setTimeout(() => {
            localPermissionTimer = null;
            rej(new Error('마이크 권한 획득 시간이 초과되었습니다 (15초).'));
          }, 15000);
        });

        localStream = await Promise.race([permissionPromise, deadlinePromise]);
        permissionSettled = true;
      } catch (err: any) {
        permissionSettled = true;
        if (this.generation !== currentGen) return;
        this.cleanup();
        reject(new Error(`마이크 접근 실패: ${err?.message || '권한 거부'}`));
        return;
      } finally {
        if (localPermissionTimer) {
          clearTimeout(localPermissionTimer);
          localPermissionTimer = null;
        }
      }

      if (this.generation !== currentGen || !this.isRecording) {
        try {
          localStream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        this.cleanup();
        reject(new Error('녹음이 시작 전 취소되었습니다.'));
        return;
      }
      this.activeStream = localStream;

      // 3. MediaRecorder 캡처 (2MiB 상한 초과 시 명시적 실패)
      const chunks: Blob[] = [];
      let totalBytes = 0;
      const maxBytes = 2 * 1024 * 1024; // 2 MiB

      let mimeType = 'audio/webm;codecs=opus';
      if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }

      let localRecorder: MediaRecorder;
      try {
        localRecorder = mimeType
          ? new MediaRecorder(localStream, { mimeType })
          : new MediaRecorder(localStream);
        this.activeRecorder = localRecorder;
      } catch {
        this.cleanup();
        reject(new Error('MediaRecorder 초기화에 실패했습니다.'));
        return;
      }

      let exceededLimit = false;

      localRecorder.ondataavailable = (event) => {
        if (this.generation !== currentGen) return;
        if (event.data && event.data.size > 0) {
          totalBytes += event.data.size;
          if (totalBytes > maxBytes) {
            exceededLimit = true;
            this.stopRecording();
            return;
          }
          chunks.push(event.data);
        }
      };

      localRecorder.onstop = async () => {
        // onstop 시작 즉시 마이크 트랙 중단하여 디코딩 중 마이크 끄기
        try {
          localStream.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }

        if (this.generation !== currentGen) return;
        this.clearRecordTimeout();

        if (exceededLimit) {
          this.cleanup();
          reject(new Error('녹음 데이터 크기가 최대 허용치(2 MiB)를 초과했습니다.'));
          return;
        }

        const recordedBlob = new Blob(chunks, { type: localRecorder.mimeType || 'audio/webm' });

        try {
          const arrayBuffer = await recordedBlob.arrayBuffer();

          // decodeAudioData 15초 상한 설정 (디코딩 멈춤 시 무한 대기 방지)
          const decodePromise = localCtx.decodeAudioData(arrayBuffer);
          const decodeDeadlinePromise = new Promise<never>((_, rej) => {
            localDecodeTimer = setTimeout(() => {
              localDecodeTimer = null;
              try {
                localCtx.close().catch(() => {});
              } catch {
                // ignore
              }
              rej(new Error('오디오 디코딩 시간이 초과되었습니다 (15초).'));
            }, 15000);
          });

          const decodedBuffer = await Promise.race([decodePromise, decodeDeadlinePromise]);
          if (localDecodeTimer) {
            clearTimeout(localDecodeTimer);
            localDecodeTimer = null;
          }

          if (this.generation !== currentGen) {
            try {
              localCtx.close().catch(() => {});
            } catch {
              // ignore
            }
            return;
          }

          const pcm16k = resampleTo16kHzMono(decodedBuffer);
          const isSilent = checkSilence(pcm16k);
          const durationSec = Math.round((pcm16k.length / 16000) * 10) / 10;

          this.cleanup();
          resolve({
            audio: pcm16k,
            durationSec,
            isSilent,
            sampleCount: pcm16k.length,
          });
        } catch (decodeErr: any) {
          if (localDecodeTimer) {
            clearTimeout(localDecodeTimer);
            localDecodeTimer = null;
          }
          if (this.generation !== currentGen) return;
          this.cleanup();
          reject(new Error(`오디오 디코딩 실패: ${decodeErr?.message || '오류'}`));
        }
      };

      localRecorder.onerror = (err: any) => {
        if (this.generation !== currentGen) return;
        this.cleanup();
        reject(new Error(`MediaRecorder 에러: ${err?.message || '녹음 에러'}`));
      };

      try {
        localRecorder.start(250);
        try {
          options.onReady?.();
        } catch {
          // onReady 콜백 에러 격리
        }

        this.recordTimeout = setTimeout(() => {
          if (this.generation === currentGen) {
            this.stopRecording();
          }
        }, maxMs);
      } catch (startErr: any) {
        if (this.generation !== currentGen) return;
        this.cleanup();
        reject(new Error(`녹음 시작 실패: ${startErr?.message || '오류'}`));
      }
    });
  }

  public stop(): void {
    this.stopRecording();
  }

  public cancel(): void {
    this.generation++; // 세대 증가로 pending onstop/decode 무력화
    this.clearRecordTimeout();

    if (this.pendingReject) {
      try {
        this.pendingReject(new Error('녹음이 취소되었습니다.'));
      } catch {
        // ignore
      }
      this.pendingReject = null;
    }

    // MediaRecorder 핸들러 즉시 해제 후 안전 stop
    if (this.activeRecorder) {
      const rec = this.activeRecorder;
      this.activeRecorder = null;
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      try {
        if (rec.state === 'recording') {
          rec.stop();
        }
      } catch {
        // ignore
      }
    }

    if (this.activeStream) {
      try {
        this.activeStream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      this.activeStream = null;
    }

    if (this.activeAudioContext) {
      try {
        this.activeAudioContext.close().catch(() => {});
      } catch {
        // ignore
      }
      this.activeAudioContext = null;
    }

    this.isRecording = false;
  }

  private stopRecording(): void {
    this.clearRecordTimeout();
    if (this.activeRecorder && this.activeRecorder.state === 'recording') {
      try {
        this.activeRecorder.stop();
      } catch {
        // ignore
      }
    }
  }

  private cleanup(): void {
    this.clearRecordTimeout();
    if (this.activeStream) {
      try {
        this.activeStream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      this.activeStream = null;
    }
    if (this.activeAudioContext) {
      try {
        this.activeAudioContext.close().catch(() => {});
      } catch {
        // ignore
      }
      this.activeAudioContext = null;
    }
    this.activeRecorder = null;
    this.isRecording = false;
    this.pendingReject = null;
  }

  private clearRecordTimeout(): void {
    if (this.recordTimeout) {
      clearTimeout(this.recordTimeout);
      this.recordTimeout = null;
    }
  }
}

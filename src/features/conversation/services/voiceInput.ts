// src/features/conversation/services/voiceInput.ts
// 브라우저 MediaRecorder 기반 음성 입력 서비스 (권한 거부 대응, 30초/2MiB 제한, 트랙 즉각 해제)

import { normalizeRecordedAudio } from './audioNormalization';

export type VoiceInputState =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'permission_denied'
  | 'unsupported'
  | 'error';

export interface RecordedAudioResult {
  audioBlob: Blob;
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
}

export class VoiceInputService {
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private state: VoiceInputState = 'idle';
  private startTime = 0;
  private autoStopTimer: any = null;
  private totalBytes = 0;
  private isCancelled = false;
  private currentMediaSessionId = 0;
  private pendingStopResolve: ((value: RecordedAudioResult) => void) | null = null;
  private pendingStopReject: ((reason?: any) => void) | null = null;
  public onAutoStop?: (result: RecordedAudioResult) => void;

  public static readonly MAX_DURATION_SECONDS = 30;
  public static readonly MAX_BYTES = 2 * 1024 * 1024; // 2 MiB

  public getState(): VoiceInputState {
    return this.state;
  }

  public getOptimalMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return 'audio/webm';
    }

    const candidateMimes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
    ];

    for (const mime of candidateMimes) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }

    return '';
  }

  /**
   * 사용자 제스처 기반 녹음 시작 (getUserMedia 대기 중 취소 레이스 완벽 방어)
   */
  public async startRecording(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.state = 'unsupported';
      throw new Error('이 브라우저는 음성 녹음 기능을 지원하지 않습니다. 텍스트 입력을 사용해주세요.');
    }

    const sessionId = ++this.currentMediaSessionId;
    this.isCancelled = false;
    this.cleanupStream();

    try {
      const streamPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const stream = await streamPromise;

      // 만약 getUserMedia 비동기 대기 도중 취소(cancelRecording)되었거나 새 세션이 시작된 경우
      if (this.isCancelled || this.currentMediaSessionId !== sessionId) {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // ignore
          }
        });
        throw new Error('녹음이 시작 전 취소되었습니다.');
      }

      this.mediaStream = stream;

      const mimeType = this.getOptimalMimeType();
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
      this.recordedChunks = [];
      this.totalBytes = 0;
      this.startTime = Date.now();

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (this.currentMediaSessionId !== sessionId) return;
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
          this.totalBytes += event.data.size;

          // 2 MiB 초과 시 자동 중단
          if (this.totalBytes >= VoiceInputService.MAX_BYTES) {
            this.stopRecording().catch(() => {});
          }
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.currentMediaSessionId !== sessionId) return;
        const rawMime = this.mediaRecorder?.mimeType || this.getOptimalMimeType() || 'audio/webm';
        const rawChunks = [...this.recordedChunks];
        const rawElapsedSeconds = Math.max(1, Math.round((Date.now() - this.startTime) / 1000));

        // async 디코딩/정규화 전에 마이크 트랙 즉각 정지 (사용자 프라이버시 보호)
        this.cleanupStream();

        try {
          const rawBlob = new Blob(rawChunks, { type: rawMime });

          // 기기 내 Web Audio 정규화 (PCM16 16kHz Mono WAV 변환)
          const normResult = await normalizeRecordedAudio(rawBlob, rawElapsedSeconds);
          if (this.currentMediaSessionId !== sessionId) return;

          const finalBlob = normResult.blob;
          const finalMime = normResult.mimeType;
          const finalDuration = normResult.durationSeconds;

          const base64 = await this.blobToBase64(finalBlob);
          if (this.currentMediaSessionId !== sessionId) return;

          const result: RecordedAudioResult = {
            audioBlob: finalBlob,
            audioBase64: base64,
            mimeType: finalMime,
            durationSeconds: finalDuration,
          };

          this.state = 'idle';

          if (this.pendingStopResolve) {
            const resolve = this.pendingStopResolve;
            this.pendingStopResolve = null;
            this.pendingStopReject = null;
            resolve(result);
          }

          if (this.onAutoStop) {
            this.onAutoStop(result);
          }
        } catch (err) {
          if (this.currentMediaSessionId !== sessionId) return;
          this.state = 'idle';
          if (this.pendingStopReject) {
            const reject = this.pendingStopReject;
            this.pendingStopResolve = null;
            this.pendingStopReject = null;
            reject(err);
          }
        }
      };

      this.mediaRecorder.onerror = (e) => {
        if (this.currentMediaSessionId !== sessionId) return;
        this.cleanupStream();
        this.state = 'error';
        if (this.pendingStopReject) {
          const reject = this.pendingStopReject;
          this.pendingStopResolve = null;
          this.pendingStopReject = null;
          reject(e);
        }
      };

      this.mediaRecorder.start(250);
      this.state = 'recording';

      // 30초 시간 제한 타이머
      this.autoStopTimer = setTimeout(() => {
        if (this.state === 'recording') {
          this.stopRecording().catch(() => {});
        }
      }, VoiceInputService.MAX_DURATION_SECONDS * 1000);
    } catch (err: unknown) {
      if (this.currentMediaSessionId !== sessionId) throw err;
      this.cleanupStream();
      const e = err as Error;
      if (e.message?.includes('취소')) {
        this.state = 'idle';
        throw e;
      }
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        this.state = 'permission_denied';
        throw new Error('마이크 접근 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해주세요.');
      }
      this.state = 'error';
      throw new Error(`마이크 초기화 실패: ${e.message}`);
    }
  }

  /**
   * 녹음 종료 및 오디오 데이터 반환
   */
  public async stopRecording(): Promise<RecordedAudioResult> {
    if (!this.mediaRecorder || this.state !== 'recording') {
      throw new Error('진행 중인 녹음이 없습니다.');
    }

    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    this.state = 'processing';

    return new Promise((resolve, reject) => {
      this.pendingStopResolve = resolve;
      this.pendingStopReject = reject;

      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
      } catch (err) {
        this.cleanupStream();
        this.state = 'idle';
        reject(err);
      }
    });
  }

  /**
   * 녹음 취소 및 모든 트랙 즉시 정지
   */
  public cancelRecording(): void {
    this.currentMediaSessionId++;
    this.isCancelled = true;

    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }

    this.cleanupStream();
    this.recordedChunks = [];
    this.totalBytes = 0;
    this.state = 'idle';

    if (this.pendingStopReject) {
      const reject = this.pendingStopReject;
      this.pendingStopResolve = null;
      this.pendingStopReject = null;
      reject(new Error('녹음이 취소되었습니다.'));
    }
  }

  private cleanupStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  }
}

export const voiceInput = new VoiceInputService();

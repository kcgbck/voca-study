// src/features/conversation/whisper/whisperClient.ts
// Whisper Web Worker 생명주기 관리, 180초 전체 데드라인, 30초 추론 타임아웃, generation/요청id 격리 및 자원 해제

import type {
  WhisperPreference,
  WhisperStatus,
  WhisperProgressPayload,
  WhisperTranscribeResult,
  WhisperWorkerIncomingMessage,
  WhisperWorkerOutgoingMessage,
} from './whisperTypes';

import { WHISPER_MODEL_REVISION } from './whisperTypes';

export interface WhisperClientDeps {
  createWorker?: () => Worker;
  hasWebGpu?: () => Promise<boolean>;
  clockNow?: () => number;
}

export class WhisperClient {
  private worker: Worker | null = null;
  private currentStatus: WhisperStatus = {
    state: 'unloaded',
    backend: 'unknown',
    progressPercent: 0,
    downloadBytes: 0,
    totalBytes: 0,
  };
  private isBusy = false;
  private generation = 0;
  private sequence = 0;
  private activePendingReject: ((err: Error) => void) | null = null;
  private activeTimer: any = null;
  private activeSingleTimer: any = null;
  private isCanceled = false;

  constructor(private deps: WhisperClientDeps = {}) {}

  public getStatus(): WhisperStatus {
    return { ...this.currentStatus };
  }

  /**
   * 브라우저의 WebGPU 어댑터 가용성 검사
   */
  public async checkWebGpuSupport(): Promise<boolean> {
    if (this.deps.hasWebGpu) {
      try {
        return await this.deps.hasWebGpu();
      } catch {
        return false;
      }
    }
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        return Boolean(adapter);
      } catch {
        return false;
      }
    }
    return false;
  }

  private spawnWorker(): Worker {
    if (this.deps.createWorker) {
      return this.deps.createWorker();
    }
    return new Worker(new URL('./whisperWorker.ts', import.meta.url), {
      type: 'module',
    });
  }

  private nextMessageId(prefix: string): string {
    this.sequence++;
    return `${prefix}_${this.generation}_${this.sequence}`;
  }

  /**
   * Whisper 모델 다운로드 및 파이프라인 초기화 (전체 상한 180초, WebGPU 실패 시 남은 시간 내 WASM 자동 1회 재시도)
   */
  public async prepare(
    preference: WhisperPreference = 'auto',
    onProgress?: (progress: WhisperProgressPayload) => void
  ): Promise<WhisperStatus> {
    if (this.currentStatus.state === 'ready') {
      return this.getStatus();
    }
    if (this.isBusy) {
      throw new Error('다른 Whisper 작업이 진행 중입니다.');
    }

    // 1. 상태 즉시 확립 (hasWebGpu 대기 중 cancel/동시 실행 방지)
    this.isBusy = true;
    this.isCanceled = false;
    const currentGen = ++this.generation;
    const overallStartTime = Date.now();
    const overallTimeoutMs = 180000; // 전체 상한 180초

    this.currentStatus = {
      state: 'loading',
      backend: 'unknown',
      progressPercent: 0,
      downloadBytes: 0,
      totalBytes: 0,
    };

    return new Promise<WhisperStatus>(async (resolve, reject) => {
      this.activePendingReject = reject;

      // 전체 180초 타이머 확립 (만료 시 세대 증가로 지연 후속 분기 무효화)
      this.activeTimer = setTimeout(() => {
        if (this.generation !== currentGen) return;
        this.generation++;
        this.clearAllTimers();
        this.terminateWorker();
        this.isBusy = false;
        this.activePendingReject = null;
        this.currentStatus = {
          state: 'error',
          backend: 'unknown',
          progressPercent: 0,
          downloadBytes: 0,
          totalBytes: 0,
          errorMessage: 'Whisper 모델 준비 시간이 초과되었습니다 (180초).',
        };
        reject(new Error('Whisper 모델 준비 시간이 초과되었습니다 (180초).'));
      }, overallTimeoutMs);

      // preference 판정
      let targetPref = preference;
      if (targetPref === 'auto') {
        let gpuOk = false;
        try {
          gpuOk = await this.checkWebGpuSupport();
        } catch {
          gpuOk = false;
        }

        // await 도중 취소되었거나 세대가 바뀌었으면 현재 작업 건드리지 않고 즉시 탈출
        if (this.isCanceled || this.generation !== currentGen) {
          return;
        }
        targetPref = gpuOk ? 'webgpu' : 'wasm';
      }

      // probe 이후에도 취소/세대 변경 여부 재확인
      if (this.isCanceled || this.generation !== currentGen) {
        return;
      }

      const safeProgress = (p: WhisperProgressPayload) => {
        try {
          onProgress?.(p);
        } catch {
          // 콜백 예외가 생명주기를 파괴하지 않도록 격리
        }
      };

      try {
        const remainingMs = Math.max(1000, overallTimeoutMs - (Date.now() - overallStartTime));
        const res = await this.runSingleInit(targetPref as 'webgpu' | 'wasm', currentGen, remainingMs, safeProgress);
        if (this.isCanceled || this.generation !== currentGen) return;

        this.clearAllTimers();
        this.isBusy = false;
        this.activePendingReject = null;
        resolve(res);
      } catch (firstErr: any) {
        // 이전 probe나 취소된 분기인 경우 새 작업 상태를 일체 건드리지 않고 무시
        if (this.isCanceled || this.generation !== currentGen) return;

        // WebGPU 실패 시에만 WASM으로 1회 재시도 (취소/에러/타임아웃 시에는 부활 금지)
        if (targetPref === 'webgpu' && !this.isCanceled) {
          this.terminateWorker();
          const remainingMs = overallTimeoutMs - (Date.now() - overallStartTime);
          if (remainingMs <= 2000) {
            this.clearAllTimers();
            this.isBusy = false;
            this.activePendingReject = null;
            this.currentStatus = {
              state: 'error',
              backend: 'unknown',
              progressPercent: 0,
              downloadBytes: 0,
              totalBytes: 0,
              errorMessage: 'WASM 재시도를 위한 남은 시간이 부족합니다.',
            };
            reject(new Error('WASM 재시도를 위한 남은 시간이 부족합니다.'));
            return;
          }

          try {
            const wasmRes = await this.runSingleInit('wasm', currentGen, remainingMs, safeProgress);
            if (this.isCanceled || this.generation !== currentGen) return;

            this.clearAllTimers();
            this.isBusy = false;
            this.activePendingReject = null;
            resolve(wasmRes);
            return;
          } catch (wasmErr: any) {
            if (this.isCanceled || this.generation !== currentGen) return;
            this.clearAllTimers();
            this.terminateWorker();
            this.isBusy = false;
            this.activePendingReject = null;
            this.currentStatus = {
              state: 'error',
              backend: 'unknown',
              progressPercent: 0,
              downloadBytes: 0,
              totalBytes: 0,
              errorMessage: `WebGPU/WASM 초기화 모두 실패: ${wasmErr?.message || '오류'}`,
            };
            reject(wasmErr);
            return;
          }
        }

        this.clearAllTimers();
        this.terminateWorker();
        this.isBusy = false;
        this.activePendingReject = null;
        this.currentStatus = {
          state: 'error',
          backend: 'unknown',
          progressPercent: 0,
          downloadBytes: 0,
          totalBytes: 0,
          errorMessage: firstErr?.message || '초기화 실패',
        };
        reject(firstErr);
      }
    });
  }

  private runSingleInit(
    pref: 'webgpu' | 'wasm',
    expectedGen: number,
    timeoutMs: number,
    onProgress: (p: WhisperProgressPayload) => void
  ): Promise<WhisperStatus> {
    return new Promise<WhisperStatus>((resolve, reject) => {
      if (this.isCanceled || this.generation !== expectedGen) {
        reject(new Error('작업이 취소되었습니다.'));
        return;
      }

      let worker: Worker;
      try {
        worker = this.spawnWorker();
        this.worker = worker;
      } catch (spawnErr: any) {
        reject(new Error(`Worker 생성 실패: ${spawnErr?.message || '오류'}`));
        return;
      }

      const msgId = this.nextMessageId('init');
      this.currentStatus.backend = pref;

      let singleTimer: any = setTimeout(() => {
        singleTimer = null;
        this.activeSingleTimer = null;
        reject(new Error(`${pref} 백엔드 초기화 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`));
      }, timeoutMs);
      this.activeSingleTimer = singleTimer;

      worker.onmessage = (event: MessageEvent<WhisperWorkerOutgoingMessage>) => {
        const data = event.data;
        if (!data || data.id !== msgId || data.generation !== expectedGen) return;
        if (this.generation !== expectedGen || this.isCanceled) return;

        if (data.type === 'progress') {
          const p = data.data;
          onProgress(p);
          if (typeof p.progress === 'number' && Number.isFinite(p.progress)) {
            this.currentStatus.progressPercent = Math.max(0, Math.min(100, Math.round(p.progress)));
          }
          if (typeof p.loaded === 'number' && Number.isFinite(p.loaded)) {
            this.currentStatus.downloadBytes = Math.max(0, p.loaded);
          }
          if (typeof p.total === 'number' && Number.isFinite(p.total)) {
            this.currentStatus.totalBytes = Math.max(0, p.total);
          }
          return;
        }

        if (data.type === 'init_done') {
          if (singleTimer) {
            clearTimeout(singleTimer);
            singleTimer = null;
            this.activeSingleTimer = null;
          }
          this.currentStatus = {
            state: 'ready',
            backend: data.backend,
            progressPercent: 100,
            downloadBytes: this.currentStatus.downloadBytes,
            totalBytes: this.currentStatus.totalBytes,
            loadDurationMs: Math.max(0, data.loadDurationMs),
            isWarmCache: Boolean(data.isWarmCache),
            cacheHits: Math.max(0, data.cacheHits),
          };
          resolve(this.getStatus());
          return;
        }

        if (data.type === 'error') {
          if (singleTimer) {
            clearTimeout(singleTimer);
            singleTimer = null;
            this.activeSingleTimer = null;
          }
          reject(new Error(data.errorMessage));
        }
      };

      worker.onerror = (err) => {
        if (singleTimer) {
          clearTimeout(singleTimer);
          singleTimer = null;
          this.activeSingleTimer = null;
        }
        reject(new Error(`Worker 에러 발생: ${err.message || '스크립트 에러'}`));
      };

      const initMsg: WhisperWorkerIncomingMessage = {
        id: msgId,
        generation: expectedGen,
        type: 'init',
        preference: pref,
      };

      try {
        worker.postMessage(initMsg);
      } catch (postErr: any) {
        if (singleTimer) {
          clearTimeout(singleTimer);
          singleTimer = null;
          this.activeSingleTimer = null;
        }
        reject(new Error(`Worker 메시지 전송 실패: ${postErr?.message || '오류'}`));
      }
    });
  }

  /**
   * 음성 PCM 버퍼 전사 (30초 상한, Float32Array 전송 최적화, 검증 및 강제 종료)
   */
  public async transcribe(audio: Float32Array): Promise<WhisperTranscribeResult> {
    if (this.currentStatus.state !== 'ready' || !this.worker) {
      throw new Error('Whisper 모델이 준비되지 않았습니다.');
    }
    if (this.isBusy) {
      throw new Error('이전 전사 작업이 아직 처리 중입니다.');
    }

    // 오디오 입력 버퍼 엄격 검증
    if (!(audio instanceof Float32Array)) {
      throw new Error('오디오 입력이 Float32Array 형식이 아닙니다.');
    }
    if (audio.length === 0 || audio.length > 176000) {
      throw new Error(`오디오 길이가 유효하지 않습니다 (현재 ${audio.length} 샘플, 허용 1~176000).`);
    }

    let sumSq = 0;
    for (let i = 0; i < audio.length; i++) {
      const v = audio[i];
      if (!Number.isFinite(v)) {
        throw new Error('오디오 버퍼에 비정상적인 값(NaN/Infinity)이 포함되어 있습니다.');
      }
      sumSq += v * v;
    }

    const rms = Math.sqrt(sumSq / audio.length);
    if (rms < 0.0001 || audio.length < 3200) {
      // 0.2초 미만이거나 디지털 무음은 추론 전 즉시 반환
      return {
        text: '',
        durationMs: 0,
        audioDurationSec: Math.round((audio.length / 16000) * 10) / 10,
        backend: this.currentStatus.backend,
        modelRevision: WHISPER_MODEL_REVISION,
      };
    }

    this.isBusy = true;
    const currentGen = this.generation;
    const worker = this.worker;
    const audioSec = Math.round((audio.length / 16000) * 10) / 10;
    const msgId = this.nextMessageId('tx');

    return new Promise<WhisperTranscribeResult>((resolve, reject) => {
      this.activePendingReject = reject;

      // 30초 추론 타임아웃
      this.activeTimer = setTimeout(() => {
        if (this.generation !== currentGen) return;
        this.generation++;
        this.terminateWorker();
        this.isBusy = false;
        this.activePendingReject = null;
        this.currentStatus.state = 'unloaded'; // 추론 오류/타임아웃 시 ready 상태 허위 유지 금지
        reject(new Error('Whisper 전사 시간이 초과되었습니다 (30초).'));
      }, 30000);

      worker.onmessage = (event: MessageEvent<WhisperWorkerOutgoingMessage>) => {
        const data = event.data;
        if (!data || data.id !== msgId || data.generation !== currentGen) return;
        if (this.generation !== currentGen) return;

        if (data.type === 'transcribe_done') {
          this.clearAllTimers();
          this.isBusy = false;
          this.activePendingReject = null;

          // 반환값 엄격 검증
          const durationMs = Math.max(0, Number.isFinite(data.durationMs) ? data.durationMs : 0);
          const text = (data.text || '').slice(0, 500);

          resolve({
            text,
            durationMs,
            audioDurationSec: audioSec,
            backend: data.backend || this.currentStatus.backend,
            modelRevision: WHISPER_MODEL_REVISION,
          });
          return;
        }

        if (data.type === 'error') {
          this.clearAllTimers();
          this.isBusy = false;
          this.activePendingReject = null;
          this.currentStatus.state = 'unloaded';
          reject(new Error(data.errorMessage));
        }
      };

      worker.onerror = (err) => {
        this.clearAllTimers();
        this.isBusy = false;
        this.activePendingReject = null;
        this.currentStatus.state = 'unloaded';
        reject(new Error(`전사 중 Worker 에러 발생: ${err.message || '오류'}`));
      };

      const msg: WhisperWorkerIncomingMessage = {
        id: msgId,
        generation: currentGen,
        type: 'transcribe',
        audio,
      };

      try {
        // Transferable object로 postMessage 메모리 복제 감소
        worker.postMessage(msg, [audio.buffer]);
      } catch (postErr: any) {
        this.clearAllTimers();
        this.isBusy = false;
        this.activePendingReject = null;
        this.currentStatus.state = 'unloaded';
        reject(new Error(`오디오 전송 실패: ${postErr?.message || '오류'}`));
      }
    });
  }

  /**
   * 모든 진행 중인 작업 즉시 취소 및 Worker 강제 종료
   */
  public cancel(): void {
    this.isCanceled = true;
    this.generation++; // 세대 증가로 지연 콜백 완전 차단
    this.clearAllTimers();

    if (this.activePendingReject) {
      try {
        this.activePendingReject(new Error('작업이 사용자에 의해 취소되었습니다.'));
      } catch {
        // ignore
      }
      this.activePendingReject = null;
    }

    this.terminateWorker();
    this.isBusy = false;
    this.currentStatus.state = 'unloaded';
  }

  public dispose(): void {
    this.cancel();
  }

  private terminateWorker(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
  }

  private clearAllTimers(): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.activeSingleTimer) {
      clearTimeout(this.activeSingleTimer);
      this.activeSingleTimer = null;
    }
  }
}

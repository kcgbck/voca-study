// src/features/conversation/moonshine/moonshineSpeechInput.ts
// Moonshine v2 English SmallStreaming on-device STT service

import type { BrowserSpeechInputOptions } from '../services/browserSpeechInput';
import {
  WhisperAudioRecorder,
  type WhisperRecordResult,
  type WhisperRecordOptions,
} from '../whisper/whisperAudioRecorder';
import type {
  MoonshineWorkerIncomingMessage,
  MoonshineWorkerOutgoingMessage,
} from './moonshineWorker';

export interface MoonshineProgressPayload {
  loaded: number;
  total?: number;
  file?: string;
}

export interface MoonshineSpeechInputDeps {
  createWorker?: () => Worker;
  recorder?: {
    record: (options?: WhisperRecordOptions) => Promise<WhisperRecordResult>;
    stop: () => void;
    cancel: () => void;
  };
}

export class MoonshineSpeechInputService {
  public static readonly ENGINE_NAME = 'Moonshine' as const;
  public static readonly MODEL_ARCH = 'SmallStreaming' as const;
  public static readonly SDK_VERSION = '0.1.5' as const;
  public static readonly CATALOG_REVISION = 'quantized_26_07_30' as const;
  public static readonly ESTIMATED_DOWNLOAD_BYTES = 165489086 as const;

  public readonly engineName = MoonshineSpeechInputService.ENGINE_NAME;
  public readonly modelArch = MoonshineSpeechInputService.MODEL_ARCH;
  public readonly sdkVersion = MoonshineSpeechInputService.SDK_VERSION;
  public readonly catalogRevision = MoonshineSpeechInputService.CATALOG_REVISION;

  private worker: Worker | null = null;
  private recorder: {
    record: (options?: WhisperRecordOptions) => Promise<WhisperRecordResult>;
    stop: () => void;
    cancel: () => void;
  };
  private workerFactory: () => Worker;

  private ready = false;
  private isPreparing = false;
  private isRecordingOrInference = false;
  private generation = 0;
  private currentRequestId = 0;

  // Active prepare / inference promise controllers
  private activeReject: ((err: Error) => void) | null = null;
  private activeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: MoonshineSpeechInputDeps = {}) {
    this.workerFactory =
      deps.createWorker ||
      (() => {
        return new Worker(new URL('./moonshineWorker.ts', import.meta.url), {
          type: 'module',
        });
      });
    this.recorder = deps.recorder || new WhisperAudioRecorder();
  }

  public isReady(): boolean {
    return this.ready;
  }

  /**
   * Checks whether the current browser environment supports the required capabilities
   * for Moonshine on-device STT: Worker, MediaRecorder, getUserMedia, AudioContext, crossOriginIsolated.
   * SSR returns neutral true until client effect.
   */
  public isSupported(): boolean {
    if (typeof window === 'undefined') {
      return true;
    }
    const hasWorker = typeof Worker !== 'undefined';
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasGetUserMedia = !!(navigator?.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const hasAudioContext = typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined';
    const isIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;

    return Boolean(hasWorker && hasMediaRecorder && hasGetUserMedia && hasAudioContext && isIsolated);
  }

  /**
   * Prepares the Moonshine model worker once. Reuses idle prepared model across answers.
   * Does NOT open microphone. 180s timeout.
   */
  public async prepare(
    onProgress?: (progress: MoonshineProgressPayload) => void
  ): Promise<void> {
    if (this.ready) {
      return;
    }
    if (this.isPreparing) {
      throw new Error('Moonshine preparation is already in progress.');
    }

    this.isPreparing = true;
    const currentGen = ++this.generation;
    const reqId = `prep_${++this.currentRequestId}`;

    if (!this.worker) {
      try {
        this.worker = this.workerFactory();
        this.attachWorkerListeners();
      } catch (err: any) {
        this.isPreparing = false;
        throw new Error(`Failed to create Moonshine worker: ${err?.message || String(err)}`);
      }
    }

    return new Promise<void>((resolve, reject) => {
      this.activeReject = reject;

      // 180 second timeout for model download & initialization
      this.activeTimeout = setTimeout(() => {
        this.activeTimeout = null;
        if (this.generation === currentGen) {
          this.terminateWorker();
          this.isPreparing = false;
          const capturedReject = this.activeReject;
          this.activeReject = null;
          capturedReject?.(new Error('Moonshine model initialization timed out (180s).'));
        }
      }, 180000);

      const handleMessage = (event: MessageEvent<MoonshineWorkerOutgoingMessage>) => {
        if (this.generation !== currentGen) return;
        const msg = event.data;
        if (!msg || msg.id !== reqId) return;

        if (msg.type === 'progress') {
          try {
            onProgress?.({
              loaded: msg.loaded,
              total: msg.total,
              file: msg.file,
            });
          } catch {
            // UI callback exceptions must not strand operation
          }
        } else if (msg.type === 'init_done') {
          this.cleanupActiveRequest();
          this.isPreparing = false;
          this.ready = true;
          this.worker?.removeEventListener('message', handleMessage);
          resolve();
        } else if (msg.type === 'error') {
          this.cleanupActiveRequest();
          this.isPreparing = false;
          this.worker?.removeEventListener('message', handleMessage);
          reject(new Error(`Moonshine worker initialization failed: ${msg.errorMessage}`));
        }
      };

      this.worker!.addEventListener('message', handleMessage);

      try {
        const initMsg: MoonshineWorkerIncomingMessage = {
          id: reqId,
          type: 'init',
        };
        this.worker!.postMessage(initMsg);
      } catch (postErr: any) {
        this.cleanupActiveRequest();
        this.isPreparing = false;
        this.worker?.removeEventListener('message', handleMessage);
        reject(new Error(`Failed to post init message to worker: ${postErr?.message || String(postErr)}`));
      }
    });
  }

  /**
   * Captures audio via recorder (bounded windowMs capped at 10s) and runs batch transcription.
   * start requires ready=true. Reuses idle prepared model.
   */
  public async start(
    _lang = 'en-US',
    options: BrowserSpeechInputOptions = {}
  ): Promise<string> {
    if (!this.ready || !this.worker) {
      throw new Error('Moonshine engine is not ready. Call prepare() first.');
    }
    if (this.isRecordingOrInference) {
      throw new Error('Moonshine recognition is already in progress.');
    }

    this.isRecordingOrInference = true;
    const currentGen = ++this.generation;

    // Window duration capped at 10000ms (default 10000ms)
    const windowMs = options.windowMs ? Math.min(10000, options.windowMs) : 10000;

    // Safe onReady wrapper
    const safeOnReady = () => {
      try {
        options.onReady?.();
      } catch {
        // UI callback exceptions must not strand operation
      }
    };

    let recordResult: WhisperRecordResult;
    try {
      // Bounded cancellation race for recorder
      let cancelRecorderListener: ((err: Error) => void) | null = null;
      const cancelRace = new Promise<never>((_, rej) => {
        cancelRecorderListener = rej;
      });
      this.activeReject = cancelRecorderListener;

      const recordPromise = this.recorder.record({
        maxDurationMs: windowMs,
        onReady: safeOnReady,
      });

      try {
        recordResult = await Promise.race([recordPromise, cancelRace]);
      } finally {
        if (this.generation === currentGen) {
          this.activeReject = null;
        }
      }
    } catch (err: any) {
      if (this.generation === currentGen) {
        this.isRecordingOrInference = false;
      }
      throw err;
    }

    if (this.generation !== currentGen) {
      throw new Error('Recording was cancelled.');
    }

    const audio = recordResult?.audio;

    // Reject non-Float32Array or too short (< 3200 samples = 0.2s)
    if (!audio || !(audio instanceof Float32Array) || audio.length < 3200) {
      if (this.generation === currentGen) {
        this.isRecordingOrInference = false;
      }
      return '';
    }

    // Reject overlong buffers (> 176,000 samples) rather than truncating
    if (audio.length > 176000) {
      if (this.generation === currentGen) {
        this.isRecordingOrInference = false;
      }
      return '';
    }

    // Check finite numbers, range [-1, 1], and digital silence (RMS < 0.0001)
    let sumSquares = 0;
    for (let i = 0; i < audio.length; i++) {
      const val = audio[i];
      if (!Number.isFinite(val) || val < -1.0 || val > 1.0) {
        if (this.generation === currentGen) {
          this.isRecordingOrInference = false;
        }
        return '';
      }
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / audio.length);
    if (!Number.isFinite(rms) || rms < 0.0001) {
      if (this.generation === currentGen) {
        this.isRecordingOrInference = false;
      }
      return '';
    }

    // Run inference in worker (15s bounded recognition timeout)
    const reqId = `infer_${++this.currentRequestId}`;
    try {
      options.onProcessing?.();
    } catch {
      // Safe callback execution
    }
    return new Promise<string>((resolve, reject) => {
      this.activeReject = reject;

      this.activeTimeout = setTimeout(() => {
        this.activeTimeout = null;
        if (this.generation === currentGen) {
          this.terminateWorker();
          this.isRecordingOrInference = false;
          const capturedReject = this.activeReject;
          this.activeReject = null;
          capturedReject?.(new Error('Moonshine inference timed out (15s).'));
        }
      }, 15000);

      const handleMessage = (event: MessageEvent<MoonshineWorkerOutgoingMessage>) => {
        if (this.generation !== currentGen) return;
        const msg = event.data;
        if (!msg || msg.id !== reqId) return;

        if (msg.type === 'transcribe_done') {
          this.cleanupActiveRequest();
          this.isRecordingOrInference = false;
          this.worker?.removeEventListener('message', handleMessage);

          const transcript = msg.text || '';
          if (options.onAlternatives && transcript) {
            try {
              options.onAlternatives([transcript]);
            } catch {
              // UI callback exception safe handling
            }
          }
          resolve(transcript);
        } else if (msg.type === 'error') {
          this.cleanupActiveRequest();
          this.isRecordingOrInference = false;
          this.worker?.removeEventListener('message', handleMessage);
          reject(new Error(`Moonshine inference failed: ${msg.errorMessage}`));
        }
      };

      this.worker!.addEventListener('message', handleMessage);

      // Transfer PCM buffer to worker
      try {
        const transcribeMsg: MoonshineWorkerIncomingMessage = {
          id: reqId,
          type: 'transcribe',
          audio,
        };
        this.worker!.postMessage(transcribeMsg, [audio.buffer]);
      } catch (postErr: any) {
        this.cleanupActiveRequest();
        this.isRecordingOrInference = false;
        this.worker?.removeEventListener('message', handleMessage);
        reject(new Error(`Failed to post transcribe message to worker: ${postErr?.message || String(postErr)}`));
      }
    });
  }

  /**
   * Immediately rejects pending start/prepare and cancels recorder.
   * If worker is busy with active init/inference, terminates it;
   * if idle, retains the ready worker.
   */
  public cancel(): void {
    this.generation++;

    // Capture pending reject BEFORE clearing
    const capturedReject = this.activeReject;
    this.cleanupActiveRequest();

    try {
      this.recorder.cancel();
    } catch {
      // ignore
    }

    if (this.isPreparing || this.isRecordingOrInference) {
      // Terminate worker if busy with operation
      this.terminateWorker();
      this.isPreparing = false;
      this.isRecordingOrInference = false;
    }

    if (capturedReject) {
      try {
        capturedReject(new Error('Moonshine operation was cancelled.'));
      } catch {
        // ignore
      }
    }
  }

  /**
   * Completely terminates worker and tears down all resources.
   */
  public dispose(): void {
    this.cancel();
    this.terminateWorker();
  }

  private terminateWorker(): void {
    this.ready = false;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }
  }

  private cleanupActiveRequest(): void {
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }
    this.activeReject = null;
  }

  private attachWorkerListeners(): void {
    if (!this.worker) return;
    this.worker.onerror = (err) => {
      // Catch errors, no unhandled rejects
      const capturedReject = this.activeReject;
      this.cleanupActiveRequest();
      this.cancel();
      if (capturedReject) {
        try {
          capturedReject(new Error(`Worker error: ${err.message || 'unknown'}`));
        } catch {
          // ignore
        }
      }
    };
  }
}

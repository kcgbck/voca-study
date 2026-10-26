// src/features/conversation/moonshine/moonshineWorker.ts
// Dedicated Web Worker for Moonshine v2 English SmallStreaming STT

export interface MoonshineWorkerInitMessage {
  id: string;
  type: 'init';
}

export interface MoonshineWorkerTranscribeMessage {
  id: string;
  type: 'transcribe';
  audio: Float32Array;
}

export type MoonshineWorkerIncomingMessage =
  | MoonshineWorkerInitMessage
  | MoonshineWorkerTranscribeMessage;

export interface MoonshineWorkerProgressMessage {
  id: string;
  type: 'progress';
  loaded: number;
  total?: number;
  file?: string;
}

export interface MoonshineWorkerInitDoneMessage {
  id: string;
  type: 'init_done';
  durationMs: number;
}

export interface MoonshineWorkerTranscribeDoneMessage {
  id: string;
  type: 'transcribe_done';
  text: string;
  durationMs: number;
}

export interface MoonshineWorkerErrorMessage {
  id: string;
  type: 'error';
  errorMessage: string;
}

export type MoonshineWorkerOutgoingMessage =
  | MoonshineWorkerProgressMessage
  | MoonshineWorkerInitDoneMessage
  | MoonshineWorkerTranscribeDoneMessage
  | MoonshineWorkerErrorMessage;

let transcriberInstance: any = null;
let isBusy = false;

const ctx: Worker = self as any;

/**
 * Validates 16kHz mono audio PCM buffer.
 * Rejects non-Float32Array, length < 3200 (0.2s), length > 176000 (11s),
 * non-finite values (NaN, Infinity), and out-of-range samples (> 1 or < -1).
 */
export function validatePcmBuffer(audio: any): { valid: boolean; reason?: string } {
  if (!audio || !(audio instanceof Float32Array)) {
    return { valid: false, reason: 'Audio is not a Float32Array.' };
  }
  if (audio.length < 3200) {
    return { valid: false, reason: 'Audio buffer is too short (< 3200 samples).' };
  }
  if (audio.length > 176000) {
    return { valid: false, reason: 'Audio buffer exceeds maximum limit (176,000 samples).' };
  }

  for (let i = 0; i < audio.length; i++) {
    const val = audio[i];
    if (!Number.isFinite(val)) {
      return { valid: false, reason: 'Audio contains non-finite values (NaN or Infinity).' };
    }
    if (val < -1.0 || val > 1.0) {
      return { valid: false, reason: 'Audio sample out of range [-1.0, 1.0].' };
    }
  }

  return { valid: true };
}

ctx.onmessage = async (event: MessageEvent<MoonshineWorkerIncomingMessage>) => {
  const msg = event.data;
  if (!msg || !msg.id || !msg.type) return;

  if (isBusy) {
    const errorReply: MoonshineWorkerErrorMessage = {
      id: msg.id,
      type: 'error',
      errorMessage: 'Worker is currently busy processing another request.',
    };
    ctx.postMessage(errorReply);
    return;
  }

  isBusy = true;
  const startTime = Date.now();

  try {
    if (msg.type === 'init') {
      if (transcriberInstance) {
        const doneReply: MoonshineWorkerInitDoneMessage = {
          id: msg.id,
          type: 'init_done',
          durationMs: Date.now() - startTime,
        };
        ctx.postMessage(doneReply);
        return;
      }

      // Dynamic import same-origin fixed URL to avoid npm-bundling the SDK
      const transcriberUrl = '/moonshine/0.1.5/transcriber.js';
      const sdk = await import(/* @vite-ignore */ transcriberUrl);
      const Transcriber = sdk.Transcriber || (sdk.default && sdk.default.Transcriber);

      if (!Transcriber || typeof Transcriber.load !== 'function') {
        throw new Error('Failed to load Transcriber class from Moonshine SDK.');
      }

      transcriberInstance = await Transcriber.load({
        language: 'en',
        modelArch: 4, // ModelArch.SmallStreaming = 4
        onProgress: (loaded: number, total: number | undefined, file: string) => {
          try {
            const progressReply: MoonshineWorkerProgressMessage = {
              id: msg.id,
              type: 'progress',
              loaded,
              total,
              file,
            };
            ctx.postMessage(progressReply);
          } catch {
            // ignore progress delivery failure
          }
        },
      });

      const doneReply: MoonshineWorkerInitDoneMessage = {
        id: msg.id,
        type: 'init_done',
        durationMs: Date.now() - startTime,
      };
      ctx.postMessage(doneReply);
    } else if (msg.type === 'transcribe') {
      if (!transcriberInstance) {
        throw new Error('Transcriber is not initialized. Call init first.');
      }

      const audio = msg.audio;
      const validation = validatePcmBuffer(audio);
      if (!validation.valid) {
        const errorReply: MoonshineWorkerErrorMessage = {
          id: msg.id,
          type: 'error',
          errorMessage: `Invalid audio PCM: ${validation.reason}`,
        };
        ctx.postMessage(errorReply);
        return;
      }

      const result = transcriberInstance.transcribe(audio, { sampleRate: 16000 });
      let text = '';
      if (result && Array.isArray(result.lines)) {
        text = result.lines.map((l: any) => l.text || '').join(' ').trim();
      } else if (typeof result === 'string') {
        text = result.trim();
      } else if (result && typeof result.text === 'string') {
        text = result.text.trim();
      }

      const doneReply: MoonshineWorkerTranscribeDoneMessage = {
        id: msg.id,
        type: 'transcribe_done',
        text,
        durationMs: Date.now() - startTime,
      };
      ctx.postMessage(doneReply);
    }
  } catch (err: any) {
    try {
      const errorReply: MoonshineWorkerErrorMessage = {
        id: msg.id,
        type: 'error',
        errorMessage: err?.message || String(err),
      };
      ctx.postMessage(errorReply);
    } catch {
      // ignore
    }
  } finally {
    isBusy = false;
  }
};

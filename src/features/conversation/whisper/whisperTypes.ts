// src/features/conversation/whisper/whisperTypes.ts
// 기기 내 무료 Whisper ASR 및 Web Speech API 비교 전용 타입 정의

export const WHISPER_MODEL_ID = 'onnx-community/whisper-tiny';
export const WHISPER_MODEL_REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
export const WHISPER_DTYPE = 'q8';
export const WHISPER_CUSTOM_CACHE_NAME = 'voca-whisper-model-v1';

export type WhisperBackend = 'webgpu' | 'wasm' | 'unknown';
export type WhisperPreference = 'auto' | 'webgpu' | 'wasm';

export interface WhisperProgressPayload {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface WhisperStatus {
  state: 'unloaded' | 'loading' | 'ready' | 'error';
  backend: WhisperBackend;
  progressPercent: number;
  downloadBytes: number;
  totalBytes: number;
  errorMessage?: string;
  loadDurationMs?: number;
  isWarmCache?: boolean;
  cacheHits?: number;
}

export interface WhisperTranscribeResult {
  text: string;
  durationMs: number;
  audioDurationSec: number;
  backend: WhisperBackend;
  modelRevision: string;
}

// Worker 통신 메시지 프로토콜
export type WhisperWorkerIncomingMessage =
  | {
      id: string;
      generation: number;
      type: 'init';
      preference: 'webgpu' | 'wasm';
    }
  | {
      id: string;
      generation: number;
      type: 'transcribe';
      audio: Float32Array; // 16kHz 모노 PCM (transferrable)
    };

export type WhisperWorkerOutgoingMessage =
  | {
      id: string;
      generation: number;
      type: 'progress';
      data: WhisperProgressPayload;
    }
  | {
      id: string;
      generation: number;
      type: 'init_done';
      backend: WhisperBackend;
      loadDurationMs: number;
      isWarmCache: boolean;
      cacheHits: number;
    }
  | {
      id: string;
      generation: number;
      type: 'transcribe_done';
      text: string;
      durationMs: number;
      backend: WhisperBackend;
    }
  | {
      id: string;
      generation: number;
      type: 'error';
      errorMessage: string;
    };

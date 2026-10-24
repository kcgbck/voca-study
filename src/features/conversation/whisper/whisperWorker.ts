// src/features/conversation/whisper/whisperWorker.ts
// @huggingface/transformers 기반 Web Worker 호스팅 스크립트

import type {
  WhisperWorkerIncomingMessage,
  WhisperWorkerOutgoingMessage,
  WhisperBackend,
} from './whisperTypes';

import {
  WHISPER_MODEL_ID,
  WHISPER_MODEL_REVISION,
  WHISPER_DTYPE,
  WHISPER_CUSTOM_CACHE_NAME,
} from './whisperTypes';

// 로컬 Vite 빌드 시 ONNX 런타임 WASM 바이너리 URL 번들링
const wasmUrl = new URL(
  '../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm',
  import.meta.url
).href;
const wasmMjsUrl = new URL(
  '../../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
  import.meta.url
).href;

let pipelineInstance: any = null;
let currentBackend: WhisperBackend = 'unknown';
let isWorkerBusy = false;

// 필수 7개 파일 (설정, 토크나이저, 전처리기, 모델 가중치 2개)
const REQUIRED_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'encoder_model_quantized.onnx',
  'decoder_model_merged_quantized.onnx',
];

/**
 * Cache API 래퍼: init 시점 스냅샷에 이미 존재했던 키만 unique hit로 계수
 */
async function inspectPreExistingCache(): Promise<{
  preExistingUrls: Set<string>;
  cache: Cache | null;
}> {
  if (typeof caches === 'undefined') {
    return { preExistingUrls: new Set(), cache: null };
  }
  try {
    const cache = await caches.open(WHISPER_CUSTOM_CACHE_NAME);
    const keys = await cache.keys();
    const urls = new Set<string>();
    for (const req of keys) {
      urls.add(req.url);
    }
    return { preExistingUrls: urls, cache };
  } catch {
    return { preExistingUrls: new Set(), cache: null };
  }
}

function verifyWarmCache(preExistingUrls: Set<string>): boolean {
  if (preExistingUrls.size < REQUIRED_MODEL_FILES.length) {
    return false;
  }
  // 고정 revision 경로 및 필수 파일들이 사전에 모두 존재했는지 확인
  for (const file of REQUIRED_MODEL_FILES) {
    let found = false;
    for (const url of preExistingUrls) {
      if (url.includes(WHISPER_MODEL_REVISION) && url.includes(file)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

self.onmessage = async (event: MessageEvent<WhisperWorkerIncomingMessage>) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  const msgId = msg.id;
  const generation = msg.generation;

  if (isWorkerBusy) {
    const errorMsg: WhisperWorkerOutgoingMessage = {
      id: msgId,
      generation,
      type: 'error',
      errorMessage: 'Worker가 이미 다른 작업을 처리 중입니다.',
    };
    self.postMessage(errorMsg);
    return;
  }

  if (msg.type === 'init') {
    isWorkerBusy = true;
    const startTime = performance.now();
    try {
      const { pipeline, env } = await import('@huggingface/transformers');

      // 환경 플래그 엄격 설정
      env.allowLocalModels = false;
      env.useFS = false;
      env.useFSCache = false;
      env.useBrowserCache = false; // 기본 browser cache 차단, customCache만 사용

      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths = {
          wasm: wasmUrl,
          mjs: wasmMjsUrl,
        };
      }

      // 사전 캐시 스냅샷 확인
      const { preExistingUrls, cache } = await inspectPreExistingCache();
      const isWarmCache = verifyWarmCache(preExistingUrls);
      const uniqueHits = new Set<string>();

      if (cache && env.useCustomCache !== undefined) {
        env.useCustomCache = true;
        env.customCache = {
          match: async (request: RequestInfo | URL) => {
            try {
              const res = await cache.match(request);
              if (res) {
                const url = typeof request === 'string' ? request : (request as any).url || '';
                // init 전 스냅샷에 이미 존재했던 URL만 unique hit로 기록
                if (url && preExistingUrls.has(url)) {
                  uniqueHits.add(url);
                }
              }
              return res;
            } catch {
              return undefined;
            }
          },
          put: async (request: RequestInfo | URL, response: Response) => {
            try {
              const url = typeof request === 'string' ? request : (request as any).url || '';
              // 오디오, WAV, 전사 결과는 캐시 금지; 고정 모델 파일 GET 요청만 캐시
              if (url && (url.endsWith('.wav') || url.includes('/transcribe') || url.includes('/audio'))) {
                return;
              }
              await cache.put(request, response);
            } catch {
              // 캐시 저장 실패는 무시하고 계속 진행
            }
          },
        };
      }

      // 외부 override 필드 무시, 항상 고정 상수만 사용
      const targetDevice: 'webgpu' | 'wasm' = msg.preference === 'webgpu' ? 'webgpu' : 'wasm';

      pipelineInstance = await pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
        revision: WHISPER_MODEL_REVISION,
        dtype: WHISPER_DTYPE,
        device: targetDevice,
        progress_callback: (data: any) => {
          const progressMsg: WhisperWorkerOutgoingMessage = {
            id: msgId,
            generation,
            type: 'progress',
            data,
          };
          self.postMessage(progressMsg);
        },
      });

      currentBackend = targetDevice;
      const loadDurationMs = Math.max(0, Math.round(performance.now() - startTime));

      const doneMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'init_done',
        backend: currentBackend,
        loadDurationMs,
        isWarmCache,
        cacheHits: uniqueHits.size,
      };
      self.postMessage(doneMsg);
    } catch (err: any) {
      const errorMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'error',
        errorMessage: err?.message || 'Whisper 초기화에 실패했습니다.',
      };
      self.postMessage(errorMsg);
    } finally {
      isWorkerBusy = false;
    }
    return;
  }

  if (msg.type === 'transcribe') {
    isWorkerBusy = true;
    if (!pipelineInstance) {
      isWorkerBusy = false;
      const errorMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'error',
        errorMessage: 'Whisper 파이프라인이 준비되지 않았습니다.',
      };
      self.postMessage(errorMsg);
      return;
    }

    const audio = msg.audio;
    // PCM 유효성 검사 (길이 1~176,000, NaN/무한대 검사, 극단적 무음 사전 차단)
    if (!audio || !(audio instanceof Float32Array) || audio.length === 0 || audio.length > 176000) {
      isWorkerBusy = false;
      const errorMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'error',
        errorMessage: '유효하지 않은 오디오 버퍼입니다 (길이 1~176,000 범위 초과).',
      };
      self.postMessage(errorMsg);
      return;
    }

    let sumSquares = 0;
    let hasInvalid = false;
    for (let i = 0; i < audio.length; i++) {
      const v = audio[i];
      if (!Number.isFinite(v)) {
        hasInvalid = true;
        break;
      }
      sumSquares += v * v;
    }

    if (hasInvalid) {
      isWorkerBusy = false;
      const errorMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'error',
        errorMessage: '오디오 버퍼에 비정상적인 값(NaN/Infinity)이 포함되어 있습니다.',
      };
      self.postMessage(errorMsg);
      return;
    }

    const rms = Math.sqrt(sumSquares / audio.length);
    if (rms < 0.0001 || audio.length < 3200) {
      // 0.2초 미만이거나 극단적 무음인 경우 모델 추론 전 빈 결과 반환
      isWorkerBusy = false;
      const doneMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'transcribe_done',
        text: '',
        durationMs: 0,
        backend: currentBackend,
      };
      self.postMessage(doneMsg);
      return;
    }

    const startTime = performance.now();
    try {
      // 힌트/프롬프트/참조문장/이름 절대 주입 금지
      const output = await pipelineInstance(audio, {
        language: 'english',
        task: 'transcribe',
        return_timestamps: false,
        max_new_tokens: 96,
        do_sample: false,
      });

      const durationMs = Math.max(0, Math.round(performance.now() - startTime));
      let rawText = typeof output?.text === 'string' ? output.text.trim() : '';
      if (rawText.length > 500) {
        rawText = rawText.slice(0, 500);
      }

      const doneMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'transcribe_done',
        text: rawText,
        durationMs,
        backend: currentBackend,
      };
      self.postMessage(doneMsg);
    } catch (err: any) {
      const errorMsg: WhisperWorkerOutgoingMessage = {
        id: msgId,
        generation,
        type: 'error',
        errorMessage: err?.message || 'Whisper 전사 처리에 실패했습니다.',
      };
      self.postMessage(errorMsg);
    } finally {
      isWorkerBusy = false;
    }
  }
};

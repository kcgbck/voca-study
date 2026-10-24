// src/features/conversation/server/budgetPolicy.ts
// Google AI Studio 공급자 공식 한도, 90% 하드캡 정책 및 액션별 보수적 안전 계량 로직
// [원칙]
// 1. CHAT 15/250000/500 -> 90% floor: 13/225000/450, callerRpm: 13
// 2. STT 3/10000/25 -> 90% floor: 2/9000/22, callerRpm: 2
// 3. TTS 3/10000/10 -> 90% floor: 2/9000/9, callerRpm: 2
// 4. CHAT은 기존 16KiB + 교재JSON + 본문바이트 유지 (회귀 및 안전보호)
// 5. TTS는 500자 검증 텍스트/옵션 UTF-8 바이트 + 1024 로컬 유닛 추정
// 6. STT는 PCM16 RIFF/WAV 헤더 구조를 검증하여 실제 duration 기반 ceil(duration*64) + 1024 산정
//    압축/비WAV 오디오는 client duration 할인 없이 decodedBytes + 1024 폴백

import { GEMINI_MODELS } from './geminiInteractionsClient';
import {
  SecurityGuardError,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_USER_TEXT_LENGTH,
} from './securityGuards';
import { base64ToUint8Array } from './audioUtils';

export interface ModelBudgetLimits {
  rpm: number;
  tpm: number;
  rpd: number;
  callerRpm: number;
}

export type ModelLimitsMap = Record<string, ModelBudgetLimits>;

/**
 * 2026-10-22 기준 Google AI Studio 콘솔 확인 무료 등급 공식 한도
 */
export const GEMINI_PROVIDER_LIMITS = {
  [GEMINI_MODELS.CHAT]: { rpm: 15, tpm: 250000, rpd: 500 },
  [GEMINI_MODELS.TRANSCRIBE]: { rpm: 3, tpm: 10000, rpd: 25 },
  [GEMINI_MODELS.TTS]: { rpm: 3, tpm: 10000, rpd: 10 },
} as const;

/**
 * 공급자 한도 대비 90% 정수 내림(Floor) 하드캡 정책
 * 소수점이 발생하는 2.7 rpm 및 22.5 rpd는 올림 없이 엄격히 2, 22로 내림
 */
export const MODEL_HARD_CAPS_90_PERCENT: Record<string, ModelBudgetLimits> = {
  [GEMINI_MODELS.CHAT]: { rpm: 13, tpm: 225000, rpd: 450, callerRpm: 13 },
  [GEMINI_MODELS.TRANSCRIBE]: { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
  [GEMINI_MODELS.TTS]: { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
};

/**
 * 모델별 설정값을 90% 하드캡 정책으로 클램핑
 * - 공급자 90% 상한보다 큰 설정값은 90% 하드캡으로 제한
 * - 사용자가 더 작게 설정한 한도는 그대로 존중
 * - callerRpm은 min(설정값, 90% 하드캡 callerRpm, effectiveRPM)
 */
export function clampModelLimitsToPolicy(limits: ModelLimitsMap): ModelLimitsMap {
  const clamped: ModelLimitsMap = {};

  for (const [model, val] of Object.entries(limits)) {
    const hardCap = MODEL_HARD_CAPS_90_PERCENT[model];
    if (!hardCap) {
      clamped[model] = { ...val };
      continue;
    }

    const effectiveRpm = Math.min(val.rpm, hardCap.rpm);
    const effectiveTpm = Math.min(val.tpm, hardCap.tpm);
    const effectiveRpd = Math.min(val.rpd, hardCap.rpd);
    const effectiveCallerRpm = Math.min(val.callerRpm, hardCap.callerRpm, effectiveRpm);

    clamped[model] = {
      rpm: effectiveRpm,
      tpm: effectiveTpm,
      rpd: effectiveRpd,
      callerRpm: effectiveCallerRpm,
    };
  }

  return clamped;
}

/**
 * RIFF/WAVE 오디오 헤더 시그니처 판별
 */
export function isRiffWaveSignature(audioBytes: Uint8Array): boolean {
  if (audioBytes.length < 12) return false;
  return (
    audioBytes[0] === 0x52 && // 'R'
    audioBytes[1] === 0x49 && // 'I'
    audioBytes[2] === 0x46 && // 'F'
    audioBytes[3] === 0x46 && // 'F'
    audioBytes[8] === 0x57 && // 'W'
    audioBytes[9] === 0x41 && // 'A'
    audioBytes[10] === 0x56 && // 'V'
    audioBytes[11] === 0x45    // 'E'
  );
}

export interface VerifiedWavPcm16Info {
  verifiedDuration: number;
  sampleRate: number;
  numChannels: number;
  dataSize: number;
}

/**
 * 16-bit Linear PCM RIFF/WAV 헤더 구조 및 청크 검증
 * - 청크 순회 상한(32회), 경계, 오버플로우, 패딩 검사
 * - 중복 fmt/data 거절, 지원되지 않는 샘플레이트/채널/오디오포맷 거절
 * - 실제 dataSize와 byteRate로 정확한 duration 계산 (클라이언트 metadata 불신)
 */
export function parseAndValidateWavPcm16(audioBytes: Uint8Array): VerifiedWavPcm16Info {
  if (!isRiffWaveSignature(audioBytes)) {
    throw new SecurityGuardError('유효하지 않은 RIFF/WAVE 오디오 헤더 시그니처입니다.', 400);
  }

  const view = new DataView(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength);
  const riffChunkSize = view.getUint32(4, true);

  if (riffChunkSize < 4) {
    throw new SecurityGuardError('유효하지 않은 RIFF 청크 크기입니다.', 400);
  }

  // RIFF 청크 헤더 8바이트 + riffChunkSize는 실제 오디오 파일 길이와 엄격히 일치해야 함
  if (riffChunkSize + 8 !== audioBytes.length) {
    throw new SecurityGuardError('RIFF 청크 크기가 실제 오디오 파일 크기와 일치하지 않습니다.', 400);
  }

  const riffEnd = riffChunkSize + 8; // audioBytes.length
  let offset = 12;
  let foundFmt = false;
  let foundData = false;
  let byteRate = 0;
  let dataSize = 0;
  let sampleRate = 0;
  let numChannels = 0;
  let blockAlign = 0;
  let chunkCount = 0;
  const maxChunks = 32;

  while (offset < riffEnd && chunkCount < maxChunks) {
    chunkCount++;
    // 완전한 8바이트 헤더 검사 (파일 끝 0~7 잔여 바이트 junk 거부)
    if (offset + 8 > riffEnd) {
      throw new SecurityGuardError('완전한 청크 헤더(8바이트)가 부족합니다.', 400);
    }

    const chunkId = String.fromCharCode(
      audioBytes[offset],
      audioBytes[offset + 1],
      audioBytes[offset + 2],
      audioBytes[offset + 3]
    );
    const chunkSize = view.getUint32(offset + 4, true);

    // 청크 데이터가 파일 경계를 초과하는지 검사
    if (offset + 8 + chunkSize > riffEnd) {
      throw new SecurityGuardError('WAV 청크 데이터가 파일 경계를 초과합니다 (잘린 청크).', 400);
    }

    // 홀수 크기 청크의 1바이트 패딩 검증 (incomplete odd pad 거절)
    const padding = chunkSize % 2;
    if (offset + 8 + chunkSize + padding > riffEnd) {
      throw new SecurityGuardError('WAV 홀수 청크의 패딩 바이트가 누락되었습니다.', 400);
    }

    if (chunkId === 'fmt ') {
      if (foundFmt) {
        throw new SecurityGuardError('중복된 WAV fmt 청크가 감지되었습니다.', 400);
      }
      foundFmt = true;
      if (chunkSize < 16) {
        throw new SecurityGuardError('WAV fmt 청크 크기가 유효하지 않습니다 (최소 16바이트 필요).', 400);
      }

      const audioFormat = view.getUint16(offset + 8, true);
      if (audioFormat !== 1) { // 1 = Linear PCM
        throw new SecurityGuardError('지원하지 않는 WAV 오디오 포맷입니다 (Linear PCM 1만 지원).', 400);
      }

      numChannels = view.getUint16(offset + 10, true);
      if (numChannels === 0 || numChannels > 8) {
        throw new SecurityGuardError('유효하지 않은 WAV 오디오 채널 수입니다.', 400);
      }

      sampleRate = view.getUint32(offset + 12, true);
      if (sampleRate < 8000 || sampleRate > 192000) {
        throw new SecurityGuardError('유효하지 않은 WAV 샘플레이트입니다.', 400);
      }

      byteRate = view.getUint32(offset + 16, true);
      blockAlign = view.getUint16(offset + 20, true);
      const bitsPerSample = view.getUint16(offset + 22, true);

      if (bitsPerSample !== 16) {
        throw new SecurityGuardError('WAV 오디오는 16-bit PCM이어야 합니다.', 400);
      }

      const expectedBlockAlign = numChannels * 2;
      if (blockAlign !== expectedBlockAlign) {
        throw new SecurityGuardError('WAV blockAlign 값이 형식과 일치하지 않습니다.', 400);
      }

      const expectedByteRate = sampleRate * blockAlign;
      if (byteRate !== expectedByteRate) {
        throw new SecurityGuardError('WAV byteRate 값이 샘플레이트/블록 크기와 일치하지 않습니다.', 400);
      }
    } else if (chunkId === 'data') {
      if (foundData) {
        throw new SecurityGuardError('중복된 WAV data 청크가 감지되었습니다.', 400);
      }
      foundData = true;
      dataSize = chunkSize;
      if (dataSize <= 0) {
        throw new SecurityGuardError('WAV data 청크의 실제 데이터 크기가 0입니다.', 400);
      }
    }

    offset += 8 + chunkSize + padding;
  }

  // unparsed bytes 남으면 거부 (32청크 초과 후 미처리 바이트가 남거나, 끝에 잔여 바이트/junk가 있는 경우)
  if (offset !== riffEnd) {
    throw new SecurityGuardError('파싱되지 않은 잔여 데이터가 존재하거나 청크 제한(32회)을 초과했습니다.', 400);
  }

  if (!foundFmt) {
    throw new SecurityGuardError('WAV 필수 fmt 청크가 누락되었습니다.', 400);
  }
  if (!foundData) {
    throw new SecurityGuardError('WAV 필수 data 청크가 누락되었습니다.', 400);
  }
  if (byteRate <= 0 || dataSize <= 0) {
    throw new SecurityGuardError('유효한 WAV 오디오 스트림 정보를 읽을 수 없습니다.', 400);
  }

  // 모든 dataSize % blockAlign == 0 확인
  if (dataSize % blockAlign !== 0) {
    throw new SecurityGuardError('WAV data 크기가 blockAlign 정렬과 일치하지 않습니다.', 400);
  }

  const verifiedDuration = dataSize / byteRate;
  if (!Number.isFinite(verifiedDuration) || verifiedDuration <= 0) {
    throw new SecurityGuardError('유효하지 않은 WAV 재생 지속시간입니다.', 400);
  }

  if (verifiedDuration > MAX_AUDIO_DURATION_SECONDS) {
    throw new SecurityGuardError(
      `WAV 오디오의 실제 재생 지속시간(${verifiedDuration.toFixed(1)}초)이 최대 허용치(${MAX_AUDIO_DURATION_SECONDS}초)를 초과했습니다.`,
      400
    );
  }

  return { verifiedDuration, sampleRate, numChannels, dataSize };
}

/**
 * TTS 음성 합성 요청의 보수적 예산 산정
 * - 텍스트 유효성(최대 500자) 검증 후 UTF-8 바이트 + 옵션 바이트 + 고정 1024 로컬 유닛
 */
export function calculateTtsEstimatedUnits(
  parsedBody?: Record<string, unknown>,
  rawBodyBytes?: number
): number {
  if (parsedBody) {
    if (typeof parsedBody.text !== 'string') {
      throw new SecurityGuardError('입력 텍스트가 유효한 문자열이 아닙니다.', 400);
    }
    const trimmedText = parsedBody.text.trim();
    if (trimmedText.length === 0) {
      throw new SecurityGuardError('입력 텍스트가 비어 있습니다.', 400);
    }
    if (trimmedText.length > MAX_USER_TEXT_LENGTH) {
      throw new SecurityGuardError(
        `입력 텍스트가 최대 길이(${MAX_USER_TEXT_LENGTH}자)를 초과했습니다.`,
        400
      );
    }

    let effectiveVoiceName = 'Kore';
    if (typeof parsedBody.voiceName !== 'undefined') {
      if (typeof parsedBody.voiceName !== 'string') {
        throw new SecurityGuardError('voiceName은 문자열이어야 합니다.', 400);
      }
      if (parsedBody.voiceName === '') {
        effectiveVoiceName = 'Kore';
      } else if (parsedBody.voiceName.trim().length === 0) {
        throw new SecurityGuardError('voiceName이 유효하지 않습니다.', 400);
      } else {
        // 실제 handler가 보내는 원본 voiceName 문자열 byte를 count (trim으로 길이 줄이지 않음)
        effectiveVoiceName = parsedBody.voiceName;
      }
    }

    const textBytes = new TextEncoder().encode(trimmedText).byteLength;
    const optionBytes = new TextEncoder().encode(JSON.stringify({ voiceName: effectiveVoiceName })).byteLength;

    return textBytes + optionBytes + 1024;
  }

  return Math.min(rawBodyBytes ?? 0, MAX_USER_TEXT_LENGTH * 4) + 1024;
}

/**
 * STT 음성 전사 요청의 practical 안전 예산 산정
 * - Base64 형식, 2 MiB 크기, client metadata 지속시간 30초 검증
 * - PCM16 WAV인 경우: 실제 헤더 구조를 검증하여 verifiedDuration 도출 -> ceil(verifiedDuration * 64) + 1024
 * - 비WAV 압축 오디오인 경우: client duration으로 할인하지 않고 decodedBytes + 1024 보수 폴백
 */
export function calculateTranscribeEstimatedUnits(
  parsedBody?: Record<string, unknown>,
  rawBodyBytes?: number
): number {
  if (parsedBody) {
    if (typeof parsedBody.audioBase64 !== 'string' || parsedBody.audioBase64.trim().length === 0) {
      throw new SecurityGuardError('오디오 데이터가 누락되었거나 비어 있습니다.', 400);
    }

    const cleanBase64 = parsedBody.audioBase64.trim();
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (!base64Regex.test(cleanBase64)) {
      throw new SecurityGuardError('오디오 데이터가 올바른 Base64 형식이 아닙니다.', 400);
    }

    const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
    if (approxBytes === 0) {
      throw new SecurityGuardError('오디오 데이터 바이트 크기가 0입니다.', 400);
    }
    if (approxBytes > MAX_AUDIO_BYTES) {
      throw new SecurityGuardError(
        `오디오 파일 크기(${approxBytes} 바이트)가 최대 허용치(${MAX_AUDIO_BYTES / (1024 * 1024)} MiB)를 초과했습니다.`,
        400
      );
    }

    if (typeof parsedBody.durationSeconds !== 'undefined') {
      const d = parsedBody.durationSeconds;
      if (typeof d !== 'number' || isNaN(d) || !isFinite(d) || d <= 0) {
        throw new SecurityGuardError('유효하지 않은 오디오 재생 지속시간(duration)입니다.', 400);
      }
      if (d > MAX_AUDIO_DURATION_SECONDS) {
        throw new SecurityGuardError(
          `오디오 녹음 시간(${d}초)이 최대 허용치(${MAX_AUDIO_DURATION_SECONDS}초)를 초과했습니다.`,
          400
        );
      }
    }

    const audioBytes = base64ToUint8Array(cleanBase64);
    if (audioBytes.length === 0) {
      throw new SecurityGuardError('오디오 디코딩 바이트 크기가 0입니다.', 400);
    }
    if (audioBytes.length > MAX_AUDIO_BYTES) {
      throw new SecurityGuardError('오디오 바이트 크기가 최대 허용치를 초과했습니다.', 400);
    }

    // MIME wav계열 OR 처음 4bytes RIFF OR 정상 signature 중 하나면 strict WAV parse
    const isWavMime =
      typeof parsedBody.mimeType === 'string' &&
      /wav/i.test(parsedBody.mimeType);

    const hasRiffPrefix =
      audioBytes.length >= 4 &&
      audioBytes[0] === 0x52 && // 'R'
      audioBytes[1] === 0x49 && // 'I'
      audioBytes[2] === 0x46 && // 'F'
      audioBytes[3] === 0x46;   // 'F'

    if (isWavMime || hasRiffPrefix || isRiffWaveSignature(audioBytes)) {
      const { verifiedDuration } = parseAndValidateWavPcm16(audioBytes);
      // Google 32 audio tokens/s의 2배인 64를 로컬 보수적 추정 계수로 적용
      return Math.ceil(verifiedDuration * 64) + 1024;
    }

    // 일반 webm/rawPCM 등 header 없는 비WAV 압축 오디오는 기존 decodedBytes + 1024 폴백으로 메타데이터 할인 없이 유지
    return audioBytes.length + 1024;
  }

  return (rawBodyBytes ?? 0) + 1024;
}

// src/features/conversation/server/audioUtils.ts
// PCM 16-bit 오디오를 브라우저 재생 가능한 WAV 컨테이너로 변환 및 MIME 유효성 검증

/**
 * 16-bit Linear PCM 바이트를 표준 44바이트 RIFF/WAV 오디오로 패키징
 */
export function pcm16ToWav(
  pcmData: Uint8Array,
  sampleRate = 24000,
  numChannels = 1
): Uint8Array {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmData.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // Subchunk2Size

  const wav = new Uint8Array(44 + dataSize);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmData, 44);
  return wav;
}

/**
 * 허용된 오디오 MIME 타입 목록
 */
export const ALLOWED_AUDIO_MIMES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/l16',
] as const;

export function isAllowedAudioMime(mime: string): boolean {
  if (!mime || typeof mime !== 'string') return false;
  const baseMime = mime.split(';')[0].trim().toLowerCase();
  return (
    baseMime === 'audio/webm' ||
    baseMime === 'audio/ogg' ||
    baseMime === 'audio/wav' ||
    baseMime === 'audio/x-wav' ||
    baseMime === 'audio/mpeg' ||
    baseMime === 'audio/mp3' ||
    baseMime === 'audio/mp4' ||
    baseMime === 'audio/m4a' ||
    baseMime === 'audio/l16'
  );
}

/**
 * Google AI Interactions API 규격에 맞게 오디오 MIME 정규화
 * - 코덱 suffix(;codecs=...) 제거
 * - audio/mp4 -> audio/m4a
 * - audio/x-wav -> audio/wav
 */
export function normalizeInteractionsAudioMime(mime: string): string {
  if (!mime || typeof mime !== 'string') return 'audio/wav';
  const baseMime = mime.split(';')[0].trim().toLowerCase();
  if (baseMime === 'audio/mp4') {
    return 'audio/m4a';
  }
  if (baseMime === 'audio/x-wav') {
    return 'audio/wav';
  }
  return baseMime;
}

/**
 * Base64 인코딩된 문자열을 Uint8Array 바이트 배열로 변환
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Uint8Array 바이트 배열을 Base64 문자열로 변환
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

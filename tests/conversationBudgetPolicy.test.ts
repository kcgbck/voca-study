// tests/conversationBudgetPolicy.test.ts
// 공급자 한도 90% 하드캡 정책, 클램핑 및 액션별 보수적 안전 계량 로직 단위 검증

import { describe, it, expect } from 'vitest';
import {
  GEMINI_PROVIDER_LIMITS,
  MODEL_HARD_CAPS_90_PERCENT,
  clampModelLimitsToPolicy,
  parseAndValidateWavPcm16,
  calculateTtsEstimatedUnits,
  calculateTranscribeEstimatedUnits,
  isRiffWaveSignature,
} from '../src/features/conversation/server/budgetPolicy';
import {
  validateModelLimitsJson,
  calculateConservativeEstimatedUnits,
} from '../src/features/conversation/server/configFactory';
import { pcm16ToWav, uint8ArrayToBase64 } from '../src/features/conversation/server/audioUtils';
import { SecurityGuardError } from '../src/features/conversation/server/securityGuards';

describe('conversationBudgetPolicy 단위 및 안전 계량 검증', () => {
  describe('1. 90% 하드캡 정책 및 클램핑 검증', () => {
    it('공급자 한도 대비 90% 정수 내림(floor) 하드캡이 정확해야 한다', () => {
      // 공급자 공식 한도 대비 각 축(rpm, tpm, rpd)의 90% floor 계산 일치 단언
      for (const [model, provider] of Object.entries(GEMINI_PROVIDER_LIMITS)) {
        const cap = MODEL_HARD_CAPS_90_PERCENT[model];
        expect(cap).toBeDefined();
        expect(cap.rpm).toBe(Math.floor(provider.rpm * 0.9));
        expect(cap.tpm).toBe(Math.floor(provider.tpm * 0.9));
        expect(cap.rpd).toBe(Math.floor(provider.rpd * 0.9));
      }

      expect(MODEL_HARD_CAPS_90_PERCENT['gemini-3.5-flash-lite']).toEqual({
        rpm: 13, // floor(15 * 0.9) = 13
        tpm: 225000, // floor(250000 * 0.9) = 225000
        rpd: 450, // floor(500 * 0.9) = 450
        callerRpm: 13,
      });

      expect(MODEL_HARD_CAPS_90_PERCENT['gemini-3.5-transcribe']).toEqual({
        rpm: 2, // floor(3 * 0.9 = 2.7) = 2 (올림 없음)
        tpm: 9000, // floor(10000 * 0.9) = 9000
        rpd: 22, // floor(25 * 0.9 = 22.5) = 22 (올림 없음)
        callerRpm: 2,
      });

      expect(MODEL_HARD_CAPS_90_PERCENT['gemini-3.8-flash-lite-tts']).toEqual({
        rpm: 2, // floor(3 * 0.9 = 2.7) = 2 (올림 없음)
        tpm: 9000, // floor(10000 * 0.9) = 9000
        rpd: 9, // floor(10 * 0.9) = 9
        callerRpm: 2,
      });
    });

    it('하드캡보다 큰 설정값은 90% 하드캡으로 클램핑되어야 한다', () => {
      const hugeInput = {
        'gemini-3.5-flash-lite': { rpm: 100, tpm: 1000000, rpd: 5000, callerRpm: 50 },
        'gemini-3.5-transcribe': { rpm: 10, tpm: 100000, rpd: 500, callerRpm: 10 },
        'gemini-3.8-flash-lite-tts': { rpm: 10, tpm: 100000, rpd: 500, callerRpm: 10 },
      };

      const clamped = clampModelLimitsToPolicy(hugeInput);

      expect(clamped['gemini-3.5-flash-lite']).toEqual({
        rpm: 13,
        tpm: 225000,
        rpd: 450,
        callerRpm: 13,
      });
      expect(clamped['gemini-3.5-transcribe']).toEqual({
        rpm: 2,
        tpm: 9000,
        rpd: 22,
        callerRpm: 2,
      });
      expect(clamped['gemini-3.8-flash-lite-tts']).toEqual({
        rpm: 2,
        tpm: 9000,
        rpd: 9,
        callerRpm: 2,
      });
    });

    it('하드캡보다 작은 사용자 설정값은 그대로 존중되어야 한다', () => {
      const smallInput = {
        'gemini-3.5-flash-lite': { rpm: 5, tpm: 50000, rpd: 100, callerRpm: 3 },
        'gemini-3.5-transcribe': { rpm: 1, tpm: 4000, rpd: 10, callerRpm: 1 },
        'gemini-3.8-flash-lite-tts': { rpm: 1, tpm: 4000, rpd: 5, callerRpm: 1 },
      };

      const clamped = clampModelLimitsToPolicy(smallInput);

      expect(clamped['gemini-3.5-flash-lite']).toEqual({
        rpm: 5,
        tpm: 50000,
        rpd: 100,
        callerRpm: 3,
      });
      expect(clamped['gemini-3.5-transcribe']).toEqual({
        rpm: 1,
        tpm: 4000,
        rpd: 10,
        callerRpm: 1,
      });
      expect(clamped['gemini-3.8-flash-lite-tts']).toEqual({
        rpm: 1,
        tpm: 4000,
        rpd: 5,
        callerRpm: 1,
      });
    });

    it('callerRpm은 클램핑된 effectiveRPM을 초과할 수 없다', () => {
      const input = {
        'gemini-3.5-flash-lite': { rpm: 5, tpm: 200000, rpd: 400, callerRpm: 10 },
        'gemini-3.5-transcribe': { rpm: 1, tpm: 8000, rpd: 20, callerRpm: 5 },
        'gemini-3.8-flash-lite-tts': { rpm: 1, tpm: 8000, rpd: 8, callerRpm: 5 },
      };

      const clamped = clampModelLimitsToPolicy(input);

      expect(clamped['gemini-3.5-flash-lite'].callerRpm).toBe(5);
      expect(clamped['gemini-3.5-transcribe'].callerRpm).toBe(1);
      expect(clamped['gemini-3.8-flash-lite-tts'].callerRpm).toBe(1);
    });

    it('validateModelLimitsJson은 비정상/누락/음수/null 입력 시 fail-closed(null)를 반환해야 한다', () => {
      expect(validateModelLimitsJson(null)).toBeNull();
      expect(validateModelLimitsJson('')).toBeNull();
      expect(validateModelLimitsJson('not-json')).toBeNull();
      expect(validateModelLimitsJson(JSON.stringify({}))).toBeNull();

      // 음수 한도
      expect(
        validateModelLimitsJson(
          JSON.stringify({
            'gemini-3.5-flash-lite': { rpm: -1, tpm: 225000, rpd: 450, callerRpm: 13 },
            'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
            'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
          })
        )
      ).toBeNull();

      // null 포함
      expect(
        validateModelLimitsJson(
          JSON.stringify({
            'gemini-3.5-flash-lite': { rpm: 13, tpm: null, rpd: 450, callerRpm: 13 },
            'gemini-3.5-transcribe': { rpm: 2, tpm: 9000, rpd: 22, callerRpm: 2 },
            'gemini-3.8-flash-lite-tts': { rpm: 2, tpm: 9000, rpd: 9, callerRpm: 2 },
          })
        )
      ).toBeNull();
    });
  });

  describe('2. PCM16 WAV 파싱 및 지속시간 검증', () => {
    it('표준 3초 16kHz PCM16 WAV를 정확히 파싱하고 duration을 계산해야 한다', () => {
      // 16kHz, mono, 16-bit PCM: byteRate = 32000, 3초 dataSize = 96000
      const pcm = new Uint8Array(96000);
      const wav = pcm16ToWav(pcm, 16000, 1);

      expect(isRiffWaveSignature(wav)).toBe(true);

      const parsed = parseAndValidateWavPcm16(wav);
      expect(parsed.verifiedDuration).toBeCloseTo(3.0, 2);
      expect(parsed.sampleRate).toBe(16000);
      expect(parsed.numChannels).toBe(1);
      expect(parsed.dataSize).toBe(96000);
    });

    it('실제 길이가 31초인 WAV는 client duration metadata가 1초라도 400 에러로 거절되어야 한다', () => {
      // 8kHz, mono, 16-bit PCM: byteRate = 16000, 31초 = 496000 bytes
      const pcm = new Uint8Array(16000 * 31);
      const wav = pcm16ToWav(pcm, 8000, 1);

      expect(() => parseAndValidateWavPcm16(wav)).toThrow(SecurityGuardError);
      expect(() => parseAndValidateWavPcm16(wav)).toThrow(/30초/);

      // calculateTranscribeEstimatedUnits에 metadata durationSeconds: 1을 주어도 거절
      const b64 = uint8ArrayToBase64(wav);
      expect(() =>
        calculateTranscribeEstimatedUnits({
          audioBase64: b64,
          durationSeconds: 1, // 클라이언트의 거짓 지속시간
        })
      ).toThrow(SecurityGuardError);
    });

    it('잘린 WAV 또는 잘못된 RIFF 크기는 400 에러로 거절되어야 한다', () => {
      const pcm = new Uint8Array(16000);
      const wav = pcm16ToWav(pcm, 16000, 1);

      // 파일을 중간에서 잘라냄 (truncated)
      const truncated = wav.slice(0, 30);
      expect(() => parseAndValidateWavPcm16(truncated)).toThrow(SecurityGuardError);
    });

    it('data 청크 크기가 0인 빈 WAV는 400 에러로 거절되어야 한다', () => {
      const pcm = new Uint8Array(0);
      const wav = pcm16ToWav(pcm, 16000, 1);
      expect(() => parseAndValidateWavPcm16(wav)).toThrow(SecurityGuardError);
    });
  });

  describe('3. 액션별 예산 산정 공식 자기검증', () => {
    it('3초 대표 WAV의 추정 예산은 ceil(3 * 64) + 1024 = 1216 units여야 한다', () => {
      const pcm = new Uint8Array(16000 * 3 * 2); // 16kHz mono 3s = 96000 bytes
      const wav = pcm16ToWav(pcm, 16000, 1);
      const b64 = uint8ArrayToBase64(wav);

      const units = calculateTranscribeEstimatedUnits({
        audioBase64: b64,
        durationSeconds: 3,
      });

      // ceil(3 * 64) + 1024 = 192 + 1024 = 1216
      expect(units).toBe(1216);
      expect(units).toBeLessThanOrEqual(9000); // STT 9000 TPM 이내
    });

    it('1초 및 5초 WAV도 9000 한도 내에서 안전하게 산정되어야 한다', () => {
      const pcm1 = new Uint8Array(16000 * 1 * 2);
      const wav1 = pcm16ToWav(pcm1, 16000, 1);
      const units1 = calculateTranscribeEstimatedUnits({ audioBase64: uint8ArrayToBase64(wav1) });
      expect(units1).toBe(64 + 1024); // 1088

      const pcm5 = new Uint8Array(16000 * 5 * 2);
      const wav5 = pcm16ToWav(pcm5, 16000, 1);
      const units5 = calculateTranscribeEstimatedUnits({ audioBase64: uint8ArrayToBase64(wav5) });
      expect(units5).toBe(320 + 1024); // 1344
    });

    it('비WAV 압축 오디오는 client duration으로 할인되지 않고 decodedBytes + 1024로 보수 산정되어야 한다', () => {
      // RIFF 헤더가 없는 임의의 바이트 (예: WebM Opus 청크 1500바이트)
      const fakeOpus = new Uint8Array(1500);
      fakeOpus.fill(0xaa);
      const b64 = uint8ArrayToBase64(fakeOpus);

      const units = calculateTranscribeEstimatedUnits({
        audioBase64: b64,
        durationSeconds: 1, // client duration이 1초라고 해도 무시
      });

      // 1500 + 1024 = 2524
      expect(units).toBe(2524);
    });

    it('보통 길이의 TTS 요청은 9000 한도 내에서 안전하게 산정되어야 한다', () => {
      const ttsUnits = calculateTtsEstimatedUnits({
        text: 'Hello, welcome to our conversation lesson!',
        voiceName: 'Kore',
      });

      expect(ttsUnits).toBeGreaterThan(1024);
      expect(ttsUnits).toBeLessThan(1200);
      expect(ttsUnits).toBeLessThanOrEqual(9000); // TTS 9000 TPM 이내
    });

    it('TTS 텍스트가 500자 초과 시 400 에러로 거절되어야 한다', () => {
      const longText = 'a'.repeat(501);
      expect(() => calculateTtsEstimatedUnits({ text: longText })).toThrow(SecurityGuardError);
      expect(() => calculateTtsEstimatedUnits({ text: longText })).toThrow(/500자/);
    });

    it('CHAT 계량은 기존 16KiB 고정 오버헤드를 유지하여 대용량 본문 거절 회귀를 보존해야 한다', () => {
      // 2 MiB 크기의 body (lesson 없는 경우 정확히 body + 16 KiB)
      const units = calculateConservativeEstimatedUnits('chat', 2 * 1024 * 1024);
      expect(units).toBe(2 * 1024 * 1024 + 16 * 1024);
      // 225,000 TPM 하드캡을 초과하므로 거절 의도 보존
      expect(units).toBeGreaterThan(225000);
    });

    it('잘린/과소 RIFF size, 불일치 크기, 32 청크 초과, 패딩 누락, 비정렬 PCM은 400 거절되고 정상 JUNK 패딩은 통과해야 한다', () => {
      const validWav = pcm16ToWav(new Uint8Array(16000 * 1 * 2), 16000, 1);

      // 1) 과소 RIFF size (< 4)
      const underWav = new Uint8Array(validWav);
      new DataView(underWav.buffer).setUint32(4, 3, true);
      expect(() => parseAndValidateWavPcm16(underWav)).toThrow(SecurityGuardError);
      expect(() => parseAndValidateWavPcm16(underWav)).toThrow(/유효하지 않은 RIFF/);

      // 2) RIFF size 4로 축소 (실제 파일 길이와 불일치)
      const shrinkRiff = new Uint8Array(validWav);
      new DataView(shrinkRiff.buffer).setUint32(4, 4, true);
      expect(() => parseAndValidateWavPcm16(shrinkRiff)).toThrow(SecurityGuardError);
      expect(() => parseAndValidateWavPcm16(shrinkRiff)).toThrow(/일치하지 않습니다/);

      // 3) RIFF size와 파일 길이 불일치 (과대)
      const mismatchWav = new Uint8Array(validWav);
      new DataView(mismatchWav.buffer).setUint32(4, validWav.length, true);
      expect(() => parseAndValidateWavPcm16(mismatchWav)).toThrow(SecurityGuardError);

      // 4) 홀수 청크 패딩 누락 (JUNK 청크 3바이트인데 패딩 없이 바로 파일 끝)
      const unpadded = new Uint8Array(12 + 8 + 3);
      unpadded.set(validWav.slice(0, 12), 0);
      new DataView(unpadded.buffer).setUint32(4, unpadded.length - 8, true);
      unpadded[12] = 0x4a; unpadded[13] = 0x55; unpadded[14] = 0x4e; unpadded[15] = 0x4b; // 'JUNK'
      new DataView(unpadded.buffer).setUint32(16, 3, true);
      unpadded[20] = 0x01; unpadded[21] = 0x02; unpadded[22] = 0x03;
      expect(() => parseAndValidateWavPcm16(unpadded)).toThrow(SecurityGuardError);

      // 5) 32 청크 초과 미처리 (33개 더미 청크 후 fmt/data)
      const chunkBytes = 8 + 4; // 12바이트씩 33개 = 396바이트
      const manyChunks = new Uint8Array(12 + chunkBytes * 33);
      manyChunks.set(validWav.slice(0, 12), 0);
      new DataView(manyChunks.buffer).setUint32(4, manyChunks.length - 8, true);
      let o = 12;
      for (let i = 0; i < 33; i++) {
        manyChunks[o] = 0x4a; manyChunks[o + 1] = 0x55; manyChunks[o + 2] = 0x4e; manyChunks[o + 3] = 0x4b;
        new DataView(manyChunks.buffer).setUint32(o + 4, 4, true);
        o += 12;
      }
      expect(() => parseAndValidateWavPcm16(manyChunks)).toThrow(SecurityGuardError);

      // 6) dataSize가 blockAlign(mono 16-bit = 2바이트) 배수가 아닌 홀수 (비정렬, 정상 1바이트 패딩 포함)
      // 12 (RIFF) + 24 (fmt) + 8 (data header) + 3 (data) + 1 (pad) = 48 bytes
      const unaligned = new Uint8Array(12 + 24 + 8 + 3 + 1);
      unaligned.set(validWav.slice(0, 36), 0); // RIFF + fmt
      new DataView(unaligned.buffer).setUint32(4, unaligned.length - 8, true); // RIFF size = 40
      unaligned.set([0x64, 0x61, 0x74, 0x61], 36); // 'data'
      new DataView(unaligned.buffer).setUint32(40, 3, true); // dataSize = 3
      unaligned[44] = 0x01; unaligned[45] = 0x02; unaligned[46] = 0x03; // 3 bytes PCM
      unaligned[47] = 0x00; // 1 byte padding
      expect(() => parseAndValidateWavPcm16(unaligned)).toThrow(SecurityGuardError);
      expect(() => parseAndValidateWavPcm16(unaligned)).toThrow(/blockAlign/);

      // 7) 정상 JUNK 청크 및 1바이트 패딩이 있는 WAV는 정상 통과
      // 12 (RIFF) + 12 (JUNK: 8 header + 3 data + 1 pad) + 24 (fmt) + 8 (data header) + 32000 (pcm) = 32056 bytes
      const junkWav = new Uint8Array(12 + 12 + 24 + 8 + 32000);
      junkWav.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
      new DataView(junkWav.buffer).setUint32(4, junkWav.length - 8, true);
      junkWav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
      // JUNK 청크: 크기 3, 패딩 1
      junkWav.set([0x4a, 0x55, 0x4e, 0x4b], 12);
      new DataView(junkWav.buffer).setUint32(16, 3, true);
      junkWav[20] = 0x01; junkWav[21] = 0x02; junkWav[22] = 0x03; junkWav[23] = 0x00; // pad
      // fmt 청크 복사 (24바이트)
      junkWav.set(validWav.slice(12, 36), 24);
      // data 청크 헤더 및 데이터 복사 (8 + 32000)
      junkWav.set(validWav.slice(36), 48);

      const parsedJunk = parseAndValidateWavPcm16(junkWav);
      expect(parsedJunk.verifiedDuration).toBeCloseTo(1.0, 2);
      expect(parsedJunk.sampleRate).toBe(16000);
    });

    it('WAV mime 잘린 file 및 MIME webm 위장 RIFF 31초는 400 거절되어야 한다', () => {
      // 1) MIME이 audio/wav인데 10바이트로 잘린 파일
      const shortBytes = new Uint8Array(10);
      shortBytes.set([0x52, 0x49, 0x46, 0x46, 0x02, 0x00, 0x00, 0x00, 0x57, 0x41], 0);
      expect(() =>
        calculateTranscribeEstimatedUnits({
          audioBase64: uint8ArrayToBase64(shortBytes),
          mimeType: 'audio/wav',
          durationSeconds: 1,
        })
      ).toThrow(SecurityGuardError);

      // 2) MIME이 audio/webm이지만 실제로는 RIFF prefix를 가진 31초 초과 파일
      const longPcm = new Uint8Array(8000 * 31 * 2);
      const longWav = pcm16ToWav(longPcm, 8000, 1);
      expect(() =>
        calculateTranscribeEstimatedUnits({
          audioBase64: uint8ArrayToBase64(longWav),
          mimeType: 'audio/webm', // webm으로 위장
          durationSeconds: 1,
        })
      ).toThrow(SecurityGuardError);
    });

    it('TTS invalid voice 객체는 400 에러, 긴 voice는 meter 증가(공백 미할인), 일반 Kore는 9000 이내여야 한다', () => {
      // 1) voiceName이 객체인 경우 400
      expect(() =>
        calculateTtsEstimatedUnits({
          text: 'Hello test',
          voiceName: { name: 'Kore' } as unknown as string,
        })
      ).toThrow(SecurityGuardError);

      // voiceName이 공백만 있는 문자열인 경우 400
      expect(() =>
        calculateTtsEstimatedUnits({
          text: 'Hello test',
          voiceName: '   ',
        })
      ).toThrow(SecurityGuardError);

      // 2) 긴 원본 voice 옵션은 trim 없이 바이트가 보존되어 meter 증가
      const unitsTrimmed = calculateTtsEstimatedUnits({
        text: 'Hello test',
        voiceName: 'Kore',
      });
      const unitsSpaced = calculateTtsEstimatedUnits({
        text: 'Hello test',
        voiceName: '   Kore   ',
      });
      expect(unitsSpaced).toBe(unitsTrimmed + 6); // 6칸 공백 바이트 그대로 반영

      // 8000자 초과 voice 옵션 시 예산 산정값이 9000을 초과하여 거절 가능
      const hugeVoiceUnits = calculateTtsEstimatedUnits({
        text: 'Hello test',
        voiceName: 'A'.repeat(8000),
      });
      expect(hugeVoiceUnits).toBeGreaterThan(9000);

      // 3) 일반 Kore voice는 9000 이내
      const normalUnits = calculateTtsEstimatedUnits({
        text: 'Hello, welcome to TOEIC conversation practice!',
        voiceName: 'Kore',
      });
      expect(normalUnits).toBeLessThanOrEqual(9000);
    });
  });
});

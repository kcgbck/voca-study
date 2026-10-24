// src/features/conversation/services/voiceOutput.ts
// 음성 출력 서비스 (공식 TTS 오디오 재생 및 브라우저 SpeechSynthesis 안전 폴백)
// 비공식 Translate 프록시 절대 사용 금지, 동시 발화 정지, BlobURL 즉시 해제

export interface VoiceOutputOptions {
  audioBase64?: string;
  mimeType?: string;
  lang?: string;
  rate?: number;
  isFixedKeyExpression?: boolean;
}

export interface VoiceOutputResult {
  success: boolean;
  method: 'server_tts' | 'browser_speech' | 'none';
  autoplayBlocked?: boolean;
  error?: string;
}

export class VoiceOutputService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private currentAudioResolver: ((value: boolean) => void) | null = null;
  private currentSpeechResolver: ((value: boolean) => void) | null = null;
  private currentSpeechGen = 0;

  // 수업 고정 핵심 표현만 제한적으로 메모리 캐시 (임의 사용자 문장 캐시 금지)
  private fixedExpressionCache = new Map<string, { audioBase64: string; mimeType: string }>();

  /**
   * 고정 핵심 표현 캐시 조회
   */
  public getCachedExpression(text: string): { audioBase64: string; mimeType: string } | undefined {
    return this.fixedExpressionCache.get(text.trim().toLowerCase());
  }

  /**
   * 고정 핵심 표현 캐시 저장
   */
  public cacheExpression(text: string, audioBase64: string, mimeType: string): void {
    if (this.fixedExpressionCache.size > 200) {
      // 과도한 메모리 누적 방지 (선입선출 제거)
      const firstKey = this.fixedExpressionCache.keys().next().value;
      if (firstKey) this.fixedExpressionCache.delete(firstKey);
    }
    this.fixedExpressionCache.set(text.trim().toLowerCase(), { audioBase64, mimeType });
  }

  /**
   * 현재 진행 중인 모든 음성 재생 즉시 중단 및 리소스 해제
   */
  public cancel(): void {
    this.currentSpeechGen++;

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // ignore
      }
      this.currentAudio = null;
    }

    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }

    if (this.currentAudioResolver) {
      this.currentAudioResolver(false);
      this.currentAudioResolver = null;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }

    if (this.currentSpeechResolver) {
      this.currentSpeechResolver(false);
      this.currentSpeechResolver = null;
    }
  }

  /**
   * 오디오 데이터 재생 (서버 TTS Base64)
   */
  public async playAudio(audioBase64: string, mimeType = 'audio/wav', generation?: number, rate = 1.0): Promise<{ success: boolean; autoplayBlocked?: boolean }> {
    if (generation === undefined) this.cancel();

    if (typeof Audio === 'undefined') {
      return { success: false };
    }

    try {
      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      this.currentBlobUrl = blobUrl;

      const audio = new Audio(blobUrl);
      if (rate && rate > 0) {
        audio.playbackRate = rate;
      }
      this.currentAudio = audio;

      return new Promise((resolve) => {
        this.currentAudioResolver = (val: boolean) => resolve({ success: val });

        audio.onended = () => {
          if (this.currentAudio !== audio) { resolve({ success: false }); return; }
          this.cleanupAudio();
          resolve({ success: true });
        };

        audio.onerror = () => {
          if (this.currentAudio !== audio) { resolve({ success: false }); return; }
          this.cleanupAudio();
          resolve({ success: false });
        };

        audio.play().catch((err: Error) => {
          if (this.currentAudio !== audio) { resolve({ success: false }); return; }
          this.cleanupAudio();
          const isAutoplay = err.name === 'NotAllowedError';
          resolve({ success: false, autoplayBlocked: isAutoplay });
        });
      });
    } catch {
      this.cleanupAudio();
      return { success: false };
    }
  }

  /**
   * 브라우저 기본 Web Speech API (SpeechSynthesis) 폴백 발화
   */
  public async speakBrowserSynthesis(text: string, lang = 'en-US', rate = 1.0, gen?: number): Promise<boolean> {
    if (gen !== undefined && this.currentSpeechGen !== gen) {
      return false;
    }

    if (gen === undefined) this.cancel();
    const currentGen = this.currentSpeechGen;

    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    return new Promise((resolve) => {
      this.currentSpeechResolver = resolve;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;

      utterance.onend = () => {
        if (this.currentSpeechGen === currentGen) {
          this.currentSpeechResolver = null;
          resolve(true);
        } else {
          resolve(false);
        }
      };

      utterance.onerror = () => {
        if (this.currentSpeechGen === currentGen) {
          this.currentSpeechResolver = null;
        }
        resolve(false);
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        this.currentSpeechResolver = null;
        resolve(false);
      }
    });
  }

  /**
   * 통합 음성 출력 (서버 오디오 우선 -> 브라우저 Web Speech API 안전 폴백)
   */
  public async speak(
    text: string,
    options: VoiceOutputOptions = {}
  ): Promise<VoiceOutputResult> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { success: false, method: 'none', error: '텍스트가 비어 있습니다.' };
    }

    this.cancel();
    const gen = this.currentSpeechGen;

    // 1. 고정 핵심 표현인 경우 캐시 확인
    let audioBase64 = options.audioBase64;
    let mimeType = options.mimeType;

    if (options.isFixedKeyExpression && !audioBase64) {
      const cached = this.getCachedExpression(trimmed);
      if (cached) {
        audioBase64 = cached.audioBase64;
        mimeType = cached.mimeType;
      }
    }

    // 2. 서버 TTS 오디오 데이터가 있는 경우 우선 재생
    if (audioBase64) {
      const playRes = await this.playAudio(audioBase64, mimeType || 'audio/wav', gen, options.rate || 1.0);
      if (this.currentSpeechGen !== gen) {
        return { success: false, method: 'none', error: '음성 재생이 취소되었습니다.' };
      }
      if (playRes.success) {
        if (options.isFixedKeyExpression && !this.getCachedExpression(trimmed)) {
          this.cacheExpression(trimmed, audioBase64, mimeType || 'audio/wav');
        }
        return { success: true, method: 'server_tts' };
      }
      if (playRes.autoplayBlocked) {
        return { success: false, method: 'server_tts', autoplayBlocked: true, error: '브라우저 오디오 자동 재생이 차단되었습니다.' };
      }
    }

    if (this.currentSpeechGen !== gen) {
      return { success: false, method: 'none', error: '음성 재생이 취소되었습니다.' };
    }

    // 3. 브라우저 내장 SpeechSynthesis 안전 폴백 (Translate 프록시 절대 사용 금지)
    const browserSuccess = await this.speakBrowserSynthesis(trimmed, options.lang || 'en-US', options.rate || 1.0, gen);
    if (this.currentSpeechGen !== gen) {
      return { success: false, method: 'none', error: '음성 재생이 취소되었습니다.' };
    }
    if (browserSuccess) {
      return { success: true, method: 'browser_speech' };
    }

    return {
      success: false,
      method: 'none',
      error: '음성 출력을 지원하지 않거나 재생에 실패했습니다.',
    };
  }

  private cleanupAudio(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
    this.currentAudio = null;
    this.currentAudioResolver = null;
  }
}

export const voiceOutput = new VoiceOutputService();

// src/features/conversation/services/localSpeechInput.ts
// 온디바이스(로컬) SpeechRecognition 전용 서비스 (Google STT 쿼터 절감용)
// 원격 음성 인식/fetch/Google API/MediaRecorder 사용 절대 금지

export class LocalSpeechInputService {
  private generation = 0;
  private activeRecognition: any = null;
  private pendingAvailabilityReject: ((error: Error) => void) | null = null;
  private pendingResolve: ((transcript: string) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private maxDurationTimer: any = null;
  private endGraceTimer: any = null;
  private accumulatedTranscript = '';
  private lastErrorMessage = '';

  constructor(private injectedConstructor?: any) {}

  private getConstructor(): any {
    if (this.injectedConstructor) return this.injectedConstructor;
    if (typeof window !== 'undefined') {
      return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    }
    if (typeof globalThis !== 'undefined') {
      return (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition || null;
    }
    return null;
  }

  private clearTimers(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.endGraceTimer) {
      clearTimeout(this.endGraceTimer);
      this.endGraceTimer = null;
    }
  }

  public async start(): Promise<string> {
    const sessionGen = ++this.generation;
    this.cancelActiveSession('새 음성 인식이 시작되어 이전 세션이 취소되었습니다.');

    const Constructor = this.getConstructor();
    if (!Constructor) {
      throw new Error('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    }

    if (typeof Constructor.available !== 'function') {
      throw new Error('이 브라우저는 온디바이스 음성 인식을 지원하지 않습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    }

    let probe: any;
    try {
      probe = new Constructor();
    } catch {
      throw new Error('음성 인식 초기화에 실패했습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    }

    if (!probe || !('processLocally' in probe)) {
      throw new Error('이 브라우저는 온디바이스(로컬) 음성 인식을 지원하지 않습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    }

    let status: string;
    let stageTimeoutTimer: any = null;
    let stageCancelReject: ((error: Error) => void) | null = null;
    try {
      const availablePromise = Promise.resolve(
        Constructor.available({ langs: ['en-US'], processLocally: true })
      );

      const cancelPromise = new Promise<never>((_, reject) => {
        stageCancelReject = reject;
        this.pendingAvailabilityReject = reject;
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        stageTimeoutTimer = setTimeout(() => {
          reject(new Error('온디바이스 음성인식 확인 시간이 초과되었습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.'));
        }, 5000);
      });

      status = await Promise.race([availablePromise, cancelPromise, timeoutPromise]);
    } catch (err: any) {
      if (this.generation !== sessionGen) {
        throw new Error('음성 인식이 취소되었습니다.');
      }
      if (err instanceof Error && (err.message.includes('취소되었습니다') || err.message.includes('시간이 초과되었습니다'))) {
        throw err;
      }
      throw new Error('온디바이스 음성인식 확인 중 오류가 발생했습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    } finally {
      if (stageTimeoutTimer) {
        clearTimeout(stageTimeoutTimer);
        stageTimeoutTimer = null;
      }
      if (this.pendingAvailabilityReject === stageCancelReject) {
        this.pendingAvailabilityReject = null;
      }
    }

    if (this.generation !== sessionGen) {
      throw new Error('음성 인식이 취소되었습니다.');
    }

    if (status !== 'available') {
      throw new Error('영어(en-US) 온디바이스 음성인식 언어 팩이 준비되지 않았습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.');
    }

    return new Promise<string>((resolve, reject) => {
      if (this.generation !== sessionGen) {
        reject(new Error('음성 인식이 취소되었습니다.'));
        return;
      }

      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.accumulatedTranscript = '';
      this.lastErrorMessage = '';

      let recognition: any;
      try {
        recognition = new Constructor();
      } catch {
        this.settleReject(new Error('음성 인식 생성에 실패했습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.'));
        return;
      }

      this.activeRecognition = recognition;

      recognition.processLocally = true;
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        if (this.generation !== sessionGen) return;
        if (!event || !event.results) return;
        for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
          const item = event.results[i];
          if (item && item.isFinal !== false && item[0]?.transcript) {
            const text = item[0].transcript.trim();
            if (text) {
              this.accumulatedTranscript += (this.accumulatedTranscript ? ' ' : '') + text;
            }
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (this.generation !== sessionGen) return;
        const code = event?.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.lastErrorMessage = '마이크 접근 권한이 거부되었습니다. 권한을 허용하거나 텍스트 입력/클라우드 음성 입력을 이용해 주세요.';
        } else if (code === 'no-speech') {
          this.lastErrorMessage = '음성이 감지되지 않았습니다. 다시 시도하거나 텍스트 입력을 이용해 주세요.';
        } else if (code === 'aborted') {
          this.lastErrorMessage = '음성 인식이 취소되었습니다.';
        } else {
          this.lastErrorMessage = '음성 인식 중 오류가 발생했습니다. 텍스트 입력 또는 클라우드 음성 입력을 이용해 주세요.';
        }
      };

      recognition.onend = () => {
        if (this.generation !== sessionGen) return;
        this.clearTimers();
        this.detachRecognition();

        const final = this.accumulatedTranscript.trim();
        if (final) {
          this.settleResolve(final);
        } else {
          this.settleReject(new Error(this.lastErrorMessage || '인식된 텍스트가 없습니다. 다시 시도하거나 텍스트 입력을 이용해 주세요.'));
        }
      };

      this.maxDurationTimer = setTimeout(() => {
        if (this.generation !== sessionGen) return;
        this.triggerStopWithGrace();
      }, 30000);

      try {
        recognition.start();
      } catch (err: any) {
        this.clearTimers();
        this.detachRecognition();
        this.settleReject(new Error(`음성 인식 시작 실패: ${err?.message || '알 수 없는 오류'}`));
      }
    });
  }

  public stop(): void {
    if (this.pendingAvailabilityReject) {
      this.cancel();
      return;
    }
    if (!this.activeRecognition) return;
    this.triggerStopWithGrace();
  }

  private triggerStopWithGrace(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    if (this.activeRecognition) {
      try {
        this.activeRecognition.stop();
      } catch {
        // ignore
      }
    }

    if (!this.endGraceTimer) {
      this.endGraceTimer = setTimeout(() => {
        if (!this.activeRecognition) return;
        const rec = this.activeRecognition;
        this.detachRecognition();
        try {
          rec.abort();
        } catch {
          // ignore
        }
        const final = this.accumulatedTranscript.trim();
        if (final) {
          this.settleResolve(final);
        } else {
          this.settleReject(new Error(this.lastErrorMessage || '인식된 텍스트가 없습니다. 다시 시도하거나 텍스트 입력을 이용해 주세요.'));
        }
      }, 2000);
    }
  }

  public cancel(): void {
    this.generation++;
    this.cancelActiveSession('음성 인식이 취소되었습니다.');
  }

  private cancelActiveSession(reason: string): void {
    if (this.pendingAvailabilityReject) {
      const rejectAvailability = this.pendingAvailabilityReject;
      this.pendingAvailabilityReject = null;
      rejectAvailability(new Error(reason));
    }
    this.clearTimers();
    if (this.activeRecognition) {
      const rec = this.activeRecognition;
      this.detachRecognition();
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
    this.settleReject(new Error(reason));
  }

  private detachRecognition(): void {
    if (this.activeRecognition) {
      this.activeRecognition.onresult = null;
      this.activeRecognition.onerror = null;
      this.activeRecognition.onend = null;
      this.activeRecognition.onstart = null;
      this.activeRecognition = null;
    }
  }

  private settleResolve(value: string): void {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve(value);
    }
  }

  private settleReject(error: Error): void {
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject(error);
    }
  }
}

export const localSpeechInput = new LocalSpeechInputService();

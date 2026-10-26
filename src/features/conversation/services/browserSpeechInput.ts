// src/features/conversation/services/browserSpeechInput.ts
// 브라우저 기본 Web Speech API (SpeechRecognition / webkitSpeechRecognition) 입력 서비스
//
// [중요 고지 및 아키텍처 특성]
// 1. 원격 처리 가능성:
//    브라우저 내장 Web Speech API(SpeechRecognition / webkitSpeechRecognition)는
//    브라우저 벤더(Google, Samsung, Apple 등)의 원격 음성인식 서버를 경유하여 전사될 수 있습니다.
//    단, 본 서비스는 애플리케이션 자체의 Gemini STT API(gemini-3.5-transcribe 등)나 유료 외부 API,
//    fetch, MediaRecorder, Google STT API를 전혀 호출하지 않으며 순수 브라우저 플랫폼 기능을 활용합니다.
// 2. 무료 무제한 및 모든 기기 작동 보장 금지:
//    Web Speech API는 플랫폼, OS 버전, 브라우저 엔진에 따라 가용성 및 인식 품질이 상이하며,
//    무료 무제한 또는 모든 단말/브라우저 환경에서의 동작을 보장하지 않습니다.
// 3. processLocally 강제 금지:
//    Android Chrome 등 모바일 브라우저 환경에서는 SpeechRecognition.available / install API가
//    지원되지 않거나 PC 환경에서 영어 언어팩 설치 실패가 발생하므로 processLocally를 강제하지 않습니다.
// 4. 동기(Synchronous) Native Start:
//    모바일 브라우저의 사용자 인터랙션(User Gesture) 컨텍스트 유실을 방지하기 위해
//    비동기 await 없이 동기적으로 native recognition.start()를 호출합니다.
// 5. 바운디드 윈도우 모드:
//    영어 코치 전용 6초 캡처 윈도우 옵션을 제공하며, continuous=false(Android interim 승격 방지)와
//    interimResults=true를 조합합니다. 네이티브 onstart 시점부터 6초 클록을 측정하고
//    조기 종료 시 세그먼트를 보존하여 재시작합니다.

export interface BrowserSpeechTrace {
  session: number;
  event: 'start' | 'result' | 'end' | 'error' | 'settled';
  results?: { index: number; text: string; final: boolean }[];
  text?: string;
  code?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  choices?: { index: number; alternatives: string[] }[];
  alternatives?: string[];
}

export interface BrowserSpeechInputOptions {
  windowMs?: number;
  onReady?: () => void;
  onProcessing?: () => void;
  onPartial?: (text: string) => void;
  onTrace?: (trace: BrowserSpeechTrace) => void;
  onAlternatives?: (alternatives: string[]) => void;
}

/**
 * 다중 세그먼트의 후보군을 순위 합산 및 마지막 세그먼트 우선 타이 브레이킹으로 결합 (최대 3개)
 */
function combineAlternatives(segmentAlternativesList: string[][]): string[] {
  if (segmentAlternativesList.length === 0) return [];
  if (segmentAlternativesList.length === 1) {
    const list = segmentAlternativesList[0] || [];
    const deduped: string[] = [];
    for (const item of list) {
      const trimmed = item.trim();
      if (trimmed && !deduped.includes(trimmed)) {
        deduped.push(trimmed);
      }
    }
    return deduped.slice(0, 3);
  }

  // Multi-segment combination
  let current: { text: string; rankSum: number; tieKey: number }[] = (
    segmentAlternativesList[0] || []
  ).map((t, r) => ({ text: t.trim(), rankSum: r, tieKey: 0 }));

  for (let segIdx = 1; segIdx < segmentAlternativesList.length; segIdx++) {
    const alts = segmentAlternativesList[segIdx] || [];
    const next: { text: string; rankSum: number; tieKey: number }[] = [];
    for (const c of current) {
      for (let r = 0; r < alts.length; r++) {
        const altText = alts[r].trim();
        const combinedText = c.text ? (altText ? `${c.text} ${altText}` : c.text) : altText;
        next.push({
          text: combinedText,
          rankSum: c.rankSum + r,
          tieKey: c.tieKey + (r > 0 ? segIdx * 1000 + r : 0),
        });
      }
    }
    next.sort((a, b) => {
      if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum;
      return b.tieKey - a.tieKey;
    });
    current = next.slice(0, 9);
  }

  const results: string[] = [];
  for (const c of current) {
    if (c.text && !results.includes(c.text)) {
      results.push(c.text);
      if (results.length >= 3) break;
    }
  }
  return results;
}

export class BrowserSpeechInputService {
  private generation = 0;
  private activeRecognition: any = null;
  private pendingResolve: ((transcript: string) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private maxDurationTimer: any = null;
  private endGraceTimer: any = null;
  private windowTimer: any = null;
  private startupTimer: any = null;
  private restartTimer: any = null;
  private accumulatedTranscript = '';
  private lastErrorMessage = '';

  /**
   * 생성자 (테스트 및 목업을 위한 Constructor 의존성 주입 가능)
   */
  constructor(private injectedConstructor?: any) {}

  /**
   * 브라우저 환경에서 SpeechRecognition 생성자 획득
   */
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

  /**
   * 현재 브라우저 환경에서 Web Speech API 지원 여부 확인
   */
  public isSupported(): boolean {
    return !!this.getConstructor();
  }

  /**
   * 등록된 모든 타이머 리소스 정리
   */
  private clearTimers(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.endGraceTimer) {
      clearTimeout(this.endGraceTimer);
      this.endGraceTimer = null;
    }
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  /**
   * 음성 인식 시작 (옵션 여부에 따라 레거시 단발성 또는 바운디드 윈도우 모드 실행)
   */
  public start(lang = 'en-US', options?: BrowserSpeechInputOptions): Promise<string> {
    const sessionGen = ++this.generation;
    this.cancelActiveSession('새 음성 인식이 시작되어 이전 세션이 취소되었습니다.');

    const Constructor = this.getConstructor();
    if (!Constructor) {
      return Promise.reject(
        new Error('이 브라우저는 Web Speech API 음성 인식을 지원하지 않습니다. 텍스트 입력을 이용해 주세요.')
      );
    }

    if (options !== undefined) {
      return this.startWindowCapture(Constructor, lang, options, sessionGen);
    }

    return this.startOneShotCapture(Constructor, lang, sessionGen);
  }

  /**
   * 레거시 단발성 캡처 모드 (한국어 확인 등 기본 동작 100% 보존)
   */
  private startOneShotCapture(Constructor: any, lang: string, sessionGen: number): Promise<string> {
    let recognition: any;
    try {
      recognition = new Constructor();
    } catch {
      return Promise.reject(
        new Error('음성 인식 초기화에 실패했습니다. 텍스트 입력을 이용해 주세요.')
      );
    }

    this.activeRecognition = recognition;
    this.accumulatedTranscript = '';
    this.lastErrorMessage = '';

    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;

    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      recognition.onresult = (event: any) => {
        if (this.generation !== sessionGen) return;
        if (!event || !event.results) return;

        for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
          const item = event.results[i];
          if (item && item.isFinal === true && item[0]?.transcript) {
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
        let message: string;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          message = '마이크 접근 권한이 거부되었습니다. 마이크 권한을 허용해 주세요.';
        } else if (code === 'no-speech') {
          message = '음성이 감지되지 않았습니다. 다시 말씀해 주세요.';
        } else if (code === 'aborted') {
          message = '음성 인식이 취소되었습니다.';
        } else {
          message = `음성 인식 중 오류가 발생했습니다 (${code || 'unknown'}).`;
        }

        this.clearTimers();
        const rec = this.activeRecognition;
        this.detachRecognition();
        if (rec) {
          try {
            rec.abort();
          } catch {
            // ignore
          }
        }
        const err = new Error(message);
        if (code) {
          (err as any).code = code;
        }
        this.settleReject(err);
      };

      recognition.onend = () => {
        if (this.generation !== sessionGen) return;
        this.clearTimers();
        this.detachRecognition();

        const final = this.accumulatedTranscript.trim();
        if (final) {
          this.settleResolve(final);
        } else {
          const err = new Error(
            this.lastErrorMessage || '인식된 음성 텍스트가 없습니다. 다시 시도해 주세요.'
          );
          (err as any).code = 'empty-result';
          this.settleReject(err);
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
        this.settleReject(
          new Error(`음성 인식 시작 실패: ${err?.message || '알 수 없는 오류'}`)
        );
      }
    });
  }

  /**
   * 영어 코치 전용 바운디드 윈도우 캡처 모드
   * - continuous=false (Android Chromium 브리지에서 continuous=true 시 provisional interim 가설이
   *   final 결과로 강제 승격되어 누적 중복되는 현상 방지), interimResults=true 유지
   * - 공유 6초 데드라인 및 조기 종료 시 세그먼트 보존/재시작을 통해 단일 발화 모드로도 자동 6초 수집 제공
   * - onstart 시점부터 6초 클록 시작 (초기 5초 시작 데드라인)
   * - resultIndex별 덮어쓰기로 반복 누적 방지
   * - 6초 만료 시 native.stop() 및 최대 1초 final grace 대기
   * - 오직 최종 확정된(final) 텍스트만 resolve (interim은 onPartial 미리보기 전용)
   */
  private startWindowCapture(
    Constructor: any,
    lang: string,
    options: BrowserSpeechInputOptions,
    sessionGen: number
  ): Promise<string> {
    const windowMs = options.windowMs ?? 6000;
    let isReady = false;
    let windowEnded = false;
    let windowSettled = false;
    let deadline = 0;
    let restartCount = 0;
    let traceCount = 0;
    let nativeSession = 0;

    const emitTrace = (record: BrowserSpeechTrace) => {
      if (!options.onTrace || traceCount >= 40) return;
      if (this.generation !== sessionGen) return;
      traceCount++;
      try {
        options.onTrace(record);
      } catch {
        // UI exceptions must not break microphone
      }
    };

    const retainedFinalSegments: string[] = [];
    const retainedFinalSegmentAlternatives: string[][] = [];
    const currentNativeFinals = new Map<number, string>();
    const currentNativeFinalAlternatives = new Map<number, string[]>();
    const currentNativeInterims = new Map<number, string>();

    return new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      const notifyPartial = () => {
        if (this.generation !== sessionGen || windowSettled || !options.onPartial) return;
        const parts: string[] = [...retainedFinalSegments];
        const finals = Array.from(currentNativeFinals.entries())
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[1])
          .filter(Boolean);
        const interims = Array.from(currentNativeInterims.entries())
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[1])
          .filter(Boolean);

        if (finals.length > 0) parts.push(finals.join(' '));
        if (interims.length > 0) parts.push(interims.join(' '));

        const preview = parts.join(' ').trim();
        options.onPartial(preview);
      };

      const finalizeAndResolve = () => {
        if (windowSettled) return;
        windowSettled = true;
        this.clearTimers();
        const liveRec = this.activeRecognition;
        this.detachRecognition();
        if (liveRec) {
          try {
            liveRec.abort();
          } catch {
            // ignore
          }
        }

        const allFinals: string[] = [...retainedFinalSegments];
        const finals = Array.from(currentNativeFinals.entries())
          .sort((a, b) => a[0] - b[0])
          .map((e) => e[1])
          .filter(Boolean);
        if (finals.length > 0) allFinals.push(finals.join(' '));

        const finalResult = allFinals.join(' ').trim();

        let finalCandidates: string[] = [];
        if (finalResult) {
          try {
            const allSegmentsAlternatives: string[][] = [...retainedFinalSegmentAlternatives];
            const curSegmentAlts = Array.from(currentNativeFinalAlternatives.entries())
              .sort((a, b) => a[0] - b[0])
              .map((e) => e[1])
              .filter((alts) => alts && alts.length > 0);
            if (curSegmentAlts.length > 0) {
              allSegmentsAlternatives.push(...curSegmentAlts);
            }

            finalCandidates = combineAlternatives(allSegmentsAlternatives);
            if (!finalCandidates.includes(finalResult)) {
              finalCandidates = [finalResult, ...finalCandidates.filter((c) => c !== finalResult)].slice(0, 3);
            }
          } catch {
            finalCandidates = [finalResult];
          }
        }

        emitTrace({
          session: nativeSession,
          event: 'settled',
          text: finalResult.slice(0, 500),
          alternatives: finalCandidates.slice(0, 3).map((s) => s.slice(0, 500)),
        });

        if (finalResult) {
          if (options.onAlternatives && finalCandidates.length > 0) {
            try {
              options.onAlternatives(finalCandidates);
            } catch {
              // UI callback exceptions must not break microphone resolution
            }
          }
          this.settleResolve(finalResult);
        } else {
          const err = new Error('인식된 음성 텍스트가 없습니다. 다시 시도해 주세요.');
          (err as any).code = 'empty-result';
          this.settleReject(err);
        }
      };

      const onWindowExpired = () => {
        if (this.generation !== sessionGen || windowEnded || windowSettled) return;
        windowEnded = true;

        if (this.windowTimer) {
          clearTimeout(this.windowTimer);
          this.windowTimer = null;
        }

        const rec = this.activeRecognition;
        if (rec) {
          try {
            rec.stop();
          } catch {
            // ignore
          }
        }

        if (windowSettled) return;

        // 최대 1초 final result 유예 타이머
        this.endGraceTimer = setTimeout(() => {
          if (this.generation !== sessionGen || windowSettled) return;
          finalizeAndResolve();
        }, 1000);
      };

      const launchNative = (isRestart: boolean) => {
        if (this.generation !== sessionGen || windowEnded || windowSettled) return;

        nativeSession++;
        const currentSession = nativeSession;

        let recognition: any;
        try {
          recognition = new Constructor();
        } catch {
          windowSettled = true;
          this.clearTimers();
          this.settleReject(
            new Error('음성 인식 초기화에 실패했습니다. 텍스트 입력을 이용해 주세요.')
          );
          return;
        }

        this.activeRecognition = recognition;
        currentNativeFinals.clear();
        currentNativeFinalAlternatives.clear();
        currentNativeInterims.clear();

        recognition.lang = lang;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;

        recognition.onstart = () => {
          if (this.generation !== sessionGen || this.activeRecognition !== recognition || windowSettled) return;
          emitTrace({
            session: currentSession,
            event: 'start',
            continuous: recognition.continuous,
            interimResults: recognition.interimResults,
            maxAlternatives: recognition.maxAlternatives,
          });
          if (!isReady) {
            isReady = true;
            if (this.startupTimer) {
              clearTimeout(this.startupTimer);
              this.startupTimer = null;
            }
            options.onReady?.();
            deadline = Date.now() + windowMs;
            this.windowTimer = setTimeout(() => {
              onWindowExpired();
            }, windowMs);
          }
        };

        recognition.onresult = (event: any) => {
          if (this.generation !== sessionGen || this.activeRecognition !== recognition || windowSettled) return;
          if (!event || !event.results) return;

          if (options.onTrace) {
            const resultsSnapshot: { index: number; text: string; final: boolean }[] = [];
            const choicesSnapshot: { index: number; alternatives: string[] }[] = [];
            const maxEntries = Math.min(event.results.length, 16);
            for (let j = 0; j < maxEntries; j++) {
              const r = event.results[j];
              const t = (r && r[0]?.transcript ? String(r[0].transcript) : '').slice(0, 160);
              resultsSnapshot.push({
                index: j,
                text: t,
                final: r ? r.isFinal === true : false,
              });

              if (r) {
                const altChoices: string[] = [];
                const maxChoices = Math.min(r.length || 1, 3);
                for (let c = 0; c < maxChoices; c++) {
                  const altT = r[c]?.transcript ? String(r[c].transcript).trim().slice(0, 160) : '';
                  if (altT) {
                    altChoices.push(altT);
                  }
                }
                choicesSnapshot.push({
                  index: j,
                  alternatives: altChoices,
                });
              }
            }
            emitTrace({
              session: currentSession,
              event: 'result',
              results: resultsSnapshot,
              choices: choicesSnapshot,
            });
          }

          currentNativeInterims.clear();
          for (let i = 0; i < event.results.length; i++) {
            const item = event.results[i];
            if (item && item[0]?.transcript) {
              const text = item[0].transcript.trim();
              if (item.isFinal === true) {
                currentNativeFinals.set(i, text);
                const alts: string[] = [];
                const maxAlts = Math.min(item.length || 1, 3);
                for (let a = 0; a < maxAlts; a++) {
                  const altTranscript = item[a]?.transcript ? String(item[a].transcript).trim() : '';
                  if (altTranscript && !alts.includes(altTranscript)) {
                    alts.push(altTranscript);
                  }
                }
                currentNativeFinalAlternatives.set(i, alts);
              } else {
                currentNativeInterims.set(i, text);
              }
            }
          }

          notifyPartial();
        };

        recognition.onerror = (event: any) => {
          if (this.generation !== sessionGen || this.activeRecognition !== recognition || windowSettled) return;
          const code = event?.error;
          emitTrace({ session: currentSession, event: 'error', code: String(code || '') });
          if (code === 'no-speech') {
            return;
          }

          windowSettled = true;
          windowEnded = true;
          this.clearTimers();
          const rec = this.activeRecognition;
          this.detachRecognition();
          if (rec) {
            try {
              rec.abort();
            } catch {
              // ignore
            }
          }

          let message = '음성 인식 중 오류가 발생했습니다.';
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            message = '마이크 접근 권한이 거부되었습니다. 마이크 권한을 허용해 주세요.';
          } else if (code === 'network') {
            message = '네트워크 연결 오류로 음성 인식에 실패했습니다.';
          } else if (code === 'aborted') {
            message = '음성 인식이 취소되었습니다.';
          }
          const err = new Error(message);
          (err as any).code = code;
          this.settleReject(err);
        };

        recognition.onend = () => {
          if (this.generation !== sessionGen || this.activeRecognition !== recognition || windowSettled) return;

          emitTrace({ session: currentSession, event: 'end' });

          // Ended native session is detached so stale callbacks cannot affect restart
          this.detachRecognition();

          if (windowEnded) {
            finalizeAndResolve();
            return;
          }

          // 윈도우 만료 전 조기 종료 시 세그먼트 보존 후 재시작
          const finals = Array.from(currentNativeFinals.entries())
            .sort((a, b) => a[0] - b[0])
            .map((e) => e[1])
            .filter(Boolean);
          if (finals.length > 0) {
            retainedFinalSegments.push(finals.join(' '));
          }
          const finalAlts = Array.from(currentNativeFinalAlternatives.entries())
            .sort((a, b) => a[0] - b[0])
            .map((e) => e[1])
            .filter((alts) => alts && alts.length > 0);
          if (finalAlts.length > 0) {
            retainedFinalSegmentAlternatives.push(...finalAlts);
          }
          currentNativeFinals.clear();
          currentNativeFinalAlternatives.clear();
          currentNativeInterims.clear();

          const leftMs = deadline - Date.now();
          if (leftMs > 150 && restartCount < 8) {
            restartCount++;
            this.restartTimer = setTimeout(() => {
              if (this.generation === sessionGen && !windowEnded && !windowSettled) {
                launchNative(true);
              }
            }, 100);
          } else {
            windowEnded = true;
            finalizeAndResolve();
          }
        };

        // 초기 시작 5초 데드라인 (첫 시작 시에만)
        if (!isRestart && !isReady) {
          this.startupTimer = setTimeout(() => {
            if (this.generation !== sessionGen || isReady || windowSettled) return;
            windowSettled = true;
            this.clearTimers();
            emitTrace({ session: currentSession, event: 'error', code: 'startup-timeout' });
            const rec = this.activeRecognition;
            this.detachRecognition();
            if (rec) {
              try {
                rec.abort();
              } catch {
                // ignore
              }
            }
            const err = new Error('음성 인식 시작 응답 시간이 초과되었습니다.');
            (err as any).code = 'startup-timeout';
            this.settleReject(err);
          }, 5000);
        }

        try {
          recognition.start();
        } catch (err: any) {
          windowSettled = true;
          this.clearTimers();
          this.detachRecognition();
          this.settleReject(
            new Error(`음성 인식 시작 실패: ${err?.message || '알 수 없는 오류'}`)
          );
        }
      };

      launchNative(false);
    });
  }

  /**
   * 음성 인식 정상 종료 트리거 (2초 유예 후 최종 abort)
   */
  public stop(): void {
    if (!this.activeRecognition) return;
    this.triggerStopWithGrace();
  }

  /**
   * 30초 경과 또는 수동 stop 요청 시 graceful 종료 처리
   */
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
          const err = new Error(
            this.lastErrorMessage || '인식된 음성 텍스트가 없습니다. 다시 시도해 주세요.'
          );
          (err as any).code = 'empty-result';
          this.settleReject(err);
        }
      }, 2000);
    }
  }

  /**
   * 현재 진행 중인 음성 인식 취소 및 상태 초기화
   */
  public cancel(): void {
    this.generation++;
    this.cancelActiveSession('음성 인식이 취소되었습니다.');
  }

  /**
   * 활성 세션 즉시 취소 및 reject settle
   */
  private cancelActiveSession(reason: string): void {
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

  /**
   * native recognition 인스턴스 이벤트 핸들러 해제
   */
  private detachRecognition(): void {
    if (this.activeRecognition) {
      this.activeRecognition.onresult = null;
      this.activeRecognition.onerror = null;
      this.activeRecognition.onend = null;
      this.activeRecognition.onstart = null;
      this.activeRecognition = null;
    }
  }

  /**
   * 대기 중인 promise resolve settle
   */
  private settleResolve(value: string): void {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve(value);
    }
  }

  /**
   * 대기 중인 promise reject settle
   */
  private settleReject(error: Error): void {
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      reject(error);
    }
  }
}

export const browserSpeechInput = new BrowserSpeechInputService();

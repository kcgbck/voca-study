// src/features/conversation/services/handsFreeVoiceLoop.ts
// UI 독립형 핸즈프리 음성 루프 컨트롤러 (질문 TTS -> 자동 STT -> 인식 결과 전달)
// 페이지 숨김(visibilitychange/onHidden) 및 언마운트 시 UI에서 pause()를 호출하여 관리합니다.

export type VoiceLoopState = 'idle' | 'speaking' | 'listening' | 'heard' | 'paused' | 'error';

export interface VoiceLoopEvent {
  state: VoiceLoopState;
  transcript?: string;
  message?: string;
}

export interface VoiceLoopInputService {
  start(): Promise<string>;
  cancel(): void;
}

export interface VoiceLoopOutputService {
  speak(text: string, lang: string): Promise<boolean>;
  cancel(): void;
}

export class HandsFreeVoiceLoopController {
  private generation = 0;
  private ttsTimeoutTimer: any = null;

  constructor(
    private input: VoiceLoopInputService,
    private output: VoiceLoopOutputService,
    private emit: (event: VoiceLoopEvent) => void
  ) {}

  /**
   * 등록된 TTS 상한 타이머 정리
   */
  private clearTtsTimer(): void {
    if (this.ttsTimeoutTimer) {
      clearTimeout(this.ttsTimeoutTimer);
      this.ttsTimeoutTimer = null;
    }
  }

  /**
   * 핸즈프리 1회 루프 시작
   * - 이전 세션 즉시 취소 및 generation 갱신으로 stale Promise 결과 차단
   * - speaking emit -> 질문 TTS 출력 (최대 15초 상한 지역 타이머 적용)
   * - TTS 성공 시에만 listening emit -> 음성 입력(STT) 대기 -> heard emit(transcript)
   * - TTS 실패/timeout 시 output.cancel()로 실제 음성 중단 및 error emit (마이크 시작 금지)
   * - STT 실패 시 error emit (자동 재시도 0회)
   * - start 뒤 heard에서 멈추며, UI가 다음 질문 또는 재시도를 명시적으로 이어감
   */
  public async start(question: string): Promise<void> {
    const currentGen = ++this.generation;

    // 이전 세션 취소 및 타이머 정리
    this.clearTtsTimer();
    this.input.cancel();
    this.output.cancel();

    this.emit({ state: 'speaking' });

    // 최대 TTS 대기 15초 상한 지역 타이머 (이전 세션 finally에 의한 간섭 방지)
    let localTimer: any = null;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      localTimer = setTimeout(() => {
        resolve(false);
      }, 15000);
      this.ttsTimeoutTimer = localTimer;
    });

    let speakSuccess = false;
    try {
      speakSuccess = await Promise.race([
        this.output.speak(question, 'en-US'),
        timeoutPromise,
      ]);
    } catch {
      speakSuccess = false;
    } finally {
      // 자신이 만든 지역 타이머만 정리
      if (localTimer) {
        clearTimeout(localTimer);
        if (this.ttsTimeoutTimer === localTimer) {
          this.ttsTimeoutTimer = null;
        }
      }
    }

    if (this.generation !== currentGen) return;

    if (!speakSuccess) {
      try {
        this.output.cancel();
      } catch {
        // ignore
      }
      this.emit({ state: 'error', message: '질문 음성 출력에 실패했습니다.' });
      return; // output 실패 시 마이크 시작 금지
    }

    this.emit({ state: 'listening' });

    try {
      const transcript = await this.input.start();
      if (this.generation !== currentGen) return;
      this.emit({ state: 'heard', transcript });
    } catch (err: any) {
      if (this.generation !== currentGen) return;
      this.emit({
        state: 'error',
        message: err?.message || '음성 인식에 실패했습니다.',
      });
    }
  }

  /**
   * 현재 진행 중인 루프 즉시 일시정지
   * - input/output 동기 cancel 호출 및 generation 증가로 stale Promise 차단
   * - paused emit
   */
  public pause(): void {
    this.generation++;
    this.clearTtsTimer();
    this.input.cancel();
    this.output.cancel();
    this.emit({ state: 'paused' });
  }
}

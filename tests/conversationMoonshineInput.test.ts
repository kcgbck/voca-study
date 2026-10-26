// tests/conversationMoonshineInput.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MoonshineSpeechInputService,
  type MoonshineProgressPayload,
} from '../src/features/conversation/moonshine/moonshineSpeechInput';

class MockWorker {
  public postMessage = vi.fn();
  public terminate = vi.fn();
  public onerror: ((event: ErrorEvent) => any) | null = null;
  private listeners: Record<string, ((event: any) => void)[]> = {};

  public addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  public removeEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  public emitMessage(data: any) {
    const list = this.listeners['message'] || [];
    for (const l of list) {
      l({ data });
    }
  }
}

describe('MoonshineSpeechInputService', () => {
  let mockWorker: MockWorker;
  let mockRecorder: {
    record: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockWorker = new MockWorker();
    mockRecorder = {
      record: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('exposes correct readonly metadata constants', () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });
    expect(service.engineName).toBe('Moonshine');
    expect(service.modelArch).toBe('SmallStreaming');
    expect(service.sdkVersion).toBe('0.1.5');
    expect(service.catalogRevision).toBe('quantized_26_07_30');
    expect(MoonshineSpeechInputService.ESTIMATED_DOWNLOAD_BYTES).toBe(165489086);
  });

  it('prepares worker once without opening microphone and reports progress', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const progressReports: MoonshineProgressPayload[] = [];
    const prepPromise = service.prepare((p) => {
      progressReports.push(p);
      // Verify throwing inside UI callback doesn't strand operation
      if (progressReports.length === 1) {
        throw new Error('UI progress callback error');
      }
    });

    // Microphone should NOT be opened during prepare
    expect(mockRecorder.record).not.toHaveBeenCalled();
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init' })
    );

    const initMsgId = mockWorker.postMessage.mock.calls[0][0].id;

    // Emit progress
    mockWorker.emitMessage({
      id: initMsgId,
      type: 'progress',
      loaded: 500,
      total: 1000,
      file: 'encoder.ort',
    });

    expect(progressReports).toHaveLength(1);
    expect(progressReports[0]).toEqual({
      loaded: 500,
      total: 1000,
      file: 'encoder.ort',
    });

    // Complete init
    mockWorker.emitMessage({
      id: initMsgId,
      type: 'init_done',
      durationMs: 150,
    });

    await prepPromise;
    expect(service.isReady()).toBe(true);

    // Calling prepare again reuses ready state immediately
    await service.prepare();
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('captures audio and returns transcript and only actual transcript as alternative', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    const initMsgId = mockWorker.postMessage.mock.calls[0][0].id;
    mockWorker.emitMessage({ id: initMsgId, type: 'init_done', durationMs: 50 });
    await prepPromise;

    // Mock speech PCM (16000 samples = 1 sec, moderate RMS ~0.1)
    const validPcm = new Float32Array(16000);
    for (let i = 0; i < 16000; i++) {
      validPcm[i] = 0.1 * Math.sin(i / 10);
    }

    mockRecorder.record.mockImplementation(async (opts) => {
      opts?.onReady?.();
      return {
        audio: validPcm,
        durationSec: 1.0,
        isSilent: false,
        sampleCount: 16000,
      };
    });

    const onAlternatives = vi.fn().mockImplementation(() => {
      throw new Error('UI alternatives error');
    });
    const onReady = vi.fn().mockImplementation(() => {
      throw new Error('UI onReady error');
    });

    const startPromise = service.start('en-US', {
      windowMs: 6000,
      onReady,
      onAlternatives,
    });

    expect(mockRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ maxDurationMs: 6000 })
    );
    expect(onReady).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0); // drain microtasks to reach postMessage

    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcribe',
        audio: expect.any(Float32Array),
      }),
      expect.any(Array)
    );

    const transcribeMsgId = mockWorker.postMessage.mock.calls[1][0].id;
    mockWorker.emitMessage({
      id: transcribeMsgId,
      type: 'transcribe_done',
      text: 'I would like coffee. Please.',
      durationMs: 240,
    });

    const result = await startPromise;
    expect(result).toBe('I would like coffee. Please.');
    expect(onAlternatives).toHaveBeenCalledWith(['I would like coffee. Please.']);
  });

  it('recognizes quiet PCM (RMS ~0.00075) even when recorder marks isSilent=true', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    const initMsgId = mockWorker.postMessage.mock.calls[0][0].id;
    mockWorker.emitMessage({ id: initMsgId, type: 'init_done', durationMs: 50 });
    await prepPromise;

    // Quiet synthetic fixture at RMS ~0.00075 (> 0.0001 digital silence threshold)
    const quietPcm = new Float32Array(16000);
    for (let i = 0; i < 16000; i++) {
      quietPcm[i] = 0.001 * Math.sin(i / 5);
    }

    mockRecorder.record.mockResolvedValue({
      audio: quietPcm,
      durationSec: 1.0,
      isSilent: true, // Recorder's 0.003 threshold flagged it as silent
      sampleCount: 16000,
    });

    const startPromise = service.start();
    await vi.advanceTimersByTimeAsync(0);

    // Must still send to worker for transcription!
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transcribe' }),
      expect.any(Array)
    );

    const transcribeMsgId = mockWorker.postMessage.mock.calls[1][0].id;
    mockWorker.emitMessage({
      id: transcribeMsgId,
      type: 'transcribe_done',
      text: 'I would like coffee. Please.',
      durationMs: 232,
    });

    const result = await startPromise;
    expect(result).toBe('I would like coffee. Please.');
  });

  it('rejects digital zero silence (RMS < 0.0001) without calling worker', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    mockWorker.emitMessage({
      id: mockWorker.postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await prepPromise;

    // Digital silence (all zeros)
    const silentPcm = new Float32Array(16000);
    mockRecorder.record.mockResolvedValue({
      audio: silentPcm,
      durationSec: 1.0,
      isSilent: true,
      sampleCount: 16000,
    });

    const result = await service.start();
    expect(result).toBe('');
    // No transcribe message sent
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1); // only init
  });

  it('rejects very short or invalid PCM (<3200 samples) without calling worker', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    mockWorker.emitMessage({
      id: mockWorker.postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await prepPromise;

    // Short buffer (1000 samples < 3200)
    mockRecorder.record.mockResolvedValue({
      audio: new Float32Array(1000),
      durationSec: 0.06,
      isSilent: false,
      sampleCount: 1000,
    });

    const result = await service.start();
    expect(result).toBe('');
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects NaN, Infinity, out-of-range, and overlong PCM buffers without calling worker', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    mockWorker.emitMessage({
      id: mockWorker.postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await prepPromise;

    // 1. Buffer with NaN
    const nanPcm = new Float32Array(16000);
    nanPcm[10] = NaN;
    mockRecorder.record.mockResolvedValueOnce({
      audio: nanPcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });
    expect(await service.start()).toBe('');

    // 2. Buffer with Infinity
    const infPcm = new Float32Array(16000);
    infPcm[20] = Infinity;
    mockRecorder.record.mockResolvedValueOnce({
      audio: infPcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });
    expect(await service.start()).toBe('');

    // 3. Buffer with out of range (> 1.0)
    const outRangePcm = new Float32Array(16000);
    outRangePcm[30] = 1.5;
    mockRecorder.record.mockResolvedValueOnce({
      audio: outRangePcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });
    expect(await service.start()).toBe('');

    // 4. Overlong buffer (> 176000 samples)
    const overlongPcm = new Float32Array(176001);
    overlongPcm.fill(0.1);
    mockRecorder.record.mockResolvedValueOnce({
      audio: overlongPcm,
      durationSec: 11.1,
      isSilent: false,
      sampleCount: 176001,
    });
    expect(await service.start()).toBe('');

    // Verify none of these invalid buffers posted transcribe message
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1); // only the initial init
  });

  it('cancels pending prepare immediately and terminates worker', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    let caughtError: Error | null = null;
    const prepPromise = service.prepare().catch((e) => {
      caughtError = e;
    });

    service.cancel();
    await prepPromise;

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('cancelled');
    expect(mockWorker.terminate).toHaveBeenCalled();
    expect(service.isReady()).toBe(false);
  });

  it('cancels during deferred recorder record immediately and allows clean retry', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    mockWorker.emitMessage({
      id: mockWorker.postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await prepPromise;

    // Recorder never settles unless cancelled
    let recorderResolve: any;
    mockRecorder.record.mockImplementation(
      () =>
        new Promise((resolve) => {
          recorderResolve = resolve;
        })
    );

    let caughtError: Error | null = null;
    const startPromise = service.start().catch((e) => {
      caughtError = e;
    });

    // Cancel while deferred recorder is running
    service.cancel();
    expect(mockRecorder.cancel).toHaveBeenCalled();

    // Start promise must reject immediately via cancellation race
    await startPromise;
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('cancelled');

    // Late completion from old record does not corrupt new session
    const validPcm = new Float32Array(16000);
    validPcm.fill(0.1);
    if (recorderResolve) {
      recorderResolve({
        audio: validPcm,
        durationSec: 1.0,
        isSilent: false,
        sampleCount: 16000,
      });
    }

    // Prepare again (worker was terminated because it cancelled during active operation)
    const retryPrepPromise = service.prepare();
    mockWorker.emitMessage({
      id: mockWorker.postMessage.mock.calls[1][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await retryPrepPromise;

    // Clean retry succeeds
    mockRecorder.record.mockResolvedValueOnce({
      audio: validPcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });

    const retryStartPromise = service.start();
    await vi.advanceTimersByTimeAsync(0);

    const transcribeId = mockWorker.postMessage.mock.calls[2][0].id;
    mockWorker.emitMessage({
      id: transcribeId,
      type: 'transcribe_done',
      text: 'Retry success',
      durationMs: 120,
    });

    const result = await retryStartPromise;
    expect(result).toBe('Retry success');
  });

  it('cancels during record/inference and ignores stale worker messages', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    const initId = mockWorker.postMessage.mock.calls[0][0].id;
    mockWorker.emitMessage({ id: initId, type: 'init_done', durationMs: 50 });
    await prepPromise;

    const validPcm = new Float32Array(16000);
    validPcm.fill(0.05);

    mockRecorder.record.mockResolvedValue({
      audio: validPcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });

    let caughtError: Error | null = null;
    const startPromise = service.start().catch((e) => {
      caughtError = e;
    });

    await vi.advanceTimersByTimeAsync(0); // recorder completes, inference message posted

    const transcribeId = mockWorker.postMessage.mock.calls[1][0].id;
    // Cancel during inference
    service.cancel();

    // Stale message arrives from old worker
    mockWorker.emitMessage({
      id: transcribeId,
      type: 'transcribe_done',
      text: 'Stale text',
      durationMs: 100,
    });

    await startPromise;
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain('cancelled');
  });

  it('retains ready worker when cancel is called while idle', async () => {
    const service = new MoonshineSpeechInputService({
      createWorker: () => mockWorker as any,
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    const initId = mockWorker.postMessage.mock.calls[0][0].id;
    mockWorker.emitMessage({ id: initId, type: 'init_done', durationMs: 50 });
    await prepPromise;

    expect(service.isReady()).toBe(true);

    // Cancel while idle
    service.cancel();
    expect(mockWorker.terminate).not.toHaveBeenCalled();
    expect(service.isReady()).toBe(true);

    // Dispose terminates worker
    service.dispose();
    expect(mockWorker.terminate).toHaveBeenCalled();
    expect(service.isReady()).toBe(false);
  });

  it('times out during prepare after 180s and allows clean retry', async () => {
    let workerCounter = 0;
    const workers: MockWorker[] = [];
    const service = new MoonshineSpeechInputService({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        workerCounter++;
        return w as any;
      },
      recorder: mockRecorder,
    });

    let prepError: Error | null = null;
    const prepPromise = service.prepare().catch((e) => {
      prepError = e;
    });

    // Advance 180s
    vi.advanceTimersByTime(180000);
    await prepPromise;

    expect(prepError).not.toBeNull();
    expect(prepError!.message).toContain('timed out');
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(service.isReady()).toBe(false);

    // Clean retry succeeds
    const retryPromise = service.prepare();
    expect(workerCounter).toBe(2);
    const retryInitId = workers[1].postMessage.mock.calls[0][0].id;
    workers[1].emitMessage({ id: retryInitId, type: 'init_done', durationMs: 100 });
    await retryPromise;
    expect(service.isReady()).toBe(true);
  });

  it('times out during inference after 15s and allows clean retry', async () => {
    let workerCounter = 0;
    const workers: MockWorker[] = [];
    const service = new MoonshineSpeechInputService({
      createWorker: () => {
        const w = new MockWorker();
        workers.push(w);
        workerCounter++;
        return w as any;
      },
      recorder: mockRecorder,
    });

    const prepPromise = service.prepare();
    workers[0].emitMessage({
      id: workers[0].postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await prepPromise;

    const validPcm = new Float32Array(16000);
    validPcm.fill(0.05);
    mockRecorder.record.mockResolvedValue({
      audio: validPcm,
      durationSec: 1.0,
      isSilent: false,
      sampleCount: 16000,
    });

    let inferError: Error | null = null;
    const startPromise = service.start().catch((e) => {
      inferError = e;
    });

    await vi.advanceTimersByTimeAsync(0);
    // Advance 15s inference timeout
    vi.advanceTimersByTime(15000);
    await startPromise;

    expect(inferError).not.toBeNull();
    expect(inferError!.message).toContain('timed out');
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(service.isReady()).toBe(false);

    // After inference timeout worker is terminated, retry requires prepare
    expect(service.isReady()).toBe(false);
    const retryPrepPromise = service.prepare();
    expect(workerCounter).toBe(2);
    workers[1].emitMessage({
      id: workers[1].postMessage.mock.calls[0][0].id,
      type: 'init_done',
      durationMs: 50,
    });
    await retryPrepPromise;
    expect(service.isReady()).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSpeechInputService } from '../src/features/conversation/services/localSpeechInput';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface FakeRecognitionInstance {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

function createFakeSpeechRecognition() {
  const instances: FakeRecognitionInstance[] = [];

  class FakeSpeechRecognition {
    static available = vi.fn();
    static install = vi.fn();

    processLocally = false;
    lang = '';
    continuous = false;
    interimResults = false;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    onresult: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onend: (() => void) | null = null;
    onstart: (() => void) | null = null;

    constructor() {
      instances.push(this);
    }
  }

  FakeSpeechRecognition.prototype.processLocally = false;

  return { FakeSpeechRecognition, instances };
}

describe('LocalSpeechInputService', () => {
  it('local start sets processLocally true, lang en-US, and final result + end returns text', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    const startPromise = service.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(instances.length).toBe(2);
    const recognition = instances[1];
    expect(recognition.processLocally).toBe(true);
    expect(recognition.lang).toBe('en-US');
    expect(recognition.start).toHaveBeenCalledTimes(1);

    recognition.onresult!({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: 'Hello TOEIC' }], { isFinal: true })
      ]
    });
    recognition.onend!();

    const text = await startPromise;
    expect(text).toBe('Hello TOEIC');
  });

  it('rejects with no-speech error message when no speech is detected', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    const errorPromise = service.start().catch((err: Error) => err);
    await Promise.resolve();
    await Promise.resolve();

    const recognition = instances[1];
    recognition.onerror!({ error: 'no-speech' });
    recognition.onend!();

    const err = await errorPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('음성이 감지되지 않았습니다');
  });

  it('does not start recognition if processLocally is missing on prototype/probe despite available', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    delete (FakeSpeechRecognition.prototype as any).processLocally;

    const originalConstructor = FakeSpeechRecognition;
    class NoLocalRecognition extends originalConstructor {
      constructor() {
        super();
        delete (this as any).processLocally;
      }
    }
    delete (NoLocalRecognition.prototype as any).processLocally;

    const service = new LocalSpeechInputService(NoLocalRecognition);

    const errorPromise = service.start().catch((err: Error) => err);
    const err = await errorPromise;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('온디바이스(로컬) 음성 인식을 지원하지 않습니다');
    expect(FakeSpeechRecognition.available).not.toHaveBeenCalled();
    expect(instances.every(inst => inst.start.mock.calls.length === 0)).toBe(true);
  });

  it('rejects without starting or downloading/installing when status is unavailable or downloadable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    // 1. unavailable
    FakeSpeechRecognition.available.mockResolvedValueOnce('unavailable');
    const errUnavailable = await service.start().catch((err: Error) => err);
    expect(errUnavailable).toBeInstanceOf(Error);
    expect((errUnavailable as Error).message).toContain('언어 팩이 준비되지 않았습니다');
    expect(FakeSpeechRecognition.install).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. downloadable
    FakeSpeechRecognition.available.mockResolvedValueOnce('downloadable');
    const errDownloadable = await service.start().catch((err: Error) => err);
    expect(errDownloadable).toBeInstanceOf(Error);
    expect((errDownloadable as Error).message).toContain('언어 팩이 준비되지 않았습니다');
    expect(FakeSpeechRecognition.install).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // Native recognition was never started
    expect(instances.every(inst => inst.start.mock.calls.length === 0)).toBe(true);
  });

  it('cannot late-start if canceled while availability check is pending', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    let resolveAvailable!: (status: string) => void;
    FakeSpeechRecognition.available.mockReturnValue(
      new Promise<string>(resolve => {
        resolveAvailable = resolve;
      })
    );
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    const startPromise = service.start().catch((err: Error) => err);
    service.cancel();

    // Late resolution after cancel
    resolveAvailable('available');
    const err = await startPromise;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('음성 인식이 취소되었습니다');
    // Only probe instance was created, active recognition was never started
    expect(instances.length).toBe(1);
    expect(instances[0].start).not.toHaveBeenCalled();
  });

  it('aborts native recognition and rejects if canceled while listening', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    const startPromise = service.start().catch((err: Error) => err);
    await Promise.resolve();
    await Promise.resolve();

    const recognition = instances[1];
    expect(recognition.start).toHaveBeenCalledTimes(1);

    service.cancel();
    expect(recognition.abort).toHaveBeenCalledTimes(1);

    const err = await startPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('음성 인식이 취소되었습니다');
  });

  it('captured old events from previous session cannot alter new session', async () => {
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    // Session 1
    const session1Promise = service.start().catch((err: Error) => err);
    await Promise.resolve();
    await Promise.resolve();
    const rec1 = instances[1];
    const oldOnResult = rec1.onresult;
    const oldOnEnd = rec1.onend;

    // Session 2 starts (canceling Session 1)
    const session2Promise = service.start();
    await Promise.resolve();
    await Promise.resolve();
    const rec2 = instances[3];

    // Late events fired from Session 1
    oldOnResult!({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Ghost transcript' }], { isFinal: true })]
    });
    oldOnEnd!();

    // Session 2 receives valid events
    rec2.onresult!({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Valid transcript' }], { isFinal: true })]
    });
    rec2.onend!();

    const session2Result = await session2Promise;
    expect(session2Result).toBe('Valid transcript');

    const session1Err = await session1Promise;
    expect(session1Err).toBeInstanceOf(Error);
  });

  it('triggers stop at 30s and aborts after 2s grace period to settle finitely', async () => {
    vi.useFakeTimers();
    const { FakeSpeechRecognition, instances } = createFakeSpeechRecognition();
    FakeSpeechRecognition.available.mockResolvedValue('available');
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    const startPromise = service.start().catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(0);

    const rec = instances[1];
    expect(rec.start).toHaveBeenCalledTimes(1);

    // At 30s: stop is triggered
    await vi.advanceTimersByTimeAsync(30000);
    expect(rec.stop).toHaveBeenCalledTimes(1);
    expect(rec.abort).not.toHaveBeenCalled();

    // At 32s (30s + 2s grace): abort is called and pending promise is settled
    await vi.advanceTimersByTimeAsync(2000);
    expect(rec.abort).toHaveBeenCalledTimes(1);

    const err = await startPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('인식된 텍스트가 없습니다');
  });

  it('canceling while available promise is pending immediately settles/rejects start without resolving available', async () => {
    const { FakeSpeechRecognition } = createFakeSpeechRecognition();
    // Intentionally unresolving promise
    FakeSpeechRecognition.available.mockReturnValue(new Promise(() => {}));
    const service = new LocalSpeechInputService(FakeSpeechRecognition);

    let settledFlag = false;
    let caughtError: unknown = null;

    service.start().catch((err: unknown) => {
      settledFlag = true;
      caughtError = err;
      return err;
    });

    // Cancel while available promise is still pending
    service.cancel();

    // Flush several microtasks to observe immediate rejection
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    expect(settledFlag).toBe(true);
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain('음성 인식이 취소되었습니다');
  });
});

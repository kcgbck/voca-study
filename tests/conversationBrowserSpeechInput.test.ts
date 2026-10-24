import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechInputService } from '../src/features/conversation/services/browserSpeechInput';

function recognizer() {
  const instances: any[] = [];
  class Native {
    lang = ''; continuous = true; interimResults = false;
    start = vi.fn(); stop = vi.fn(); abort = vi.fn();
    onresult: any = null; onerror: any = null; onend: any = null;
    constructor() { instances.push(this); }
  }
  return { Native, instances };
}
const result = (text: string, isFinal = true) => ({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser speech without Gemini STT', () => {
  it('starts synchronously without local-pack APIs, collecting final text only', async () => {
    const { Native, instances } = recognizer();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const input = new BrowserSpeechInputService(Native);
    const pending = input.start();
    const native = instances[0];
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.lang).toBe('en-US');
    expect(native.continuous).toBe(false);
    expect(native.processLocally).not.toBe(true);
    native.onresult(result('wrong interim', false));
    native.onresult(result('My name is Alex.'));
    native.onend();
    expect(await pending).toBe('My name is Alex.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancel settles and stale events cannot contaminate a new utterance', async () => {
    const { Native, instances } = recognizer();
    const input = new BrowserSpeechInputService(Native);
    const first = input.start().catch(error => error);
    const stale = instances[0].onresult;
    input.cancel();
    expect(await first).toBeInstanceOf(Error);
    const second = input.start();
    stale(result('stale'));
    instances[1].onresult(result('current'));
    instances[1].onend();
    expect(await second).toBe('current');
  });

  it('start failure is recoverable and permission errors do not retry', async () => {
    const { Native, instances } = recognizer();
    const input = new BrowserSpeechInputService(Native);
    const pending = input.start().catch(error => error);
    instances[0].onerror({ error: 'not-allowed' });
    expect(await pending).toBeInstanceOf(Error);
    expect(instances[0].start).toHaveBeenCalledOnce();
  });

  it('empty recognition is not a learning answer', async () => {
    const { Native, instances } = recognizer();
    const input = new BrowserSpeechInputService(Native);
    const pending = input.start().catch(error => error);
    instances[0].onend();
    expect(await pending).toBeInstanceOf(Error);
  });

  it('native failure to end is bounded by the recording and grace timers', async () => {
    vi.useFakeTimers();
    const { Native, instances } = recognizer();
    const input = new BrowserSpeechInputService(Native);
    const pending = input.start().catch(error => error);
    await vi.advanceTimersByTimeAsync(32001);
    expect(await pending).toBeInstanceOf(Error);
    expect(instances[0].abort).toHaveBeenCalled();
  });
});

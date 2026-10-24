import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandsFreeVoiceLoopController } from '../src/features/conversation/services/handsFreeVoiceLoop';
afterEach(() => vi.useRealTimers());

describe('hands-free voice ordering and cancellation', () => {
  it('listens only after speech completes and emits one recognized answer', async () => {
    let finish!: (ok: boolean) => void;
    const input = { start: vi.fn().mockResolvedValue('I am twenty.'), cancel: vi.fn() };
    const output = { speak: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), cancel: vi.fn() };
    const emit = vi.fn();
    const controller = new HandsFreeVoiceLoopController(input, output, emit);
    const pending = controller.start('How old are you?');
    expect(input.start).not.toHaveBeenCalled();
    finish(true); await pending;
    expect(emit.mock.calls.map(call => call[0].state)).toEqual(['speaking', 'listening', 'heard']);
    expect(emit.mock.calls[2][0].transcript).toBe('I am twenty.');
    expect(input.start).toHaveBeenCalledOnce();
  });

  it('speech failure never opens the microphone', async () => {
    const input = { start: vi.fn(), cancel: vi.fn() };
    const output = { speak: vi.fn().mockResolvedValue(false), cancel: vi.fn() };
    const emit = vi.fn();
    await new HandsFreeVoiceLoopController(input, output, emit).start('Hello');
    expect(input.start).not.toHaveBeenCalled();
    expect(emit.mock.calls.at(-1)?.[0].state).toBe('error');
  });

  it('restarting cannot let the old completion clear the new speech timeout', async () => {
    vi.useFakeTimers();
    let finish: ((ok: boolean) => void) | undefined;
    const input = { start: vi.fn(), cancel: vi.fn() };
    const output = {
      speak: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })),
      cancel: vi.fn(() => { finish?.(false); finish = undefined; }),
    };
    const emit = vi.fn();
    const controller = new HandsFreeVoiceLoopController(input, output, emit);
    const first = controller.start('first');
    const second = controller.start('second');
    await Promise.resolve(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15001);
    expect(emit.mock.calls.at(-1)?.[0].state).toBe('error');
    expect(input.start).not.toHaveBeenCalled();
    await Promise.all([first, second]);
  });

  it('pause during listening discards the delayed recognized text', async () => {
    let finish!: (text: string) => void;
    const input = { start: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), cancel: vi.fn() };
    const output = { speak: vi.fn().mockResolvedValue(true), cancel: vi.fn() };
    const emit = vi.fn();
    const controller = new HandsFreeVoiceLoopController(input, output, emit);
    const pending = controller.start('Hello');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    controller.pause(); finish('late'); await pending;
    expect(emit.mock.calls.some(call => call[0].state === 'heard')).toBe(false);
    expect(emit.mock.calls.at(-1)?.[0].state).toBe('paused');
  });
});

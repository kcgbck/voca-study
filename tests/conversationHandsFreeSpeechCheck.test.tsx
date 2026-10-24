import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
const h = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], memos: [] as any[], s: 0, r: 0, m: 0, effect: false, cleanup: undefined as any,
  speak: vi.fn(), cancelOutput: vi.fn(), start: vi.fn(), cancelInput: vi.fn(), listeners: {} as Record<string, () => void> }));
vi.mock('react', async original => ({ ...await original<any>(),
  useState: (initial: any) => { const i = h.s++; if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial; return [h.states[i], (value: any) => { h.states[i] = typeof value === 'function' ? value(h.states[i]) : value; }]; },
  useRef: (initial: any) => { const i = h.r++; return h.refs[i] ?? (h.refs[i] = { current: initial }); },
  useMemo: (factory: any) => { const i = h.m++; return h.memos[i] ?? (h.memos[i] = factory()); },
  useEffect: (effect: any) => { if (!h.effect) { h.effect = true; h.cleanup = effect(); } },
}));
vi.mock('../src/features/conversation/services/browserSpeechInput', () => ({ BrowserSpeechInputService: class { start = h.start; cancel = h.cancelInput; isSupported() { return true; } } }));
vi.mock('../src/features/conversation/services/voiceOutput', () => ({ VoiceOutputService: class { speak = h.speak; cancel = h.cancelOutput; } }));
import { HandsFreeSpeechCheck } from '../src/features/conversation/components/HandsFreeSpeechCheck';
const render = () => { h.s = h.r = h.m = 0; return HandsFreeSpeechCheck({ onBack: vi.fn() }); };
function nodes(tree: any): any[] { return tree && typeof tree === 'object' ? [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)] : []; }
function text(tree: any): string { return typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : ''; }
const button = (tree: any, label: string) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function agree() { nodes(render()).find(node => node.type === 'input').props.onChange({ target: { checked: true } }); }
beforeEach(() => {
  h.states = []; h.refs = []; h.memos = []; h.listeners = {}; h.effect = false; h.cleanup = undefined;
  vi.resetAllMocks();
  const target = { visibilityState: 'visible', addEventListener: (name: string, fn: any) => { h.listeners[name] = fn; }, removeEventListener: vi.fn() };
  vi.stubGlobal('document', target); vi.stubGlobal('window', target);
  h.speak.mockResolvedValue({ success: true }); h.start.mockResolvedValue('I am twenty.');
});
afterEach(() => { h.cleanup?.(); vi.unstubAllGlobals(); });

it('starts with one checkbox and then hears and echoes without a send button', async () => {
  expect(button(render(), '확인 시작').props.disabled).toBe(true);
  agree(); button(render(), '확인 시작').props.onClick(); await flush();
  expect(h.start).toHaveBeenCalledOnce(); expect(h.speak).toHaveBeenCalledTimes(2);
  expect(button(render(), '다음 질문').props.disabled).toBe(false);
  expect(nodes(render()).some(node => node.type === 'button' && text(node) === '전송')).toBe(false);
});

it('failed echo playback is not reported as a successful voice connection', async () => {
  h.speak.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
  agree(); button(render(), '확인 시작').props.onClick(); await flush();
  expect(button(render(), '다음 질문').props.disabled).toBe(true);
  expect(text(render())).toMatch(/실패|오류/);
});

it('pagehide pauses even when document visibility is still visible', async () => {
  h.start.mockImplementation(() => new Promise(() => {}));
  agree(); button(render(), '확인 시작').props.onClick(); await flush();
  const before = h.cancelInput.mock.calls.length;
  h.listeners.pagehide();
  expect(h.cancelInput.mock.calls.length).toBeGreaterThan(before);
  expect(text(render())).toContain('일시정지');
});

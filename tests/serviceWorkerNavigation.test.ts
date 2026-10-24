import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

afterEach(() => vi.useRealTimers());

function worker(network: (...args: any[]) => Promise<Response>) {
  const listeners: Record<string, (event: any) => void> = {};
  const put = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(true);
  const match = vi.fn(async () => new Response('CACHED_OLD', { headers: { 'Content-Type': 'text/html' } }));
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (name: string, handler: any) => { listeners[name] = handler; }, clients: { claim: vi.fn() } },
    location: { origin: 'https://study.example' },
    caches: { match, open: async () => ({ put }), keys: async () => ['voca-study-cache-v6', 'unrelated-cache'], delete: remove },
    fetch: network, URL, Response, Request, Promise, console,
    setTimeout, clearTimeout, AbortController,
  });
  return { listeners, put, remove };
}
function request(url: string, navigation = true) {
  return { url, method: 'GET', mode: navigation ? 'navigate' : 'cors', headers: new Headers({ accept: navigation ? 'text/html' : 'application/json' }) };
}

describe('PWA deployment freshness', () => {
  it('an online navigation serves fresh HTML rather than the previous cached shell', async () => {
    const { listeners } = worker(async () => new Response('NETWORK_NEW', { headers: { 'Content-Type': 'text/html' } }));
    let response!: Promise<Response>;
    listeners.fetch({ request: request('https://study.example/'), respondWith: (value: any) => { response = Promise.resolve(value); }, waitUntil: vi.fn() });
    expect(await (await response).text()).toBe('NETWORK_NEW');
  });

  it('an offline navigation still serves the cached shell', async () => {
    const { listeners } = worker(async () => { throw new Error('offline'); });
    let response!: Promise<Response>;
    listeners.fetch({ request: request('https://study.example/'), respondWith: (value: any) => { response = Promise.resolve(value); }, waitUntil: vi.fn() });
    expect(await (await response).text()).toBe('CACHED_OLD');
  });

  it('API and cross-origin requests never enter the app shell cache strategy', () => {
    const { listeners } = worker(vi.fn());
    const respondWith = vi.fn();
    listeners.fetch({ request: request('https://study.example/api/conversation/chat', false), respondWith, waitUntil: vi.fn() });
    listeners.fetch({ request: request('https://external.example/'), respondWith, waitUntil: vi.fn() });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('a server denial is returned rather than cached or hidden by an old shell', async () => {
    const { listeners, put } = worker(async () => new Response('DENIED', { status: 403 }));
    let response!: Promise<Response>;
    listeners.fetch({ request: request('https://study.example/'), respondWith: (value: any) => { response = Promise.resolve(value); }, waitUntil: vi.fn() });
    expect((await response).status).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });

  it('activation deletes only obsolete caches owned by this app', async () => {
    const { listeners, remove } = worker(vi.fn());
    let pending!: Promise<unknown>;
    listeners.activate({ waitUntil: (value: any) => { pending = value; } });
    await pending;
    expect(remove).toHaveBeenCalledWith('voca-study-cache-v6');
    expect(remove).not.toHaveBeenCalledWith('unrelated-cache');
  });

  it('manual CLEAR_CACHE messages delete only this app caches',async()=>{
    const {listeners,remove}=worker(vi.fn());let pending!:Promise<unknown>;
    listeners.message({data:{type:'CLEAR_CACHE'},waitUntil:(value:Promise<unknown>)=>{pending=value;}});
    await pending;expect(remove).toHaveBeenCalledWith('voca-study-cache-v6');expect(remove).not.toHaveBeenCalledWith('unrelated-cache');
  });

  it('a stalled network is aborted after five seconds and returns the offline shell', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const { listeners } = worker((_request, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    let response!: Promise<Response>;
    listeners.fetch({ request: request('https://study.example/'), respondWith: (value: any) => { response = Promise.resolve(value); }, waitUntil: vi.fn() });
    await vi.advanceTimersByTimeAsync(5001);
    expect(signal.aborted).toBe(true);
    expect(await (await response).text()).toBe('CACHED_OLD');
    expect(vi.getTimerCount()).toBe(0);
  });
});

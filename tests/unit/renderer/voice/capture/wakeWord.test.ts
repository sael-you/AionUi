import { describe, expect, it, vi } from 'vitest';
import { WAKE_WORKER_IDLE_MS, WakeWord, type WakeWordEvents, type WorkerLike } from '@/renderer/voice/capture/wakeWord';

function fakeWorker() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const posted: Array<{ msg: { type: string } & Record<string, unknown>; transfer: Transferable[] }> = [];
  const worker = {
    postMessage: (msg: { type: string }, transfer: Transferable[]) => posted.push({ msg, transfer }),
    terminate: vi.fn(),
    addEventListener: (type: string, cb: (e: unknown) => void) => (listeners[type] = cb),
  } as unknown as WorkerLike;
  return { worker, posted, emit: (data: unknown) => listeners.message?.({ data }), listeners };
}

const events = (): WakeWordEvents => ({ onLoaded: vi.fn(), onWake: vi.fn(), onVad: vi.fn(), onError: vi.fn() });

describe('WakeWord (main-thread handle)', () => {
  it('loads the models once, resets, sets wake mode and transfers the capture port', () => {
    const w = fakeWorker();
    const ww = new WakeWord(() => w.worker);
    const port = {} as MessagePort;
    ww.start(port, '/voice/', events(), { threshold: 0.65 });
    expect(w.posted.map((p) => p.msg.type)).toEqual(['init', 'reset', 'mode', 'port']);
    expect(w.posted[0].msg).toMatchObject({ assetBase: '/voice/', threshold: 0.65 });
    expect(w.posted[3].transfer).toEqual([port]);
  });

  it('does not download models when the wake word is off (VAD only)', () => {
    const w = fakeWorker();
    new WakeWord(() => w.worker).start({} as MessagePort, '/voice/', events(), { loadModels: false });
    expect(w.posted.map((p) => p.msg.type)).not.toContain('init');
    expect(w.posted.find((p) => p.msg.type === 'mode')?.msg.mode).toBe('vad');
  });

  it('a second arm reuses the loaded worker and reports loaded immediately', () => {
    const w = fakeWorker();
    let created = 0;
    const ww = new WakeWord(() => {
      created++;
      return w.worker;
    });
    ww.start({} as MessagePort, '/voice/', events());
    w.emit({ type: 'loaded', ms: 900 });
    ww.detach();
    const second = events();
    ww.start({} as MessagePort, '/voice/', second);
    expect(created).toBe(1);
    expect(second.onLoaded).toHaveBeenCalledWith(0);
    expect(w.posted.filter((p) => p.msg.type === 'init')).toHaveLength(1);
  });

  it('routes wake, vad and errors; retries the load after a failure', () => {
    const w = fakeWorker();
    const ww = new WakeWord(() => w.worker);
    const ev = events();
    ww.start({} as MessagePort, '/voice/', ev);
    w.emit({ type: 'wake', t: 3, score: 0.9 });
    w.emit({ type: 'vad', speech: true, t: 2.5 });
    w.emit({ type: 'error', message: 'load failed: 404' });
    expect(ev.onWake).toHaveBeenCalledWith(3, 0.9);
    expect(ev.onVad).toHaveBeenCalledWith(true, 2.5);
    expect(ev.onError).toHaveBeenCalledWith('load failed: 404');
    ww.start({} as MessagePort, '/voice/', ev);
    expect(w.posted.filter((p) => p.msg.type === 'init')).toHaveLength(2);
  });

  it('releases the worker after 5 minutes disarmed, and re-creates it on the next arm', () => {
    vi.useFakeTimers();
    try {
      const w = fakeWorker();
      let created = 0;
      const ww = new WakeWord(() => {
        created++;
        return w.worker;
      });
      ww.start({} as MessagePort, '/voice/', events());
      ww.detach();
      vi.advanceTimersByTime(WAKE_WORKER_IDLE_MS - 1);
      expect(w.worker.terminate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(w.worker.terminate).toHaveBeenCalledTimes(1);
      ww.start({} as MessagePort, '/voice/', events());
      expect(created).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a re-arm within the idle window keeps the worker; pagehide while armed does not dispose it', () => {
    vi.useFakeTimers();
    try {
      const w = fakeWorker();
      const ww = new WakeWord(() => w.worker);
      ww.start({} as MessagePort, '/voice/', events());
      ww.detach();
      ww.start({} as MessagePort, '/voice/', events());
      ww.disposeIfDetached();
      vi.advanceTimersByTime(WAKE_WORKER_IDLE_MS * 2);
      expect(w.worker.terminate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('events after detach are not delivered', () => {
    const w = fakeWorker();
    const ww = new WakeWord(() => w.worker);
    const ev = events();
    ww.start({} as MessagePort, '/voice/', ev);
    ww.detach();
    w.emit({ type: 'wake', t: 3, score: 0.9 });
    expect(ev.onWake).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ClipPlayer } from '@/renderer/voice/audio/clipPlayer';
import { EARCONS, earconDuration, playEarcon, type EarconName } from '@/renderer/voice/audio/earcons';
import { getVoiceDeviceId, ScreenWakeLock } from '@/renderer/voice/audio/platform';

function fakeCtx(state: AudioContextState = 'running') {
  const sources: Array<{
    listeners: Record<string, () => void>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn((n: unknown) => n), disconnect: vi.fn() });
  const ctx = {
    state,
    currentTime: 5,
    destination: {},
    createOscillator: vi.fn(() => ({ ...node(), type: '', frequency: param(), start: vi.fn(), stop: vi.fn() })),
    createGain: vi.fn(() => ({ ...node(), gain: param() })),
    decodeAudioData: vi.fn(async () => ({ duration: 1.5 })),
    createBufferSource: vi.fn(() => {
      const listeners: Record<string, () => void> = {};
      const src = {
        ...node(),
        buffer: null,
        listeners,
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: (t: string, cb: () => void) => (listeners[t] = cb),
        removeEventListener: (t: string) => delete listeners[t],
      };
      sources.push(src);
      return src;
    }),
  };
  return { ctx: ctx as unknown as AudioContext, raw: ctx, sources };
}

describe('earcons', () => {
  it('defines every tone the plan lists and keeps each under half a second', () => {
    const names: EarconName[] = [
      'armed',
      'listening',
      'gotIt',
      'yourTurn',
      'working',
      'sent',
      'needsYou',
      'agent',
      'bye',
    ];
    for (const n of names) {
      expect(EARCONS[n].length).toBeGreaterThan(0);
      expect(earconDuration(n)).toBeLessThan(0.55);
    }
  });

  it('schedules one oscillator per note and returns the end time on the context clock', () => {
    const { ctx, raw } = fakeCtx();
    const end = playEarcon(ctx, 'needsYou');
    expect(raw.createOscillator).toHaveBeenCalledTimes(3);
    expect(end).toBeCloseTo(5.01 + earconDuration('needsYou'));
  });

  it('plays nothing when the context is not running (autoplay blocked / interrupted)', () => {
    const { ctx, raw } = fakeCtx('suspended');
    expect(playEarcon(ctx, 'armed')).toBeNull();
    expect(raw.createOscillator).not.toHaveBeenCalled();
  });
});

describe('ClipPlayer', () => {
  it('resolves completed with tEnd = start + duration on the same clock', async () => {
    const { ctx, sources } = fakeCtx();
    const player = new ClipPlayer(ctx);
    const done = player.play(new ArrayBuffer(4));
    await Promise.resolve();
    await Promise.resolve();
    expect(player.playing).toBe(true);
    sources[0].listeners.ended();
    await expect(done).resolves.toEqual({ completed: true, tStart: 5.02, tEnd: 6.52 });
    expect(player.playing).toBe(false);
  });

  it('tEnd includes the output latency (when the last sample is heard) and onStart reports it', async () => {
    const { ctx, raw, sources } = fakeCtx();
    Object.assign(raw, { outputLatency: 0.1, baseLatency: 0.01 });
    const onStart = vi.fn();
    const done = new ClipPlayer(ctx).play(new ArrayBuffer(4), { onStart });
    await Promise.resolve();
    await Promise.resolve();
    expect(onStart).toHaveBeenCalledWith(5.02, expect.closeTo(6.63, 5));
    sources[0].listeners.ended();
    await expect(done).resolves.toMatchObject({ completed: true, tEnd: expect.closeTo(6.63, 5) });
  });

  it('a stopped clip resolves as truncated (not finished)', async () => {
    const { ctx, sources } = fakeCtx();
    const player = new ClipPlayer(ctx);
    const done = player.play(new ArrayBuffer(4));
    await Promise.resolve();
    await Promise.resolve();
    player.stop();
    await expect(done).resolves.toMatchObject({ completed: false });
    expect(sources[0].stop).toHaveBeenCalled();
  });

  it('a decode failure rejects', async () => {
    const { ctx, raw } = fakeCtx();
    raw.decodeAudioData.mockRejectedValueOnce(new Error('bad audio'));
    await expect(new ClipPlayer(ctx).play(new ArrayBuffer(1))).rejects.toThrow('bad audio');
  });
});

describe('ScreenWakeLock', () => {
  it('re-acquires after the browser released it (page hidden)', async () => {
    const released: Array<() => void> = [];
    const request = vi.fn(async () => ({
      release: vi.fn(async () => undefined),
      addEventListener: (_t: string, cb: () => void) => released.push(cb),
    }));
    const lock = new ScreenWakeLock({ wakeLock: { request } } as unknown as Navigator);
    expect(await lock.acquire()).toBe(true);
    released[0]();
    lock.reacquireIfWanted();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reports refusal and does not re-acquire after release()', async () => {
    const request = vi.fn(async () => Promise.reject(new Error('battery saver')));
    const lock = new ScreenWakeLock({ wakeLock: { request } } as unknown as Navigator);
    expect(await lock.acquire()).toBe(false);
    expect(lock.refused).toBe(true);
    lock.release();
    lock.reacquireIfWanted();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without the API', async () => {
    const lock = new ScreenWakeLock({} as Navigator);
    expect(await lock.acquire()).toBe(false);
  });
});

describe('getVoiceDeviceId', () => {
  it('is stable per browser', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    } as unknown as Storage;
    const a = getVoiceDeviceId(storage);
    expect(a).toMatch(/^web-[0-9a-f]{32}$/);
    expect(getVoiceDeviceId(storage)).toBe(a);
  });
});

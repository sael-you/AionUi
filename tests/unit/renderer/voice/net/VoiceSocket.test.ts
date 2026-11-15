import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_FRAMES_PER_SECOND,
  VoiceSocket,
  type VoiceSocketListener,
  type VoiceWebSocket,
} from '@/renderer/voice/net/VoiceSocket';

class FakeWs implements VoiceWebSocket {
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.emitClose(1000);
  }
  addEventListener(type: string, cb: (e: never) => void) {
    (this.listeners[type] ??= []).push(cb as (e: unknown) => void);
  }
  emit(type: string, e: unknown = {}) {
    this.listeners[type]?.forEach((cb) => cb(e));
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  emitClose(code: number) {
    this.readyState = 3;
    this.emit('close', { code });
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s) as { name: string; data: Record<string, unknown> });
  }
}

function setup(refresh = vi.fn(async () => true)) {
  const sockets: FakeWs[] = [];
  const listener: VoiceSocketListener = { onOpen: vi.fn(), onClose: vi.fn(), onFrame: vi.fn() };
  const vs = new VoiceSocket({
    device: { id: 'web-1', kind: 'browser', label: 'test' },
    capabilities: { wakeWord: true, webrtc: true, clips: true, mediaSession: false },
    listener,
    url: () => 'wss://host/api/voice/ws',
    createSocket: (url) => {
      const ws = new FakeWs(url);
      sockets.push(ws);
      return ws;
    },
    random: () => 0.5,
    refresh,
  });
  return { vs, sockets, listener, refresh };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('VoiceSocket', () => {
  it('sends voice.hello with device and capabilities first on open', () => {
    const { vs, sockets, listener } = setup();
    vs.start();
    sockets[0].open();
    // The backend's `VoiceHello.device` is a plain string: an object would be refused as INVALID_FRAME.
    expect(sockets[0].frames()[0]).toMatchObject({ name: 'voice.hello', data: { device: 'web-1' } });
    expect(listener.onOpen).toHaveBeenCalled();
  });

  it('sends a heartbeat every 10 s', () => {
    const { vs, sockets } = setup();
    vs.start();
    sockets[0].open();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(sockets[0].frames().filter((f) => f.name === 'voice.heartbeat')).toHaveLength(3);
  });

  it('re-sends hello with the bound session so a reconnect re-binds the call', () => {
    const { vs, sockets } = setup();
    vs.start();
    sockets[0].open();
    vs.bindSession('vs-1');
    expect(sockets[0].frames()[1]).toMatchObject({ name: 'voice.hello', data: { voiceSessionId: 'vs-1' } });
    sockets[0].emitClose(1006);
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].frames()[0]).toMatchObject({ name: 'voice.hello', data: { voiceSessionId: 'vs-1' } });
  });

  it('reconnects with exponential backoff', () => {
    const { vs, sockets } = setup();
    vs.start();
    sockets[0].emitClose(1006);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1].emitClose(1006);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('refreshes the session once on an auth close (1008) before reconnecting', async () => {
    const { vs, sockets, refresh } = setup();
    vs.start();
    sockets[0].emitClose(1008);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
  });

  it('stop() closes and never reconnects', () => {
    const { vs, sockets, listener } = setup();
    vs.start();
    sockets[0].open();
    vs.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(listener.onClose).not.toHaveBeenCalled();
  });

  it('drops frames while the socket is down', () => {
    const { vs } = setup();
    vs.start();
    expect(vs.send({ name: 'voice.speechOnset', t: 1 })).toBe(false);
  });

  it('rate-limits to 10 frames/s, queueing control frames and dropping heartbeats', () => {
    const { vs, sockets } = setup();
    vs.start();
    sockets[0].open();
    for (let i = 0; i < 15; i++) vs.send({ name: 'voice.speechOnset', t: i });
    expect(vs.send({ name: 'voice.heartbeat', t: 0 })).toBe(false);
    expect(sockets[0].sent.length).toBe(MAX_FRAMES_PER_SECOND);
    vi.advanceTimersByTime(1200);
    const onsets = sockets[0].frames().filter((f) => f.name === 'voice.speechOnset');
    expect(onsets.map((f) => f.data.t)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('delivers decoded frames and ignores garbage', () => {
    const { vs, sockets, listener } = setup();
    vs.start();
    sockets[0].open();
    sockets[0].emit('message', { data: JSON.stringify({ name: 'voice.budget', data: { usedUsd: 1, limitUsd: 5 } }) });
    sockets[0].emit('message', { data: '{oops' });
    expect(listener.onFrame).toHaveBeenCalledTimes(1);
    expect(listener.onFrame).toHaveBeenCalledWith(expect.objectContaining({ name: 'voice.budget', usedUsd: 1 }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICE_DISCONNECT_GRACE_MS, startRealtimeCall } from '@/renderer/voice/engine/openaiRealtime';
import type { VoiceApi } from '@/renderer/voice/net/voiceApi';

class FakePc {
  iceConnectionState: RTCIceConnectionState = 'new';
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'v=0 offer' }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => undefined);
  createDataChannel = vi.fn();
  getSenders = vi.fn(() => []);
  close = vi.fn();
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  ice(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.listeners.iceconnectionstatechange?.forEach((cb) => cb({}));
  }
}

class FakeMediaStream {
  constructor(readonly tracks: unknown[] = []) {}
}

function setup(
  createSession = vi.fn(async () => ({ voice_session_id: 'vs', sdp_answer: 'v=0 answer', engine: 'e', model: 'm' }))
) {
  const pc = new FakePc();
  const api = { createSession, endSession: vi.fn(async () => undefined) } as unknown as VoiceApi;
  const onNetworkLost = vi.fn();
  const audioElement = { srcObject: null, play: vi.fn(async () => undefined) } as unknown as HTMLAudioElement;
  const start = (extra: Record<string, unknown> = {}) =>
    startRealtimeCall({
      api,
      outgoingTrack: { id: 'send' } as unknown as MediaStreamTrack,
      audioElement,
      deviceId: 'web-1',
      onNetworkLost,
      createPeerConnection: () => pc as unknown as RTCPeerConnection,
      ...extra,
    });
  return { pc, api, onNetworkLost, start, createSession };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaStream', FakeMediaStream);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openai-realtime adapter', () => {
  it('posts the SDP offer to the backend and applies the answer, without a data channel', async () => {
    const { pc, start, createSession } = setup();
    const call = await start({ focusConversationId: 'c1' });
    expect(createSession).toHaveBeenCalledWith({
      engine: 'openai-realtime',
      sdp_offer: 'v=0 offer',
      device_id: 'web-1',
      focus_conversation_id: 'c1',
    });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0 answer' });
    expect(pc.createDataChannel).not.toHaveBeenCalled();
    expect(call.voiceSessionId).toBe('vs');
  });

  it('sends only the worklet track (never the raw mic)', async () => {
    const { pc, start } = setup();
    await start();
    expect(pc.addTrack).toHaveBeenCalledTimes(1);
    expect(pc.addTrack.mock.calls[0][0]).toEqual({ id: 'send' });
  });

  it('passes resume_of on a resume', async () => {
    const { start, createSession } = setup();
    await start({ resumeOf: 'vs-old' });
    expect(createSession.mock.calls[0][0]).toMatchObject({ resume_of: 'vs-old' });
  });

  it('reports network loss after ICE stays disconnected for more than 3 s', async () => {
    const { pc, start, onNetworkLost } = setup();
    await start();
    pc.ice('disconnected');
    vi.advanceTimersByTime(ICE_DISCONNECT_GRACE_MS - 1);
    expect(onNetworkLost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onNetworkLost).toHaveBeenCalledTimes(1);
  });

  it('a short ICE blip that recovers is not a loss', async () => {
    const { pc, start, onNetworkLost } = setup();
    await start();
    pc.ice('disconnected');
    vi.advanceTimersByTime(1000);
    pc.ice('connected');
    vi.advanceTimersByTime(5000);
    expect(onNetworkLost).not.toHaveBeenCalled();
  });

  it('ICE failed is an immediate loss', async () => {
    const { pc, start, onNetworkLost } = setup();
    await start();
    pc.ice('failed');
    expect(onNetworkLost).toHaveBeenCalledTimes(1);
  });

  it('closes the peer connection when the backend refuses the session', async () => {
    const { pc, start } = setup(vi.fn(async () => Promise.reject(new Error('409'))));
    await expect(start()).rejects.toThrow('409');
    expect(pc.close).toHaveBeenCalled();
  });

  it('hangs up an admitted session whose SDP answer cannot be applied', async () => {
    const { pc, start, api } = setup();
    pc.setRemoteDescription.mockRejectedValueOnce(new Error('bad sdp'));
    await expect(start()).rejects.toThrow('bad sdp');
    expect(api.endSession).toHaveBeenCalledWith('vs', 'setup_failed');
  });
});

/**
 * Fakes for the voice controller's effect boundary (no audio, no network).
 */

import { vi } from 'vitest';
import type { ClipPlayOptions } from '@/renderer/voice/audio/clipPlayer';
import type { WakeWordEvents } from '@/renderer/voice/capture/wakeWord';
import type { CaptureOptions } from '@/renderer/voice/capture/micCapture';
import type { Effects, LifecycleHandlers, StartCallOptions } from '@/renderer/voice/core/effects';
import {
  DEFAULT_VOICE_SETTINGS,
  type ServerFrame,
  type VoiceSessionSummary,
  type VoiceSettings,
} from '@/renderer/voice/core/types';
import type { VoiceSocketListener } from '@/renderer/voice/net/VoiceSocket';
import { realTimers } from '@/renderer/voice/net/VoiceSocket';

export type FakeAudioContext = {
  state: AudioContextState;
  currentTime: number;
  outputLatency: number;
  baseLatency: number;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

export function createFakeEffects(settings: Partial<VoiceSettings> = { enabled: true }) {
  const ctx: FakeAudioContext = {
    state: 'running',
    currentTime: 10,
    outputLatency: 0.05,
    baseLatency: 0.01,
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const capture = {
    outgoingTrack: { id: 'send-track' } as unknown as MediaStreamTrack,
    trackSettings: {},
    setLive: vi.fn(),
    mute: vi.fn(),
    takeWakePort: vi.fn(() => ({}) as MessagePort),
    stop: vi.fn(),
  };
  const state = {
    wakeEvents: null as WakeWordEvents | null,
    socketListener: null as VoiceSocketListener | null,
    socketOpen: false,
    lifecycle: null as LifecycleHandlers | null,
    callOptions: null as StartCallOptions | null,
    captureOptions: null as CaptureOptions | null,
    online: true,
  };
  const call = { voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'gpt-realtime-2.1', close: vi.fn() };
  const socket = {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(() => state.socketOpen),
    bindSession: vi.fn(),
  };
  const clips = {
    playing: false,
    play: vi.fn(async (_data: ArrayBuffer, options?: ClipPlayOptions) => {
      options?.onStart?.(11, 12.5);
      return { completed: true, tStart: 11, tEnd: 12.5 };
    }),
    stop: vi.fn(),
  };
  const fx = {
    api: {
      getSettings: vi.fn(async () => ({ ...DEFAULT_VOICE_SETTINGS, ...settings })),
      putSettings: vi.fn(async (patch: Partial<VoiceSettings>) => ({
        ...DEFAULT_VOICE_SETTINGS,
        ...settings,
        ...patch,
      })),
      createSession: vi.fn(),
      endSession: vi.fn(async () => undefined),
      fetchClip: vi.fn(async () => new ArrayBuffer(8)),
      listSessions: vi.fn(async (): Promise<VoiceSessionSummary[]> => []),
    },
    timers: realTimers,
    createAudioContext: vi.fn(() => ctx as unknown as AudioContext),
    createAudioElement: vi.fn(() => ({ srcObject: null }) as unknown as HTMLAudioElement),
    createClipPlayer: vi.fn(() => clips),
    openCapture: vi.fn(async (_ctx: AudioContext, options: CaptureOptions) => {
      state.captureOptions = options;
      return capture;
    }),
    wakeWord: {
      start: vi.fn((_port: MessagePort, _base: string, events: WakeWordEvents) => {
        state.wakeEvents = events;
      }),
      setMode: vi.fn(),
      suppress: vi.fn(),
      detach: vi.fn(),
    },
    createSocket: vi.fn((listener: VoiceSocketListener) => {
      state.socketListener = listener;
      return socket;
    }),
    startCall: vi.fn(async (options: StartCallOptions) => {
      state.callOptions = options;
      return call;
    }),
    playEarcon: vi.fn(() => 10.5),
    wakeLock: { acquire: vi.fn(async () => true), release: vi.fn(), reacquireIfWanted: vi.fn() },
    registerMediaSession: vi.fn(() => vi.fn()),
    vibrate: vi.fn(),
    lifecycle: vi.fn((handlers: LifecycleHandlers) => {
      state.lifecycle = handlers;
      return vi.fn();
    }),
    isOnline: () => state.online,
    isVisible: () => true,
    assetBase: () => '/voice/',
  } satisfies Effects;

  const helpers = {
    openSocket() {
      state.socketOpen = true;
      state.socketListener?.onOpen();
    },
    closeSocket() {
      state.socketOpen = false;
      state.socketListener?.onClose({ code: 1006, willReconnect: true });
    },
    frame(frame: ServerFrame) {
      state.socketListener?.onFrame(frame);
    },
    earcons(): string[] {
      return fx.playEarcon.mock.calls.map((c) => (c as unknown[])[1] as string);
    },
    sent(name: string): Array<Record<string, unknown>> {
      return socket.send.mock.calls
        .map((c) => (c as unknown[])[0] as Record<string, unknown>)
        .filter((f) => f.name === name);
    },
  };

  return { fx, ctx, capture, socket, clips, call, state, ...helpers };
}

/** Let pending promise chains settle (works with fake timers). */
export function flush(ticks = 20): Promise<void> {
  return Array.from({ length: ticks }).reduce<Promise<void>>((p) => p.then(() => undefined), Promise.resolve());
}

/** Run `fn` n times strictly one after another. */
export function sequential<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  return Array.from({ length: n }).reduce<Promise<T[]>>(
    (acc, _v, i) => acc.then(async (out) => [...out, await fn(i)]),
    Promise.resolve([])
  );
}

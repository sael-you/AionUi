/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Side-effect boundary of the voice controller. Tests inject fakes; the app
 * uses `createBrowserEffects()` through the `getVoiceController()` singleton.
 */

import { ClipPlayer, type ClipOutcome, type ClipPlayOptions } from '../audio/clipPlayer';
import { playEarcon, type EarconName } from '../audio/earcons';
import { getVoiceDeviceId, registerMediaSession, ScreenWakeLock, vibrate, type MediaControls } from '../audio/platform';
import { voiceAssetBase } from '../capture/assets';
import { isMicLevel, openCapture, type CaptureGraph, type CaptureOptions, type MicLevel } from '../capture/micCapture';
import { WakeWord } from '../capture/wakeWord';
import { startRealtimeCall, type RealtimeCall, type RealtimeCallOptions } from '../engine/openaiRealtime';
import { isVoiceMockEnabled, withMockBackend } from '../net/mockBackend';
import { voiceApi, type VoiceApi } from '../net/voiceApi';
import { realTimers, VoiceSocket, type Timers, type VoiceSocketListener } from '../net/VoiceSocket';
import type { VoiceSessionMode } from './types';
import { VoiceController } from './VoiceController';

export type ClipPlayerLike = {
  readonly playing: boolean;
  play(data: ArrayBuffer, options?: ClipPlayOptions): Promise<ClipOutcome>;
  stop(): void;
};

export type VoiceSocketLike = Pick<VoiceSocket, 'start' | 'stop' | 'send' | 'bindSession'>;

export type WakeWordLike = Pick<WakeWord, 'start' | 'setMode' | 'suppress' | 'detach'>;

export type LifecycleHandlers = {
  onVisible(): void;
  onFreeze(): void;
  onResume(): void;
  onOnline(): void;
};

export type StartCallOptions = Pick<
  RealtimeCallOptions,
  'outgoingTrack' | 'audioElement' | 'focusConversationId' | 'resumeOf' | 'mode' | 'onNetworkLost'
>;

export type Effects = {
  api: VoiceApi;
  timers: Timers;
  createAudioContext(): AudioContext;
  createAudioElement(): HTMLAudioElement;
  createClipPlayer(ctx: AudioContext): ClipPlayerLike;
  openCapture(ctx: AudioContext, options: CaptureOptions): Promise<CaptureGraph>;
  /** The mic level that last worked in this browser (TASK-106). */
  micLevelStore: { get(): MicLevel | null; set(level: MicLevel): void };
  wakeWord: WakeWordLike;
  /** `mode`: the mode the device is armed in (sent with every `voice.hello`). */
  createSocket(listener: VoiceSocketListener, mode?: VoiceSessionMode): VoiceSocketLike;
  startCall(options: StartCallOptions): Promise<RealtimeCall>;
  playEarcon(ctx: AudioContext, name: EarconName): number | null;
  wakeLock: Pick<ScreenWakeLock, 'acquire' | 'release' | 'reacquireIfWanted'>;
  registerMediaSession(controls: MediaControls): () => void;
  vibrate(pattern: number | number[]): void;
  lifecycle(handlers: LifecycleHandlers): () => void;
  isOnline(): boolean;
  isVisible(): boolean;
  assetBase(): string;
};

/** Page lifecycle wiring: visibility, Chrome's freeze/resume, connectivity. */
export function listenPageLifecycle(handlers: LifecycleHandlers): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') handlers.onVisible();
  };
  const onFreeze = () => handlers.onFreeze();
  const onResume = () => handlers.onResume();
  const onOnline = () => handlers.onOnline();
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);
  window.addEventListener('online', onOnline);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    window.removeEventListener('online', onOnline);
  };
}

export function createBrowserEffects(): Effects {
  const deviceId = getVoiceDeviceId();
  const wakeWord = new WakeWord();
  // Leaving the page while disarmed: release the worker right away instead of after the idle timeout.
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => wakeWord.disposeIfDetached());
  const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  return {
    api: voiceApi,
    timers: realTimers,
    createAudioContext: () => new AudioContext({ latencyHint: 'interactive' }),
    createAudioElement: () => {
      const el = new Audio();
      el.autoplay = true;
      return el;
    },
    createClipPlayer: (ctx) => new ClipPlayer(ctx),
    openCapture: (ctx, options) => openCapture(ctx, options),
    micLevelStore: browserMicLevelStore,
    wakeWord,
    createSocket: (listener, mode) =>
      new VoiceSocket({
        mode,
        device: { id: deviceId, kind: 'browser', label: navigator.userAgent.slice(0, 120) },
        capabilities: {
          wakeWord: true,
          webrtc: typeof RTCPeerConnection !== 'undefined',
          clips: true,
          mediaSession: hasMediaSession,
        },
        listener,
      }),
    startCall: (options) => startRealtimeCall({ ...options, api: voiceApi, deviceId }),
    playEarcon: (ctx, name) => playEarcon(ctx, name),
    wakeLock: new ScreenWakeLock(),
    registerMediaSession: (controls) => registerMediaSession('Jarvis', controls),
    vibrate,
    lifecycle: listenPageLifecycle,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    isVisible: () => typeof document !== 'undefined' && document.visibilityState === 'visible',
    assetBase: () => voiceAssetBase(),
  };
}

/** localStorage key of the mic level that worked in this browser. */
export const MIC_LEVEL_STORAGE_KEY = 'aionui.voice.micLevel';

/** Per-browser memory of the working mic level; storage failures (private mode) are ignored. */
export const browserMicLevelStore: Effects['micLevelStore'] = {
  get: () => {
    try {
      const value = window.localStorage.getItem(MIC_LEVEL_STORAGE_KEY);
      return isMicLevel(value) ? value : null;
    } catch {
      return null;
    }
  },
  set: (level) => {
    try {
      window.localStorage.setItem(MIC_LEVEL_STORAGE_KEY, level);
    } catch {
      // not persisted: the next arm starts from `all` again
    }
  },
};

let instance: VoiceController | null = null;

/** The app-wide voice controller (one per page). */
export function getVoiceController(): VoiceController {
  if (!instance) {
    const fx = createBrowserEffects();
    // The scripted mock exists only in development builds (dead code in production).
    const useMock = process.env.NODE_ENV !== 'production' && isVoiceMockEnabled();
    instance = new VoiceController(useMock ? withMockBackend(fx) : fx);
  }
  return instance;
}

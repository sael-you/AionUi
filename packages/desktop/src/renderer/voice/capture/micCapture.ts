/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Microphone capture graph for voice mode (plan §3.6 step 1–2, S0-C §2):
 *
 *   mic track ──► send worklet (8 s ring, mute = silence) ──► MediaStreamDestination ──► WebRTC
 *   track.clone() ──► capture-16k worklet ──MessagePort──► wake-word worker
 *
 * The AudioContext is created by the caller inside the arm gesture (autoplay
 * policy) at the native rate; one context serves capture, earcons and clips.
 */

import { AudioWorkletUnavailableError } from '@/renderer/services/speech/pcmRecorder';
import { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_SOURCE } from './captureWorklet';
import { SEND_PROCESSOR_NAME, SEND_WORKLET_SOURCE, type SendModeEvent } from './sendWorklet';

/**
 * Microphone processing levels, strongest first (TASK-106). macOS voice-processing echo
 * cancellation (Chromium's `"all"` / system AEC) can kill the track right after it opened when
 * the input or output is a virtual, aggregate or multi-output device (e.g. BlackHole); the
 * controller then re-arms one level lower.
 * - `all`: `echoCancellation: "all"` + noise suppression + gain control (falls back to `standard`
 *   constraints when `"all"` is not understood)
 * - `standard`: `echoCancellation: true` + noise suppression + gain control
 * - `plain`: `{ audio: true }`, no processing requested
 */
export type MicLevel = 'all' | 'standard' | 'plain';
export const MIC_LEVELS: readonly MicLevel[] = ['all', 'standard', 'plain'];

export function isMicLevel(value: unknown): value is MicLevel {
  return typeof value === 'string' && (MIC_LEVELS as readonly string[]).includes(value);
}

/** The next weaker level, or `null` after `plain`. */
export function nextMicLevel(level: MicLevel): MicLevel | null {
  return MIC_LEVELS[MIC_LEVELS.indexOf(level) + 1] ?? null;
}

export type CaptureGraph = {
  /** The only track ever handed to a provider call. */
  outgoingTrack: MediaStreamTrack;
  /** The level the microphone actually opened at (`all` may fall back to `standard`). */
  level: MicLevel;
  /** `getSettings()` of the mic track, for diagnostics (EC mode etc.). */
  trackSettings: MediaTrackSettings;
  /** Unmute the outgoing path; with `fromTime` (context clock) replay the ring buffer first. */
  setLive(fromTime?: number): void;
  /** Outgoing worklet writes silence. */
  mute(): void;
  /** Port that receives 16 kHz frames; transfer it to the wake-word worker. */
  takeWakePort(): MessagePort;
  stop(): void;
};

export type CaptureOptions = {
  /** Processing level to ask for (default `all`). */
  level?: MicLevel;
  onTrackEnded?: () => void;
  /** Send-worklet mode changes (mute / catch-up / live, with pre-roll lag and jumps). */
  onSendMode?: (event: SendModeEvent) => void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

/** Open the mic at `level`; resolves with the stream and the level it really opened at. */
export async function openMicStreamAt(
  getUserMedia: GetUserMedia,
  level: MicLevel = 'all'
): Promise<{ stream: MediaStream; level: MicLevel }> {
  const base = { noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const standard = () => getUserMedia({ audio: { ...base, echoCancellation: true }, video: false });
  if (level === 'plain') return { stream: await getUserMedia({ audio: true, video: false }), level };
  if (level === 'standard') return { stream: await standard(), level };
  // `all`: ask for echoCancellation "all" (Chrome ≥ 141 cancels page playback too), fall back to `true`.
  try {
    const stream = await getUserMedia({
      audio: { ...base, echoCancellation: { ideal: 'all' } as unknown as ConstrainBoolean },
      video: false,
    });
    return { stream, level: 'all' };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') throw error;
    return { stream: await standard(), level: 'standard' };
  }
}

export async function openMicStream(getUserMedia: GetUserMedia, level: MicLevel = 'all'): Promise<MediaStream> {
  return (await openMicStreamAt(getUserMedia, level)).stream;
}

/** One diagnostic console line per mic event (device label + settings; no secrets in either). */
function logMic(event: 'open' | 'ended', track: MediaStreamTrack, level: MicLevel): void {
  let settings = '{}';
  try {
    settings = JSON.stringify(track.getSettings?.() ?? {});
  } catch {
    // diagnostics only
  }
  console.info(
    `[voice] mic ${event}: level=${level} label=${JSON.stringify(track.label ?? '')} readyState=${track.readyState} settings=${settings}`
  );
}

const loadedContexts = new WeakSet<BaseAudioContext>();

async function loadWorklets(ctx: AudioContext): Promise<void> {
  if (loadedContexts.has(ctx)) return;
  const blob = new Blob([CAPTURE_WORKLET_SOURCE, SEND_WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
    loadedContexts.add(ctx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function openCapture(ctx: AudioContext, options: CaptureOptions = {}): Promise<CaptureGraph> {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new AudioWorkletUnavailableError();
  const gum = options.getUserMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
  const { stream, level } = await openMicStreamAt(gum, options.level ?? 'all');
  const callTrack = stream.getAudioTracks()[0];
  if (!callTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('no audio track');
  }
  logMic('open', callTrack, level);
  // Listen at once: the track may end while the worklets load (macOS AEC failures end it within
  // a second). The controller hears about it only once the graph is returned.
  let graphReturned = false;
  let endedBeforeReturn = false;
  callTrack.addEventListener('ended', () => {
    logMic('ended', callTrack, level);
    if (graphReturned) options.onTrackEnded?.();
    else endedBeforeReturn = true;
  });
  const wakeTrack = callTrack.clone();
  const release = () => {
    callTrack.stop();
    wakeTrack.stop();
    stream.getTracks().forEach((t) => t.stop());
  };
  try {
    await loadWorklets(ctx);
  } catch (error) {
    release();
    throw error;
  }

  const callSource = new MediaStreamAudioSourceNode(ctx, { mediaStream: new MediaStream([callTrack]) });
  const sendNode = new AudioWorkletNode(ctx, SEND_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  sendNode.port.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as SendModeEvent | undefined;
    if (data?.type === 'mode') options.onSendMode?.(data);
  });
  sendNode.port.start();
  const destination = new MediaStreamAudioDestinationNode(ctx, { channelCount: 1 });
  callSource.connect(sendNode).connect(destination);

  const wakeSource = new MediaStreamAudioSourceNode(ctx, { mediaStream: new MediaStream([wakeTrack]) });
  const captureNode = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  const channel = new MessageChannel();
  captureNode.port.postMessage({ port: channel.port1 }, [channel.port1]);
  wakeSource.connect(captureNode);

  const outgoingTrack = destination.stream.getAudioTracks()[0];
  let stopped = false;
  graphReturned = true;
  if (endedBeforeReturn || callTrack.readyState === 'ended') {
    // After the caller stored the graph (it awaits this function first).
    setTimeout(() => {
      if (!stopped) options.onTrackEnded?.();
    }, 0);
  }

  return {
    outgoingTrack,
    level,
    trackSettings: callTrack.getSettings(),
    setLive: (fromTime) => sendNode.port.postMessage({ cmd: 'live', fromTime }, []),
    mute: () => sendNode.port.postMessage({ cmd: 'mute' }, []),
    takeWakePort: () => channel.port2,
    stop: () => {
      if (stopped) return;
      stopped = true;
      sendNode.port.postMessage({ cmd: 'clear' }, []);
      sendNode.port.postMessage({ cmd: 'stop' }, []);
      captureNode.port.postMessage({ stop: true }, []);
      for (const node of [callSource, sendNode, destination, wakeSource, captureNode]) {
        try {
          node.disconnect();
        } catch {
          // already disconnected
        }
      }
      outgoingTrack?.stop();
      release();
    },
  };
}

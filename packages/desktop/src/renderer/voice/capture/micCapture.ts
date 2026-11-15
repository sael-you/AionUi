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

export type CaptureGraph = {
  /** The only track ever handed to a provider call. */
  outgoingTrack: MediaStreamTrack;
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
  onTrackEnded?: () => void;
  /** Send-worklet mode changes (mute / catch-up / live, with pre-roll lag and jumps). */
  onSendMode?: (event: SendModeEvent) => void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

/** Ask for `echoCancellation: "all"` (Chrome ≥ 141 cancels page playback too), fall back to `true`. */
export async function openMicStream(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
): Promise<MediaStream> {
  const base = { noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  try {
    return await getUserMedia({
      audio: { ...base, echoCancellation: { ideal: 'all' } as unknown as ConstrainBoolean },
      video: false,
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') throw error;
    return getUserMedia({ audio: { ...base, echoCancellation: true }, video: false });
  }
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
  const stream = await openMicStream(gum);
  const callTrack = stream.getAudioTracks()[0];
  if (!callTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('no audio track');
  }
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

  callTrack.addEventListener('ended', () => options.onTrackEnded?.());
  const outgoingTrack = destination.stream.getAudioTracks()[0];
  let stopped = false;

  return {
    outgoingTrack,
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

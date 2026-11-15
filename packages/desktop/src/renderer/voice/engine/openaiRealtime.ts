/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `openai-realtime` engine adapter, browser side (plan §3.1, §3.6).
 *
 * The browser carries media only: mic (the send worklet's track) up, model
 * audio down. There is **no data channel** — control, captions and drafts come
 * from the backend's sideband over `/api/voice/ws`. The SDP offer goes to
 * `POST /api/voice/sessions`; the backend holds the key and answers with the
 * provider's SDP. ICE `disconnected` for more than 3 s, or `failed`, is
 * reported as a network loss (the controller hangs up and resumes later).
 */

import type { VoiceApi } from '../net/voiceApi';
import type { CreateVoiceSessionResponse, VoiceSessionMode } from '../core/types';
import type { Timers } from '../net/VoiceSocket';
import { realTimers } from '../net/VoiceSocket';

export const ICE_DISCONNECT_GRACE_MS = 3000;

export type RealtimeCall = {
  voiceSessionId: string;
  engine: string;
  model: string;
  close(): void;
};

export type RealtimeCallOptions = {
  api: VoiceApi;
  outgoingTrack: MediaStreamTrack;
  /** `<audio>` element created in the arm gesture; plays the model's audio. */
  audioElement: HTMLAudioElement;
  deviceId: string;
  focusConversationId?: string;
  resumeOf?: string;
  /** `conversation` opens a transcribe-only call bound to `focusConversationId` (C26). */
  mode?: VoiceSessionMode;
  onNetworkLost: () => void;
  createPeerConnection?: () => RTCPeerConnection;
  timers?: Timers;
};

export async function startRealtimeCall(options: RealtimeCallOptions): Promise<RealtimeCall> {
  const timers = options.timers ?? realTimers;
  const pc = (options.createPeerConnection ?? (() => new RTCPeerConnection()))();
  let closed = false;
  let graceTimer: unknown = null;

  const clearGrace = () => {
    if (graceTimer) timers.clearTimeout(graceTimer);
    graceTimer = null;
  };
  const lost = () => {
    if (closed) return;
    clearGrace();
    options.onNetworkLost();
  };

  pc.addEventListener('track', (event: RTCTrackEvent) => {
    const [stream] = event.streams;
    options.audioElement.srcObject = stream ?? new MediaStream([event.track]);
    void options.audioElement.play().catch((): undefined => undefined);
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    const state = pc.iceConnectionState;
    if (state === 'failed') lost();
    else if (state === 'disconnected') {
      if (!graceTimer) graceTimer = timers.setTimeout(lost, ICE_DISCONNECT_GRACE_MS);
    } else if (state === 'connected' || state === 'completed') clearGrace();
  });

  const close = () => {
    if (closed) return;
    closed = true;
    clearGrace();
    try {
      pc.getSenders().forEach((sender) => sender.track && sender.replaceTrack(null).catch((): undefined => undefined));
      pc.close();
    } catch {
      // already closed
    }
    options.audioElement.srcObject = null;
  };

  let answer: CreateVoiceSessionResponse | null = null;
  try {
    pc.addTrack(options.outgoingTrack, new MediaStream([options.outgoingTrack]));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    answer = await options.api.createSession({
      engine: 'openai-realtime',
      sdp_offer: offer.sdp ?? '',
      device_id: options.deviceId,
      ...(options.focusConversationId ? { focus_conversation_id: options.focusConversationId } : {}),
      ...(options.resumeOf ? { resume_of: options.resumeOf } : {}),
      ...(options.mode === 'conversation' ? { mode: 'conversation' as const } : {}),
    });
    if (!answer?.voice_session_id || !answer.sdp_answer) throw new Error('malformed session response');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp_answer });
  } catch (error) {
    close();
    // The backend admitted a call we cannot use: hang it up (best effort).
    if (answer?.voice_session_id)
      void options.api.endSession(answer.voice_session_id, 'setup_failed').catch((): undefined => undefined);
    throw error;
  }

  return { voiceSessionId: answer.voice_session_id, engine: answer.engine, model: answer.model, close };
}

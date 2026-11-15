/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure state machine of the voice controller (plan §3.6).
 *
 * Three independent axes:
 * - `mode`: the local arm lifecycle (mic + audio engine), no provider cost;
 * - `socket`: the `/api/voice/ws` control channel;
 * - `call`: the provider call, if any.
 *
 * The outgoing audio is live only while the call is `ready`, the socket is open
 * and the user has not muted — everything else means "the worklet writes
 * silence" (§3.6 step 2 and 4: mute on close, unmute only on `voice.ready`).
 */

import type { OrbState, ServerVoiceState } from './types';

export type VoiceMode = 'off' | 'arming' | 'armed' | 'frozen';
export type SocketPhase = 'closed' | 'connecting' | 'open';
export type CallPhase = 'connecting' | 'awaitingReady' | 'ready';

export type CallState = {
  phase: CallPhase;
  voiceSessionId: string | null;
  serverState: ServerVoiceState;
};

export type VoiceMachineState = {
  mode: VoiceMode;
  socket: SocketPhase;
  call: CallState | null;
  userMuted: boolean;
  /** Session to resume after a network handover (§3.6 step 5). */
  resumeOf: string | null;
};

export type VoiceEvent =
  | { type: 'arm' }
  | { type: 'armed' }
  | { type: 'armFailed' }
  | { type: 'disarm' }
  | { type: 'socketConnecting' }
  | { type: 'socketOpen' }
  | { type: 'socketClosed' }
  | { type: 'wake' }
  | { type: 'sessionCreated'; voiceSessionId: string }
  | { type: 'ready'; voiceSessionId: string }
  | { type: 'serverState'; state: ServerVoiceState }
  /** Backend lost the provider sideband (`voice.state offline`): mute until the next `voice.ready`. */
  | { type: 'callSuspended' }
  | { type: 'callEnded'; resumeOf?: string | null }
  | { type: 'resumeConsumed' }
  | { type: 'frozen' }
  | { type: 'resumed' }
  | { type: 'userMute'; muted: boolean };

export const INITIAL_VOICE_STATE: VoiceMachineState = {
  mode: 'off',
  socket: 'closed',
  call: null,
  userMuted: false,
  resumeOf: null,
};

export function reduceVoice(state: VoiceMachineState, event: VoiceEvent): VoiceMachineState {
  switch (event.type) {
    case 'arm':
      return state.mode === 'off' ? { ...INITIAL_VOICE_STATE, mode: 'arming' } : state;
    case 'armed':
      return state.mode === 'arming' ? { ...state, mode: 'armed' } : state;
    case 'armFailed':
    case 'disarm':
      return INITIAL_VOICE_STATE;
    case 'socketConnecting':
      return state.mode === 'off' ? state : { ...state, socket: 'connecting' };
    case 'socketOpen':
      return state.mode === 'off' ? state : { ...state, socket: 'open' };
    case 'socketClosed': {
      if (state.mode === 'off') return state;
      // Mute at once; the call waits for a fresh `voice.ready` after reconnect.
      const call =
        state.call && state.call.phase === 'ready' ? { ...state.call, phase: 'awaitingReady' as const } : state.call;
      return { ...state, socket: 'closed', call };
    }
    case 'wake':
      // Duplicate taps / repeated wake words while a call exists are ignored.
      if (state.mode !== 'armed' || state.call) return state;
      return { ...state, call: { phase: 'connecting', voiceSessionId: null, serverState: 'listening' } };
    case 'sessionCreated':
      if (!state.call || state.call.phase !== 'connecting') return state;
      return { ...state, call: { ...state.call, phase: 'awaitingReady', voiceSessionId: event.voiceSessionId } };
    case 'ready':
      if (!state.call || state.call.voiceSessionId !== event.voiceSessionId || state.socket !== 'open') return state;
      return {
        ...state,
        call: {
          ...state.call,
          phase: 'ready',
          serverState: state.call.serverState === 'offline' ? 'listening' : state.call.serverState,
        },
      };
    case 'callSuspended':
      if (!state.call || !state.call.voiceSessionId) return state;
      return { ...state, call: { ...state.call, phase: 'awaitingReady', serverState: 'offline' } };
    case 'serverState':
      if (!state.call) return state;
      return { ...state, call: { ...state.call, serverState: event.state } };
    case 'callEnded':
      if (state.mode === 'off') return state;
      return { ...state, call: null, userMuted: false, resumeOf: event.resumeOf ?? null };
    case 'resumeConsumed':
      return { ...state, resumeOf: null };
    case 'frozen':
      if (state.mode === 'off') return state;
      return { ...state, mode: 'frozen', call: null };
    case 'resumed':
      return state.mode === 'frozen' ? { ...state, mode: 'armed' } : state;
    case 'userMute':
      return state.call ? { ...state, userMuted: event.muted } : state;
    default:
      return state;
  }
}

/** Outgoing audio may flow only when every gate is open. */
export function isOutgoingLive(state: VoiceMachineState): boolean {
  return state.mode === 'armed' && state.socket === 'open' && state.call?.phase === 'ready' && !state.userMuted;
}

/** True when a transition closes the outgoing gate (the worklet must write silence now). */
export function decideNextMute(prev: VoiceMachineState, next: VoiceMachineState): boolean {
  return isOutgoingLive(prev) && !isOutgoingLive(next);
}

export function orbStateOf(state: VoiceMachineState): OrbState {
  if (state.mode === 'off') return 'off';
  if (state.mode === 'arming') return 'arming';
  if (state.mode === 'frozen') return 'frozen';
  if (state.socket !== 'open' && (state.call || state.socket === 'closed')) return 'offline';
  if (!state.call) return 'armed';
  if (state.call.serverState === 'offline') return 'offline';
  if (state.call.phase !== 'ready') return 'connecting';
  const s = state.call.serverState;
  return s === 'armed' ? 'listening' : s;
}

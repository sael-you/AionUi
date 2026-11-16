/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Voice mode ("Jarvis") wire and view types.
 *
 * Frame names and fields follow the `/api/voice/ws` table in the C9 plan
 * (§3.9, `domain.camelCaseAction`). REST bodies use AionCore's snake_case.
 */

export type VoiceEngineId = 'openai-realtime' | 'openai-relay' | 'minimax-cascade';

/**
 * `jarvis`: the C9 dispatcher (orb, Alt+J). `conversation` (C26): the call only transcribes; your
 * words go into the focused conversation and its own agent answers and speaks.
 */
export type VoiceSessionMode = 'jarvis' | 'conversation';

/** States the backend reports in `voice.state`. */
export type ServerVoiceState = 'armed' | 'listening' | 'thinking' | 'speaking' | 'offline';

/** What the orb shows; derived from the controller state (see stateMachine.ts). */
export type OrbState =
  | 'off'
  | 'arming'
  | 'armed'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'offline'
  | 'frozen';

export type DraftState =
  | 'drafted'
  | 'ambiguous'
  | 'pending_transcript'
  | 'confirmed'
  | 'committing'
  | 'sending'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'saved_not_started'
  | 'cancelled'
  | 'expired'
  | 'interrupted'
  | 'superseded';

export const TERMINAL_DRAFT_STATES: ReadonlySet<DraftState> = new Set([
  'sent',
  'failed',
  'saved_not_started',
  'cancelled',
  'expired',
  'interrupted',
  'superseded',
]);

/** Draft states in which a tap on Send is still meaningful. */
export const CONFIRMABLE_DRAFT_STATES: ReadonlySet<DraftState> = new Set(['drafted', 'pending_transcript']);

/** Draft states in which Cancel still wins (cancel wins from any state before `sending`). */
export const CANCELLABLE_DRAFT_STATES: ReadonlySet<DraftState> = new Set([
  'drafted',
  'ambiguous',
  'pending_transcript',
  'confirmed',
  'committing',
  'queued',
]);

/** How a confirmed draft reaches its target (plan §1 "Read-back", §3.3.6). */
export type DraftDelivery = 'new_turn' | 'steer' | 'queue_busy' | 'queue_approval' | 'new_conversation';

/** One transform-by-transform segment of the draft diff against the transcript. */
export type DraftDiffSegment = {
  op: 'equal' | 'insert' | 'delete';
  text: string;
  /** Which allowed transform produced the change (§3.3.2 a–c). */
  transform?: 'filler' | 'reference' | 'reorder';
};

export type DraftTarget = {
  id: string;
  name: string;
  kind?: 'conversation' | 'project' | 'card';
};

export type VoiceDraft = {
  draftId: string;
  version: number;
  state: DraftState;
  target: DraftTarget | null;
  text: string;
  diff: DraftDiffSegment[];
  delivery: DraftDelivery | null;
  /** Payload hash the confirm/cancel taps must echo (§3.3.4 "draft version hash"). */
  hash: string | null;
  /** While `committing`: time left in the 4 s hold, as reported by the backend (ms). */
  holdRemainingMs?: number;
  /** While `committing`: the hold deadline is frozen by a new utterance (§3.3.5). */
  holdFrozen?: boolean;
  /** Choices Jarvis asks about while the draft is `ambiguous` ("A or B?"). */
  options: DraftTarget[];
  /** Spoken "send" is accepted (the read-back passed the name check); otherwise only a tap confirms. */
  spokenConfirm: boolean;
};

export type CaptionRole = 'user' | 'assistant' | 'agent';

export type VoiceCaption = {
  id: number;
  role: CaptionRole;
  text: string;
  final: boolean;
};

/**
 * `voice.followUp` statuses: conversation follow-ups (`finished`, `failed`, `needs_approval`),
 * agent lines (`says`, `asks`), draft outcomes (`sent`, `queued`, `failed`, `saved_not_started`,
 * `expired`, `interrupted`) and a refused spoken confirmation (`confirm_rejected`).
 */
export type FollowUpStatus =
  | 'finished'
  | 'failed'
  | 'needs_approval'
  | 'says'
  | 'asks'
  | 'sent'
  | 'queued'
  | 'saved_not_started'
  | 'expired'
  | 'interrupted'
  | 'confirm_rejected'
  /** Conversation mode: your words joined the running turn. */
  | 'added'
  /** Conversation mode: the running turn was cancelled ("stop the task"). */
  | 'stopped'
  /** Conversation mode: a bare "stop" silenced the agent's speech only. */
  | 'silenced';

export type VoiceFollowUp = {
  id: number;
  conversationId: string;
  status: FollowUpStatus;
  line: string;
  clipId: string | null;
  at: number;
};

export type VoiceBudget = {
  usedUsd: number;
  limitUsd: number;
  /** `80` at the 80 % warning, `100` once the daily cap is reached. */
  warning: '80' | '100' | null;
};

// ---------------------------------------------------------------------------
// Server → client frames
// ---------------------------------------------------------------------------

export type ServerFrame =
  | { name: 'voice.ready'; voiceSessionId: string; engine: string; model: string }
  | { name: 'voice.state'; voiceSessionId: string | null; state: ServerVoiceState; reason: string | null }
  | { name: 'voice.caption'; voiceSessionId: string | null; role: CaptionRole; text: string; final: boolean }
  | ({ name: 'voice.draftUpdated'; voiceSessionId: string | null } & VoiceDraft)
  | {
      name: 'voice.readbackReady';
      voiceSessionId: string | null;
      draftId: string;
      version: number;
      readbackId: string;
      url: string;
    }
  | { name: 'voice.assistantAudioFinished'; voiceSessionId: string | null; responseId: string }
  | { name: 'voice.callEnded'; voiceSessionId: string | null; reason: string }
  /** No live call: `reason` = `follow_up` | `says` | `asks`; `itemId` = the clip id to play. */
  | { name: 'voice.wake'; voiceSessionId: string | null; reason: string; itemId: string | null }
  | {
      name: 'voice.followUp';
      voiceSessionId: string | null;
      conversationId: string;
      status: FollowUpStatus;
      line: string;
      clipId: string | null;
    }
  | ({ name: 'voice.budget'; voiceSessionId: string | null } & VoiceBudget)
  | { name: 'voice.error'; voiceSessionId: string | null; code: string; message: string };

export type ServerFrameName = ServerFrame['name'];

// ---------------------------------------------------------------------------
// Client → server frames
// ---------------------------------------------------------------------------

export type DeviceInfo = { id: string; kind: 'browser'; label: string };

export type ClientCapabilities = {
  wakeWord: boolean;
  webrtc: boolean;
  clips: boolean;
  mediaSession: boolean;
};

export type ClientFrame =
  /** `device` is the device id string (the backend logs it; REST `device_id` carries the same id). */
  | { name: 'voice.hello'; voiceSessionId?: string; device: string; capabilities: ClientCapabilities }
  | { name: 'voice.heartbeat'; t: number }
  | { name: 'voice.frozen' }
  | { name: 'voice.resumed' }
  | { name: 'voice.playbackFinished'; readbackId: string; tEnd: number }
  | { name: 'voice.speechOnset'; t: number }
  | { name: 'voice.confirmTap'; draftId: string; version: number; hash: string }
  | { name: 'voice.cancelTap'; draftId: string; version: number; hash: string }
  /** Conversation mode "Done": end the utterance now. */
  | { name: 'voice.commit' };

// ---------------------------------------------------------------------------
// REST (snake_case, AionCore convention)
// ---------------------------------------------------------------------------

export type CreateVoiceSessionRequest = {
  engine: VoiceEngineId;
  sdp_offer: string;
  device_id: string;
  focus_conversation_id?: string;
  resume_of?: string;
  /** Omitted for Jarvis (older backends reject unknown fields). */
  mode?: VoiceSessionMode;
};

export type CreateVoiceSessionResponse = {
  voice_session_id: string;
  sdp_answer: string;
  engine: string;
  model: string;
};

export type VoiceSettings = {
  enabled: boolean;
  engine: VoiceEngineId;
  wake_word_enabled: boolean;
  car_mode: boolean;
  daily_budget_usd: number;
  used_today_usd?: number;
  /** Server-owned call profile; read back and kept, not edited here. */
  model?: string;
  voice?: string;
  eagerness?: string;
  provider_id?: string;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  engine: 'openai-realtime',
  wake_word_enabled: true,
  car_mode: false,
  daily_budget_usd: 5,
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/api/voice/ws` frame codec.
 *
 * Envelope: the core realtime convention `{ name, data }` (same as `/ws`). The
 * decoder also accepts a flat `{ type, ...fields }` frame so a backend that
 * picks the other common shape still works. Unknown or malformed frames decode
 * to `null` and are ignored — a frame can never throw into the controller.
 */

import type {
  CaptionRole,
  ClientFrame,
  DraftDelivery,
  DraftDiffSegment,
  DraftState,
  DraftTarget,
  FollowUpStatus,
  ServerFrame,
  ServerVoiceState,
} from './types';

/** Control frame size limit (plan §3.5 "control ≤ 64 KB"). */
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

const SERVER_STATES: ReadonlySet<string> = new Set(['armed', 'listening', 'thinking', 'speaking', 'offline']);
const CAPTION_ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'agent']);
const DRAFT_STATES: ReadonlySet<string> = new Set([
  'drafted',
  'ambiguous',
  'pending_transcript',
  'confirmed',
  'committing',
  'sending',
  'queued',
  'sent',
  'failed',
  'saved_not_started',
  'cancelled',
  'expired',
  'interrupted',
  'superseded',
]);
const DELIVERIES: ReadonlySet<string> = new Set([
  'new_turn',
  'steer',
  'queue_busy',
  'queue_approval',
  'new_conversation',
]);
const FOLLOW_UP_STATUSES: ReadonlySet<string> = new Set([
  'finished',
  'failed',
  'needs_approval',
  'says',
  'asks',
  'sent',
  'queued',
  'saved_not_started',
  'expired',
  'interrupted',
  'confirm_rejected',
  'added',
  'stopped',
  'silenced',
  'turn_failed',
  'reply',
]);
/** The only follow-up status that names no conversation (`minimax-cascade` answer clips). */
const REPLY_STATUS = 'reply';
const BUDGET_WARNINGS: ReadonlySet<string> = new Set(['80', '100']);
const DIFF_OPS: Record<string, DraftDiffSegment['op']> = {
  equal: 'equal',
  keep: 'equal',
  insert: 'insert',
  add: 'insert',
  delete: 'delete',
  remove: 'delete',
};
const TRANSFORMS: ReadonlySet<string> = new Set(['filler', 'reference', 'reorder']);

const parseTarget = (v: unknown): DraftTarget | null => {
  if (typeof v === 'string') return { id: v, name: v };
  if (!isObj(v)) return null;
  const id = str(v.id);
  const name = str(v.name) ?? id;
  if (!id || !name) return null;
  const kind = str(v.kind);
  return {
    id,
    name,
    ...(kind === 'conversation' || kind === 'project' || kind === 'card' ? { kind } : {}),
  };
};

const parseTargets = (v: unknown): DraftTarget[] =>
  Array.isArray(v) ? v.map(parseTarget).filter((t): t is DraftTarget => t !== null) : [];

const parseDiff = (v: unknown): DraftDiffSegment[] => {
  if (!Array.isArray(v)) return [];
  const out: DraftDiffSegment[] = [];
  for (const seg of v) {
    if (!isObj(seg)) continue;
    const op = DIFF_OPS[str(pick(seg, 'op', 'kind')) ?? ''];
    const text = str(seg.text);
    if (!op || text === null) continue;
    const transform = str(seg.transform);
    out.push({
      op,
      text,
      ...(transform && TRANSFORMS.has(transform) ? { transform: transform as DraftDiffSegment['transform'] } : {}),
    });
  }
  return out;
};

/** Split a raw frame into its name and field object, accepting both envelopes. */
const unwrap = (raw: unknown): { name: string; data: Obj } | null => {
  if (!isObj(raw)) return null;
  const name = str(raw.name) ?? str(raw.type);
  if (!name || !name.startsWith('voice.')) return null;
  const data = isObj(raw.data) ? raw.data : raw;
  return { name, data };
};

/** Decode one server frame. Returns null for anything unknown, oversized or malformed. */
export function decodeFrame(text: unknown): ServerFrame | null {
  if (typeof text !== 'string' || text.length > MAX_CONTROL_FRAME_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const env = unwrap(parsed);
  if (!env) return null;
  const d = env.data;
  const voiceSessionId = str(pick(d, 'voiceSessionId', 'voice_session_id'));

  switch (env.name) {
    case 'voice.ready': {
      if (!voiceSessionId) return null;
      return { name: env.name, voiceSessionId, engine: str(d.engine) ?? '', model: str(d.model) ?? '' };
    }
    case 'voice.state': {
      const state = str(d.state);
      if (!state || !SERVER_STATES.has(state)) return null;
      return { name: env.name, voiceSessionId, state: state as ServerVoiceState, reason: str(d.reason) };
    }
    case 'voice.caption': {
      const role = str(d.role);
      const textValue = str(d.text);
      if (!role || !CAPTION_ROLES.has(role) || textValue === null) return null;
      return { name: env.name, voiceSessionId, role: role as CaptionRole, text: textValue, final: d.final === true };
    }
    case 'voice.draftUpdated': {
      const draftId = str(d.draftId);
      const version = num(d.version);
      const state = str(d.state);
      if (!draftId || version === null || !state || !DRAFT_STATES.has(state)) return null;
      const delivery = str(d.delivery);
      return {
        name: env.name,
        voiceSessionId,
        draftId,
        version,
        state: state as DraftState,
        target: parseTarget(d.target),
        text: str(d.text) ?? '',
        diff: parseDiff(d.diff),
        delivery: delivery && DELIVERIES.has(delivery) ? (delivery as DraftDelivery) : null,
        hash: str(d.hash),
        ...(num(d.holdRemainingMs) !== null ? { holdRemainingMs: Math.max(0, num(d.holdRemainingMs) as number) } : {}),
        ...(typeof d.holdFrozen === 'boolean' ? { holdFrozen: d.holdFrozen } : {}),
        options: parseTargets(d.options),
        spokenConfirm: d.spokenConfirm === true,
      };
    }
    case 'voice.readbackReady': {
      const draftId = str(d.draftId);
      const version = num(d.version);
      const readbackId = str(d.readbackId);
      if (!draftId || version === null || !readbackId) return null;
      return { name: env.name, voiceSessionId, draftId, version, readbackId, url: str(d.url) ?? '' };
    }
    case 'voice.assistantAudioFinished': {
      return { name: env.name, voiceSessionId, responseId: str(d.responseId) ?? '' };
    }
    case 'voice.callEnded': {
      return { name: env.name, voiceSessionId, reason: str(d.reason) ?? '' };
    }
    case 'voice.wake': {
      return { name: env.name, voiceSessionId, reason: str(d.reason) ?? '', itemId: str(d.itemId) };
    }
    case 'voice.followUp': {
      const conversationId = str(d.conversationId);
      const status = str(d.status);
      if (!status || !FOLLOW_UP_STATUSES.has(status)) return null;
      if (!conversationId && status !== REPLY_STATUS) return null;
      return {
        name: env.name,
        voiceSessionId,
        conversationId: conversationId ?? '',
        status: status as FollowUpStatus,
        line: str(d.line) ?? '',
        clipId: str(d.clipId),
      };
    }
    case 'voice.budget': {
      const usedUsd = num(d.usedUsd);
      const limitUsd = num(d.limitUsd);
      if (usedUsd === null || limitUsd === null) return null;
      const warning = str(d.warning) ?? (typeof d.warning === 'number' ? String(d.warning) : null);
      return {
        name: env.name,
        voiceSessionId,
        usedUsd,
        limitUsd,
        warning: warning && BUDGET_WARNINGS.has(warning) ? (warning as '80' | '100') : null,
      };
    }
    case 'voice.error': {
      return { name: env.name, voiceSessionId, code: str(d.code) ?? 'unknown', message: str(d.message) ?? '' };
    }
    default:
      return null;
  }
}

/**
 * Encode a client frame as `{ name, data }`. Every frame after `voice.ready`
 * carries the bound `voiceSessionId` (plan §3.5 "frames" row).
 */
export function encodeFrame(frame: ClientFrame, voiceSessionId: string | null): string {
  const { name, ...fields } = frame;
  const data: Obj = { ...fields };
  if (voiceSessionId && data.voiceSessionId === undefined) data.voiceSessionId = voiceSessionId;
  return JSON.stringify({ name, data });
}

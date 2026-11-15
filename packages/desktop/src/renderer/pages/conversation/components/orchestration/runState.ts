/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One status language for orchestration (C21): the sidebar tree, the
 * delegated-work card and the header pill all speak these states. `idle` has
 * no glyph (the tree shows the agent mark instead).
 */
export type RunState = 'waiting' | 'failed' | 'running' | 'done' | 'queued' | 'stopped' | 'idle';

/** Most urgent first: the roll-up of a parent is the first state any descendant has. */
export const RUN_STATE_PRIORITY: readonly RunState[] = [
  'waiting',
  'failed',
  'running',
  'done',
  'queued',
  'stopped',
  'idle',
];

const RANK = new Map<RunState, number>(RUN_STATE_PRIORITY.map((state, index) => [state, index]));

/** The more urgent of two states. */
export const moreUrgent = (a: RunState, b: RunState): RunState => ((RANK.get(a) ?? 99) <= (RANK.get(b) ?? 99) ? a : b);

/** The most urgent state of a list (`idle` for an empty list). */
export const worstRunState = (states: Iterable<RunState>): RunState => {
  let worst: RunState = 'idle';
  for (const state of states) worst = moreUrgent(worst, state);
  return worst;
};

export type RunStateCounts = Record<RunState, number>;

export const emptyRunStateCounts = (): RunStateCounts => ({
  waiting: 0,
  failed: 0,
  running: 0,
  done: 0,
  queued: 0,
  stopped: 0,
  idle: 0,
});

/** i18n key of a state's word (`conversation.orchestration.state.*`). */
export const runStateLabelKey = (state: RunState): string => `conversation.orchestration.state.${state}`;

/** How a conversation's last turn ended (`extra.last_outcome`, AionCore C21). */
export type LastOutcome = 'finished' | 'error' | 'cancelled';

export const readLastOutcome = (extra: unknown): LastOutcome | undefined => {
  const value = (extra as { last_outcome?: unknown } | undefined)?.last_outcome;
  return value === 'finished' || value === 'error' || value === 'cancelled' ? value : undefined;
};

export type ConversationRunInputs = {
  waiting: boolean;
  generating: boolean;
  /** Background work (subagents, background tasks) still alive after the turn. */
  backgroundActive: boolean;
  /** Finished and not yet opened (cleared when the conversation is opened). */
  doneUnread: boolean;
  /** DB status `pending`: created, no turn yet. */
  notStarted: boolean;
  lastOutcome?: LastOutcome;
};

/**
 * A conversation's state in the sidebar. Waiting beats running (a paused turn
 * still streams frames); a failed last turn stays visible until a new turn
 * starts; done shows only until the conversation is opened.
 */
export const conversationRunState = (input: ConversationRunInputs): RunState => {
  if (input.waiting) return 'waiting';
  if (input.generating || input.backgroundActive) return 'running';
  if (input.lastOutcome === 'error') return 'failed';
  if (input.doneUnread) return 'done';
  if (input.notStarted) return 'queued';
  return 'idle';
};

/** A delegated run's state from a conversation-style status word, for the card. */
export const toolStatusRunState = (status: string | undefined): RunState => {
  switch (status) {
    case 'running':
    case 'pending':
      return 'running';
    case 'error':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'stopped';
    case 'completed':
      return 'done';
    default:
      return 'done';
  }
};

/**
 * Compact duration: "9s", "12m" (or "2m 06s" with `seconds`), "2h 05m".
 * Units come from i18n (`common.unit.*_short`).
 */
export const formatRunDuration = (
  ms: number,
  units: { s: string; m: string; h: string },
  options: { seconds?: boolean } = {}
): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}${units.s}`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return options.seconds
      ? `${minutes}${units.m} ${String(seconds).padStart(2, '0')}${units.s}`
      : `${minutes}${units.m}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}${units.h} ${String(minutes % 60).padStart(2, '0')}${units.m}`;
};

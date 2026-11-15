/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageToolCall, IToolTaskInfo } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

import {
  emptyRunStateCounts,
  readLastOutcome,
  toolStatusRunState,
  type RunState,
  type RunStateCounts,
} from '../runState';

/** The three groups of the delegated-work card, in display order. */
export type DelegatedKind = 'conversation' | 'subagent' | 'background';

export type DelegatedRow = {
  key: string;
  kind: DelegatedKind;
  name: string;
  state: RunState;
  /** Nesting below the conversation's direct children (conversations only). */
  depth: number;
  startedAt?: number;
  endedAt?: number;
  /** Conversation rows: the child conversation. */
  conversation?: TChatConversation;
  /** Task rows: the launching call (its own steps are `parent_call_id` children). */
  callId?: string;
  task?: IToolTaskInfo;
  /** Background task: the command it runs. */
  command?: string;
  /** Background task: the launching call's output. */
  output?: string;
};

export type ConversationLiveState = {
  waiting: (conversationId: string) => boolean;
  running: (conversationId: string) => boolean;
};

/**
 * A child conversation's state as a run record: unlike the sidebar, a
 * finished child stays "done" here (the card is history, not an inbox).
 */
export const childRunState = (conversation: TChatConversation, live: ConversationLiveState): RunState => {
  if (live.waiting(conversation.id)) return 'waiting';
  if (live.running(conversation.id)) return 'running';
  const outcome = readLastOutcome(conversation.extra);
  if (outcome === 'error') return 'failed';
  if (outcome === 'cancelled') return 'stopped';
  if (outcome === 'finished' || conversation.status === 'finished') return 'done';
  if (conversation.status === 'pending') return 'queued';
  return 'done';
};

/**
 * Descendants of `parentId` (depth-first, children by creation time), each
 * with its depth below the parent's direct children.
 */
export const descendantConversations = (
  parentId: string,
  conversations: readonly TChatConversation[]
): Array<{ conversation: TChatConversation; depth: number }> => {
  const byParent = new Map<string, TChatConversation[]>();
  for (const conversation of conversations) {
    const parent = conversation.parent_conversation_id;
    if (!parent) continue;
    const list = byParent.get(parent);
    if (list) list.push(conversation);
    else byParent.set(parent, [conversation]);
  }
  const out: Array<{ conversation: TChatConversation; depth: number }> = [];
  const seen = new Set<string>([parentId]);
  const walk = (id: string, depth: number) => {
    const kids = (byParent.get(id) ?? []).toSorted((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
    for (const kid of kids) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      out.push({ conversation: kid, depth });
      walk(kid.id, depth + 1);
    }
  };
  walk(parentId, 0);
  return out;
};

export const conversationRows = (
  children: ReadonlyArray<{ conversation: TChatConversation; depth: number }>,
  live: ConversationLiveState
): DelegatedRow[] =>
  children.map(({ conversation, depth }) => {
    const state = childRunState(conversation, live);
    const ended =
      state === 'running' || state === 'waiting' || state === 'queued' ? undefined : conversation.modified_at;
    return {
      key: `conversation:${conversation.id}`,
      kind: 'conversation',
      name: conversation.name,
      state,
      depth,
      startedAt: state === 'queued' ? undefined : conversation.created_at,
      endedAt: ended,
      conversation,
    };
  });

/** Labels by task id, so a SendMessage card (no description) shows the subagent's name. */
export const taskLabelsById = (messages: readonly IMessageToolCall[]): Map<string, string> => {
  const labels = new Map<string, string>();
  for (const message of messages) {
    const task = message.content?.task;
    if (task?.label && !labels.has(task.id)) labels.set(task.id, task.label);
  }
  return labels;
};

const commandOf = (message: IMessageToolCall): string | undefined => {
  const command = message.content?.args?.command;
  return typeof command === 'string' ? command : undefined;
};

/**
 * Task rows (subagents, workflows, background tasks) from the launching calls'
 * progress cards. One row per task id: a SendMessage that resumes a subagent
 * updates the same row.
 */
export const taskRows = (
  messages: readonly IMessageToolCall[],
  labels: ReadonlyMap<string, string>
): DelegatedRow[] => {
  const byTask = new Map<string, DelegatedRow>();
  for (const message of messages) {
    const task = message.content?.task;
    if (!task) continue;
    const kind: DelegatedKind = task.kind === 'background' ? 'background' : 'subagent';
    const state = toolStatusRunState(message.content.status);
    const name = task.label ?? labels.get(task.id) ?? message.content.name;
    const previous = byTask.get(task.id);
    byTask.set(task.id, {
      key: `task:${task.id}`,
      kind,
      name: previous?.name && !task.label ? previous.name : name,
      state,
      depth: 0,
      startedAt: Math.min(previous?.startedAt ?? task.started_at, task.started_at),
      endedAt: state === 'running' ? undefined : (task.ended_at ?? previous?.endedAt),
      callId: message.content.call_id,
      task,
      command: commandOf(message),
      output: message.content.output,
    });
  }
  return [...byTask.values()];
};

/**
 * Task rows whose card still says "running" but are not alive were cut off —
 * e.g. by a restart, after which the CLI never settles them. Show them as
 * stopped, ended at the last thing their OWN turn recorded, instead of a timer
 * that runs forever (C21 FIXES 4 / TASK-82). `isLive` decides per row: the
 * card's turn is the one processing now, or the call reported itself alive in
 * this session. Conversation rows carry their own live state.
 */
export const settleStaleTaskRows = (
  rows: DelegatedRow[],
  options: { isLive: (row: DelegatedRow) => boolean; turnEnd: number }
): DelegatedRow[] =>
  rows.map((row) =>
    row.kind !== 'conversation' && row.state === 'running' && !options.isLive(row)
      ? { ...row, state: 'stopped', endedAt: row.endedAt ?? Math.max(options.turnEnd, row.startedAt ?? 0) }
      : row
  );

export const countRunStates = (rows: readonly DelegatedRow[]): RunStateCounts => {
  const counts = emptyRunStateCounts();
  for (const row of rows) counts[row.state] += 1;
  return counts;
};

/** The latest inner step of a subagent (`parent_call_id` = its launching call). */
export const latestInnerStep = (callId: string, messages: readonly IMessageToolCall[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index].content;
    if (content?.parent_call_id === callId) return content.description || content.name;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Header pill store: the open conversation's delegated-work counts, published
// by the message list (which owns the messages) and read by the chat header.

export type DelegatedSummary = {
  counts: RunStateCounts;
  /** DOM id of the latest delegated-work card, for "click scrolls to it". */
  latestCardId?: string;
};

const summaries = new Map<string, DelegatedSummary>();
const summaryListeners = new Set<() => void>();

export const publishDelegatedSummary = (conversationId: string, summary: DelegatedSummary | null): void => {
  const previous = summaries.get(conversationId);
  if (!summary) {
    if (!previous) return;
    summaries.delete(conversationId);
  } else {
    if (
      previous &&
      previous.latestCardId === summary.latestCardId &&
      (Object.keys(summary.counts) as RunState[]).every((state) => previous.counts[state] === summary.counts[state])
    ) {
      return;
    }
    summaries.set(conversationId, summary);
  }
  summaryListeners.forEach((listener) => listener());
};

export const subscribeDelegatedSummary = (listener: () => void): (() => void) => {
  summaryListeners.add(listener);
  return () => summaryListeners.delete(listener);
};

export const getDelegatedSummary = (conversationId: string): DelegatedSummary | undefined =>
  summaries.get(conversationId);

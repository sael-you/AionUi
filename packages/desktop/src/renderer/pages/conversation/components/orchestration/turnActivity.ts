/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageThinking } from '@/common/chat/chatLib';
import type { NormalizedToolCall, ToolMessage } from '@/common/chat/normalizeToolCall';
import { hasRunningToolMessages, normalizeToolMessages } from '@/common/chat/normalizeToolCall';

/** Thoughts shorter than this fold into "+ N short thoughts" and show no duration. */
export const SHORT_THOUGHT_MS = 2000;

/** One entry of a turn's activity, in transcript order. */
export type TurnActivityEntry =
  | { kind: 'thought'; message: IMessageThinking }
  | { kind: 'tools'; id: string; messages: ToolMessage[]; created_at: number };

export type TurnActivitySummary = {
  /** Wall time from the first entry to the answer that follows (or now while running). */
  elapsedMs: number;
  steps: number;
  thoughts: number;
  running: boolean;
  /** The step in flight while running (name / description). */
  currentStep?: string;
  /** Steps that failed. */
  failed: number;
};

const isSubagentInternal = (message: ToolMessage): boolean =>
  message.type === 'tool_call' && Boolean(message.content?.parent_call_id);

/**
 * The parent's own steps: a subagent's inner calls (`parent_call_id`) belong
 * to its transcript in the delegated-work card, not to the parent's steps.
 */
export const ownToolMessages = (messages: readonly ToolMessage[]): ToolMessage[] =>
  messages.filter((message) => !isSubagentInternal(message));

export const thoughtDurationMs = (message: IMessageThinking): number =>
  message.content.duration ?? (message.content as { duration_ms?: number }).duration_ms ?? 0;

/**
 * Summarise a run of activity entries. `endAt` is when the next answer started
 * (epoch ms); without it (the turn is still going) `now` is used.
 */
export const summarizeTurnActivity = (
  entries: readonly TurnActivityEntry[],
  options: { endAt?: number; now: number }
): TurnActivitySummary => {
  let start = Number.POSITIVE_INFINITY;
  let lastEnd = 0;
  let thoughts = 0;
  let running = false;
  let currentStep: string | undefined;
  const tools: NormalizedToolCall[] = [];
  for (const entry of entries) {
    if (entry.kind === 'thought') {
      thoughts += 1;
      const createdAt = entry.message.created_at ?? 0;
      start = Math.min(start, createdAt);
      lastEnd = Math.max(lastEnd, createdAt + thoughtDurationMs(entry.message));
      if (entry.message.content.status !== 'done') running = true;
      continue;
    }
    const own = ownToolMessages(entry.messages);
    start = Math.min(start, entry.created_at);
    for (const message of own) lastEnd = Math.max(lastEnd, message.created_at ?? 0);
    const normalized = normalizeToolMessages(own);
    tools.push(...normalized);
    // Delegated work (task cards) outlives the turn; it is tracked in the
    // delegated-work card, so it never keeps the activity line "working".
    const inTurn = own.filter((message) => !(message.type === 'tool_call' && message.content?.task));
    if (hasRunningToolMessages(inTurn)) {
      running = true;
      const live = normalizeToolMessages(inTurn)
        .toReversed()
        .find((tool) => tool.status === 'running');
      if (live) currentStep = live.description || live.name;
    }
  }
  if (!Number.isFinite(start)) start = options.endAt ?? options.now;
  const end = running ? options.now : (options.endAt ?? Math.max(lastEnd, start));
  return {
    elapsedMs: Math.max(0, end - start),
    steps: tools.length,
    thoughts,
    running,
    currentStep,
    failed: tools.filter((tool) => tool.status === 'error').length,
  };
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  conversationRunState,
  formatRunDuration,
  isOutcomeSeen,
  readLastOutcome,
  toolStatusRunState,
  worstRunState,
} from '@/renderer/pages/conversation/components/orchestration/runState';
import {
  applyBackgroundTransition,
  backgroundTransitionOf,
  runningRowsToHydrate,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { stepOfFrame } from '@/renderer/pages/conversation/components/orchestration/DelegatedWork/liveSteps';

const base = {
  waiting: false,
  generating: false,
  backgroundActive: false,
  doneUnread: false,
  notStarted: false,
};
const units = { s: 's', m: 'm', h: 'h' };

describe('one status language', () => {
  it('ranks needs you › failed › running › done › not started › stopped › idle', () => {
    expect(worstRunState(['stopped', 'done', 'queued'])).toBe('done');
    expect(worstRunState(['running', 'failed'])).toBe('failed');
    expect(worstRunState(['failed', 'waiting', 'running'])).toBe('waiting');
    expect(worstRunState([])).toBe('idle');
  });

  it('derives a sidebar row state: waiting beats running, a failed last turn stays until a new turn', () => {
    expect(conversationRunState({ ...base, waiting: true, generating: true })).toBe('waiting');
    expect(conversationRunState({ ...base, backgroundActive: true, lastOutcome: 'error' })).toBe('running');
    expect(conversationRunState({ ...base, lastOutcome: 'error', doneUnread: true })).toBe('failed');
    // FIXES 2: a failure clears once the owner opened the conversation.
    expect(conversationRunState({ ...base, lastOutcome: 'error', outcomeSeen: true })).toBe('idle');
    expect(conversationRunState({ ...base, doneUnread: true, lastOutcome: 'finished' })).toBe('done');
    expect(conversationRunState({ ...base, notStarted: true })).toBe('queued');
    // Cancelled by the user, nothing unread: quiet.
    expect(conversationRunState({ ...base, lastOutcome: 'cancelled' })).toBe('idle');
  });

  it('a failure is seen when opened after it happened, and shows again when it fails again', () => {
    expect(isOutcomeSeen({ last_outcome: 'error', last_outcome_at: 10 })).toBe(false);
    expect(isOutcomeSeen({ last_outcome: 'error', last_outcome_at: 10, last_outcome_seen_at: 20 })).toBe(true);
    expect(isOutcomeSeen({ last_outcome: 'error', last_outcome_at: 30, last_outcome_seen_at: 20 })).toBe(false);
    // Opened just now, before the list refresh carries the persisted mark.
    expect(isOutcomeSeen({ last_outcome: 'error', last_outcome_at: 30 }, 40)).toBe(true);
    // Rows from before last_outcome_at existed: any seen mark counts.
    expect(isOutcomeSeen({ last_outcome: 'error', last_outcome_seen_at: 1 })).toBe(true);
  });

  it('reads extra.last_outcome defensively', () => {
    expect(readLastOutcome({ last_outcome: 'error' })).toBe('error');
    expect(readLastOutcome({ last_outcome: 'weird' })).toBeUndefined();
    expect(readLastOutcome(undefined)).toBeUndefined();
  });

  it('maps tool statuses to run states', () => {
    expect(toolStatusRunState('running')).toBe('running');
    expect(toolStatusRunState('error')).toBe('failed');
    expect(toolStatusRunState('canceled')).toBe('stopped');
    expect(toolStatusRunState('completed')).toBe('done');
  });

  it('formats durations compactly, padding seconds when shown', () => {
    expect(formatRunDuration(9_400, units)).toBe('9s');
    expect(formatRunDuration(12 * 60_000 + 5_000, units)).toBe('12m');
    expect(formatRunDuration(2 * 60_000 + 6_000, units, { seconds: true })).toBe('2m 06s');
    expect(formatRunDuration(125 * 60_000, units)).toBe('2h 05m');
    expect(formatRunDuration(-5, units)).toBe('0s');
  });
});

describe('background work tracking (C21)', () => {
  it('only progress-card frames (with task) open or settle background work', () => {
    expect(backgroundTransitionOf({ type: 'tool_call', data: { call_id: 'c1', status: 'running' } })).toBeNull();
    expect(
      backgroundTransitionOf({
        type: 'tool_call',
        data: { call_id: 'c1', status: 'running', task: { kind: 'subagent', id: 't', started_at: 1 } },
      })
    ).toEqual({ callId: 'c1', alive: true });
    expect(
      backgroundTransitionOf({
        type: 'tool_call',
        data: { call_id: 'c1', status: 'running', task: { kind: 'subagent', id: 't', started_at: 1, ended_at: 2 } },
      })
    ).toEqual({ callId: 'c1', alive: false });
    expect(backgroundTransitionOf({ type: 'text', data: {} })).toBeNull();
  });

  it('keeps a set of live calls and lets a concrete call replace the runtime sentinel', () => {
    const a = applyBackgroundTransition(undefined, { kind: 'mark', callId: '__runtime_background__' });
    const b = applyBackgroundTransition(a, { kind: 'mark', callId: 'c1' });
    expect([...b]).toEqual(['c1']);
    const c = applyBackgroundTransition(b, { kind: 'unmark', callId: 'c1' });
    expect(c.size).toBe(0);
    expect(applyBackgroundTransition(b, { kind: 'clear' }).size).toBe(0);
    expect([...a]).toEqual(['__runtime_background__']); // input untouched
  });

  it('names a conversation’s live step from its stream', () => {
    expect(stepOfFrame({ type: 'tool_call', data: { status: 'running', description: 'cargo test -p x' } })).toBe(
      'cargo test -p x'
    );
    expect(stepOfFrame({ type: 'tool_call', data: { status: 'completed', name: 'Read' } })).toBeUndefined();
    expect(
      stepOfFrame({ type: 'acp_tool_call', data: { update: { title: 'Read a.rs', status: 'in_progress' } } })
    ).toBe('Read a.rs');
    expect(stepOfFrame({ type: 'finish' })).toBeNull();
  });
});

describe('waiting after a reload (FIXES 3)', () => {
  it('fetches the live runtime of every row the database says is mid-turn, once per running episode', () => {
    const rows = [
      { id: 'a', status: 'running' as const },
      { id: 'b', status: 'finished' as const },
      { id: 'c', status: 'running' as const },
    ];
    const first = runningRowsToHydrate(rows, new Set());
    expect(first.fetch).toEqual(['a', 'c']);
    // Already hydrated rows are not fetched again; finished ones are forgotten.
    const second = runningRowsToHydrate(rows, first.keep);
    expect(second.fetch).toEqual([]);
    const later = runningRowsToHydrate([{ id: 'a', status: 'finished' as const }], second.keep);
    expect(later.keep.size).toBe(0);
  });
});

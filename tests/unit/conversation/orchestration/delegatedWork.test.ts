/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IMessageThinking, IMessageToolCall } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import {
  childRunState,
  descendantConversations,
  latestInnerStep,
  settleStaleTaskRows,
  taskLabelsById,
  taskRows,
} from '@/renderer/pages/conversation/components/orchestration/DelegatedWork/delegatedWork';
import { placeDelegatedWork } from '@/renderer/pages/conversation/components/orchestration/DelegatedWork/placement';
import { summarizeTurnActivity } from '@/renderer/pages/conversation/components/orchestration/turnActivity';

const conv = (id: string, parent: string | undefined, created_at: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    type: 'acp',
    status: 'finished',
    created_at,
    modified_at: created_at + 1000,
    parent_conversation_id: parent,
    extra,
  }) as unknown as TChatConversation;

const call = (
  call_id: string,
  status: 'running' | 'completed' | 'error' | 'canceled',
  extra: Partial<IMessageToolCall['content']> = {},
  created_at = 0
): IMessageToolCall =>
  ({
    id: call_id,
    type: 'tool_call',
    conversation_id: 'p',
    created_at,
    content: { call_id, name: `Tool ${call_id}`, args: {}, status, ...extra },
  }) as IMessageToolCall;

const idle = { waiting: () => false, running: () => false };

describe('delegated work model', () => {
  it('keeps a finished child "done" as a run record and shows live states first', () => {
    expect(childRunState(conv('a', 'p', 1, { last_outcome: 'finished' }), idle)).toBe('done');
    expect(childRunState(conv('a', 'p', 1, { last_outcome: 'error' }), idle)).toBe('failed');
    expect(childRunState(conv('a', 'p', 1, { last_outcome: 'cancelled' }), idle)).toBe('stopped');
    expect(childRunState({ ...conv('a', 'p', 1), status: 'pending' }, idle)).toBe('queued');
    expect(childRunState(conv('a', 'p', 1, { last_outcome: 'error' }), { ...idle, waiting: () => true })).toBe(
      'waiting'
    );
  });

  it('walks descendants depth-first with their depth below the direct children', () => {
    const list = [conv('b', 'p', 20), conv('a', 'p', 10), conv('a1', 'a', 15), conv('x', 'other', 1)];
    expect(descendantConversations('p', list).map((e) => `${e.conversation.id}:${e.depth}`)).toEqual([
      'a:0',
      'a1:1',
      'b:0',
    ]);
  });

  it('builds one row per task id, named by the launch description, and a SendMessage keeps that name', () => {
    const launch = call('toolu_1', 'completed', {
      task: {
        kind: 'subagent',
        id: 'ag1',
        label: 'Build Jarvis S1a core voice crate',
        started_at: 1000,
        ended_at: 5000,
      },
    });
    const resume = call('toolu_2', 'running', {
      name: 'Message ag1',
      task: { kind: 'subagent', id: 'ag1', started_at: 9000 },
    });
    const bash = call('toolu_3', 'running', {
      args: { command: 'cargo test -p aionui-db' },
      task: { kind: 'background', id: 'b7', label: 'Run fmt, clippy and touched-crate tests', started_at: 2000 },
    });
    const labels = taskLabelsById([launch, resume, bash]);
    const rows = taskRows([launch, resume, bash], labels);
    expect(rows.map((r) => [r.kind, r.name, r.state])).toEqual([
      ['subagent', 'Build Jarvis S1a core voice crate', 'running'],
      ['background', 'Run fmt, clippy and touched-crate tests', 'running'],
    ]);
    expect(rows[0].startedAt).toBe(1000);
    expect(rows[1].command).toBe('cargo test -p aionui-db');
  });

  it('names a subagent’s live step from its inner calls', () => {
    const inner = call('toolu_in', 'running', {
      parent_call_id: 'toolu_1',
      description: 'cargo clippy -p aionui-voice',
    });
    expect(latestInnerStep('toolu_1', [call('toolu_1', 'running'), inner])).toBe('cargo clippy -p aionui-voice');
    expect(latestInnerStep('nope', [inner])).toBeUndefined();
  });
});

describe('placement: one card per turn, where the work was launched', () => {
  it('puts the card after the activity holding the first task and gathers children created in that turn', () => {
    const task = call('toolu_1', 'running', { task: { kind: 'subagent', id: 'ag1', label: 'S1a', started_at: 150 } });
    const items = [
      { kind: 'user' as const, created_at: 100, taskCalls: [] },
      { kind: 'activity' as const, created_at: 110, taskCalls: [] },
      { kind: 'other' as const, created_at: 120, taskCalls: [] },
      { kind: 'activity' as const, created_at: 130, taskCalls: [task] },
      { kind: 'user' as const, created_at: 500, taskCalls: [] },
      { kind: 'activity' as const, created_at: 510, taskCalls: [] },
    ];
    const cards = placeDelegatedWork(items, {
      conversationId: 'p',
      conversations: [conv('c15', 'p', 140), conv('c16', 'p', 520), conv('c15a', 'c15', 600)],
      live: idle,
      labels: new Map(),
    });
    expect(cards.map((c) => c.afterIndex)).toEqual([3, 5]);
    expect(cards[0].rows.map((r) => r.key)).toEqual(['conversation:c15', 'conversation:c15a', 'task:ag1']);
    expect(cards[1].rows.map((r) => r.key)).toEqual(['conversation:c16']);
  });

  it('places nothing when a turn launched nothing', () => {
    const items = [{ kind: 'user' as const, created_at: 1, taskCalls: [] }];
    expect(
      placeDelegatedWork(items, { conversationId: 'p', conversations: [], live: idle, labels: new Map() })
    ).toEqual([]);
  });
});

describe('turn activity summary', () => {
  const thought = (id: string, created_at: number, duration: number, status: 'done' | 'thinking' = 'done') =>
    ({
      id,
      type: 'thinking',
      conversation_id: 'p',
      created_at,
      content: { content: '', duration, status },
    }) as IMessageThinking;

  it('measures wall time to the answer, counts own steps and thoughts, ignores subagent-internal calls', () => {
    const summary = summarizeTurnActivity(
      [
        { kind: 'thought', message: thought('t1', 1000, 6000) },
        {
          kind: 'tools',
          id: 's',
          created_at: 8000,
          messages: [
            call('a', 'completed', {}, 8000),
            call('b', 'error', { parent_call_id: 'a' }, 9000),
            call('c', 'error', {}, 9500),
          ],
        },
      ],
      { endAt: 253_000, now: 999_999 }
    );
    expect(summary).toMatchObject({ elapsedMs: 252_000, steps: 2, thoughts: 1, running: false, failed: 1 });
  });

  it('is running (with the current step) while a step runs, but not for delegated cards', () => {
    const running = summarizeTurnActivity(
      [{ kind: 'tools', id: 's', created_at: 0, messages: [call('a', 'running', { description: 'cargo test' })] }],
      { now: 60_000 }
    );
    expect(running).toMatchObject({ running: true, currentStep: 'cargo test', elapsedMs: 60_000 });
    const delegated = summarizeTurnActivity(
      [
        {
          kind: 'tools',
          id: 's',
          created_at: 0,
          messages: [call('a', 'running', { task: { kind: 'background', id: 'b', started_at: 0 } })],
        },
      ],
      { endAt: 5000, now: 60_000 }
    );
    expect(delegated.running).toBe(false);
  });
});

describe('stale running rows after a restart (FIXES 4)', () => {
  const rows = [
    { key: 'task:a', kind: 'subagent' as const, name: 'a', state: 'running' as const, depth: 0, startedAt: 1000 },
    {
      key: 'task:b',
      kind: 'background' as const,
      name: 'b',
      state: 'done' as const,
      depth: 0,
      startedAt: 1000,
      endedAt: 2000,
    },
    {
      key: 'conversation:c',
      kind: 'conversation' as const,
      name: 'c',
      state: 'running' as const,
      depth: 0,
      startedAt: 1000,
    },
  ];

  it('shows running task rows as stopped at the last recorded time when nothing is alive', () => {
    const settled = settleStaleTaskRows(rows, { live: false, lastEnd: 9000 });
    expect(settled.map((r) => [r.key, r.state, r.endedAt])).toEqual([
      ['task:a', 'stopped', 9000],
      ['task:b', 'done', 2000],
      ['conversation:c', 'running', undefined],
    ]);
    expect(settleStaleTaskRows(rows, { live: true, lastEnd: 9000 })).toBe(rows);
  });

  it('does not keep a cut-off turn "working" forever', () => {
    const cut = summarizeTurnActivity(
      [{ kind: 'tools', id: 's', created_at: 0, messages: [call('a', 'running', {}, 1000)] }],
      { now: 1_080_000_000, live: false }
    );
    expect(cut.running).toBe(false);
    expect(cut.elapsedMs).toBe(1000);
  });
});

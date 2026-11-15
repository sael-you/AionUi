/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const bridge = vi.hoisted(() => ({
  rows: [] as unknown[],
  turnCompleted: [] as Array<(event: Record<string, unknown>) => void>,
  listChanged: [] as Array<(event: Record<string, unknown>) => void>,
  markOutcomeSeen: vi.fn(async () => ({ last_outcome_seen_at: 5000 })),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: vi.fn(async () => ({ items: bridge.rows })) },
    },
    conversation: {
      listChanged: {
        on: (listener: (event: Record<string, unknown>) => void) => {
          bridge.listChanged.push(listener);
          return () => {};
        },
      },
      responseStream: { on: () => () => {} },
      turnCompleted: {
        on: (listener: (event: Record<string, unknown>) => void) => {
          bridge.turnCompleted.push(listener);
          return () => {};
        },
      },
      confirmation: { remove: { on: () => () => {} } },
      markOutcomeSeen: { invoke: bridge.markOutcomeSeen },
    },
    application: { writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) } },
  },
}));
vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import {
  reconcileFromListRows,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

/**
 * A list row exactly as AionCore C21 returns it (`GET /api/conversations`,
 * `ConversationResponse` with `live`): core writes status "finished" at every
 * turn end and never "running", so liveness comes from `live`, not status.
 */
/** Make the store re-read the list (what a `listChanged` event does). */
const refreshList = () =>
  bridge.listChanged.forEach((listener) => listener({ action: 'updated', conversation_id: 'x' }));

const coreRow = (id: string, live?: TChatConversation['live'], extra: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    type: 'acp',
    status: 'finished',
    depth: 0,
    pinned: false,
    created_at: 1,
    modified_at: 1,
    extra,
    ...(live ? { live } : {}),
  }) as unknown as TChatConversation;

describe('TASK-81: live state from the list rows', () => {
  it('marks waiting, running and background from `live` right after a reload', () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      reconcileFromListRows([
        coreRow('waits', { is_processing: true, pending_confirmations: 1, background_active: 0 }),
        coreRow('bg', { is_processing: false, pending_confirmations: 0, background_active: 2 }),
        coreRow('quiet'),
      ]);
    });
    expect(result.current.isConversationWaitingConfirmation('waits')).toBe(true);
    expect(result.current.isConversationGenerating('waits')).toBe(true);
    expect(result.current.hasBackgroundActive('bg')).toBe(true);
    expect(result.current.isConversationGenerating('bg')).toBe(false);
    expect(result.current.isConversationWaitingConfirmation('quiet')).toBe(false);
  });

  it('applies it on the initial list load', async () => {
    bridge.rows = [coreRow('loaded-waiting', { is_processing: true, pending_confirmations: 2, background_active: 0 })];
    const { result } = renderHook(() => useConversationListSync());
    act(() => refreshList());
    await waitFor(() => expect(result.current.isConversationWaitingConfirmation('loaded-waiting')).toBe(true));
  });
});

describe('TASK-83: "seen" uses server times only', () => {
  it('records the failure’s own last_outcome_at, then the server’s last_outcome_seen_at', async () => {
    // The browser clock is far ahead of the server: it must not matter.
    vi.setSystemTime(new Date(9_999_999_999_999));
    bridge.rows = [coreRow('failed', undefined, { last_outcome: 'error', last_outcome_at: 4000 })];
    const { result } = renderHook(() => useConversationListSync());
    act(() => refreshList());
    await waitFor(() => expect(result.current.conversations.some((c) => c.id === 'failed')).toBe(true));
    act(() => {
      result.current.markOutcomeSeen('failed');
    });
    expect(result.current.outcomeSeenAt('failed')).toBe(4000);
    await waitFor(() => expect(result.current.outcomeSeenAt('failed')).toBe(5000));
    expect(bridge.markOutcomeSeen).toHaveBeenCalledWith({ conversation_id: 'failed' });
    vi.useRealTimers();
  });

  it('a failure watched live is seen up to the event’s last_outcome_at', async () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      result.current.setActiveConversation('watched');
      bridge.turnCompleted.forEach((listener) =>
        listener({
          session_id: 'watched',
          turn_id: 't',
          state: 'ai_waiting_input',
          last_outcome: 'error',
          last_outcome_at: 7000,
        })
      );
    });
    expect(result.current.outcomeSeenAt('watched')).toBe(7000);
  });
});

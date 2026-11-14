/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);

import { useBoard } from '@/renderer/components/board/hooks/useBoard';
import { useBoardLiveFeed } from '@/renderer/components/board/hooks/useBoardLiveFeed';

import {
  boardChanged,
  bridge,
  createTestI18n,
  makeCard,
  makeEvent,
  makeSnapshot,
  reconnected,
  resetBridge,
} from '../boardTestUtils';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nextProvider i18n={createTestI18n()}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
  </I18nextProvider>
);

const change = (seq: number, over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  project_id: 'p1',
  seq,
  prev_seq: seq - 1,
  event: makeEvent(seq, 'card_moved'),
  ...over,
});

beforeEach(() => resetBridge());
afterEach(() => cleanup());

describe('useBoardLiveFeed', () => {
  it('delivers only this project’s hints and resyncs on reconnect', () => {
    const onChange = vi.fn();
    const onResync = vi.fn();
    renderHook(() => useBoardLiveFeed('p1', { onChange, onResync }));

    act(() => {
      boardChanged.emit(change(1, { project_id: 'other' }));
      boardChanged.emit(change(2));
      reconnected.emit({ timestamp: 1 });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].seq).toBe(2);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing without a project and unsubscribes on unmount', () => {
    const handlers = { onChange: vi.fn(), onResync: vi.fn() };
    renderHook(() => useBoardLiveFeed(null, handlers));
    expect(boardChanged.listeners.size).toBe(0);

    const { unmount } = renderHook(() => useBoardLiveFeed('p1', handlers));
    expect(boardChanged.listeners.size).toBe(1);
    expect(reconnected.listeners.size).toBe(1);
    unmount();
    expect(boardChanged.listeners.size).toBe(0);
    expect(reconnected.listeners.size).toBe(0);
  });
});

describe('useBoard live updates', () => {
  it('applies the card carried by the next hint without refetching', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(1, 'triage', 1)], last_seq: 5 }));
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    act(() => boardChanged.emit(change(6, { card: makeCard(1, 'done', 1) })));

    await waitFor(() => expect(result.current.snapshot?.cards[0].column_key).toBe('done'));
    expect(result.current.snapshot?.last_seq).toBe(6);
    expect(bridge.get).toHaveBeenCalledTimes(1);
  });

  it('does not refetch for interleaved events of other projects (global seq)', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(1, 'triage', 1)], last_seq: 5 }));
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    act(() => {
      boardChanged.emit(change(6, { project_id: 'p2', prev_seq: 3 }));
      boardChanged.emit(change(7, { project_id: 'p2', prev_seq: 6 }));
      // p1's next event: global seq 8, its project chain continues from 5.
      boardChanged.emit(change(8, { prev_seq: 5, card: makeCard(1, 'done', 1) }));
      boardChanged.emit(change(9, { project_id: 'p3', prev_seq: 0 }));
      boardChanged.emit(change(10, { prev_seq: 8, event: makeEvent(10, 'commented') }));
    });

    await waitFor(() => expect(result.current.snapshot?.last_seq).toBe(10));
    expect(result.current.snapshot?.cards[0].column_key).toBe('done');
    expect(bridge.get).toHaveBeenCalledTimes(1);
  });

  it('refetches when a hint of this project was missed (prev_seq gap)', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ last_seq: 5 }));
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(4, 'triage', 1)], last_seq: 9 }));
    act(() => boardChanged.emit(change(9, { prev_seq: 7, card: makeCard(4, 'triage', 1) })));

    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.snapshot?.last_seq).toBe(9));
  });

  it('refetches after the realtime socket reconnects', async () => {
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    act(() => reconnected.emit({ timestamp: 2 }));

    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
  });

  it('reads a large board through the paged card list, on the first read and after a reconnect', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({ cards: [makeCard(1, 'triage', 1)], last_seq: 5, next_cards_cursor: 'c1' })
    );
    bridge.listCards
      .mockResolvedValueOnce({ items: [makeCard(2, 'triage', 2), makeCard(3, 'done', 1)], next_cursor: 'c2' })
      .mockResolvedValueOnce({ items: [makeCard(4, 'done', 2)], next_cursor: null });
    const { result } = renderHook(() => useBoard('p1'), { wrapper });

    await waitFor(() => expect(result.current.snapshot?.cards).toHaveLength(4));
    expect(bridge.listCards.mock.calls.map((call) => call[0])).toEqual([
      { project_id: 'p1', cursor: 'c1' },
      { project_id: 'p1', cursor: 'c2' },
    ]);
    expect(result.current.snapshot?.next_cards_cursor).toBeNull();

    bridge.listCards.mockResolvedValueOnce({ items: [makeCard(5, 'done', 3)], next_cursor: null });
    act(() => reconnected.emit({ timestamp: 3 }));
    await waitFor(() => expect(result.current.snapshot?.cards.map((card) => card.number)).toEqual([1, 5]));
    expect(bridge.listCards).toHaveBeenLastCalledWith({ project_id: 'p1', cursor: 'c1' });
  });

  it('pages archived cards too when the view includes them', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ cards: [], next_cards_cursor: 'a1' }));
    bridge.listCards.mockResolvedValue({ items: [makeCard(9, 'done', 1, { archived_at: 4 })], next_cursor: null });
    const { result } = renderHook(() => useBoard('p1', { includeArchived: true }), { wrapper });
    await waitFor(() => expect(result.current.snapshot?.cards).toHaveLength(1));
    expect(bridge.listCards).toHaveBeenCalledWith({ project_id: 'p1', cursor: 'a1', include_archived: true });
  });

  it('reports a project without a board as unavailable', async () => {
    const { backendError } = await import('../boardTestUtils');
    bridge.get.mockRejectedValue(backendError(409, 'board_no_project'));
    const { result } = renderHook(() => useBoard('p1'), { wrapper });

    await waitFor(() => expect(result.current.unavailable).toBe(true));
  });

  it('does not fetch without a project id', () => {
    renderHook(() => useBoard(''), { wrapper });
    expect(bridge.get).not.toHaveBeenCalled();
  });
});

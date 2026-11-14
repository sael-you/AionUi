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

  it('refetches when a hint was missed (seq gap)', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ last_seq: 5 }));
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(4, 'triage', 1)], last_seq: 9 }));
    act(() => boardChanged.emit(change(9, { card: makeCard(4, 'triage', 1) })));

    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.snapshot?.last_seq).toBe(9));
  });

  it('refetches after the realtime socket reconnects', async () => {
    const { result } = renderHook(() => useBoard('p1'), { wrapper });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());

    act(() => reconnected.emit({ timestamp: 2 }));

    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
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

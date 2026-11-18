/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextAutoCompact, ConversationContextReport } from '@/common/types/conversationContext';

type StreamFrame = { conversation_id: string; type: string; data?: unknown };
const streamListeners = new Set<(m: StreamFrame) => void>();
const turnListeners = new Set<(e: { session_id: string }) => void>();
const getContext = vi.fn<(p: { conversation_id: string }) => Promise<ConversationContextReport | null>>();
const compact = vi.fn<(p: { conversation_id: string }) => Promise<{ msg_id: string }>>();
const setAutoCompact = vi.fn<(p: { conversation_id: string; mode: string }) => Promise<ContextAutoCompact>>();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getContext: { invoke: (p: { conversation_id: string }) => getContext(p) },
      compact: { invoke: (p: { conversation_id: string }) => compact(p) },
      setAutoCompact: { invoke: (p: { conversation_id: string; mode: string }) => setAutoCompact(p) },
      responseStream: {
        on: (fn: (m: StreamFrame) => void) => {
          streamListeners.add(fn);
          return () => streamListeners.delete(fn);
        },
      },
      turnCompleted: {
        on: (fn: (e: { session_id: string }) => void) => {
          turnListeners.add(fn);
          return () => turnListeners.delete(fn);
        },
      },
    },
  },
}));

import { useContextReport } from '@/renderer/pages/conversation/explorer/context/useContextReport';

const report = (used: number, over: Partial<ConversationContextReport> = {}): ConversationContextReport => ({
  used,
  size: 1_000_000,
  percent: used / 10_000,
  model: null,
  auto_compact: { supported: true, mode: 'auto', threshold_tokens: null, until_tokens: null },
  categories: [{ id: 'messages', label_key: 'k', name: 'Messages', tokens: used, deferred: false, estimated: false }],
  items: { mcp_tools: [], memory_files: [], agents: [], skills: [] },
  cost: null,
  source: 'cli',
  updated_at: 1,
  ...over,
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

const emit = (frame: StreamFrame) => act(() => streamListeners.forEach((fn) => fn(frame)));
const backendError = (code: string) => Object.assign(new Error(code), { name: 'BackendHttpError', code, status: 409 });

vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (e: unknown) => (e as { name?: string })?.name === 'BackendHttpError',
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getContext.mockReset();
  compact.mockReset();
  setAutoCompact.mockReset();
  streamListeners.clear();
  turnListeners.clear();
});

afterEach(() => vi.useRealTimers());

describe('useContextReport', () => {
  it('fetches the report when it opens and stays idle without a conversation', async () => {
    getContext.mockResolvedValue(report(600_000));
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.report?.used).toBe(600_000));
    expect(getContext).toHaveBeenCalledWith({ conversation_id: 'c1' });

    const none = renderHook(() => useContextReport(null), { wrapper });
    expect(none.result.current.loading).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once per burst of usage frames, and only for its own conversation', async () => {
    getContext.mockResolvedValueOnce(report(100)).mockResolvedValue(report(200));
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    await waitFor(() => expect(result.current.report?.used).toBe(100));

    emit({ conversation_id: 'other', type: 'acp_context_usage' });
    emit({ conversation_id: 'c1', type: 'content' });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(getContext).toHaveBeenCalledTimes(1);

    emit({ conversation_id: 'c1', type: 'acp_context_usage' });
    emit({ conversation_id: 'c1', type: 'acp_context_usage' });
    emit({ conversation_id: 'c1', type: 'acp_context_report' });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.report?.used).toBe(200));
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it('keeps the last report when a refresh fails', async () => {
    getContext.mockResolvedValueOnce(report(100)).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    await waitFor(() => expect(result.current.report?.used).toBe(100));
    await act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.report?.used).toBe(100);
  });

  it('stays "compacting" through mid-turn usage frames until the new breakdown lands', async () => {
    getContext.mockResolvedValueOnce(report(600_000)).mockResolvedValue(report(40_000));
    compact.mockResolvedValue({ msg_id: 'm1' });
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    await waitFor(() => expect(result.current.report?.used).toBe(600_000));

    let outcome = '';
    await act(async () => {
      outcome = await result.current.compact();
    });
    expect(outcome).toBe('started');
    expect(compact).toHaveBeenCalledWith({ conversation_id: 'c1' });
    expect(result.current.compacting).toBe(true);

    emit({ conversation_id: 'c1', type: 'acp_context_usage' });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.compacting).toBe(true);

    emit({ conversation_id: 'c1', type: 'acp_context_report' });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.compacting).toBe(false));
    expect(result.current.report?.used).toBe(40_000);
  });

  it('reports a running turn and an agent without compact, and is not left busy', async () => {
    getContext.mockResolvedValue(report(100));
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    await waitFor(() => expect(result.current.report).not.toBeNull());

    compact.mockRejectedValueOnce(backendError('TURN_RUNNING'));
    let outcome = '';
    await act(async () => {
      outcome = await result.current.compact();
    });
    expect(outcome).toBe('turn_running');
    expect(result.current.compacting).toBe(false);

    compact.mockRejectedValueOnce(backendError('COMPACT_UNSUPPORTED'));
    await act(async () => {
      outcome = await result.current.compact();
    });
    expect(outcome).toBe('unsupported');

    compact.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      outcome = await result.current.compact();
    });
    expect(outcome).toBe('failed');
  });

  it('saves the threshold, shows it without a second GET and flags "next agent start"', async () => {
    getContext.mockResolvedValue(report(100));
    setAutoCompact.mockResolvedValue({ supported: true, mode: '60', threshold_tokens: 600_000, until_tokens: 599_900 });
    const { result } = renderHook(() => useContextReport('c1'), { wrapper });
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(result.current.autoCompactPending).toBe(false);

    let ok = false;
    await act(async () => {
      ok = await result.current.setAutoCompact('60');
    });
    expect(ok).toBe(true);
    expect(setAutoCompact).toHaveBeenCalledWith({ conversation_id: 'c1', mode: '60' });
    expect(result.current.report?.auto_compact.mode).toBe('60');
    expect(result.current.report?.auto_compact.until_tokens).toBe(599_900);
    expect(result.current.autoCompactPending).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);

    setAutoCompact.mockRejectedValueOnce(backendError('AUTO_COMPACT_UNSUPPORTED'));
    await act(async () => {
      ok = await result.current.setAutoCompact('70');
    });
    expect(ok).toBe(false);
    expect(result.current.report?.auto_compact.mode).toBe('60');
  });
});

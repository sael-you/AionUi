/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data of the Context panel (C41) for one conversation: the report is fetched
 * when a surface opens, and again (debounced) whenever the agent reports usage
 * or finishes a turn. A failed refresh keeps the last report on screen.
 *
 * SWR keys the report by conversation id, so the sidebar tab and the mobile
 * sheet share one request and one cache entry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { mutate as mutateGlobal } from 'swr';

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { ContextAutoCompactMode, ConversationContextReport } from '@/common/types/conversationContext';

export const contextReportKey = (conversationId: string): string => `conversation-context/${conversationId}`;

/** Re-fetch the report of a conversation from anywhere (the tab bar's refresh button). */
export const reloadConversationContext = (conversationId: string): Promise<unknown> =>
  mutateGlobal(contextReportKey(conversationId));

/** Backend error codes of `POST /compact` (both 409). */
export const COMPACT_ERROR_TURN_RUNNING = 'TURN_RUNNING';
export const COMPACT_ERROR_UNSUPPORTED = 'COMPACT_UNSUPPORTED';

/** `message.stream` frames after which the report is worth re-fetching. */
const USAGE_FRAME = 'acp_context_usage';
/** The agent's own breakdown landed (1-3 s after a turn or a compact ends). */
const REPORT_FRAME = 'acp_context_report';

/** Usage frames arrive in bursts while a turn streams; one re-fetch per burst. */
const REFRESH_DEBOUNCE_MS = 600;
/** A background compact that never reports back must not leave the button busy. */
const COMPACT_SETTLE_TIMEOUT_MS = 120_000;

export type CompactOutcome = 'started' | 'turn_running' | 'unsupported' | 'failed';

export type UseContextReportResult = {
  report: ConversationContextReport | null;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** The last request failed (the previous report, if any, stays). */
  error: boolean;
  reload: () => Promise<void>;
  compacting: boolean;
  compact: () => Promise<CompactOutcome>;
  /** The setting changed in this session: it applies at the next agent start. */
  autoCompactPending: boolean;
  savingAutoCompact: boolean;
  setAutoCompact: (mode: ContextAutoCompactMode) => Promise<boolean>;
};

export function useContextReport(conversationId: string | null | undefined): UseContextReportResult {
  const id = conversationId || null;
  const { data, error, isLoading, mutate } = useSWR(
    id ? contextReportKey(id) : null,
    () => ipcBridge.conversation.getContext.invoke({ conversation_id: id as string }),
    { revalidateOnFocus: false, keepPreviousData: false }
  );

  const [compacting, setCompacting] = useState(false);
  const [savingAutoCompact, setSavingAutoCompact] = useState(false);
  const [autoCompactPending, setAutoCompactPending] = useState(false);
  // The compact runs as a turn (202); it is over when its numbers arrive.
  const awaitingCompactRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      await mutate();
    } catch {
      // surfaced through `error`; the last report stays
    }
  }, [mutate]);

  const settleCompact = useCallback((): void => {
    awaitingCompactRef.current = false;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setCompacting(false);
  }, []);

  // Per-conversation state must not leak into the next conversation.
  useEffect(() => {
    setAutoCompactPending(false);
    setSavingAutoCompact(false);
    settleCompact();
    return settleCompact;
  }, [id, settleCompact]);

  // Live refresh: the agent's usage frame and the end of a turn.
  useEffect(() => {
    if (!id) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Mid-turn usage frames refresh the numbers but do not end a compact: only
    // the breakdown that follows it, or the end of its turn, does.
    let settles = false;
    const schedule = (endsCompact: boolean): void => {
      settles = settles || endsCompact;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const settle = settles;
        settles = false;
        void reload().then(() => {
          if (settle && awaitingCompactRef.current) settleCompact();
        });
      }, REFRESH_DEBOUNCE_MS);
    };
    const offStream = ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== id) return;
      if (message.type === USAGE_FRAME) schedule(false);
      else if (message.type === REPORT_FRAME) schedule(true);
    });
    const offTurn = ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id === id) schedule(true);
    });
    return () => {
      if (timer) clearTimeout(timer);
      offStream();
      offTurn();
    };
  }, [id, reload, settleCompact]);

  const compact = useCallback(async (): Promise<CompactOutcome> => {
    if (!id || compacting) return 'failed';
    setCompacting(true);
    try {
      await ipcBridge.conversation.compact.invoke({ conversation_id: id });
      awaitingCompactRef.current = true;
      settleTimerRef.current = setTimeout(settleCompact, COMPACT_SETTLE_TIMEOUT_MS);
      return 'started';
    } catch (e) {
      settleCompact();
      if (isBackendHttpError(e) && e.code === COMPACT_ERROR_TURN_RUNNING) return 'turn_running';
      if (isBackendHttpError(e) && e.code === COMPACT_ERROR_UNSUPPORTED) return 'unsupported';
      return 'failed';
    }
  }, [id, compacting, settleCompact]);

  const setAutoCompact = useCallback(
    async (mode: ContextAutoCompactMode): Promise<boolean> => {
      if (!id) return false;
      setSavingAutoCompact(true);
      try {
        const next = await ipcBridge.conversation.setAutoCompact.invoke({ conversation_id: id, mode });
        // The answer is the setting alone: put it into the cached report.
        await mutate((current) => (current && next ? { ...current, auto_compact: next } : current), {
          revalidate: false,
        });
        setAutoCompactPending(true);
        return true;
      } catch {
        return false;
      } finally {
        setSavingAutoCompact(false);
      }
    },
    [id, mutate]
  );

  return {
    report: data ?? null,
    loading: Boolean(id) && isLoading && !data,
    error: Boolean(error),
    reload,
    compacting,
    compact,
    autoCompactPending,
    savingAutoCompact,
    setAutoCompact,
  };
}

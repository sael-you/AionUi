/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { addEventListener } from '@/renderer/utils/emitter';
import { isOutcomeSeen, readLastOutcome } from '@/renderer/pages/conversation/components/orchestration/runState';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Whitelist of message types that indicate content generation is in progress.
 * Only these types should trigger the sidebar loading spinner.
 * Using a whitelist (instead of a blacklist) prevents unknown/internal message
 * types (e.g. slash_commands_updated, acp_context_usage) from falsely
 * triggering the generating state.
 */
const isGeneratingStreamMessage = (type: string): boolean => {
  return (
    type === 'content' ||
    type === 'start' ||
    type === 'thought' ||
    type === 'thinking' ||
    type === 'tool_group' ||
    // Direct-CLI (non-ACP) sessions stream individual `tool_call` frames
    // instead of `tool_group` — measured live: 31 of 34 frames in a 55s tool
    // stretch were `tool_call`. Without this, long tool runs on direct-CLI
    // backends can leave the sidebar spinner dark for the whole stretch.
    type === 'tool_call' ||
    type === 'acp_tool_call' ||
    type === 'acp_permission' ||
    type === 'permission' ||
    type === 'plan'
  );
};

const isTerminalAgentStatus = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const { status } = data as { status?: string };
  return status === 'error' || status === 'disconnected';
};

const isTerminalStreamMessage = (message: { type: string; data: unknown }): boolean => {
  return (
    message.type === 'finish' ||
    message.type === 'error' ||
    (message.type === 'agent_status' && isTerminalAgentStatus(message.data))
  );
};

const isTerminalTurnState = (state: string): boolean => {
  return state === 'ai_waiting_input' || state === 'error' || state === 'stopped';
};

export type SidebarStreamGuardDecision = {
  markGenerating: boolean;
  clearCompleted: boolean;
  lateIgnored: boolean;
};

export const getSidebarStreamGuardDecision = ({
  type,
  completed,
  completedTurnId,
  streamTurnId,
}: {
  type: string;
  completed: boolean;
  /** Turn whose completion set the `completed` flag, when known. */
  completedTurnId?: string | null;
  /** Turn the incoming stream frame belongs to, when known. */
  streamTurnId?: string | null;
}): SidebarStreamGuardDecision => {
  if (!isGeneratingStreamMessage(type)) {
    return {
      markGenerating: false,
      clearCompleted: false,
      lateIgnored: false,
    };
  }

  if (type === 'start') {
    return {
      markGenerating: true,
      clearCompleted: true,
      lateIgnored: false,
    };
  }

  if (completed) {
    // A frame from a DIFFERENT turn than the one that completed is not late —
    // it belongs to a newer turn. codex keeps streaming after ending its
    // prompt turn (unified exec runs the command in a background PTY), so the
    // old turn's completion used to swallow the next turn's whole stream and
    // the sidebar never lit up as generating.
    const isNewerTurn =
      typeof streamTurnId === 'string' &&
      streamTurnId.length > 0 &&
      typeof completedTurnId === 'string' &&
      completedTurnId.length > 0 &&
      streamTurnId !== completedTurnId;
    if (!isNewerTurn) {
      return {
        markGenerating: false,
        clearCompleted: false,
        lateIgnored: true,
      };
    }
    return {
      markGenerating: true,
      clearCompleted: true,
      lateIgnored: false,
    };
  }

  return {
    markGenerating: true,
    clearCompleted: false,
    lateIgnored: false,
  };
};

/**
 * Stream `type` values that represent the agent blocking on the user: a tool
 * permission request (`permission` / `acp_permission`) or a structured question
 * (`ask`). These pause the turn until the user answers, so the sidebar shows a
 * distinct "needs you" icon instead of the generic generating spinner.
 */
export const isWaitingConfirmationStreamMessage = (type: string): boolean => {
  return type === 'permission' || type === 'acp_permission' || type === 'ask';
};

/**
 * Extract the confirmation id from a waiting-confirmation stream frame, aligned
 * with the `id` the backend later carries on the `confirmation.remove` event so
 * the waiting state clears against the right pending request:
 *  - `ask`            → `request_id`
 *  - `permission`     → `call_id` (falls back to `id`)
 *  - `acp_permission` → `tool_call.tool_call_id`
 * Returns `undefined` when the frame carries no usable id.
 */
export const extractConfirmationId = (message: { type?: string; data?: unknown }): string | undefined => {
  const data = message?.data;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const record = data as Record<string, unknown>;

  if (message.type === 'ask') {
    return typeof record.request_id === 'string' && record.request_id ? record.request_id : undefined;
  }
  if (message.type === 'permission') {
    if (typeof record.call_id === 'string' && record.call_id) {
      return record.call_id;
    }
    return typeof record.id === 'string' && record.id ? record.id : undefined;
  }
  if (message.type === 'acp_permission') {
    const toolCall = record.tool_call;
    if (toolCall && typeof toolCall === 'object') {
      const id = (toolCall as Record<string, unknown>).tool_call_id;
      return typeof id === 'string' && id ? id : undefined;
    }
    return undefined;
  }
  return undefined;
};

/**
 * Sentinel id standing in for a runtime-reconciled pending confirmation whose
 * concrete id is unknown (the runtime summary only reports a count). Any
 * concrete `confirmation.remove` invalidates this coarse guess (see
 * `applyWaitingConfirmationTransition`).
 */
export const RUNTIME_PENDING_CONFIRMATION_ID = '__runtime_pending__';

export type WaitingConfirmationTransition =
  | { kind: 'mark'; confirmationId: string }
  | { kind: 'unmark'; confirmationId: string }
  | { kind: 'clear' };

/**
 * Pure reducer over one conversation's pending-confirmation-id set. A non-empty
 * set means the conversation is waiting on the user. `unmark` drops the given id
 * AND the runtime sentinel — a concrete resolution invalidates the coarse
 * runtime-derived guess. Never mutates the input.
 */
export const applyWaitingConfirmationTransition = (
  current: ReadonlySet<string>,
  transition: WaitingConfirmationTransition
): Set<string> => {
  if (transition.kind === 'clear') {
    return new Set();
  }
  const next = new Set(current);
  if (transition.kind === 'mark') {
    next.add(transition.confirmationId);
    return next;
  }
  next.delete(transition.confirmationId);
  next.delete(RUNTIME_PENDING_CONFIRMATION_ID);
  return next;
};

/**
 * Pure decision helper mirroring `shouldReconcileMarkGenerating`: a runtime
 * summary lights the sidebar "waiting" icon only when it reports pending
 * confirmations. Clearing is never done via reconcile.
 */
export const shouldReconcileMarkWaiting = (pendingConfirmations: number): boolean => pendingConfirmations > 0;

type ConversationListSyncSnapshot = {
  conversations: TChatConversation[];
  generatingConversationIds: Set<string>;
  waitingConfirmationConversationIds: Set<string>;
  completionUnreadConversationIds: Set<string>;
  manualUnreadConversationIds: Set<string>;
  backgroundActiveConversationIds: Set<string>;
  backgroundCallIdsByConversation: Map<string, Set<string>>;
  outcomeSeenAtById: Map<string, number>;
};

/**
 * Renderer-local, persisted manual "mark as unread" set. Unlike the transient
 * completion-unread set (session-only, auto-cleared on open), this survives app
 * restarts so a user can deliberately flag a conversation to return to later.
 * Stored in localStorage, matching the existing collapsed-sections / workspace
 * expansion / team-pinned persistence pattern.
 */
const MANUAL_UNREAD_STORAGE_KEY = 'conversation-manual-unread-ids';

const readStoredManualUnread = (): Set<string> => {
  try {
    const raw = localStorage.getItem(MANUAL_UNREAD_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

const persistManualUnread = () => {
  try {
    localStorage.setItem(MANUAL_UNREAD_STORAGE_KEY, JSON.stringify([...manualUnreadConversationIdsState]));
  } catch {
    // ignore
  }
};

const listeners = new Set<() => void>();

let isStoreInitialized = false;
let conversationsState: TChatConversation[] = [];
let generatingConversationIdsState = new Set<string>();
// Per-conversation set of pending confirmation ids (permission / acp_permission
// / ask). A conversation with a non-empty set is "waiting on the user" and gets
// the distinct sidebar icon. Kept separate from the derived id set below so
// multiple concurrent confirmations clear correctly one at a time.
let waitingConfirmationIdsByConversationState = new Map<string, Set<string>>();
let waitingConfirmationConversationIdsState = new Set<string>();
let completionUnreadConversationIdsState = new Set<string>();
let manualUnreadConversationIdsState = readStoredManualUnread();
let completedConversationIdsState = new Set<string>();
// Background work (subagents, background tasks, workflows) still alive per
// conversation, keyed by the launching call id (C21). A conversation with a
// non-empty set stays "running" after its turn ended.
let backgroundCallIdsByConversationState = new Map<string, Set<string>>();
let backgroundActiveConversationIdsState = new Set<string>();
// Opens recorded locally (C21), so a failed row clears the moment it is opened,
// before the list refresh brings back extra.last_outcome_seen_at.
let outcomeSeenAtByIdState = new Map<string, number>();
let conversation_idsState = new Set<string>();
// Full id → owning project_id map over ALL loaded conversations (incl. the team
// member rows filtered out of `conversationsState`). Every row from
// GET /api/conversations carries project_id, so this lets the route publish the
// active project synchronously on switch — no waiting for the per-conversation
// `conversation.get` to resolve (that async lag painted the previous project's
// tree). `null` = known conversation with no project (or project_id not yet
// backfilled); a missing key = not loaded yet (caller placeholders).
let projectIdByIdState = new Map<string, string | null>();
// Every row (unfiltered) by id, for synchronous lookups of other fields on a
// route switch (e.g. the project workspace for the project colour identity).
let conversationByIdState = new Map<string, TChatConversation>();
let activeConversationIdState: string | null = null;
let snapshotState: ConversationListSyncSnapshot = {
  conversations: conversationsState,
  generatingConversationIds: generatingConversationIdsState,
  waitingConfirmationConversationIds: waitingConfirmationConversationIdsState,
  completionUnreadConversationIds: completionUnreadConversationIdsState,
  manualUnreadConversationIds: manualUnreadConversationIdsState,
  backgroundActiveConversationIds: backgroundActiveConversationIdsState,
  backgroundCallIdsByConversation: backgroundCallIdsByConversationState,
  outcomeSeenAtById: outcomeSeenAtByIdState,
};

const emitStoreChange = () => {
  snapshotState = {
    conversations: conversationsState,
    generatingConversationIds: generatingConversationIdsState,
    waitingConfirmationConversationIds: waitingConfirmationConversationIdsState,
    completionUnreadConversationIds: completionUnreadConversationIdsState,
    manualUnreadConversationIds: manualUnreadConversationIdsState,
    backgroundActiveConversationIds: backgroundActiveConversationIdsState,
    backgroundCallIdsByConversation: backgroundCallIdsByConversationState,
    outcomeSeenAtById: outcomeSeenAtByIdState,
  };
  listeners.forEach((listener) => listener());
};

const subscribeConversationListSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getConversationListSyncSnapshot = (): ConversationListSyncSnapshot => snapshotState;

/**
 * Synchronous lookup of a conversation's owning project id from the in-memory
 * list snapshot (loaded once via GET /api/conversations, every row carrying
 * project_id). Returns the project id string, `null` when the conversation is
 * known but has no project (or its project_id has not been backfilled yet), or
 * `undefined` when the conversation is not in the snapshot yet (brand-new /
 * not-loaded — the caller should placeholder rather than paint a stale project).
 */
export const getSnapshotConversationProjectId = (conversation_id: string): string | null | undefined => {
  if (!projectIdByIdState.has(conversation_id)) return undefined;
  return projectIdByIdState.get(conversation_id) ?? null;
};

/**
 * Synchronous lookup of a conversation row from the in-memory list snapshot
 * (all rows, including team members). `undefined` when not loaded yet.
 */
export const getSnapshotConversation = (conversation_id: string): TChatConversation | undefined =>
  conversationByIdState.get(conversation_id);

/** Test hook: seed the list snapshot rows (id → row, and id → project_id). */
export const setConversationSnapshotForTest = (conversations: TChatConversation[]): void => {
  conversationByIdState = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  projectIdByIdState = new Map(conversations.map((conversation) => [conversation.id, conversation.project_id ?? null]));
};

/** Test hook: seed the id → project_id map so the sync lookup can be exercised. */
export const setConversationProjectMapForTest = (entries: Array<[string, string | null]>): void => {
  projectIdByIdState = new Map(entries);
};

/**
 * Synchronous lookup of a conversation's display name from the in-memory list
 * snapshot. Used by the turn-completed notification to name the originating
 * conversation. Returns the trimmed name, or `undefined` when the conversation
 * is not loaded yet or has no (non-empty) name — callers fall back to a generic
 * message.
 */
export const getSnapshotConversationName = (conversation_id: string): string | undefined => {
  const conversation = conversationsState.find((item) => item.id === conversation_id);
  const name = conversation?.name?.trim();
  return name ? name : undefined;
};

const refreshConversations = () => {
  void ipcBridge.database.getUserConversations
    .invoke({ limit: 10000 })
    .then((result) => {
      const items = result?.items;
      if (items && Array.isArray(items)) {
        const filteredData = items.filter((conv) => {
          // Legacy rows from the pre-provider-probe health check flow are hidden
          // from normal history. New health checks must not create conversations.
          const extra = conv.extra as { is_health_check?: boolean; team_id?: string; teamId?: string } | undefined;
          return extra?.is_health_check !== true && !extra?.team_id && !extra?.teamId;
        });
        conversationsState = filteredData;
        // Use ALL conversation IDs (including team/legacy health-check rows) so the
        // responseStream listener recognises them as known and doesn't
        // trigger an infinite refreshConversations loop.
        conversation_idsState = new Set(items.map((conversation) => conversation.id));
        // Map ALL rows (unfiltered) so a team member conversation's project_id is
        // resolvable too — the team route looks up its leader conversation here.
        projectIdByIdState = new Map(items.map((conversation) => [conversation.id, conversation.project_id ?? null]));
        conversationByIdState = new Map(items.map((conversation) => [conversation.id, conversation]));
        emitStoreChange();
        reconcileFromListRows(items);
        return;
      }

      conversationsState = [];
      conversation_idsState = new Set();
      projectIdByIdState = new Map();
      conversationByIdState = new Map();
      emitStoreChange();
    })
    .catch((error) => {
      console.error('[WorkspaceGroupedHistory] Failed to load conversations:', error);
      conversationsState = [];
      conversation_idsState = new Set();
      projectIdByIdState = new Map();
      conversationByIdState = new Map();
      emitStoreChange();
    });
};

/** Source of a generating-state transition, logged for field diagnosis. */
type GeneratingTransitionSource = 'stream' | 'reconcile' | 'terminal' | 'turnCompleted' | 'deleted';

const logGeneratingTransition = (conversation_id: string, next: boolean, source: GeneratingTransitionSource) => {
  void ipcBridge.application.writeRendererLog
    .invoke({
      level: 'info',
      tag: 'conversationListSync',
      message: next ? 'sidebar_generating_on' : 'sidebar_generating_off',
      data: {
        conversation_id,
        source,
      },
    })
    .catch(() => {});
};

const markGenerating = (conversation_id: string, source: GeneratingTransitionSource = 'stream') => {
  if (generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  generatingConversationIdsState = new Set(generatingConversationIdsState).add(conversation_id);
  logGeneratingTransition(conversation_id, true, source);
  emitStoreChange();
};

const clearGenerating = (conversation_id: string, source: GeneratingTransitionSource = 'terminal') => {
  if (!generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(generatingConversationIdsState);
  next.delete(conversation_id);
  generatingConversationIdsState = next;
  logGeneratingTransition(conversation_id, false, source);
  emitStoreChange();
};

/**
 * Pure decision helper: whether a runtime summary's `is_processing` bit
 * should light the sidebar spinner. Clearing is intentionally NOT handled
 * here (and never by this reconcile path) — an idle-looking runtime summary
 * must not fight a live background stream that's still mid-flight; only
 * terminal stream frames / turn.completed are allowed to clear the flag.
 */
export const shouldReconcileMarkGenerating = (isProcessing: boolean): boolean => isProcessing === true;

/**
 * Reconciles the sidebar spinner with authoritative runtime state (e.g. a
 * per-conversation hydrate or send-accepted response). Call this whenever a
 * runtime summary's `is_processing` bit is in hand for a conversation — it
 * covers the case where a WS stream frame was missed (window reload/reconnect
 * race) and the store would otherwise never know the turn is still running.
 */
export const reconcileGeneratingFromRuntime = (conversation_id: string, isProcessing: boolean): void => {
  if (!conversation_id) {
    return;
  }
  if (shouldReconcileMarkGenerating(isProcessing)) {
    markGenerating(conversation_id, 'reconcile');
  }
};

/**
 * Apply a waiting-confirmation transition to a single conversation and, when the
 * waiting boolean flips, refresh the derived id set and notify subscribers. The
 * icon only depends on the boolean, so intra-set churn (a second pending id
 * arriving, one of several clearing) does not emit.
 */
const applyWaitingConfirmation = (conversation_id: string, transition: WaitingConfirmationTransition) => {
  const current = waitingConfirmationIdsByConversationState.get(conversation_id) ?? new Set<string>();
  const next = applyWaitingConfirmationTransition(current, transition);
  const wasWaiting = current.size > 0;
  const isWaiting = next.size > 0;

  const nextMap = new Map(waitingConfirmationIdsByConversationState);
  if (next.size === 0) {
    nextMap.delete(conversation_id);
  } else {
    nextMap.set(conversation_id, next);
  }
  waitingConfirmationIdsByConversationState = nextMap;

  if (wasWaiting === isWaiting) {
    return;
  }

  const derived = new Set(waitingConfirmationConversationIdsState);
  if (isWaiting) {
    derived.add(conversation_id);
  } else {
    derived.delete(conversation_id);
  }
  waitingConfirmationConversationIdsState = derived;
  emitStoreChange();
};

const markWaitingConfirmation = (conversation_id: string, confirmationId: string) => {
  applyWaitingConfirmation(conversation_id, { kind: 'mark', confirmationId });
};

const clearWaitingConfirmationById = (conversation_id: string, confirmationId: string) => {
  applyWaitingConfirmation(conversation_id, { kind: 'unmark', confirmationId });
};

const clearAllWaitingConfirmation = (conversation_id: string) => {
  applyWaitingConfirmation(conversation_id, { kind: 'clear' });
};

/**
 * Reconciles the sidebar "waiting" icon with authoritative runtime state on a
 * per-conversation hydrate/send-accepted response. Mirrors
 * `reconcileGeneratingFromRuntime`: it only ever marks (using a sentinel id, as
 * the runtime summary reports a count, not ids) so a stale idle summary can't
 * fight a live stream; clearing stays with `confirmation.remove` / terminal
 * frames. Covers the window-reload case where the mark stream frame was missed.
 */
export const reconcileWaitingConfirmationFromRuntime = (
  conversation_id: string,
  pendingConfirmations: number
): void => {
  if (!conversation_id) {
    return;
  }
  if (shouldReconcileMarkWaiting(pendingConfirmations)) {
    markWaitingConfirmation(conversation_id, RUNTIME_PENDING_CONFIRMATION_ID);
  }
};

/** Sentinel for runtime-reported background work whose call ids are unknown. */
const RUNTIME_BACKGROUND_ID = '__runtime_background__';

type BackgroundTransition = { kind: 'mark'; callId: string } | { kind: 'unmark'; callId: string } | { kind: 'clear' };

/** Pure: the next set of live background call ids. Never mutates the input. */
export const applyBackgroundTransition = (
  current: ReadonlySet<string> | undefined,
  transition: BackgroundTransition
): Set<string> => {
  const next = new Set(current ?? []);
  if (transition.kind === 'clear') return new Set();
  if (transition.kind === 'mark') {
    next.delete(RUNTIME_BACKGROUND_ID);
    next.add(transition.callId);
  } else {
    next.delete(transition.callId);
    next.delete(RUNTIME_BACKGROUND_ID);
  }
  return next;
};

const applyBackground = (conversation_id: string, transition: BackgroundTransition) => {
  const current = backgroundCallIdsByConversationState.get(conversation_id);
  const next = applyBackgroundTransition(current, transition);
  const unchanged = (current?.size ?? 0) === next.size && [...next].every((id) => current?.has(id));
  // A live card ticks every second: only a real change re-renders.
  if (unchanged) return;
  const wasActive = (current?.size ?? 0) > 0;
  const isActive = next.size > 0;
  const nextMap = new Map(backgroundCallIdsByConversationState);
  if (isActive) nextMap.set(conversation_id, next);
  else nextMap.delete(conversation_id);
  backgroundCallIdsByConversationState = nextMap;
  if (wasActive !== isActive) {
    const ids = new Set(backgroundActiveConversationIdsState);
    if (isActive) ids.add(conversation_id);
    else ids.delete(conversation_id);
    backgroundActiveConversationIdsState = ids;
  }
  emitStoreChange();
};

/**
 * Whether a `tool_call` stream frame opens or settles delegated work: progress
 * cards carry `task` (AionCore C21). `null` = not a task frame.
 */
export const backgroundTransitionOf = (message: {
  type: string;
  data?: unknown;
}): { callId: string; alive: boolean } | null => {
  if (message.type !== 'tool_call') return null;
  const data = message.data as { call_id?: unknown; status?: unknown; task?: { ended_at?: unknown } } | undefined;
  if (!data?.task || typeof data.call_id !== 'string' || !data.call_id) return null;
  const alive = data.status === 'running' && data.task.ended_at == null;
  return { callId: data.call_id, alive };
};

/**
 * Reconciles background work with an authoritative runtime summary
 * (`background_active`, AionCore C21): 0 clears the conversation, a positive
 * count with nothing tracked marks it with a sentinel.
 */
export const reconcileBackgroundFromRuntime = (conversation_id: string, backgroundActive: number | undefined): void => {
  if (backgroundActive === undefined) return;
  if (backgroundActive <= 0) {
    applyBackground(conversation_id, { kind: 'clear' });
    return;
  }
  if (!backgroundCallIdsByConversationState.has(conversation_id)) {
    applyBackground(conversation_id, { kind: 'mark', callId: RUNTIME_BACKGROUND_ID });
  }
};

/**
 * Reconcile the stream store with what the list says is live (AionCore C21
 * `live` on list rows): a conversation waiting for approval, mid-turn or
 * running background work is known right after a reload, before any frame
 * arrives. Rows without `live` are left alone (frames own their state).
 */
export const reconcileFromListRows = (rows: readonly Pick<TChatConversation, 'id' | 'live'>[]): void => {
  for (const row of rows) {
    const live = row.live;
    if (!live) continue;
    reconcileGeneratingFromRuntime(row.id, live.is_processing === true);
    reconcileWaitingConfirmationFromRuntime(row.id, live.pending_confirmations ?? 0);
    reconcileBackgroundFromRuntime(row.id, live.background_active ?? 0);
  }
};

/** The row's last turn failed and the owner has not opened it since. */
const hasUnseenFailure = (conversation_id: string): boolean => {
  const row = conversationByIdState.get(conversation_id);
  return (
    readLastOutcome(row?.extra) === 'error' && !isOutcomeSeen(row?.extra, outcomeSeenAtByIdState.get(conversation_id))
  );
};

const setLocalOutcomeSeen = (conversation_id: string, seenAt: number) => {
  if ((outcomeSeenAtByIdState.get(conversation_id) ?? -1) >= seenAt) return;
  outcomeSeenAtByIdState = new Map(outcomeSeenAtByIdState).set(conversation_id, seenAt);
  emitStoreChange();
};

/**
 * The owner opened (or is watching) the conversation: persist it (AionCore C21
 * `outcome-seen`) so it stays cleared after a reload and in the parent's
 * counts, and record it locally so the failed glyph clears now. Every time is
 * the SERVER's: the failure's own `last_outcome_at` (known from the row or the
 * turn.completed event) and then the returned `last_outcome_seen_at` — never
 * the browser clock, which can be behind the server. No-op unless the last
 * turn failed and was not seen yet, or the owner `watched` it fail.
 */
const markOutcomeSeenState = (conversation_id: string, watched?: { outcomeAt?: number }) => {
  if (!watched && !hasUnseenFailure(conversation_id)) return;
  const outcomeAt = watched?.outcomeAt;
  const rowOutcomeAt = (conversationByIdState.get(conversation_id)?.extra as { last_outcome_at?: unknown } | undefined)
    ?.last_outcome_at;
  const seenUpTo = outcomeAt ?? (typeof rowOutcomeAt === 'number' ? rowOutcomeAt : undefined);
  if (seenUpTo !== undefined) setLocalOutcomeSeen(conversation_id, seenUpTo);
  void ipcBridge.conversation.markOutcomeSeen
    .invoke({ conversation_id })
    .then((response) => {
      if (typeof response?.last_outcome_seen_at === 'number') {
        setLocalOutcomeSeen(conversation_id, response.last_outcome_seen_at);
      }
    })
    .catch((error: unknown) => {
      console.warn('[sidebar] could not mark the outcome seen:', error);
    });
};

const markCompletionUnread = (conversation_id: string) => {
  if (completionUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  completionUnreadConversationIdsState = new Set(completionUnreadConversationIdsState).add(conversation_id);
  emitStoreChange();
};

const clearCompletionUnreadState = (conversation_id: string) => {
  if (!completionUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(completionUnreadConversationIdsState);
  next.delete(conversation_id);
  completionUnreadConversationIdsState = next;
  emitStoreChange();
};

const markManualUnreadState = (conversation_id: string) => {
  if (manualUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  manualUnreadConversationIdsState = new Set(manualUnreadConversationIdsState).add(conversation_id);
  persistManualUnread();
  emitStoreChange();
};

const clearManualUnreadState = (conversation_id: string) => {
  if (!manualUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(manualUnreadConversationIdsState);
  next.delete(conversation_id);
  manualUnreadConversationIdsState = next;
  persistManualUnread();
  emitStoreChange();
};

/** Turn id that put a conversation into the `completed` set (for turn-aware
 *  late-frame detection). */
const completedTurnIdByConversation = new Map<string, string | null>();

const markCompleted = (conversation_id: string, turn_id?: string | null) => {
  completedConversationIdsState = new Set(completedConversationIdsState).add(conversation_id);
  completedTurnIdByConversation.set(conversation_id, turn_id ?? null);
};

const clearCompleted = (conversation_id: string) => {
  if (!completedConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(completedConversationIdsState);
  next.delete(conversation_id);
  completedConversationIdsState = next;
  completedTurnIdByConversation.delete(conversation_id);
};

const logLateStreamIgnored = (conversation_id: string, type: string) => {
  void ipcBridge.application.writeRendererLog
    .invoke({
      level: 'warn',
      tag: 'conversationRuntimeView',
      message: 'late_stream_ignored_for_runtime',
      data: {
        conversation_id,
        stream_type: type,
      },
    })
    .catch(() => {});
};

const setActiveConversationState = (conversation_id: string | null) => {
  activeConversationIdState = conversation_id;
};

const initializeConversationListSyncStore = () => {
  if (isStoreInitialized) {
    return;
  }

  isStoreInitialized = true;
  refreshConversations();

  addEventListener('chat.history.refresh', refreshConversations);
  // Realtime frames were lost for good (TASK-43): the sidebar list and the "Needs you"
  // box derived from it missed events too, so read the list again.
  ipcBridge.realtime?.resync?.on(() => refreshConversations());
  ipcBridge.conversation.listChanged.on((event) => {
    if (event.action === 'deleted') {
      clearGenerating(event.conversation_id, 'deleted');
      clearAllWaitingConfirmation(event.conversation_id);
      clearCompletionUnreadState(event.conversation_id);
      clearManualUnreadState(event.conversation_id);
      clearCompleted(event.conversation_id);
      applyBackground(event.conversation_id, { kind: 'clear' });
    }
    refreshConversations();
  });
  ipcBridge.conversation.confirmation.remove.on((event) => {
    if (!event?.conversation_id || !event.id) {
      return;
    }
    clearWaitingConfirmationById(event.conversation_id, event.id);
  });
  ipcBridge.conversation.responseStream.on((message) => {
    const conversation_id = message.conversation_id;
    if (!conversation_id) {
      return;
    }

    if (!conversation_idsState.has(conversation_id)) {
      refreshConversations();
    }

    const background = backgroundTransitionOf(message);
    if (background) {
      applyBackground(
        conversation_id,
        background.alive ? { kind: 'mark', callId: background.callId } : { kind: 'unmark', callId: background.callId }
      );
    }

    if (isTerminalStreamMessage(message)) {
      const wasGenerating = generatingConversationIdsState.has(conversation_id);
      if (wasGenerating && activeConversationIdState !== conversation_id) {
        markCompletionUnread(conversation_id);
      }
      clearGenerating(conversation_id, 'terminal');
      clearAllWaitingConfirmation(conversation_id);
      return;
    }

    // A permission/acp_permission/ask frame pauses the turn on the user — light
    // the distinct "waiting" icon. This is independent of the generating guard
    // (an `ask` frame is not in the generating whitelist, and waiting takes
    // display precedence over the spinner regardless).
    if (isWaitingConfirmationStreamMessage(message.type)) {
      const confirmationId = extractConfirmationId(message);
      if (confirmationId) {
        markWaitingConfirmation(conversation_id, confirmationId);
      }
    }

    const decision = getSidebarStreamGuardDecision({
      type: message.type,
      completed: completedConversationIdsState.has(conversation_id),
      completedTurnId: completedTurnIdByConversation.get(conversation_id) ?? null,
      streamTurnId: message.turn_id ?? null,
    });
    if (decision.clearCompleted) {
      clearCompleted(conversation_id);
    }
    if (decision.lateIgnored) {
      logLateStreamIgnored(conversation_id, message.type);
      return;
    }
    if (decision.markGenerating) {
      markGenerating(conversation_id, 'stream');
    }
  });
  ipcBridge.conversation.turnCompleted.on((event) => {
    if (isTerminalTurnState(event.state) && activeConversationIdState !== event.session_id) {
      markCompletionUnread(event.session_id);
    }
    // A failure the owner watched happen is seen already.
    if (event.last_outcome === 'error' && activeConversationIdState === event.session_id) {
      markOutcomeSeenState(event.session_id, { outcomeAt: event.last_outcome_at });
    }
    markCompleted(event.session_id, event.turn_id);
    clearGenerating(event.session_id, 'turnCompleted');
    reconcileBackgroundFromRuntime(event.session_id, event.runtime?.background_active);
    refreshConversations();
  });
};

export const useConversationListSync = () => {
  useEffect(() => {
    initializeConversationListSyncStore();
  }, []);

  const {
    conversations,
    generatingConversationIds,
    waitingConfirmationConversationIds,
    completionUnreadConversationIds,
    manualUnreadConversationIds,
    backgroundActiveConversationIds,
    backgroundCallIdsByConversation,
    outcomeSeenAtById,
  } = useSyncExternalStore(
    subscribeConversationListSync,
    getConversationListSyncSnapshot,
    getConversationListSyncSnapshot
  );

  const clearCompletionUnread = useCallback((conversation_id: string) => {
    clearCompletionUnreadState(conversation_id);
  }, []);

  const markManualUnread = useCallback((conversation_id: string) => {
    markManualUnreadState(conversation_id);
  }, []);

  const clearManualUnread = useCallback((conversation_id: string) => {
    clearManualUnreadState(conversation_id);
  }, []);

  const setActiveConversation = useCallback((conversation_id: string | null) => {
    setActiveConversationState(conversation_id);
  }, []);

  const isConversationGenerating = useCallback(
    (conversation_id: string) => {
      return generatingConversationIds.has(conversation_id);
    },
    [generatingConversationIds]
  );

  const isConversationWaitingConfirmation = useCallback(
    (conversation_id: string) => {
      return waitingConfirmationConversationIds.has(conversation_id);
    },
    [waitingConfirmationConversationIds]
  );

  const hasCompletionUnread = useCallback(
    (conversation_id: string) => {
      return completionUnreadConversationIds.has(conversation_id);
    },
    [completionUnreadConversationIds]
  );

  const isManualUnread = useCallback(
    (conversation_id: string) => {
      return manualUnreadConversationIds.has(conversation_id);
    },
    [manualUnreadConversationIds]
  );

  const hasBackgroundActive = useCallback(
    (conversation_id: string) => backgroundActiveConversationIds.has(conversation_id),
    [backgroundActiveConversationIds]
  );

  /** Whether this launching call's delegated work reported itself alive in this session (C21). */
  const isBackgroundCallLive = useCallback(
    (conversation_id: string, call_id: string) =>
      backgroundCallIdsByConversation.get(conversation_id)?.has(call_id) ?? false,
    [backgroundCallIdsByConversation]
  );

  /** When the owner opened it locally (before the list refresh carries it), if at all. */
  const outcomeSeenAt = useCallback(
    (conversation_id: string) => outcomeSeenAtById.get(conversation_id),
    [outcomeSeenAtById]
  );

  const markOutcomeSeen = useCallback((conversation_id: string) => {
    markOutcomeSeenState(conversation_id);
  }, []);

  return {
    conversations,
    isConversationGenerating,
    isConversationWaitingConfirmation,
    hasCompletionUnread,
    clearCompletionUnread,
    isManualUnread,
    hasBackgroundActive,
    isBackgroundCallLive,
    outcomeSeenAt,
    markOutcomeSeen,
    markManualUnread,
    clearManualUnread,
    setActiveConversation,
  };
};

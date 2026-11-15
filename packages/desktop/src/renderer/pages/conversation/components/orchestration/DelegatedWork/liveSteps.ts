/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useSyncExternalStore } from 'react';

/**
 * The step each conversation is on right now (its latest tool call), for the
 * delegated-work card's "live step" column. Fed by the stream every
 * conversation already broadcasts; cleared when a turn ends.
 */
let steps = new Map<string, string>();
const listeners = new Set<() => void>();
let subscribed = false;

const set = (conversationId: string, step: string | null) => {
  if ((steps.get(conversationId) ?? null) === step) return;
  const next = new Map(steps);
  if (step) next.set(conversationId, step);
  else next.delete(conversationId);
  steps = next;
  listeners.forEach((listener) => listener());
};

/** Pure: the step text a stream frame names, `null` for a turn end, `undefined` for no change. */
export const stepOfFrame = (frame: { type: string; data?: unknown }): string | null | undefined => {
  if (frame.type === 'finish' || frame.type === 'error') return null;
  const data = frame.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (frame.type === 'tool_call') {
    if (data.task || data.status !== 'running') return undefined;
    const text = (data.description as string | undefined) || (data.name as string | undefined);
    return text || undefined;
  }
  if (frame.type === 'acp_tool_call') {
    const update = data.update as { title?: string; status?: string } | undefined;
    if (!update?.title || update.status === 'completed' || update.status === 'failed') return undefined;
    return update.title;
  }
  return undefined;
};

const ensureSubscribed = () => {
  if (subscribed) return;
  subscribed = true;
  ipcBridge.conversation.responseStream.on((frame) => {
    if (!frame?.conversation_id) return;
    const step = stepOfFrame(frame);
    if (step !== undefined) set(frame.conversation_id, step);
  });
  ipcBridge.conversation.turnCompleted.on((event) => set(event.session_id, null));
};

const subscribe = (listener: () => void) => {
  ensureSubscribed();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Live steps by conversation id (re-renders on change). */
export const useLiveSteps = (): ReadonlyMap<string, string> =>
  useSyncExternalStore(
    subscribe,
    () => steps,
    () => steps
  );

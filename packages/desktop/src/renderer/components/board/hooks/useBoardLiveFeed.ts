/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

import { ipcBridge } from '@/common';
import type { BoardChangedEvent } from '@/common/types/board';

export type BoardLiveFeedHandlers = {
  /** A `board.changed` hint for this project. */
  onChange: (change: BoardChangedEvent) => void;
  /**
   * The realtime socket reconnected: hints sent while it was down are lost, so
   * the caller re-reads its state (R8 — after a reconnect the API is the truth).
   */
  onResync: () => void;
};

/**
 * Subscribe to a project's live board hints (pattern of `useTeamActivityFeed`).
 * Handlers are read through a ref, so changing them never re-subscribes.
 * `projectId === null` subscribes to nothing.
 */
export function useBoardLiveFeed(projectId: string | null, handlers: BoardLiveFeedHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!projectId) return;
    const unsubscribers = [
      ipcBridge.board.changed.on((change) => {
        if (!change || change.project_id !== projectId) return;
        handlersRef.current.onChange(change);
      }),
      ipcBridge.realtime.reconnected.on(() => {
        handlersRef.current.onResync();
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [projectId]);
}

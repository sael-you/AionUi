/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Show the Context tab" requests (C41). The ring beside the composer lives in
 * the conversation subtree; the tab lives in the Layout-level project panel.
 * This module-level store is the seam between them, like its siblings
 * {@link currentProjectStore} and {@link currentConversationStore}.
 *
 * Each request bumps a counter: the panel host expands on a new value and the
 * Explorer switches to its Context tab. A counter (not a boolean) lets a second
 * click re-open the tab after the owner moved to another one.
 */

import { useSyncExternalStore } from 'react';

let requests = 0;
const listeners = new Set<() => void>();

/** Ask the project panel to open on its Context tab. */
export const requestContextTab = (): void => {
  requests += 1;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Number of open requests so far (0 = none yet); the non-React read. */
export const getContextTabRequests = (): number => requests;

/** Number of open requests so far (0 = none yet). */
export const useContextTabRequests = (): number =>
  useSyncExternalStore(subscribe, getContextTabRequests, getContextTabRequests);

/** Test hook: reset module state. */
export const resetContextPanelStoreForTest = (): void => {
  requests = 0;
  listeners.clear();
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Who owns the composer state kept in the browser (TASK-127 review): saved
 * drafts, unsent messages, quote stacks and files waiting for a connection.
 *
 * - Everything is keyed by the signed-in user id, so one account never reads
 *   another's drafts on a shared browser.
 * - Everything expires 14 days after it was saved.
 * - Logout, or a different user signing in, clears all of it.
 *
 * The desktop app has no sign-in: its owner is `local`. In the web app the owner
 * is unknown until the user is (then nothing is read or written to storage).
 */

/** Saved drafts, unsent messages and waiting files are dropped after this long. */
export const OFFLINE_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const LOCAL_OFFLINE_OWNER = 'local';

/** The user the stored composer state belongs to (survives a reload). */
const OWNER_STORAGE_KEY = 'aionui.offlineDraftOwner';
/** localStorage prefixes of the composer state cleared on logout or user switch. */
export const OFFLINE_DRAFT_PREFIXES = ['aionui.sendBoxDraft.', 'aionui.unsentMessage.', 'aionui.quoteStack.'] as const;

const isDesktopRuntime = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as { electronAPI?: unknown }).electronAPI);

let owner: string | null = isDesktopRuntime() ? LOCAL_OFFLINE_OWNER : null;
const clearListeners = new Set<() => void>();

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** The current owner, or null while no user is known (then nothing is persisted). */
export const getOfflineOwner = (): string | null => owner;

/** Saved more than 14 days ago (or with no usable date): drop it. */
export const isOfflineDraftExpired = (savedAt: unknown, now = Date.now()): boolean =>
  typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0 || now - savedAt > OFFLINE_DRAFT_TTL_MS;

/** In-memory caches (draft maps, quote stacks, the waiting-files store) forget everything too. */
export const onOfflineDraftsCleared = (listener: () => void): (() => void) => {
  clearListeners.add(listener);
  return () => clearListeners.delete(listener);
};

/** Remove every saved draft, unsent message, quote stack and waiting file, for every user. */
export const clearOfflineDrafts = (): void => {
  const local = storage();
  if (local) {
    try {
      const keys: string[] = [];
      for (let index = 0; index < local.length; index += 1) {
        const key = local.key(index);
        if (key && OFFLINE_DRAFT_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
      }
      keys.forEach((key) => local.removeItem(key));
    } catch {
      /* storage blocked: nothing was saved there either */
    }
  }
  for (const listener of clearListeners) {
    try {
      listener();
    } catch {
      /* a listener never stops the clear */
    }
  }
};

/**
 * Called by the auth layer whenever the signed-in user is known or gone. A
 * different user than the one who saved the state clears it first; `null`
 * (logged out) clears it and stops persisting until the next sign-in.
 */
export const adoptOfflineOwner = (userId: string | null | undefined): void => {
  // Logged out means no owner, also in the desktop app (whose default `local` is set at start-up only).
  const next = userId || null;
  const local = storage();
  let previous: string | null = null;
  try {
    previous = local?.getItem(OWNER_STORAGE_KEY) ?? null;
  } catch {
    previous = null;
  }
  if (next === null || (previous !== null && previous !== next)) clearOfflineDrafts();
  try {
    if (next === null) local?.removeItem(OWNER_STORAGE_KEY);
    else local?.setItem(OWNER_STORAGE_KEY, next);
  } catch {
    /* storage blocked */
  }
  owner = next;
};

/** Test seam: set the owner directly (the stores' clear listeners stay registered). */
export const resetOfflineOwnerForTests = (next: string | null = null): void => {
  owner = next;
};

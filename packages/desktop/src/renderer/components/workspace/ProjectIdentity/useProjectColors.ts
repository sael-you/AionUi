/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { STORAGE_KEYS } from '@/common/config/storageKeys';
import { useOptionalAuth } from '@/renderer/hooks/context/AuthContext';
import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { isProjectColorId, type ProjectColorId } from './projectColors';

export type ProjectColorOverrides = Record<string, ProjectColorId>;

/** Backend client-preference key (per user, `/api/settings/client`). */
export const PROJECT_COLORS_SETTING_KEY = 'ui.projectColors';

/** Owner id of the single local user (desktop app, or no auth provider). */
export const LOCAL_PROJECT_COLORS_OWNER = 'local';

/** Keep only `workspace → valid palette id` entries. */
export const sanitizeProjectColorOverrides = (value: unknown): ProjectColorOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ProjectColorOverrides = {};
  for (const [workspace, id] of Object.entries(value as Record<string, unknown>)) {
    if (isProjectColorId(id)) out[workspace] = id;
  }
  return out;
};

// ---------------------------------------------------------------------------
// Backend (per user: the session cookie selects the account)
// ---------------------------------------------------------------------------

// Account-scoped: never refreshed-and-replayed on a 401 (a replay could reach
// another account than the one the payload or result belongs to). A 401 is a
// failed attempt; it stays pending and is retried once the store has re-checked
// which account it serves.
const ACCOUNT_SCOPED = { noSessionReplay: true } as const;

const loadRemote = async (): Promise<unknown> => {
  const data = await httpRequest<Record<string, unknown> | undefined>(
    'GET',
    `/api/settings/client?keys=${encodeURIComponent(PROJECT_COLORS_SETTING_KEY)}`,
    undefined,
    ACCOUNT_SCOPED
  );
  return data?.[PROJECT_COLORS_SETTING_KEY];
};

const saveRemote = (value: ProjectColorOverrides): Promise<void> =>
  httpRequest<void>('PUT', '/api/settings/client', { [PROJECT_COLORS_SETTING_KEY]: value }, ACCOUNT_SCOPED);

/** Thrown when the account changed between scheduling and sending: nothing was sent. */
class AccountChanged extends Error {}

// ---------------------------------------------------------------------------
// localStorage, scoped per account
// ---------------------------------------------------------------------------

/** This account's local copy of its colours. */
export const projectColorsCacheKey = (owner: string) => `${STORAGE_KEYS.PROJECT_COLORS}:${owner}`;
/** This account's edits not yet saved to the backend. */
export const projectColorsPendingKey = (owner: string) => `${STORAGE_KEYS.PROJECT_COLORS_PENDING}:${owner}`;

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota): memory and the backend still hold the choice.
  }
};

/**
 * The account's local copy. The legacy browser-wide copy (before colours were
 * per account) is adopted by the first account that loads here, then removed,
 * so it can never be migrated into a second account.
 */
const readLocal = (owner: string): ProjectColorOverrides => {
  const scoped = readJson(projectColorsCacheKey(owner));
  if (scoped !== null) return sanitizeProjectColorOverrides(scoped);
  const legacy = readJson(STORAGE_KEYS.PROJECT_COLORS);
  if (legacy === null) return {};
  const adopted = sanitizeProjectColorOverrides(legacy);
  writeJson(projectColorsCacheKey(owner), adopted);
  writeJson(STORAGE_KEYS.PROJECT_COLORS, null);
  return adopted;
};

type PendingEdits = Map<string, ProjectColorId | null>;

const readPending = (owner: string): PendingEdits => {
  const out: PendingEdits = new Map();
  const parsed = readJson(projectColorsPendingKey(owner));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [workspace, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (id === null) out.set(workspace, null);
      else if (isProjectColorId(id)) out.set(workspace, id);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Shared store (one copy for every consumer: sidebar, headers, file panel)
// ---------------------------------------------------------------------------

/** Account the state belongs to; `null` = signed out / not known yet (nothing is loaded or saved). */
let owner: string | null = null;
/** Bumped on every account change: async work started for another account is ignored. */
let generation = 0;
let overrides: ProjectColorOverrides = {};
let hydration: 'idle' | 'pending' | 'done' = 'idle';
/**
 * The account's edits not yet saved to the backend (workspace → id, `null` =
 * reset), kept in memory and in the account's localStorage until a save
 * succeeds. They are replayed over the backend map on every load, so neither a
 * stale local copy nor an older backend value (after a failed save and a
 * reload) can undo a choice.
 */
let pendingEdits: PendingEdits = new Map();
let saving = false;
const listeners = new Set<() => void>();

/** Retry delays after a failed backend load or save (bounded: the last one repeats). */
export const PROJECT_COLORS_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const notify = () => {
  for (const listener of listeners) listener();
};

const publish = (next: ProjectColorOverrides) => {
  overrides = next;
  notify();
};

const persist = () => {
  if (owner === null) return;
  writeJson(projectColorsCacheKey(owner), overrides);
  writeJson(projectColorsPendingKey(owner), pendingEdits.size > 0 ? Object.fromEntries(pendingEdits) : null);
};

const applyEdits = (base: ProjectColorOverrides, edits: ReadonlyMap<string, ProjectColorId | null>) => {
  const next = { ...base };
  for (const [workspace, id] of edits) {
    if (id) next[workspace] = id;
    else delete next[workspace];
  }
  return next;
};

const clearRetry = () => {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
};

const scheduleRetry = () => {
  if (listeners.size === 0 || retryTimer !== null || owner === null) return;
  const delay = PROJECT_COLORS_RETRY_DELAYS_MS[Math.min(retryAttempt, PROJECT_COLORS_RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    resume();
  }, delay);
};

/**
 * Save the merged map while edits are pending. A success drops the edits it
 * covered (edits made during the save stay pending and are saved next); a
 * failure keeps them and retries with the backoff.
 */
const flush = () => {
  if (owner === null || hydration !== 'done' || saving || pendingEdits.size === 0) return;
  saving = true;
  const run = generation;
  const saved = new Map(pendingEdits);
  const payload = overrides;
  Promise.resolve()
    .then(() => {
      // Re-check right before sending: the account may have changed since.
      if (run !== generation) throw new AccountChanged();
      return saveRemote(payload);
    })
    .then(() => {
      if (run !== generation) return;
      saving = false;
      retryAttempt = 0;
      for (const [workspace, id] of saved) {
        if (pendingEdits.has(workspace) && pendingEdits.get(workspace) === id) pendingEdits.delete(workspace);
      }
      persist();
      flush();
    })
    .catch((error: unknown) => {
      if (run !== generation) return;
      saving = false;
      console.warn('[project-colors] could not save the colours to the backend; will retry', error);
      scheduleRetry();
    });
};

/**
 * Load the account's backend copy. The backend is the source of truth (same
 * colours on every device); when it has none yet, this account's local choices
 * are migrated to it. Unsaved edits are replayed on top and saved. A failed load
 * keeps the local copy and retries with bounded backoff, or at once when the
 * browser comes back online, while any consumer is mounted.
 */
const hydrate = () => {
  if (owner === null || hydration !== 'idle') return;
  hydration = 'pending';
  clearRetry();
  const run = generation;
  Promise.resolve()
    .then(() => {
      if (run !== generation) throw new AccountChanged();
      return loadRemote();
    })
    .then((remote) => {
      if (run !== generation) return;
      hydration = 'done';
      retryAttempt = 0;
      let next: ProjectColorOverrides;
      if (remote !== undefined && remote !== null) {
        next = applyEdits(sanitizeProjectColorOverrides(remote), pendingEdits);
      } else {
        // No backend copy yet: migrate this account's choices (edits already included).
        next = overrides;
        for (const [workspace, id] of Object.entries(next)) pendingEdits.set(workspace, id);
      }
      overrides = next;
      persist();
      notify();
      flush();
    })
    .catch(() => {
      if (run !== generation) return;
      hydration = 'idle';
      scheduleRetry();
    });
};

/** Continue whatever is outstanding: load the backend copy, or save pending edits. */
const resume = () => {
  if (hydration === 'idle') hydrate();
  else flush();
};

// Peek for a render with an account the store has not switched to yet (the
// switch happens in a layout effect): same object for repeated reads.
let peek: { owner: string | null; value: ProjectColorOverrides } = { owner: null, value: {} };
const snapshotFor = (forOwner: string | null): ProjectColorOverrides => {
  if (forOwner === owner) return overrides;
  if (peek.owner !== forOwner) peek = { owner: forOwner, value: forOwner === null ? {} : readLocal(forOwner) };
  return peek.value;
};

/**
 * Switch the store to an account (`null` = signed out). Nothing from another
 * account is kept: its in-flight work is ignored, and the new account's colours
 * and pending edits come from its own scoped storage before anything is loaded
 * or saved.
 */
export const setProjectColorsOwner = (next: string | null) => {
  if (next === owner) return;
  generation += 1;
  clearRetry();
  saving = false;
  retryAttempt = 0;
  hydration = 'idle';
  overrides = snapshotFor(next);
  peek = { owner: null, value: {} };
  owner = next;
  pendingEdits = next === null ? new Map() : readPending(next);
  notify();
  if (listeners.size > 0) resume();
};

const onStorage = (event: StorageEvent) => {
  // Another tab of this browser changed this account's colours (it saves them itself).
  if (owner !== null && event.key === projectColorsCacheKey(owner)) {
    publish(applyEdits(sanitizeProjectColorOverrides(readJson(event.key)), pendingEdits));
  }
};

const onOnline = () => {
  clearRetry();
  resume();
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
  }
  listeners.add(listener);
  // Load, or resume saving edits a previous mount could not save.
  if (retryTimer === null) resume();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
      clearRetry();
    }
  };
};

/**
 * Set (or with `null`, reset to automatic) the colour of a workspace.
 * Write-through: memory and the account's localStorage at once; the edit stays
 * pending (durably) until the backend has saved it.
 */
export const setProjectColorOverride = (workspace: string, id: ProjectColorId | null) => {
  const next = applyEdits(overrides, new Map([[workspace, id]]));
  if (owner !== null) pendingEdits.set(workspace, id);
  overrides = next;
  persist();
  notify();
  flush();
};

/** The account the colours belong to: the signed-in user, `'local'` on desktop / without auth, `null` signed out. */
const useProjectColorsOwner = (): string | null => {
  const auth = useOptionalAuth();
  if (!auth) return LOCAL_PROJECT_COLORS_OWNER;
  if (auth.status !== 'authenticated') return null;
  return auth.user?.id ?? LOCAL_PROJECT_COLORS_OWNER;
};

/**
 * User-chosen project colours (normalised workspace → palette id) of the
 * signed-in account. Stored per user in the backend client preferences
 * (`ui.projectColors`), so every device shows the same colours; localStorage
 * keeps a per-account copy for offline start-up and cross-tab sync. Projects
 * without a choice use their automatic colour, which is also the same everywhere.
 */
export const useProjectColors = () => {
  const accountOwner = useProjectColorsOwner();
  useLayoutEffect(() => {
    setProjectColorsOwner(accountOwner);
  }, [accountOwner]);
  const getSnapshot = useCallback(() => snapshotFor(accountOwner), [accountOwner]);
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setProjectColor = useCallback(
    (workspace: string, id: ProjectColorId | null) => setProjectColorOverride(workspace, id),
    []
  );
  return { overrides: current, setProjectColor };
};

/** Test hook: forget all module state (the next consumer reloads its account from localStorage). */
export const resetProjectColorsForTest = () => {
  generation += 1;
  owner = null;
  peek = { owner: null, value: {} };
  overrides = {};
  hydration = 'idle';
  pendingEdits = new Map();
  saving = false;
  retryAttempt = 0;
  clearRetry();
  listeners.clear();
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('online', onOnline);
};

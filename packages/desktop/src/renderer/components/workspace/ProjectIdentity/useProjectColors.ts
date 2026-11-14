/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { STORAGE_KEYS } from '@/common/config/storageKeys';
import { useCallback, useSyncExternalStore } from 'react';
import { isProjectColorId, type ProjectColorId } from './projectColors';

export type ProjectColorOverrides = Record<string, ProjectColorId>;

/** Backend client-preference key (per user, `/api/settings/client`). */
export const PROJECT_COLORS_SETTING_KEY = 'ui.projectColors';

/** Keep only `workspace → valid palette id` entries. */
export const sanitizeProjectColorOverrides = (value: unknown): ProjectColorOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ProjectColorOverrides = {};
  for (const [workspace, id] of Object.entries(value as Record<string, unknown>)) {
    if (isProjectColorId(id)) out[workspace] = id;
  }
  return out;
};

const readLocal = (): ProjectColorOverrides => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROJECT_COLORS);
    return raw ? sanitizeProjectColorOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
};

const writeLocal = (overrides: ProjectColorOverrides) => {
  try {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (private mode / quota): the backend copy still holds the choice.
  }
};

type PendingEdits = Map<string, ProjectColorId | null>;

const readPending = (): PendingEdits => {
  const out: PendingEdits = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROJECT_COLORS_PENDING);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [workspace, id] of Object.entries(parsed as Record<string, unknown>)) {
        if (id === null) out.set(workspace, null);
        else if (isProjectColorId(id)) out.set(workspace, id);
      }
    }
  } catch {
    // Unreadable: nothing pending.
  }
  return out;
};

const writePending = (edits: PendingEdits) => {
  try {
    if (edits.size === 0) localStorage.removeItem(STORAGE_KEYS.PROJECT_COLORS_PENDING);
    else localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS_PENDING, JSON.stringify(Object.fromEntries(edits)));
  } catch {
    // Storage unavailable: the edits stay pending in memory for this session.
  }
};

// One shared copy for every consumer (sidebar, headers, file panel), so a
// colour change shows everywhere at once.
let overrides: ProjectColorOverrides = readLocal();
let hydration: 'idle' | 'pending' | 'done' = 'idle';
/**
 * Edits not yet saved to the backend (workspace → id, `null` = reset), kept in
 * memory and localStorage until a save succeeds. They are replayed over the
 * backend map on every load, so neither a stale local copy nor an older backend
 * value (after a failed save and a reload) can undo a choice.
 */
let pendingEdits: PendingEdits = readPending();
let saving = false;
const listeners = new Set<() => void>();

/** Retry delays after a failed backend load or save (bounded: the last one repeats). */
export const PROJECT_COLORS_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const publish = (next: ProjectColorOverrides) => {
  overrides = next;
  for (const listener of listeners) listener();
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
  if (listeners.size === 0 || retryTimer !== null) return;
  const delay = PROJECT_COLORS_RETRY_DELAYS_MS[Math.min(retryAttempt, PROJECT_COLORS_RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryNow();
  }, delay);
};

/**
 * Save the merged map while edits are pending. A success drops the edits it
 * covered (edits made during the save stay pending and are saved next); a
 * failure keeps them and retries with the backoff.
 */
const flush = () => {
  if (hydration !== 'done' || saving || pendingEdits.size === 0) return;
  saving = true;
  const saved = new Map(pendingEdits);
  const payload = overrides;
  Promise.resolve()
    .then(() => configService.set(PROJECT_COLORS_SETTING_KEY, payload))
    .then(() => {
      saving = false;
      retryAttempt = 0;
      for (const [workspace, id] of saved) {
        if (pendingEdits.has(workspace) && pendingEdits.get(workspace) === id) pendingEdits.delete(workspace);
      }
      writePending(pendingEdits);
      flush();
    })
    .catch((error: unknown) => {
      saving = false;
      console.warn('[project-colors] could not save the colours to the backend; will retry', error);
      scheduleRetry();
    });
};

/**
 * Load the backend copy. The backend is the source of truth (same colours on
 * every device); when it has none yet, this browser's legacy localStorage
 * choices are migrated to it. Unsaved edits are replayed on top and saved. A
 * failed load keeps the local copy and retries with bounded backoff, or at once
 * when the browser comes back online, while any consumer is mounted.
 */
const hydrate = () => {
  if (hydration !== 'idle') return;
  hydration = 'pending';
  clearRetry();
  Promise.resolve()
    .then(() => configService.whenReady())
    .then(() => {
      hydration = 'done';
      retryAttempt = 0;
      const remote: unknown = configService.get(PROJECT_COLORS_SETTING_KEY);
      const hasRemote = remote !== undefined && remote !== null;
      let next: ProjectColorOverrides;
      if (hasRemote) {
        next = applyEdits(sanitizeProjectColorOverrides(remote), pendingEdits);
      } else {
        // No backend copy yet: migrate this browser's choices (edits already included).
        next = overrides;
        for (const [workspace, id] of Object.entries(next)) pendingEdits.set(workspace, id);
        writePending(pendingEdits);
      }
      writeLocal(next);
      publish(next);
      flush();
    })
    .catch(() => {
      hydration = 'idle';
      scheduleRetry();
    });
};

const retryNow = () => {
  if (hydration === 'idle') hydrate();
  else flush();
};

const onStorage = (event: StorageEvent) => {
  // Another tab of this browser changed the colours (it saves them itself).
  if (event.key === STORAGE_KEYS.PROJECT_COLORS) publish(applyEdits(readLocal(), pendingEdits));
};

const onOnline = () => {
  clearRetry();
  retryNow();
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
  }
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
      clearRetry();
    }
  };
};

const getSnapshot = () => overrides;

/**
 * Set (or with `null`, reset to automatic) the colour of a workspace.
 * Write-through: memory and localStorage at once; the edit stays pending
 * (durably) until the backend has saved it.
 */
export const setProjectColorOverride = (workspace: string, id: ProjectColorId | null) => {
  const next = applyEdits(overrides, new Map([[workspace, id]]));
  pendingEdits.set(workspace, id);
  writePending(pendingEdits);
  writeLocal(next);
  publish(next);
  flush();
};

/**
 * User-chosen project colours (normalised workspace → palette id). Stored per
 * user in the backend client preferences (`ui.projectColors`), so every device
 * shows the same colours; localStorage keeps a copy for offline start-up and
 * cross-tab sync. Projects without a choice use their automatic colour, which is
 * also the same everywhere.
 */
export const useProjectColors = () => {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setProjectColor = useCallback(
    (workspace: string, id: ProjectColorId | null) => setProjectColorOverride(workspace, id),
    []
  );
  return { overrides: current, setProjectColor };
};

/** Test hook: reload module state (colours and pending edits) from localStorage and forget the backend load. */
export const resetProjectColorsForTest = () => {
  overrides = readLocal();
  hydration = 'idle';
  pendingEdits = readPending();
  saving = false;
  retryAttempt = 0;
  clearRetry();
  listeners.clear();
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('online', onOnline);
};

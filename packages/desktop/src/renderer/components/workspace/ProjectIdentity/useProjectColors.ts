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

const writeRemote = (overrides: ProjectColorOverrides) => {
  Promise.resolve()
    .then(() => configService.set(PROJECT_COLORS_SETTING_KEY, overrides))
    .catch((error: unknown) => {
      console.warn('[project-colors] could not save the colours to the backend; kept in this browser', error);
    });
};

// One shared copy for every consumer (sidebar, headers, file panel), so a
// colour change shows everywhere at once.
let overrides: ProjectColorOverrides = readLocal();
let hydration: 'idle' | 'pending' | 'done' = 'idle';
/**
 * Choices made before the backend copy is loaded (workspace → id, `null` =
 * reset). They are replayed over the backend map once it arrives, so a stale
 * local copy never overwrites colours this browser has not seen yet.
 */
const pendingEdits = new Map<string, ProjectColorId | null>();
const listeners = new Set<() => void>();

/** Retry delays after a failed backend load (bounded: the last one repeats). */
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
    hydrate();
  }, delay);
};

/**
 * Load the backend copy. The backend is the source of truth (same colours on
 * every device); when it has none yet, this browser's legacy localStorage
 * choices are migrated to it. Edits made meanwhile are replayed on top. A failed
 * load keeps the local copy and retries with bounded backoff, or at once when the
 * browser comes back online, while any consumer is mounted.
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
      const edits = new Map(pendingEdits);
      pendingEdits.clear();
      // No backend copy yet: migrate this browser's choices (edits already included).
      const next = hasRemote ? applyEdits(sanitizeProjectColorOverrides(remote), edits) : overrides;
      writeLocal(next);
      publish(next);
      if (edits.size > 0 || (!hasRemote && Object.keys(next).length > 0)) writeRemote(next);
    })
    .catch(() => {
      hydration = 'idle';
      scheduleRetry();
    });
};

const onStorage = (event: StorageEvent) => {
  // Another tab of this browser changed the colours (it also wrote the backend).
  if (event.key === STORAGE_KEYS.PROJECT_COLORS) publish(applyEdits(readLocal(), pendingEdits));
};

const onOnline = () => {
  if (hydration !== 'idle') return;
  clearRetry();
  hydrate();
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
 * Write-through: memory, localStorage, and the backend — once the backend copy
 * is loaded; before that the edit is buffered and merged into it.
 */
export const setProjectColorOverride = (workspace: string, id: ProjectColorId | null) => {
  const next = applyEdits(overrides, new Map([[workspace, id]]));
  writeLocal(next);
  publish(next);
  if (hydration === 'done') writeRemote(next);
  else pendingEdits.set(workspace, id);
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

/** Test hook: reload module state from localStorage and forget the backend load. */
export const resetProjectColorsForTest = () => {
  overrides = readLocal();
  hydration = 'idle';
  pendingEdits.clear();
  retryAttempt = 0;
  clearRetry();
  listeners.clear();
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('online', onOnline);
};

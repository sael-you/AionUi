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
/** A choice made while the backend copy was loading wins over that (older) copy. */
let changedWhileLoading = false;
const listeners = new Set<() => void>();

const publish = (next: ProjectColorOverrides) => {
  overrides = next;
  for (const listener of listeners) listener();
};

/**
 * Load the backend copy once. The backend is the source of truth (same colours
 * on every device); when it has none yet, this browser's legacy localStorage
 * choices are migrated to it. A failed load keeps the local copy and retries on
 * the next subscription.
 */
const hydrate = () => {
  if (hydration !== 'idle') return;
  hydration = 'pending';
  changedWhileLoading = false;
  Promise.resolve()
    .then(() => configService.whenReady())
    .then(() => {
      hydration = 'done';
      if (changedWhileLoading) return;
      const remote: unknown = configService.get(PROJECT_COLORS_SETTING_KEY);
      if (remote === undefined || remote === null) {
        if (Object.keys(overrides).length > 0) writeRemote(overrides);
        return;
      }
      const next = sanitizeProjectColorOverrides(remote);
      writeLocal(next);
      publish(next);
    })
    .catch(() => {
      hydration = 'idle';
    });
};

const onStorage = (event: StorageEvent) => {
  // Another tab of this browser changed the colours (it also wrote the backend).
  if (event.key === STORAGE_KEYS.PROJECT_COLORS) publish(readLocal());
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  hydrate();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
};

const getSnapshot = () => overrides;

/** Set (or with `null`, reset to automatic) the colour of a workspace. Write-through: memory, localStorage, backend. */
export const setProjectColorOverride = (workspace: string, id: ProjectColorId | null) => {
  if (hydration === 'pending') changedWhileLoading = true;
  const next = { ...overrides };
  if (id) next[workspace] = id;
  else delete next[workspace];
  writeLocal(next);
  writeRemote(next);
  publish(next);
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
  changedWhileLoading = false;
  listeners.clear();
  window.removeEventListener('storage', onStorage);
};

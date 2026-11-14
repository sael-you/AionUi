/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STORAGE_KEYS } from '@/common/config/storageKeys';
import { useCallback, useEffect, useState } from 'react';
import { isProjectColorId, type ProjectColorId } from '../utils/projectColors';

type Overrides = Record<string, ProjectColorId>;

const read = (): Overrides => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROJECT_COLORS);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Overrides = {};
    for (const [workspace, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (isProjectColorId(id)) out[workspace] = id;
    }
    return out;
  } catch {
    return {};
  }
};

const write = (overrides: Overrides) => {
  try {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify(overrides));
  } catch {
    // Storage unavailable (private mode / quota): the choice lasts for this session only.
  }
};

/**
 * User-chosen project colours (workspace → palette id), kept in this browser.
 * Projects without a choice use their automatic colour, which is the same on
 * every device. Other tabs pick up changes through the `storage` event.
 */
export const useProjectColors = () => {
  const [overrides, setOverrides] = useState<Overrides>(read);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.PROJECT_COLORS) setOverrides(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** `null` resets the project to its automatic colour. */
  const setProjectColor = useCallback((workspace: string, id: ProjectColorId | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (id) next[workspace] = id;
      else delete next[workspace];
      write(next);
      return next;
    });
  }, []);

  return { overrides, setProjectColor };
};

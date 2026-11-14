/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { addEventListener } from '@/renderer/utils/emitter';
import { useEffect, useRef, useState } from 'react';
import { standardProjectsFromSidebar, type StandardProject } from '../utils/standardProjects';

const RELOAD_DEBOUNCE_MS = 300;

/**
 * Standard projects from the backend, so the sidebar can show a project folder
 * even when none of its conversations is visible (all archived, or all pinned).
 *
 * One reload path: the initial load, `chat.history.refresh`, and changes of
 * `refreshKey` (a new folder chat creates a project) all go through a single
 * debounced loader, and at most one request is in flight (a trigger during a
 * request schedules exactly one follow-up). Failures keep the last known list,
 * so the sidebar falls back to conversation-derived projects.
 */
export const useStandardProjects = (refreshKey: unknown): StandardProject[] => {
  const [projects, setProjects] = useState<StandardProject[]>([]);
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;

    const load = () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      ipcBridge.sidebar.get
        .invoke({ limit: 1 })
        .then((response) => {
          if (alive) setProjects(standardProjectsFromSidebar(response));
        })
        .catch((error: unknown) => {
          console.warn('[sidebar] loading standard projects failed:', error);
        })
        .finally(() => {
          inFlight = false;
          if (alive && pending) {
            pending = false;
            schedule();
          }
        });
    };

    const schedule = () => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        load();
      }, RELOAD_DEBOUNCE_MS);
    };

    scheduleRef.current = schedule;
    load();
    const unsubscribe = addEventListener('chat.history.refresh', schedule);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      scheduleRef.current = () => {};
      unsubscribe();
    };
  }, []);

  // A changed key (e.g. conversation count) reuses the same debounced loader.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    scheduleRef.current();
  }, [refreshKey]);

  return projects;
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Data of the project page (C42): overview tiles, usage, and the disk scan with its rescan. */

import { useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import type {
  ProjectOverviewResponse,
  ProjectStorageResponse,
  ProjectUsageResponse,
  UsageRangeDays,
} from '@/common/types/platform/projectPage';

const QUIET = { shouldRetryOnError: false, revalidateOnFocus: false } as const;

export const projectOverviewKey = (projectId: string): string => `project.overview:${projectId}`;
export const projectStorageKey = (projectId: string): string => `project.storage:${projectId}`;

export const useProjectOverview = (projectId: string) => {
  const { data, error, isLoading, mutate } = useSWR<ProjectOverviewResponse>(
    projectId ? projectOverviewKey(projectId) : null,
    () => ipcBridge.projectPage.overview.invoke({ project_id: projectId }),
    QUIET
  );
  return { overview: data ?? null, error: error as unknown, isLoading, reload: mutate };
};

export const useProjectUsage = (projectId: string, days: UsageRangeDays) => {
  const { data, error, isLoading, mutate } = useSWR<ProjectUsageResponse>(
    projectId ? `project.usage:${projectId}:${days}` : null,
    () => ipcBridge.projectPage.usage.invoke({ project_id: projectId, days }),
    { ...QUIET, keepPreviousData: true }
  );
  return { usage: data ?? null, error: error as unknown, isLoading, reload: mutate };
};

/**
 * The cached disk scan (the first read scans, a few seconds: the page stays usable
 * meanwhile) and "Rescan", which replaces the result and refreshes the overview tile.
 */
export const useProjectStorage = (projectId: string) => {
  const { data, error, isLoading, mutate } = useSWR<ProjectStorageResponse>(
    projectId ? projectStorageKey(projectId) : null,
    () => ipcBridge.projectPage.storage.invoke({ project_id: projectId }),
    QUIET
  );
  const { mutate: mutateAny } = useSWRConfig();
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<unknown>(null);

  const rescan = useCallback(async () => {
    setRescanning(true);
    setRescanError(null);
    try {
      const next = await ipcBridge.projectPage.rescanStorage.invoke({ project_id: projectId });
      await mutate(next, { revalidate: false });
      void mutateAny(projectOverviewKey(projectId));
    } catch (scanError) {
      setRescanError(scanError);
    } finally {
      setRescanning(false);
    }
  }, [mutate, mutateAny, projectId]);

  return {
    storage: data ?? null,
    error: error as unknown,
    isLoading,
    reload: mutate,
    rescan,
    rescanning,
    rescanError,
  };
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The owner's own browsers paired through the AionUi extension (C34 /
 * TASK-125) and the agent actions waiting for approval. Both are SWR caches
 * kept fresh by the app WebSocket events `browser.devicesChanged`,
 * `browser.approvalRequested` and `browser.approvalResolved`; a slow refresh
 * covers a missed event. A server without these routes answers 404 → empty.
 */

import { useEffect } from 'react';
import useSWR from 'swr';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type { BrowserApproval, BrowserDevice } from '@/common/types/platform/serverBrowser';

export const BROWSER_DEVICES_KEY = 'serverBrowser.devices';
export const BROWSER_APPROVALS_KEY = 'serverBrowser.approvals';

/** A missed event is caught within this long. */
const REFRESH_MS = 30_000;

const orEmpty = async <T>(load: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await load();
  } catch {
    return [];
  }
};

export const useBrowserDevices = (enabled = true) => {
  const { data, mutate } = useSWR<BrowserDevice[]>(
    enabled ? BROWSER_DEVICES_KEY : null,
    () => orEmpty(() => serverBrowser.listDevices.invoke()),
    { refreshInterval: REFRESH_MS }
  );
  useEffect(() => {
    if (!enabled) return undefined;
    return serverBrowser.devicesChanged.on(() => void mutate());
  }, [enabled, mutate]);
  return { devices: data ?? [], reload: mutate };
};

/** Pending approvals, oldest first; expired rows drop out on their own. */
export const pendingApprovals = (approvals: readonly BrowserApproval[], now: number): BrowserApproval[] =>
  approvals.filter((approval) => approval.expires_at > now).toSorted((a, b) => a.requested_at - b.requested_at);

export const useBrowserApprovals = (enabled = true) => {
  const { data, mutate } = useSWR<BrowserApproval[]>(
    enabled ? BROWSER_APPROVALS_KEY : null,
    () => orEmpty(() => serverBrowser.listApprovals.invoke()),
    { refreshInterval: REFRESH_MS }
  );
  useEffect(() => {
    if (!enabled) return undefined;
    const offRequested = serverBrowser.approvalRequested.on((approval) => {
      void mutate(
        (current) => [...(current ?? []).filter((row) => row.approval_id !== approval.approval_id), approval],
        { revalidate: false }
      );
    });
    const offResolved = serverBrowser.approvalResolved.on((resolved) => {
      void mutate((current) => (current ?? []).filter((row) => row.approval_id !== resolved.approval_id), {
        revalidate: false,
      });
    });
    return () => {
      offRequested();
      offResolved();
    };
  }, [enabled, mutate]);
  return { approvals: data ?? [], reload: mutate };
};

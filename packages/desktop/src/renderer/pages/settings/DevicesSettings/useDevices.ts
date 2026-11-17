/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The device registry (C38 W1) as an SWR cache, kept fresh by the
 * `devices.changed` WebSocket event plus a slow refresh; and the progress of
 * one install / remove job. A server without the registry answers 404 → no
 * devices (the existing browser sections still render).
 */

import { useEffect } from 'react';
import useSWR from 'swr';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { devices as devicesApi } from '@/common/adapter/ipcBridge';
import type { Device, DeviceApproval, DeviceJob } from '@/common/types/platform/devices';

export const DEVICES_KEY = 'devices.list';

const REFRESH_MS = 30_000;
const JOB_POLL_MS = 1_000;

export const useDevices = (enabled = true) => {
  const { data, mutate, isLoading } = useSWR<Device[]>(
    enabled ? DEVICES_KEY : null,
    async () => {
      try {
        return await devicesApi.list.invoke();
      } catch {
        return [];
      }
    },
    { refreshInterval: REFRESH_MS }
  );
  useEffect(() => {
    if (!enabled) return undefined;
    return devicesApi.changed.on(() => {
      void mutate();
    });
  }, [enabled, mutate]);
  return { devices: data ?? [], reload: mutate, isLoading };
};

/**
 * A job AionCore no longer knows (it restarted while the job ran, D: core
 * 2026-11-17) is shown as failed with this error.
 */
export const JOB_LOST = 'lost';

/** Load a job; 404 (`DEVICE_JOB_NOT_FOUND`) → failed, lost. */
export const loadJob = async (jobId: string, deviceId: string): Promise<DeviceJob> => {
  try {
    return await devicesApi.job.invoke({ job_id: jobId });
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404) {
      return { job_id: jobId, device_id: deviceId, state: 'failed', progress: 0, error: JOB_LOST };
    }
    throw error;
  }
};

/** Polls the job each second while it is queued or running; refreshes the list once it ends. */
export const useDeviceJob = (jobId: string | null, deviceId: string, onFinished: () => void) => {
  const { data } = useSWR<DeviceJob>(jobId ? `devices.job.${jobId}` : null, () => loadJob(jobId!, deviceId), {
    refreshInterval: (job) => (!job || job.state === 'queued' || job.state === 'running' ? JOB_POLL_MS : 0),
  });
  const finished = data?.state === 'done' || data?.state === 'failed';
  useEffect(() => {
    if (finished) onFinished();
    // onFinished is a refresh; once per finished job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, jobId]);
  return data ?? null;
};

export const DEVICE_APPROVALS_KEY = 'devices.approvals';

/** Pending approvals, oldest first; expired rows drop out on their own. */
export const pendingDeviceApprovals = (approvals: readonly DeviceApproval[], now: number): DeviceApproval[] =>
  approvals.filter((approval) => approval.expires_at > now).toSorted((a, b) => a.created_at - b.created_at);

/** Agent actions on a device that wait for the owner (C38 §3), kept fresh by `devices.approval`. */
export const useDeviceApprovals = (enabled = true) => {
  const { data, mutate } = useSWR<DeviceApproval[]>(
    enabled ? DEVICE_APPROVALS_KEY : null,
    async () => {
      try {
        return await devicesApi.listApprovals.invoke();
      } catch {
        return [];
      }
    },
    { refreshInterval: REFRESH_MS }
  );
  useEffect(() => {
    if (!enabled) return undefined;
    return devicesApi.approval.on((event) => {
      void mutate(
        (current) => {
          const others = (current ?? []).filter((row) => row.id !== event.approval.id);
          return event.state === 'requested' ? [...others, event.approval] : others;
        },
        { revalidate: false }
      );
    });
  }, [enabled, mutate]);
  return { approvals: data ?? [], reload: mutate };
};

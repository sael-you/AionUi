/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Browser → Approvals log (TASK-128): the agent actions on
 * high-value sites in the owner's own browsers that were paused, and how each
 * ended (allowed, denied, timed out). Read from each paired browser's recent
 * activity (method names and origins only, kept in memory by AionCore).
 */

import { Empty, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type {
  BrowserActivityOutcome,
  BrowserDevice,
  BrowserDeviceActivity,
} from '@/common/types/platform/serverBrowser';
import {
  useBrowserApprovals,
  useBrowserDevices,
} from '@/renderer/pages/conversation/Preview/browser/server/useBrowserDevices';
import { formatDateTime } from '@/renderer/services/i18n/format';

const LOG_LIMIT = 200;
const REFRESH_MS = 15_000;

/** Outcomes that belong to an approval (a plain `ok` or `refused` is ordinary activity). */
const APPROVAL_OUTCOMES: ReadonlySet<BrowserActivityOutcome> = new Set(['paused', 'approved', 'denied', 'timeout']);

const OUTCOME_COLOR: Partial<Record<BrowserActivityOutcome, string>> = {
  paused: 'orange',
  approved: 'green',
  denied: 'red',
  timeout: 'gray',
};

export type ApprovalLogRow = BrowserDeviceActivity & { device_id: string; device_name: string };

/** Approval-related rows of every device, newest first. */
export const approvalLogRows = (
  devices: readonly Pick<BrowserDevice, 'device_id' | 'name'>[],
  activity: readonly (readonly BrowserDeviceActivity[])[]
): ApprovalLogRow[] =>
  devices
    .flatMap((device, index) =>
      (activity[index] ?? [])
        .filter((row) => APPROVAL_OUTCOMES.has(row.outcome))
        .map((row) => ({ ...row, device_id: device.device_id, device_name: device.name }))
    )
    .toSorted((a, b) => b.at - a.at);

const BrowserApprovalsLog: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { devices } = useBrowserDevices();
  const { approvals } = useBrowserApprovals();
  const ids = devices.map((device) => device.device_id);
  const { data } = useSWR<BrowserDeviceActivity[][]>(
    ids.length > 0 ? ['serverBrowser.approvalsLog', ...ids] : null,
    () =>
      Promise.all(
        ids.map((device_id) =>
          serverBrowser.deviceActivity.invoke({ device_id, limit: LOG_LIMIT }).catch((): BrowserDeviceActivity[] => [])
        )
      ),
    { refreshInterval: REFRESH_MS }
  );
  const rows = approvalLogRows(devices, data ?? []);

  return (
    <section
      className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'
      aria-labelledby='browser-approvals-log-title'
      data-testid='browser-approvals-log'
    >
      <h3 id='browser-approvals-log-title' className='m-0 mb-8px text-14px font-medium text-t-primary'>
        {t('settings.browserPage.approvalsLog.title')}
      </h3>
      <p className='m-0 mb-8px text-12px text-t-secondary leading-relaxed'>
        {t('settings.browserPage.approvalsLog.description')}
      </p>
      {approvals.length > 0 ? (
        <p className='m-0 mb-8px text-12px text-t-primary' role='status' data-testid='browser-approvals-pending'>
          {t('settings.browserPage.approvalsLog.pending', { count: approvals.length })}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <Empty description={t('settings.browserPage.approvalsLog.empty')} />
      ) : (
        <ol className='m-0 p-0 list-none flex flex-col gap-4px'>
          {rows.map((row, index) => (
            <li
              key={`${row.device_id}-${row.at}-${index}`}
              className='flex flex-wrap items-center gap-x-8px gap-y-2px min-w-0 text-12px'
              data-testid='browser-approvals-row'
            >
              <span className='text-t-secondary flex-shrink-0 tabular-nums'>
                {formatDateTime(row.at, i18n.language, { dateStyle: 'short', timeStyle: 'medium' })}
              </span>
              <span className='text-t-primary truncate min-w-0'>{row.origin}</span>
              <span className='text-t-secondary truncate min-w-0 flex-1'>
                {row.method} · {row.device_name}
              </span>
              <Tag size='small' color={OUTCOME_COLOR[row.outcome]} className='flex-shrink-0'>
                {t(`preview.browserDevices.outcome.${row.outcome}`)}
              </Tag>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default BrowserApprovalsLog;

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel for one of the owner's own browsers (C34 / TASK-125): no
 * screencast — the browser is on the owner's computer — but "Live in your
 * browser", its state (online, shared tabs, new tabs) and the agents' recent
 * actions there (method names and origins only, never content).
 */

import { Alert, Empty, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type { BrowserActivityOutcome, BrowserDevice, BrowserDeviceActivity } from '@/common/types/platform/serverBrowser';
import { formatDateTime } from '@/renderer/services/i18n/format';

/** Activity refresh while the panel shows this device. */
const ACTIVITY_REFRESH_MS = 5_000;
const ACTIVITY_LIMIT = 50;

const OUTCOME_COLOR: Record<BrowserActivityOutcome, string> = {
  ok: 'green',
  refused: 'red',
  paused: 'orange',
  approved: 'arcoblue',
  denied: 'red',
  timeout: 'gray',
};

export const deviceActivityKey = (deviceId: string): string => `serverBrowser.devices.${deviceId}.activity`;

const DeviceBrowserView: React.FC<{
  device: BrowserDevice | undefined;
  /** The switcher (profiles + devices), shown in the header like on the server browser. */
  switcher: React.ReactNode;
  /** "Agents may use my Mac browser" and "Agents can use the browser" are both on. */
  agentsEnabled: boolean;
}> = ({ device, switcher, agentsEnabled }) => {
  const { t, i18n } = useTranslation();
  const { data: activity } = useSWR<BrowserDeviceActivity[]>(
    device ? deviceActivityKey(device.device_id) : null,
    () => serverBrowser.deviceActivity.invoke({ device_id: device?.device_id ?? '', limit: ACTIVITY_LIMIT }),
    { refreshInterval: ACTIVITY_REFRESH_MS }
  );

  return (
    <div className='flex flex-col size-full min-h-0 bg-1' data-testid='device-browser-view'>
      <div className='flex items-center gap-8px px-8px py-6px border-b border-3 flex-shrink-0'>
        {switcher}
        <span className='flex-1' />
        {device ? (
          <Tag size='small' color={device.online ? 'green' : 'gray'} data-testid='device-browser-status'>
            {t(device.online ? 'preview.browserDevices.live' : 'preview.browserDevices.offlineLong')}
          </Tag>
        ) : null}
      </div>
      <div className='flex flex-col gap-12px p-12px overflow-y-auto min-h-0'>
        {!device ? (
          <Alert type='warning' content={t('preview.browserDevices.gone')} />
        ) : (
          <>
            <p className='m-0 text-13px text-t-secondary leading-relaxed'>
              {t('preview.browserDevices.liveHint', { name: device.name })}
            </p>
            {!agentsEnabled ? (
              <Alert type='info' content={t('preview.browserDevices.agentsOff')} data-testid='device-agents-off' />
            ) : null}
            <dl className='m-0 grid grid-cols-[auto_1fr] gap-x-12px gap-y-4px text-13px'>
              <dt className='text-t-secondary'>{t('preview.browserDevices.browser')}</dt>
              <dd className='m-0 text-t-primary'>{device.browser || '—'}</dd>
              <dt className='text-t-secondary'>{t('preview.browserDevices.sharedTabs')}</dt>
              <dd className='m-0 text-t-primary' data-testid='device-shared-tabs'>
                {device.shared_tabs}
              </dd>
              <dt className='text-t-secondary'>{t('preview.browserDevices.newTabs')}</dt>
              <dd className='m-0 text-t-primary'>{t(device.new_tabs ? 'preview.browserDevices.yes' : 'preview.browserDevices.no')}</dd>
              {device.last_seen_at ? (
                <>
                  <dt className='text-t-secondary'>{t('preview.browserDevices.lastSeen')}</dt>
                  <dd className='m-0 text-t-primary'>
                    {formatDateTime(device.last_seen_at, i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
                  </dd>
                </>
              ) : null}
            </dl>
            <section aria-labelledby='device-activity-title' className='flex flex-col gap-6px'>
              <h3 id='device-activity-title' className='m-0 text-13px font-medium text-t-primary'>
                {t('preview.browserDevices.activity')}
              </h3>
              {(activity ?? []).length === 0 ? (
                <Empty description={t('preview.browserDevices.noActivity')} />
              ) : (
                <ol className='m-0 p-0 list-none flex flex-col gap-4px' data-testid='device-activity'>
                  {(activity ?? []).map((row, index) => (
                    <li
                      key={`${row.at}-${index}`}
                      className='flex items-center gap-8px min-w-0 text-12px'
                      data-testid='device-activity-row'
                    >
                      <span className='text-t-secondary flex-shrink-0 tabular-nums'>
                        {formatDateTime(row.at, i18n.language, { timeStyle: 'medium' })}
                      </span>
                      <span className='text-t-primary truncate min-w-0'>{row.method}</span>
                      <span className='text-t-secondary truncate min-w-0 flex-1'>{row.origin}</span>
                      <Tag size='small' color={OUTCOME_COLOR[row.outcome]} className='flex-shrink-0'>
                        {t(`preview.browserDevices.outcome.${row.outcome}`)}
                      </Tag>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default DeviceBrowserView;

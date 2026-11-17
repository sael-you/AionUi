/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone (and Mac) part of the device drawer (C38 §3/§5, TASK-136 U2):
 * the agent switch with its timeout, the connection options — each with its
 * own switch and Pair — and the audit of what agents did.
 */

import { Button, Link, Message, Radio, Switch, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { devices as devicesApi } from '@/common/adapter/ipcBridge';
import {
  DEVICE_TIMEOUTS,
  type Device,
  type DeviceAuditOutcome,
  type DeviceAuditRow,
  type DevicePairingKind,
  type DeviceRoute,
  type DeviceRouteKind,
  type DeviceTimeout,
} from '@/common/types/platform/devices';
import { DrawerBlock } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { addonRunDetail, STATUS_COLORS } from '../devicesModel';

const KEY = 'settings.devices';

export const DEFAULT_TIMEOUT: DeviceTimeout = 30;

/** Which pairing a route needs. */
export const PAIRING_KIND: Record<DeviceRouteKind, DevicePairingKind> = {
  mac_relay: 'mac_helper',
  companion: 'companion',
  wifi_direct: 'wifi_direct',
};

/** The agent switch and how long it stays on. */
export const DeviceAccessBlock: React.FC<{ device: Device; onChanged: () => void }> = ({ device, onChanged }) => {
  const { t } = useTranslation();
  const [timeout, setTimeoutMinutes] = useState<DeviceTimeout>(DEFAULT_TIMEOUT);
  const [saving, setSaving] = useState(false);
  const usable = device.installed && device.available === 'now' && device.status !== 'needs_pairing';

  const save = async (enabled: boolean, minutes: DeviceTimeout) => {
    setSaving(true);
    try {
      await devicesApi.update.invoke({ id: device.id, enabled, ...(enabled ? { timeout_minutes: minutes } : {}) });
      onChanged();
    } catch {
      Message.error(t(`${KEY}.saveFailed`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DrawerBlock title={t(`${KEY}.access.title`)}>
      <div className='flex flex-col gap-8px' data-testid='device-access'>
        <label className='flex items-center justify-between gap-12px'>
          <span className='text-13px text-t-primary'>{t(`${KEY}.agentSwitch`)}</span>
          <Switch
            checked={device.enabled}
            disabled={!usable}
            loading={saving}
            aria-label={t(`${KEY}.agentSwitch`)}
            onChange={(checked: boolean) => void save(checked, timeout)}
            data-testid='device-access-switch'
          />
        </label>
        <div className='flex flex-wrap items-center justify-between gap-8px'>
          <span className='text-12px text-t-secondary'>{t(`${KEY}.access.timeout`)}</span>
          <Radio.Group
            type='button'
            size='small'
            value={timeout}
            disabled={!usable || saving}
            aria-label={t(`${KEY}.access.timeout`)}
            onChange={(value: DeviceTimeout) => {
              setTimeoutMinutes(value);
              // Already on: the new timeout starts now.
              if (device.enabled) void save(true, value);
            }}
            data-testid='device-access-timeout'
          >
            {DEVICE_TIMEOUTS.map((minutes) => (
              <Radio key={minutes} value={minutes}>
                {t(`${KEY}.access.minutes`, { count: minutes })}
              </Radio>
            ))}
          </Radio.Group>
        </div>
        <p className='m-0 text-12px text-t-secondary leading-relaxed'>{t(`${KEY}.access.hint`)}</p>
      </div>
    </DrawerBlock>
  );
};

const RouteRow: React.FC<{
  device: Device;
  route: DeviceRoute;
  onChanged: () => void;
  onPair: (kind: DevicePairingKind) => void;
}> = ({ device, route, onChanged, onPair }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      await devicesApi.setRoute.invoke({ id: device.id, route: route.route, enabled });
      onChanged();
    } catch {
      Message.error(t(`${KEY}.saveFailed`));
    } finally {
      setSaving(false);
    }
  };
  const name = t(`${KEY}.routes.${route.route}.name`);
  return (
    <li
      className='flex flex-col gap-4px px-12px py-8px rd-10px bg-1 border border-solid border-3'
      data-testid='device-route'
      data-route={route.route}
    >
      <div className='flex flex-wrap items-center gap-8px'>
        <span className='min-w-0 flex-1 text-13px font-medium text-t-primary'>{name}</span>
        {route.experimental ? (
          <Tag size='small' color='orange'>
            {t(`${KEY}.routes.experimental`)}
          </Tag>
        ) : (
          <Tag size='small' color={STATUS_COLORS[route.status]}>
            {t(`${KEY}.status.${route.status}`)}
          </Tag>
        )}
        <Switch
          size='small'
          checked={route.enabled}
          disabled={route.experimental || route.status === 'needs_pairing'}
          loading={saving}
          aria-label={name}
          onChange={(checked: boolean) => void toggle(checked)}
          data-testid='device-route-switch'
        />
      </div>
      <p className='m-0 text-12px text-t-secondary leading-relaxed'>{t(`${KEY}.routes.${route.route}.desc`)}</p>
      {!route.experimental && (route.status === 'needs_pairing' || route.status === 'offline') ? (
        <div>
          <Button size='mini' onClick={() => onPair(PAIRING_KIND[route.route])} data-testid='device-route-pair'>
            {t(route.status === 'offline' ? `${KEY}.routes.repair` : `${KEY}.routes.pair`)}
          </Button>
        </div>
      ) : null}
    </li>
  );
};

/** Connection options, each with its own switch. */
export const DeviceRoutesBlock: React.FC<{
  device: Device;
  onChanged: () => void;
  onPair: (kind: DevicePairingKind) => void;
}> = ({ device, onChanged, onPair }) => {
  const { t } = useTranslation();
  if (!device.routes || device.routes.length === 0) return null;
  return (
    <DrawerBlock title={t(`${KEY}.routes.title`)}>
      <ul className='m-0 p-0 list-none flex flex-col gap-8px' data-testid='device-routes'>
        {device.routes.map((route) => (
          <RouteRow key={route.route} device={device} route={route} onChanged={onChanged} onPair={onPair} />
        ))}
      </ul>
    </DrawerBlock>
  );
};

const OUTCOME_COLORS: Record<DeviceAuditOutcome, string> = {
  ok: 'gray',
  approved: 'green',
  refused: 'orange',
  denied: 'red',
  timeout: 'orange',
  error: 'red',
};

const AUDIT_PAGE = 50;

/** What agents did on the device: verb, app or origin, outcome. Nothing of the screen is kept. */
export const DeviceAuditBlock: React.FC<{ device: Device }> = ({ device }) => {
  const { t, i18n } = useTranslation();
  const [older, setOlder] = useState<DeviceAuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const { data, isLoading } = useSWR(`devices.audit.${device.id}`, async () => {
    try {
      return await devicesApi.audit.invoke({ id: device.id, limit: AUDIT_PAGE });
    } catch {
      return { rows: [], next_cursor: null };
    }
  });
  const rows = [...(data?.rows ?? []), ...older];
  const next = cursor === undefined ? (data?.next_cursor ?? null) : cursor;

  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await devicesApi.audit.invoke({ id: device.id, cursor: next, limit: AUDIT_PAGE });
      setOlder((current) => [...current, ...page.rows]);
      setCursor(page.next_cursor);
    } catch {
      Message.error(t(`${KEY}.audit.failed`));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DrawerBlock title={t(`${KEY}.audit.title`)}>
      <p className='m-0 mb-8px text-12px text-t-secondary'>{t(`${KEY}.audit.hint`)}</p>
      {rows.length === 0 ? (
        <p className='m-0 text-12px text-t-secondary' data-testid='device-audit-empty'>
          {isLoading ? t('common.loading') : t(`${KEY}.audit.empty`)}
        </p>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-4px' data-testid='device-audit'>
          {rows.map((row, index) => {
            const run = row.verb === 'addon_run' ? addonRunDetail(row.detail) : null;
            return (
              <li
                key={`${row.at}-${index}`}
                className='flex flex-wrap items-center gap-6px text-12px'
                data-testid='device-audit-row'
              >
                <span className='text-t-secondary tabular-nums'>
                  {formatDateTime(row.at, i18n.language, { dateStyle: 'short', timeStyle: 'medium' })}
                </span>
                <code className='text-t-primary'>{row.verb}</code>
                {row.package || row.origin ? (
                  <span className='min-w-0 text-t-secondary break-all'>{row.package ?? row.origin}</span>
                ) : null}
                <Tag size='small' color={OUTCOME_COLORS[row.outcome]}>
                  {row.outcome === 'error'
                    ? t(`${KEY}.audit.error`)
                    : t(`preview.browserDevices.outcome.${row.outcome}`)}
                </Tag>
                {run?.task ? (
                  <span className='basis-full text-t-primary break-words' data-testid='device-audit-task'>
                    {run.task}
                  </span>
                ) : null}
                {run?.message ? <span className='basis-full text-t-secondary break-words'>{run.message}</span> : null}
                {run?.traceUrl ? (
                  <Link href={run.traceUrl} target='_blank' rel='noreferrer' data-testid='device-audit-trace'>
                    {t(`${KEY}.audit.trace`)}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {next ? (
        <Button
          size='mini'
          className='mt-8px'
          loading={loading}
          onClick={() => void more()}
          data-testid='device-audit-more'
        >
          {t(`${KEY}.audit.more`)}
        </Button>
      ) : null}
    </DrawerBlock>
  );
};

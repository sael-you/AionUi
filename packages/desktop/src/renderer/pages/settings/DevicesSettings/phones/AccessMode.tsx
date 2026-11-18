/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How much agents may do on a phone or the Mac without asking (TASK-175):
 *
 *   Ask          — sensitive actions wait for the owner (the default);
 *   Trusted apps — apps on the owner's list no longer ask;
 *   Full access  — nothing asks, for 1 h, 8 h or until turned off. It is
 *                  confirmed first, with banking and password apps left out
 *                  unless the owner ticks the box. It also turns the device
 *                  switch on for that time; switching off ends it.
 *
 * `access.mode` from AionCore is the EFFECTIVE mode: a Full access that ran
 * out reads `ask`.
 */

import { Alert, Button, Checkbox, Message, Modal, Radio, Select, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { devices as devicesApi } from '@/common/adapter/ipcBridge';
import type { Device, DeviceAccess, DeviceAccessMode, DeviceFullDuration } from '@/common/types/platform/devices';
import { DrawerBlock } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { minutesLeft } from '../devicesModel';

const KEY = 'settings.devices.accessMode';

export const ACCESS_MODES: readonly DeviceAccessMode[] = ['ask', 'trusted', 'full'];
export const FULL_DURATIONS: readonly DeviceFullDuration[] = ['1h', '8h', 'until_off'];

/** AionCore's rule for an app id: 1–200 letters, digits, `.`, `_`, `-`. */
export const isAppId = (value: string): boolean => /^[A-Za-z0-9._-]{1,200}$/.test(value);
export const MAX_TRUSTED_APPS = 100;

/** Phones and the Mac always carry `access`; anything else has no access mode. */
export const accessOf = (device: Device): DeviceAccess | null =>
  (device.kind === 'phone' || device.kind === 'mac') && device.access ? device.access : null;

/** "Full access · 52 min left" / "· until you turn it off"; amber so it cannot be missed. */
export const FullAccessChip: React.FC<{ access: DeviceAccess; now: number }> = ({ access, now }) => {
  const { t } = useTranslation();
  if (access.mode !== 'full') return null;
  const left = minutesLeft(access.full_until, now);
  return (
    <Tag size='small' color='orange' data-testid='device-full-access'>
      {left === null ? t(`${KEY}.fullChipUntilOff`) : t(`${KEY}.fullChip`, { count: left })}
    </Tag>
  );
};

/**
 * The segmented control (card and drawer). Ask and Trusted apps apply at once;
 * Full access asks first.
 */
export const AccessModeControl: React.FC<{
  device: Device;
  access: DeviceAccess;
  disabled?: boolean;
  onChanged: () => void;
}> = ({ device, access, disabled, onChanged }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [duration, setDuration] = useState<DeviceFullDuration>('1h');
  const [sensitive, setSensitive] = useState(false);

  const apply = async (body: {
    mode: DeviceAccessMode;
    full_duration?: DeviceFullDuration;
    include_sensitive?: boolean;
  }) => {
    setSaving(true);
    try {
      await devicesApi.setAccess.invoke({ id: device.id, ...body });
      onChanged();
      return true;
    } catch {
      Message.error(t('settings.devices.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const pick = (mode: DeviceAccessMode) => {
    if (mode === access.mode) return;
    if (mode === 'full') {
      // Nothing is sent until the owner confirms; the box starts unchecked every time.
      setDuration('1h');
      setSensitive(false);
      setConfirming(true);
      return;
    }
    void apply({ mode });
  };

  return (
    <>
      <Radio.Group
        type='button'
        size='mini'
        value={access.mode}
        disabled={disabled || saving}
        aria-label={t(`${KEY}.label`, { name: device.name })}
        onChange={(mode: DeviceAccessMode) => pick(mode)}
        data-testid='device-access-mode'
      >
        {ACCESS_MODES.map((mode) => (
          <Radio key={mode} value={mode}>
            {t(`${KEY}.modes.${mode}`)}
          </Radio>
        ))}
      </Radio.Group>
      <Modal
        visible={confirming}
        title={t(`${KEY}.fullTitle`, { name: device.name })}
        okText={t(`${KEY}.fullConfirm`)}
        cancelText={t('common.cancel')}
        okButtonProps={{ status: 'warning' }}
        confirmLoading={saving}
        onOk={async () => {
          if (await apply({ mode: 'full', full_duration: duration, include_sensitive: sensitive }))
            setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
        unmountOnExit
        style={{ width: 480, maxWidth: 'calc(100vw - 32px)' }}
      >
        <div className='flex flex-col gap-12px' data-testid='device-full-confirm'>
          <Alert type='warning' content={t(`${KEY}.fullWarning`)} />
          <div className='flex flex-col gap-6px'>
            <span id='device-full-duration' className='text-13px text-t-secondary'>
              {t(`${KEY}.fullDuration`)}
            </span>
            <Radio.Group
              type='button'
              value={duration}
              aria-labelledby='device-full-duration'
              onChange={(value: DeviceFullDuration) => setDuration(value)}
              data-testid='device-full-duration-choice'
            >
              {FULL_DURATIONS.map((value) => (
                <Radio key={value} value={value}>
                  {t(`${KEY}.durations.${value}`)}
                </Radio>
              ))}
            </Radio.Group>
          </div>
          <Checkbox
            checked={sensitive}
            onChange={(checked: boolean) => setSensitive(checked)}
            data-testid='device-full-sensitive'
          >
            {t(`${KEY}.includeSensitive`)}
          </Checkbox>
          <p className='m-0 text-12px text-t-secondary leading-relaxed'>
            {t(sensitive ? `${KEY}.sensitiveOnHint` : `${KEY}.sensitiveOffHint`)}
          </p>
        </div>
      </Modal>
    </>
  );
};

/** Apps agents were allowed to use lately: the candidates for the trusted list. */
const useRecentApps = (device: Device): string[] => {
  const { data } = useSWR(`devices.audit.recent-apps.${device.id}`, async () => {
    try {
      return (await devicesApi.audit.invoke({ id: device.id, limit: 100 })).rows;
    } catch {
      return [];
    }
  });
  const apps = (data ?? [])
    .filter((row) => row.outcome === 'approved' && row.package && isAppId(row.package) && row.package !== 'unknown')
    .map((row) => row.package as string);
  return [...new Set(apps)];
};

/** Drawer: the mode with what it means, the trusted apps (add from recent approvals, remove). */
export const AccessModeBlock: React.FC<{ device: Device; now: number; onChanged: () => void }> = ({
  device,
  now,
  onChanged,
}) => {
  const { t } = useTranslation();
  const access = accessOf(device);
  const recent = useRecentApps(device);
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  if (!access) return null;
  const usable = device.installed && device.available === 'now' && device.status !== 'needs_pairing';
  const candidates = recent.filter((app) => !access.trusted_apps.includes(app));

  const saveApps = async (apps: string[]) => {
    setSaving(true);
    try {
      await devicesApi.setTrustedApps.invoke({ id: device.id, apps });
      setAdding(undefined);
      onChanged();
    } catch {
      Message.error(t('settings.devices.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const setSensitive = async (include: boolean) => {
    setSaving(true);
    try {
      await devicesApi.setAccess.invoke({ id: device.id, mode: 'trusted', include_sensitive: include });
      onChanged();
    } catch {
      Message.error(t('settings.devices.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const candidate = adding?.trim() ?? '';
  const canAdd =
    isAppId(candidate) &&
    candidate !== 'unknown' &&
    !access.trusted_apps.includes(candidate) &&
    access.trusted_apps.length < MAX_TRUSTED_APPS;

  return (
    <DrawerBlock title={t(`${KEY}.title`)}>
      <div className='flex flex-col gap-10px' data-testid='device-access-mode-block'>
        <div className='flex flex-wrap items-center gap-8px'>
          <AccessModeControl device={device} access={access} disabled={!usable} onChanged={onChanged} />
          <FullAccessChip access={access} now={now} />
        </div>
        <p className='m-0 text-12px text-t-secondary leading-relaxed' data-testid='device-access-mode-hint'>
          {t(`${KEY}.hints.${access.mode}`)}
          {access.mode === 'full' && access.include_sensitive ? ` ${t(`${KEY}.sensitiveOnHint`)}` : ''}
        </p>
        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-primary'>
            {t(`${KEY}.trustedTitle`, { count: access.trusted_apps.length })}
          </span>
          {access.trusted_apps.length === 0 ? (
            <span className='text-12px text-t-secondary'>{t(`${KEY}.trustedEmpty`)}</span>
          ) : (
            <div className='flex flex-wrap gap-6px' data-testid='device-trusted-apps'>
              {access.trusted_apps.map((app) => (
                <Tag
                  key={app}
                  closable
                  onClose={() => void saveApps(access.trusted_apps.filter((entry) => entry !== app))}
                  data-testid='device-trusted-app'
                  data-app={app}
                >
                  {app}
                </Tag>
              ))}
            </div>
          )}
          <div className='flex flex-wrap items-center gap-8px'>
            <Select
              size='small'
              className='min-w-200px flex-1'
              allowCreate
              showSearch
              value={adding}
              placeholder={t(`${KEY}.trustedAdd`)}
              aria-label={t(`${KEY}.trustedAdd`)}
              onChange={(value: string) => setAdding(value)}
              data-testid='device-trusted-add'
            >
              {candidates.map((app) => (
                <Select.Option key={app} value={app}>
                  {app}
                </Select.Option>
              ))}
            </Select>
            <Button
              size='small'
              loading={saving}
              disabled={!canAdd}
              onClick={() => void saveApps([...access.trusted_apps, candidate])}
              data-testid='device-trusted-add-button'
            >
              {t(`${KEY}.trustedAddButton`)}
            </Button>
          </div>
          <span className='text-12px text-t-secondary'>{t(`${KEY}.trustedHint`)}</span>
          {access.mode === 'trusted' ? (
            <Checkbox
              checked={access.include_sensitive}
              disabled={saving}
              onChange={(checked: boolean) => void setSensitive(checked)}
              data-testid='device-trusted-sensitive'
            >
              {t(`${KEY}.includeSensitive`)}
            </Checkbox>
          ) : null}
        </div>
      </div>
    </DrawerBlock>
  );
};

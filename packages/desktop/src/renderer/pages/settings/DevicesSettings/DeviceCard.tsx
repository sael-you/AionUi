/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One device on Settings → Devices (C38 §5): kind icon, name, status, the
 * connection / version / disk chips, the agent switch, and Install or the
 * install / remove progress. Opens the details drawer.
 */

import { Button, Progress, Tag, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/common/types/platform/devices';
import type { BrowserEngineStatus } from '@/common/types/platform/serverBrowser';
import LibraryCard, {
  type LibraryCardMenuItem,
} from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { descriptionKey, formatDiskSize, isBusy, isUnreachable, minutesLeft, STATUS_COLORS } from './devicesModel';
import { accessOf, AccessModeControl, FullAccessChip } from './phones/AccessMode';
import { JOB_LOST, useDeviceJob } from './useDevices';

const KEY = 'settings.devices';

/** Status word + colour; `later` replaces it for what cannot be installed yet. */
export const DeviceStatusTag: React.FC<{ device: Device }> = ({ device }) => {
  const { t } = useTranslation();
  if (device.available === 'later') {
    return (
      <Tag size='small' color='gray' data-testid='device-status'>
        {t(`${KEY}.later`)}
      </Tag>
    );
  }
  return (
    <Tag size='small' color={STATUS_COLORS[device.status]} data-testid='device-status'>
      {t(`${KEY}.status.${device.status}`)}
    </Tag>
  );
};

/** The running job's bar (or its failure). */
export const DeviceJobProgress: React.FC<{ device: Device; onFinished: () => void }> = ({ device, onFinished }) => {
  const { t } = useTranslation();
  const job = useDeviceJob(isBusy(device) ? device.job_id : null, device.id, onFinished);
  if (!job) return null;
  if (job.state === 'failed') {
    return (
      <span className='text-12px text-danger-6' data-testid='device-job-failed'>
        {t(`${KEY}.jobFailed`, { error: job.error === JOB_LOST || !job.error ? t(`${KEY}.jobLost`) : job.error })}
      </span>
    );
  }
  if (job.state === 'done') return null;
  return (
    <Progress
      size='small'
      percent={job.progress}
      className='min-w-120px flex-1'
      aria-label={t(device.status === 'removing' ? `${KEY}.removing` : `${KEY}.installing`, {
        name: device.name,
      })}
      data-testid='device-job-progress'
    />
  );
};

/** How AionCore verified the engine download, and whether it is for agents only (C35, TASK-134). */
export const EngineChips: React.FC<{ engine: BrowserEngineStatus }> = ({ engine }) => {
  const { t } = useTranslation();
  const signed = engine.verification === 'signed-repository' || engine.verification === 'pinned-sha256';
  return (
    <>
      {engine.verification ? (
        <Tooltip content={t(signed ? `${KEY}.engine.signedTip` : `${KEY}.engine.tlsOnlyTip`)}>
          <Tag size='small' color={signed ? 'green' : 'orange'} tabIndex={0} data-testid='engine-verification'>
            {t(signed ? `${KEY}.engine.signed` : `${KEY}.engine.tlsOnly`)}
          </Tag>
        </Tooltip>
      ) : null}
      {engine.agents_only ? (
        <Tooltip content={t(`${KEY}.engine.agentsOnlyTip`)}>
          <Tag size='small' color='purple' tabIndex={0} data-testid='engine-agents-only'>
            {t(`${KEY}.engine.agentsOnly`)}
          </Tag>
        </Tooltip>
      ) : null}
    </>
  );
};

/** Battery, and what stops agents right now: a locked screen, accessibility off (TASK-173). */
export const HealthChips: React.FC<{ device: Device }> = ({ device }) => {
  const { t } = useTranslation();
  const health = device.health;
  if (!health || isUnreachable(device)) return null;
  return (
    <>
      {typeof health.battery_percent === 'number' ? (
        <span data-testid='device-battery'>
          {t(health.charging ? `${KEY}.health.batteryCharging` : `${KEY}.health.battery`, {
            percent: health.battery_percent,
          })}
        </span>
      ) : null}
      {health.locked ? (
        <Tooltip content={t(`${KEY}.health.lockedTip`)}>
          <Tag size='small' color='orange' tabIndex={0} data-testid='device-locked'>
            {t(`${KEY}.health.locked`)}
          </Tag>
        </Tooltip>
      ) : null}
      {health.accessibility_on ? null : (
        <Tooltip content={t(`${KEY}.health.accessibilityOffTip`)}>
          <Tag size='small' color='red' tabIndex={0} data-testid='device-accessibility-off'>
            {t(`${KEY}.health.accessibilityOff`)}
          </Tag>
        </Tooltip>
      )}
    </>
  );
};

export type DeviceCardProps = {
  device: Device;
  /** An offline card of a phone that is also paired under the same name: offer Remove. */
  offlineDuplicate?: boolean;
  /** Server browsers: the engine's status from `GET /api/browser/status`. */
  engine?: BrowserEngineStatus;
  now: number;
  saving: boolean;
  onToggle: (device: Device, enabled: boolean) => void;
  onInstall: (device: Device) => void;
  onRemove: (device: Device) => void;
  onOpen: (device: Device) => void;
  onJobFinished: () => void;
  /** The device changed (access mode): refresh the list. */
  onChanged?: () => void;
};

const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  offlineDuplicate,
  engine,
  now,
  saving,
  onToggle,
  onInstall,
  onRemove,
  onOpen,
  onJobFinished,
  onChanged,
}) => {
  const { t, i18n } = useTranslation();
  const busy = isBusy(device);
  const description = descriptionKey(device);
  const left = device.enabled ? minutesLeft(device.enabled_until, now) : null;
  const offline = isUnreachable(device);
  const access = accessOf(device);
  // An offline device cannot be switched ON (nothing would reach it); one left on can still be switched off.
  const canToggle =
    device.installed &&
    device.available === 'now' &&
    device.status !== 'needs_pairing' &&
    !busy &&
    (!offline || device.enabled);

  const chips = (
    <>
      <DeviceStatusTag device={device} />
      {device.version ? <span>{t(`${KEY}.version`, { version: device.version })}</span> : null}
      {device.disk_bytes !== null && device.installed ? (
        <span>{t(`${KEY}.disk`, { size: formatDiskSize(device.disk_bytes, i18n.language) })}</span>
      ) : null}
      {access?.mode === 'full' ? (
        // Full access has its own clock (the switch stays on for exactly that long).
        <FullAccessChip access={access} now={now} />
      ) : left !== null ? (
        <span data-testid='device-off-in'>{t(`${KEY}.offIn`, { count: left })}</span>
      ) : null}
      {offline && device.last_seen_at ? (
        <span data-testid='device-last-seen'>
          {t('settings.browserDevices.lastSeen', {
            time: formatDateTime(device.last_seen_at, i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </span>
      ) : null}
      {device.kind === 'phone' ? <HealthChips device={device} /> : null}
      {engine ? <EngineChips engine={engine} /> : null}
    </>
  );

  const menu: LibraryCardMenuItem[] = [{ key: 'details', label: t(`${KEY}.details`), onClick: () => onOpen(device) }];
  if (device.installed && engine && device.available === 'now') {
    // Download the engine's current version over the installed one.
    menu.push({ key: 'update', label: t(`${KEY}.engine.update`), disabled: busy, onClick: () => onInstall(device) });
  }
  if (offlineDuplicate || (device.installed && (device.kind === 'server_browser' || device.kind === 'addon'))) {
    menu.push({
      key: 'remove',
      label: t(`${KEY}.remove`),
      danger: true,
      disabled: busy,
      onClick: () => onRemove(device),
    });
  }

  let action: React.ReactNode = null;
  if (busy) {
    action = <DeviceJobProgress device={device} onFinished={onJobFinished} />;
  } else if (!device.installed && device.available === 'now') {
    action = (
      <Button size='small' type='primary' onClick={() => onInstall(device)} data-testid='device-install'>
        {t(`${KEY}.install`)}
      </Button>
    );
  }

  if (!action && access && device.installed && device.available === 'now' && device.status !== 'needs_pairing') {
    action = <AccessModeControl device={device} access={access} disabled={offline} onChanged={() => onChanged?.()} />;
  }

  return (
    <LibraryCard
      id={device.id}
      name={device.name}
      visual={device.kind}
      description={
        engine?.error && !busy
          ? t(`${KEY}.engine.failed`, { error: engine.error })
          : offlineDuplicate
            ? t(`${KEY}.health.duplicate`)
            : description
              ? t(description)
              : undefined
      }
      chips={chips}
      action={action}
      toggle={
        canToggle
          ? {
              checked: device.enabled,
              label: t(`${KEY}.agentSwitch`),
              loading: saving,
              onChange: (checked: boolean) => onToggle(device, checked),
            }
          : null
      }
      menu={menu}
      onOpen={() => onOpen(device)}
    />
  );
};

export default DeviceCard;

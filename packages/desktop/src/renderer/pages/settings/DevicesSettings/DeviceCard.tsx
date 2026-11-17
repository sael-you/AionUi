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

import { Button, Progress, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/common/types/platform/devices';
import LibraryCard, {
  type LibraryCardMenuItem,
} from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import { formatDiskSize, isBusy, minutesLeft, STATUS_COLORS } from './devicesModel';
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

export type DeviceCardProps = {
  device: Device;
  now: number;
  saving: boolean;
  onToggle: (device: Device, enabled: boolean) => void;
  onInstall: (device: Device) => void;
  onRemove: (device: Device) => void;
  onOpen: (device: Device) => void;
  onJobFinished: () => void;
};

const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  now,
  saving,
  onToggle,
  onInstall,
  onRemove,
  onOpen,
  onJobFinished,
}) => {
  const { t, i18n } = useTranslation();
  const busy = isBusy(device);
  const left = device.enabled ? minutesLeft(device.enabled_until, now) : null;
  const canToggle = device.installed && device.available === 'now' && device.status !== 'needs_pairing' && !busy;

  const chips = (
    <>
      <DeviceStatusTag device={device} />
      {device.version ? <span>{t(`${KEY}.version`, { version: device.version })}</span> : null}
      {device.disk_bytes !== null && device.installed ? (
        <span>{t(`${KEY}.disk`, { size: formatDiskSize(device.disk_bytes, i18n.language) })}</span>
      ) : null}
      {left !== null ? <span data-testid='device-off-in'>{t(`${KEY}.offIn`, { count: left })}</span> : null}
    </>
  );

  const menu: LibraryCardMenuItem[] = [{ key: 'details', label: t(`${KEY}.details`), onClick: () => onOpen(device) }];
  if (device.installed && (device.kind === 'server_browser' || device.kind === 'addon')) {
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

  return (
    <LibraryCard
      id={device.id}
      name={device.name}
      visual={device.kind}
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

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The details drawer of a device (C38 §5): status, version, disk size, last
 * seen, when the switch turns itself off; Install / Remove. Phone routes,
 * pairing and the audit join it with U2; add-ons with U3.
 */

import { Button, Descriptions } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/common/types/platform/devices';
import { DrawerBlock, LibraryDrawer } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { DeviceJobProgress, DeviceStatusTag } from './DeviceCard';
import { formatDiskSize, isBusy } from './devicesModel';

const KEY = 'settings.devices';

type DetailRow = { label: string; value: React.ReactNode };

export type DeviceDrawerProps = {
  device: Device | null;
  isMobile: boolean;
  onClose: () => void;
  onInstall: (device: Device) => void;
  onRemove: (device: Device) => void;
  onJobFinished: () => void;
  /** Kind-specific blocks (phone routes, add-on runs). */
  children?: React.ReactNode;
};

const DeviceDrawer: React.FC<DeviceDrawerProps> = ({
  device,
  isMobile,
  onClose,
  onInstall,
  onRemove,
  onJobFinished,
  children,
}) => {
  const { t, i18n } = useTranslation();
  const when = (at: number) => formatDateTime(at, i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const removable = device?.installed && (device.kind === 'server_browser' || device.kind === 'addon');
  const installable = device && !device.installed && device.available === 'now';

  const footer = device ? (
    <div className='flex flex-wrap gap-8px justify-end'>
      {installable ? (
        <Button type='primary' disabled={isBusy(device)} onClick={() => onInstall(device)}>
          {t(`${KEY}.install`)}
        </Button>
      ) : null}
      {removable ? (
        <Button status='danger' disabled={isBusy(device)} onClick={() => onRemove(device)}>
          {t(`${KEY}.remove`)}
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <LibraryDrawer
      visible={device !== null}
      title={device?.name ?? ''}
      isMobile={isMobile}
      onClose={onClose}
      footer={installable || removable ? footer : undefined}
      testId='device-drawer'
    >
      {device ? (
        <>
          <DrawerBlock title={t(`${KEY}.drawer.about`)}>
            <Descriptions
              column={1}
              size='small'
              data={(
                [
                  { label: t(`${KEY}.drawer.status`), value: <DeviceStatusTag device={device} /> },
                  device.version ? { label: t(`${KEY}.drawer.version`), value: device.version } : null,
                  device.disk_bytes !== null && device.installed
                    ? { label: t(`${KEY}.drawer.disk`), value: formatDiskSize(device.disk_bytes, i18n.language) }
                    : null,
                  device.last_seen_at ? { label: t(`${KEY}.drawer.lastSeen`), value: when(device.last_seen_at) } : null,
                  device.health?.model ? { label: t(`${KEY}.drawer.model`), value: device.health.model } : null,
                  device.health?.android_version
                    ? { label: t(`${KEY}.drawer.android`), value: device.health.android_version }
                    : null,
                  typeof device.health?.battery_percent === 'number'
                    ? {
                        label: t(`${KEY}.drawer.battery`),
                        value: t(device.health.charging ? `${KEY}.health.batteryCharging` : `${KEY}.health.battery`, {
                          percent: device.health.battery_percent,
                        }),
                      }
                    : null,
                  device.enabled && device.enabled_until
                    ? { label: t(`${KEY}.drawer.until`), value: when(device.enabled_until) }
                    : null,
                ] as Array<DetailRow | null>
              ).filter((row): row is DetailRow => row !== null)}
              data-testid='device-drawer-details'
            />
            {isBusy(device) ? (
              <div className='mt-8px flex'>
                <DeviceJobProgress device={device} onFinished={onJobFinished} />
              </div>
            ) : null}
            {device.available === 'later' ? (
              <p className='m-0 mt-8px text-12px text-t-secondary'>{t(`${KEY}.laterHint`)}</p>
            ) : null}
          </DrawerBlock>
          {children}
        </>
      ) : null}
    </LibraryDrawer>
  );
};

export default DeviceDrawer;

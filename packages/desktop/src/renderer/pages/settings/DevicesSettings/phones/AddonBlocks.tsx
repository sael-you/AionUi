/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drawer blocks for add-ons and the Mac (C38 §5, TASK-136 U3). An add-on
 * (Artemis, Mobilerun) runs its own model loop on the phone: agents get one
 * tool, "run this flow", and the owner approves each task text before it
 * starts — single taps cannot be gated inside its loop. The Mac needs two
 * macOS permissions.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/common/types/platform/devices';
import { DrawerBlock } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import { knownAddon } from '../devicesModel';

const KEY = 'settings.devices';

export const AddonBlock: React.FC<{ device: Device; host: Device | null }> = ({ device, host }) => {
  const { t } = useTranslation();
  const addon = knownAddon(device) ?? 'generic';
  return (
    <DrawerBlock title={t(`${KEY}.addons.title`)}>
      <div className='flex flex-col gap-6px text-12px text-t-secondary leading-relaxed' data-testid='device-addon'>
        <p className='m-0 text-13px text-t-primary'>{t(`${KEY}.addons.${addon}.desc`)}</p>
        {addon !== 'generic' ? <p className='m-0'>{t(`${KEY}.addons.${addon}.licence`)}</p> : null}
        <p className='m-0'>{t(`${KEY}.addons.approval`)}</p>
        <p className='m-0' data-testid='device-addon-host'>
          {host ? t(`${KEY}.addons.runsOn`, { name: host.name }) : t(`${KEY}.addons.needsRoute`)}
        </p>
      </div>
    </DrawerBlock>
  );
};

export const MacBlock: React.FC = () => {
  const { t } = useTranslation();
  return (
    <DrawerBlock title={t(`${KEY}.mac.title`)}>
      <div className='flex flex-col gap-6px text-12px text-t-secondary leading-relaxed' data-testid='device-mac'>
        <p className='m-0 text-13px text-t-primary'>{t(`${KEY}.mac.desc`)}</p>
        <p className='m-0'>{t(`${KEY}.mac.permissions`)}</p>
      </div>
    </DrawerBlock>
  );
};

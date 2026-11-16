/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The browser panel's switcher: the server profiles (TASK-124) and the owner's
 * own paired browsers (C34 / TASK-125, e.g. "Mac · Chrome"), with an online dot.
 */

import { Select } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BrowserDevice } from '@/common/types/platform/serverBrowser';
import BrowserProfileLabel from './BrowserProfileLabel';
import { DeviceLabel } from './DeviceBrowserView';
import type { ServerBrowserProfile } from './useServerBrowserAvailability';

export type BrowserScope = { kind: 'profile'; instance: number } | { kind: 'device'; deviceId: string };

const keyOf = (scope: BrowserScope): string =>
  scope.kind === 'profile' ? `p:${scope.instance}` : `d:${scope.deviceId}`;

const scopeOf = (key: string): BrowserScope =>
  key.startsWith('d:')
    ? { kind: 'device', deviceId: key.slice(2) }
    : { kind: 'profile', instance: Number(key.slice(2)) };

const BrowserScopeSelect: React.FC<{
  profiles: ServerBrowserProfile[];
  devices: BrowserDevice[];
  value: BrowserScope;
  onChange: (scope: BrowserScope) => void;
}> = ({ profiles, devices, value, onChange }) => {
  const { t } = useTranslation();
  if (profiles.length === 0 && devices.length === 0) return null;
  return (
    <Select
      size='small'
      className='w-110px md:w-160px flex-shrink-0'
      value={keyOf(value)}
      aria-label={t('preview.serverBrowser.profileLabel')}
      renderFormat={(_option, key) => {
        const scope = scopeOf(String(key));
        if (scope.kind === 'device') {
          const device = devices.find((entry) => entry.device_id === scope.deviceId);
          return device ? <DeviceLabel device={device} /> : null;
        }
        const profile = profiles.find((entry) => entry.instance === scope.instance);
        return profile ? <BrowserProfileLabel profile={profile} /> : null;
      }}
      onChange={(key: string) => onChange(scopeOf(key))}
      // The list may be wider than the narrow phone trigger: grow it and keep it on screen (right-aligned).
      triggerProps={{ autoAlignPopupWidth: false, autoAlignPopupMinWidth: true, position: 'br' }}
      data-testid='server-browser-profile'
    >
      {profiles.map((profile) => (
        <Select.Option key={`p:${profile.instance}`} value={`p:${profile.instance}`}>
          <BrowserProfileLabel profile={profile} />
        </Select.Option>
      ))}
      {devices.length > 0 ? (
        <Select.OptGroup label={t('preview.browserDevices.groupLabel')}>
          {devices.map((device) => (
            <Select.Option key={`d:${device.device_id}`} value={`d:${device.device_id}`}>
              <DeviceLabel device={device} />
            </Select.Option>
          ))}
        </Select.OptGroup>
      ) : null}
    </Select>
  );
};

export default BrowserScopeSelect;

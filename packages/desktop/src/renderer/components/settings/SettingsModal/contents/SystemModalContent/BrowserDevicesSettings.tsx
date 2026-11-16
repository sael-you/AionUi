/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Browser → "Your own browser" (C34 / TASK-125): the switch
 * "Agents may use my Mac browser", pairing the AionUi Browser Bridge extension
 * with a one-time code, and the paired browsers (online, shared tabs, last
 * seen, Revoke). Agents only ever see the tabs the owner shares in the
 * extension.
 */

import { Alert, Button, Empty, Message, Modal, Switch, Tag } from '@arco-design/web-react';
import { Copy, Plus } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type { BrowserDevice, BrowserPairingCode, BrowserSettings } from '@/common/types/platform/serverBrowser';
import { DeviceLabel } from '@/renderer/pages/conversation/Preview/browser/server/BrowserScopeSelect';
import { useBrowserDevices } from '@/renderer/pages/conversation/Preview/browser/server/useBrowserDevices';
import { SERVER_BROWSER_SETTINGS_KEY } from '@/renderer/pages/conversation/Preview/browser/server/useServerBrowserAvailability';
import { formatDateTime } from '@/renderer/services/i18n/format';
import PreferenceRow from './PreferenceRow';

const secondsLeft = (expiresAt: number, now: number) => Math.max(0, Math.ceil((expiresAt - now) / 1000));

/** "4:32" for a countdown. */
export const formatCountdown = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const PairingModal: React.FC<{
  pairing: BrowserPairingCode | null;
  onClose: () => void;
  onRenew: () => void;
}> = ({ pairing, onClose, onRenew }) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pairing) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  const left = pairing ? secondsLeft(pairing.expires_at, now) : 0;
  const address = typeof window === 'undefined' ? '' : window.location.origin;
  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      Message.success(t('settings.browserDevices.pair.copied'));
    } catch {
      Message.error(t('settings.browserDevices.pair.copyFailed'));
    }
  };
  return (
    <Modal
      visible={pairing !== null}
      title={t('settings.browserDevices.pair.title')}
      onCancel={onClose}
      footer={
        left === 0 ? (
          <Button type='primary' onClick={onRenew}>
            {t('settings.browserDevices.pair.renew')}
          </Button>
        ) : (
          <Button onClick={onClose}>{t('common.close')}</Button>
        )
      }
      unmountOnExit
      style={{ width: 460, maxWidth: 'calc(100vw - 32px)' }}
    >
      {pairing ? (
        <div className='flex flex-col gap-12px' data-testid='browser-pairing'>
          <ol className='m-0 ps-20px flex flex-col gap-4px text-13px text-t-secondary'>
            <li>{t('settings.browserDevices.pair.stepOpen')}</li>
            <li>
              {t('settings.browserDevices.pair.stepAddress')}{' '}
              <code className='px-4px rd-4px bg-fill-2 text-t-primary break-all'>{address}</code>
            </li>
            <li>{t('settings.browserDevices.pair.stepCode')}</li>
          </ol>
          <div className='flex items-center justify-center gap-8px'>
            <span
              className='text-28px font-semibold tracking-[0.2em] text-t-primary font-mono select-all'
              aria-label={t('settings.browserDevices.pair.codeLabel')}
              data-testid='browser-pairing-code'
            >
              {pairing.code}
            </span>
            <Button
              size='small'
              icon={<Copy theme='outline' size={14} />}
              aria-label={t('settings.browserDevices.pair.copy')}
              onClick={() => void copy()}
            />
          </div>
          <p className='m-0 text-center text-12px text-t-secondary' aria-live='polite'>
            {left > 0
              ? t('settings.browserDevices.pair.expiresIn', { time: formatCountdown(left) })
              : t('settings.browserDevices.pair.expired')}
          </p>
        </div>
      ) : null}
    </Modal>
  );
};

const BrowserDevicesSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [modal, modalContextHolder] = Modal.useModal();
  const { data: settings } = useSWR<BrowserSettings>(SERVER_BROWSER_SETTINGS_KEY, () =>
    serverBrowser.getSettings.invoke()
  );
  const { devices, reload } = useBrowserDevices();
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState<BrowserPairingCode | null>(null);
  const [creating, setCreating] = useState(false);
  const devicesAtPairing = useRef<Set<string> | null>(null);

  // A new device appeared while the code was on screen: it paired.
  useEffect(() => {
    if (!pairing || !devicesAtPairing.current) return;
    const added = devices.find((device) => !devicesAtPairing.current?.has(device.device_id));
    if (added) {
      Message.success(t('settings.browserDevices.pair.done', { name: added.name }));
      setPairing(null);
    }
  }, [devices, pairing, t]);

  const toggleAgents = async (checked: boolean) => {
    setSaving(true);
    try {
      const next = await serverBrowser.updateSettings.invoke({ devices_agents_enabled: checked });
      await mutate(SERVER_BROWSER_SETTINGS_KEY, next, { revalidate: false });
      Message.success(t('settings.serverBrowser.saved'));
    } catch {
      Message.error(t('settings.serverBrowser.errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const startPairing = async () => {
    setCreating(true);
    try {
      devicesAtPairing.current = new Set(devices.map((device) => device.device_id));
      setPairing(await serverBrowser.createPairingCode.invoke());
    } catch {
      Message.error(t('settings.browserDevices.pair.failed'));
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = (device: BrowserDevice) => {
    modal.confirm?.({
      title: t('settings.browserDevices.revokeTitle', { name: device.name }),
      content: t('settings.browserDevices.revokeContent'),
      okText: t('settings.browserDevices.revoke'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await serverBrowser.revokeDevice.invoke({ device_id: device.device_id });
          await reload();
          Message.success(t('settings.browserDevices.revoked', { name: device.name }));
        } catch {
          Message.error(t('settings.browserDevices.revokeFailed'));
        }
      },
    });
  };

  return (
    <section
      className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'
      aria-labelledby='browser-devices-title'
      data-testid='browser-devices-settings'
    >
      {modalContextHolder}
      <div className='flex flex-wrap items-center justify-between gap-8px mb-8px'>
        <h3 id='browser-devices-title' className='m-0 text-14px font-medium text-t-primary'>
          {t('settings.browserDevices.title')}
        </h3>
        <Button
          size='small'
          icon={<Plus theme='outline' size={14} />}
          loading={creating}
          onClick={() => void startPairing()}
          data-testid='browser-devices-pair'
        >
          {t('settings.browserDevices.pairButton')}
        </Button>
      </div>
      <p className='m-0 mb-8px text-12px text-t-secondary leading-relaxed'>{t('settings.browserDevices.description')}</p>
      {settings ? (
        <PreferenceRow
          label={t('settings.browserDevices.agentsLabel')}
          description={t('settings.browserDevices.agentsDesc')}
        >
          <Switch
            checked={settings.devices_agents_enabled ?? false}
            loading={saving}
            aria-label={t('settings.browserDevices.agentsLabel')}
            onChange={(checked: boolean) => void toggleAgents(checked)}
            data-testid='browser-devices-agents'
          />
        </PreferenceRow>
      ) : null}
      {settings?.devices_agents_enabled && !settings.agents_enabled ? (
        <Alert className='mb-8px' type='info' content={t('settings.browserDevices.needsAgentsOn')} />
      ) : null}
      {devices.length === 0 ? (
        <Empty description={t('settings.browserDevices.none')} />
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-8px' data-testid='browser-devices-list'>
          {devices.map((device) => (
            <li
              key={device.device_id}
              className='flex flex-wrap items-center gap-8px px-12px py-8px rd-10px bg-1 border border-solid border-3'
              data-testid='browser-device-row'
            >
              <span className='min-w-0 flex-1 flex flex-col gap-2px'>
                <DeviceLabel device={device} />
                <span className='text-12px text-t-secondary'>
                  {[
                    device.browser,
                    t('settings.browserDevices.sharedTabs', { count: device.shared_tabs }),
                    device.last_seen_at
                      ? t('settings.browserDevices.lastSeen', {
                          time: formatDateTime(device.last_seen_at, i18n.language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Tag size='small' color={device.online ? 'green' : 'gray'}>
                {t(device.online ? 'preview.browserDevices.online' : 'preview.browserDevices.offline')}
              </Tag>
              <Button
                size='mini'
                status='danger'
                type='outline'
                aria-label={t('settings.browserDevices.revokeLabel', { name: device.name })}
                onClick={() => confirmRevoke(device)}
                data-testid='browser-device-revoke'
              >
                {t('settings.browserDevices.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <PairingModal pairing={pairing} onClose={() => setPairing(null)} onRenew={() => void startPairing()} />
    </section>
  );
};

export default BrowserDevicesSettings;

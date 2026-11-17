/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pairing a phone route (C38 §5, TASK-136 U2): a one-time code from AionCore
 * with a countdown. Companion app: one QR for the short-lived APK link and
 * one the app scans to pair (`aionui-pair:v1?host=…&code=…`), with the app's
 * limits said plainly. Mac helper: download, the Gatekeeper step, then the
 * address and the code.
 */

import { Button, Message, Modal } from '@arco-design/web-react';
import { Copy, Download } from '@icon-park/react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { devices as devicesApi } from '@/common/adapter/ipcBridge';
import type { DevicePairingCode, DevicePairingKind } from '@/common/types/platform/devices';
import { formatCountdown } from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings';
import { copyText } from '@/renderer/utils/ui/clipboard';

const KEY = 'settings.devices.pair';
const PAIR = 'settings.browserDevices.pair';

const COMPANION_LIMITS = ['notPlay', 'restricted', 'consent', 'protection', 'verification', 'noChrome'] as const;

const QrBlock: React.FC<{ value: string; label: string; testId: string }> = ({ value, label, testId }) => (
  <figure className='m-0 flex flex-col items-center gap-6px'>
    <span className='p-8px rd-8px bg-white' data-testid={testId} data-value={value}>
      <QRCodeSVG value={value} size={148} title={label} />
    </span>
    <figcaption className='text-12px text-t-secondary text-center'>{label}</figcaption>
  </figure>
);

export type DevicePairingModalProps = {
  /** What to pair; null = closed. */
  kind: DevicePairingKind | null;
  onClose: () => void;
};

const DevicePairingModal: React.FC<DevicePairingModalProps> = ({ kind, onClose }) => {
  const { t } = useTranslation();
  const [pairing, setPairing] = useState<DevicePairingCode | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!kind) return undefined;
    let stale = false;
    setPairing(null);
    setFailed(false);
    devicesApi.createPairingCode
      .invoke({ kind })
      .then((code) => {
        if (!stale) setPairing(code);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [kind, attempt]);

  useEffect(() => {
    if (!kind) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [kind]);

  const left = pairing ? Math.max(0, Math.ceil((pairing.expires_at - now) / 1000)) : 0;
  const expired = pairing !== null && left === 0;
  const address = typeof window === 'undefined' ? '' : window.location.origin;
  const copy = async () => {
    if (!pairing) return;
    try {
      await copyText(pairing.code);
      Message.success(t(`${PAIR}.copied`));
    } catch {
      Message.error(t(`${PAIR}.copyFailed`));
    }
  };

  return (
    <Modal
      visible={kind !== null}
      title={kind ? t(`${KEY}.title.${kind}`) : ''}
      onCancel={onClose}
      footer={
        expired || failed ? (
          <Button type='primary' onClick={() => setAttempt((value) => value + 1)} data-testid='device-pairing-renew'>
            {t(`${PAIR}.renew`)}
          </Button>
        ) : (
          <Button onClick={onClose}>{t('common.close')}</Button>
        )
      }
      unmountOnExit
      style={{ width: 520, maxWidth: 'calc(100vw - 32px)' }}
    >
      {kind ? (
        <div className='flex flex-col gap-12px' data-testid='device-pairing'>
          {failed ? <p className='m-0 text-13px text-danger-6'>{t(`${PAIR}.failed`)}</p> : null}
          {kind === 'companion' ? (
            <>
              <ol className='m-0 ps-20px flex flex-col gap-4px text-13px text-t-primary'>
                <li>{t(`${KEY}.companion.stepInstall`)}</li>
                <li>{t(`${KEY}.companion.stepPair`)}</li>
              </ol>
              {pairing && !expired ? (
                <div className='flex flex-wrap justify-center gap-24px'>
                  {pairing.download_url ? (
                    <QrBlock
                      value={pairing.download_url}
                      label={t(`${KEY}.companion.qrInstall`)}
                      testId='device-pairing-qr-install'
                    />
                  ) : null}
                  {pairing.qr_payload ? (
                    <QrBlock
                      value={pairing.qr_payload}
                      label={t(`${KEY}.companion.qrPair`)}
                      testId='device-pairing-qr-pair'
                    />
                  ) : null}
                </div>
              ) : null}
              <details className='text-12px text-t-secondary'>
                <summary className='cursor-pointer'>{t(`${KEY}.companion.limitsTitle`)}</summary>
                <ul className='m-0 mt-4px ps-20px flex flex-col gap-2px' data-testid='device-pairing-limits'>
                  {COMPANION_LIMITS.map((limit) => (
                    <li key={limit}>{t(`${KEY}.companion.limits.${limit}`)}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
          {kind === 'mac_helper' ? (
            <>
              <ol className='m-0 ps-20px flex flex-col gap-4px text-13px text-t-primary'>
                <li>{t(`${KEY}.mac.stepDownload`)}</li>
                <li>{t(`${KEY}.mac.stepGatekeeper`)}</li>
                <li>{t(`${KEY}.mac.stepPair`)}</li>
                <li>{t(`${KEY}.mac.stepPhone`)}</li>
              </ol>
              {pairing?.download_url ? (
                <div>
                  <Button
                    icon={<Download theme='outline' size={14} />}
                    href={pairing.download_url}
                    data-testid='device-pairing-download'
                  >
                    {t(`${KEY}.mac.download`)}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
          {kind === 'wifi_direct' ? <p className='m-0 text-13px text-t-primary'>{t(`${KEY}.wifi.steps`)}</p> : null}
          {pairing ? (
            <>
              <p className='m-0 text-12px text-t-secondary'>
                {t(`${KEY}.address`)}{' '}
                <code className='px-4px rd-4px bg-fill-2 text-t-primary break-all'>{address}</code>
              </p>
              <div className='flex items-center justify-center gap-8px'>
                <span
                  className='text-28px font-semibold tracking-[0.2em] text-t-primary font-mono select-all'
                  aria-label={t(`${PAIR}.codeLabel`)}
                  data-testid='device-pairing-code'
                >
                  {pairing.code}
                </span>
                <Button
                  size='small'
                  icon={<Copy theme='outline' size={14} />}
                  aria-label={t(`${PAIR}.copy`)}
                  onClick={() => void copy()}
                />
              </div>
              <p className='m-0 text-center text-12px text-t-secondary' aria-live='polite'>
                {expired ? t(`${PAIR}.expired`) : t(`${PAIR}.expiresIn`, { time: formatCountdown(left) })}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
};

export default DevicePairingModal;

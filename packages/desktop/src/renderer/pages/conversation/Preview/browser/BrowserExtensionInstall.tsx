/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Browser → "Install on your computer" (TASK-133): download the
 * AionUi Browser Bridge that ships with this build (version + SHA-256 shown),
 * the four install steps without the Web Store, and a notice when a paired
 * browser still runs an older build. Pairing sits right below this section.
 *
 * A page cannot link to `chrome://extensions` (Chrome blocks it), hence the
 * copy buttons.
 */

import { Alert, Button, Message } from '@arco-design/web-react';
import { Copy, Download } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { BrowserDevice } from '@/common/types/platform/serverBrowser';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { useBrowserDevices } from './server/useBrowserDevices';

/** Written by the renderer build (`packages/browser-extension/scripts/vitePlugin.ts`). */
export type ExtensionRelease = { version: string; file: string; sha256: string; size: number };

const RELEASE_URL = '/extension/latest.json';
const EXTENSION_PAGES = ['chrome://extensions', 'arc://extensions'];

/** The release descriptor, or null when the value is not one (e.g. the SPA fallback page). */
export const parseRelease = (value: unknown): ExtensionRelease | null => {
  if (!value || typeof value !== 'object') return null;
  const { version, file, sha256, size } = value as Record<string, unknown>;
  return typeof version === 'string' &&
    typeof file === 'string' &&
    /^[\w.-]+\.zip$/.test(file) &&
    typeof sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(sha256) &&
    typeof size === 'number'
    ? { version, file, sha256, size }
    : null;
};

const fetchRelease = async (): Promise<ExtensionRelease | null> => {
  try {
    const response = await fetch(RELEASE_URL, { cache: 'no-cache' });
    return response.ok ? parseRelease(await response.json()) : null;
  } catch {
    return null;
  }
};

/** True when dotted version `current` is lower than `latest` ("0.1.9" < "0.1.10"). */
export const isOlderVersion = (current: string, latest: string): boolean => {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  if ([...a, ...b].some((part) => !Number.isInteger(part))) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
};

/** Paired browsers whose extension is known to be older than the served build. */
export const outdatedDevices = (devices: BrowserDevice[], latest: string): BrowserDevice[] =>
  devices.filter((device) => device.extension_version && isOlderVersion(device.extension_version, latest));

const BrowserExtensionInstall: React.FC = () => {
  const { t } = useTranslation();
  const { data: release, isLoading } = useSWR<ExtensionRelease | null>('browser.extension.release', fetchRelease);
  const { devices } = useBrowserDevices();
  const outdated = release ? outdatedDevices(devices, release.version) : [];

  const copy = async (text: string, done: string) => {
    try {
      await copyText(text);
      Message.success(done);
    } catch {
      Message.error(t('settings.browserPage.install.copyFailed'));
    }
  };

  return (
    <section
      className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'
      aria-labelledby='browser-extension-install-title'
      data-testid='browser-extension-install'
    >
      <h3 id='browser-extension-install-title' className='m-0 mb-8px text-14px font-medium text-t-primary'>
        {t('settings.browserPage.install.title')}
      </h3>
      <p className='m-0 mb-12px text-12px text-t-secondary leading-relaxed'>
        {t('settings.browserPage.install.description')}
      </p>
      {outdated.length > 0 && release ? (
        <Alert
          className='mb-12px'
          type='warning'
          content={t('settings.browserPage.install.update', {
            version: release.version,
            names: outdated.map((device) => `${device.name} (${device.extension_version})`).join(', '),
          })}
          data-testid='browser-extension-update'
        />
      ) : null}
      {release ? (
        <div className='flex flex-col gap-4px mb-12px'>
          <div>
            <Button
              type='primary'
              icon={<Download theme='outline' size={14} />}
              href={`/extension/${release.file}`}
              anchorProps={{ download: release.file }}
              data-testid='browser-extension-download'
            >
              {t('settings.browserPage.install.download', { version: release.version })}
            </Button>
          </div>
          <div className='flex items-center gap-4px text-12px text-t-secondary'>
            <span className='flex-shrink-0'>{t('settings.browserPage.install.sha256')}</span>
            <code className='min-w-0 break-all text-t-primary' data-testid='browser-extension-sha256'>
              {release.sha256}
            </code>
            <Button
              size='mini'
              type='text'
              icon={<Copy theme='outline' size={12} />}
              aria-label={t('settings.browserPage.install.copySha')}
              onClick={() => void copy(release.sha256, t('settings.browserPage.install.shaCopied'))}
            />
          </div>
        </div>
      ) : isLoading ? null : (
        <Alert
          className='mb-12px'
          type='info'
          content={t('settings.browserPage.install.unavailable')}
          data-testid='browser-extension-unavailable'
        />
      )}
      <ol className='m-0 ps-20px flex flex-col gap-8px text-13px text-t-primary' data-testid='browser-extension-steps'>
        <li>{t('settings.browserPage.install.stepUnzip')}</li>
        <li>
          <div className='flex flex-col gap-4px'>
            <span>{t('settings.browserPage.install.stepOpen')}</span>
            <div className='flex flex-wrap gap-8px'>
              {EXTENSION_PAGES.map((address) => (
                <Button
                  key={address}
                  size='small'
                  icon={<Copy theme='outline' size={14} />}
                  onClick={() => void copy(address, t('settings.browserPage.install.addressCopied', { address }))}
                  data-testid='browser-extension-copy-address'
                >
                  {t('settings.browserPage.install.copyAddress', { address })}
                </Button>
              ))}
            </div>
          </div>
        </li>
        <li>{t('settings.browserPage.install.stepLoad')}</li>
        <li>{t('settings.browserPage.install.stepPair', { button: t('settings.browserDevices.pairButton') })}</li>
      </ol>
    </section>
  );
};

export default BrowserExtensionInstall;

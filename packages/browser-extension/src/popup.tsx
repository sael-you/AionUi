/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extension popup (C34): pair with a one-time code, share this tab, the list
 * of shared tabs, "Agents may open new tabs", Stop all / Resume, Unpair. All
 * state lives in the service worker; the popup only asks and listens.
 */

import { Alert, Button, Divider, Input, Switch, Tag, Typography } from '@arco-design/web-react';
import '@arco-design/web-react/dist/css/arco.css';
import { Close } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { localeFor, translate, type MessageKey } from './i18n';
import './popup-layout.css';
import type { PopupRequest, PopupResponse, SnapshotMessage } from './popupMessages';
import type { RelaySnapshot, RelayStatus } from './relay';

const locale = localeFor(chrome.i18n.getUILanguage());
const t = (key: MessageKey, vars?: Record<string, string>) => translate(locale, key, vars);

const ask = (request: PopupRequest): Promise<PopupResponse> =>
  chrome.runtime.sendMessage(request) as Promise<PopupResponse>;

const STATUS_COLOR: Record<RelayStatus, string> = {
  unpaired: 'gray',
  connecting: 'arcoblue',
  online: 'green',
  offline: 'orange',
  stopped: 'gray',
  error: 'red',
};

const errorText = (code: string | null): string | null => {
  if (!code) return null;
  const key = `error.${code}` as MessageKey;
  return translate(locale, key) === key ? t('error.generic', { message: code }) : t(key);
};

const hostOf = (address: string | null): string => {
  try {
    return address ? new URL(address).host : '';
  } catch {
    return address ?? '';
  }
};

const PairForm: React.FC<{ snapshot: RelaySnapshot; onDone: (response: PopupResponse) => void }> = ({
  snapshot,
  onDone,
}) => {
  const [address, setAddress] = useState(snapshot.address ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState(snapshot.device_name);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      onDone(await ask({ type: 'pair', address, code, device_name: name }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className='aion-stack' data-testid='pair-form'>
      <Typography.Text type='secondary'>{t('pair.hint')}</Typography.Text>
      <label className='aion-field'>
        <span>{t('pair.address')}</span>
        <Input value={address} onChange={setAddress} placeholder='https://aionui.example.com' autoFocus />
      </label>
      <label className='aion-field'>
        <span>{t('pair.code')}</span>
        <Input value={code} onChange={setCode} placeholder='ABCD-2345' />
      </label>
      <label className='aion-field'>
        <span>{t('pair.deviceName')}</span>
        <Input value={name} onChange={setName} />
      </label>
      <Button
        type='primary'
        long
        loading={busy}
        disabled={!address.trim() || !code.trim()}
        onClick={() => void submit()}
      >
        {t('pair.submit')}
      </Button>
    </div>
  );
};

const Popup: React.FC = () => {
  const [snapshot, setSnapshot] = useState<RelaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChromeTab | null>(null);

  useEffect(() => {
    void ask({ type: 'get' }).then((response) => setSnapshot(response.snapshot));
    void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => setActiveTab(tabs[0] ?? null));
    const listener = (message: unknown) => {
      const update = message as SnapshotMessage;
      if (update?.type === 'snapshot') setSnapshot(update.snapshot);
    };
    chrome.runtime.onMessage.addListener(listener);
  }, []);

  const apply = (response: PopupResponse) => {
    setSnapshot(response.snapshot);
    setError(response.ok ? null : response.error);
  };
  const run = async (request: PopupRequest) => apply(await ask(request));

  const activeShared = useMemo(
    () => Boolean(activeTab?.id !== undefined && snapshot?.tabs.some((tab) => tab.tab_id === activeTab.id)),
    [activeTab, snapshot]
  );
  if (!snapshot) return null;

  const paired = snapshot.status !== 'unpaired' && (snapshot.device_id !== null || snapshot.status === 'connecting');
  const shareable = /^https?:/i.test(activeTab?.url ?? '');
  const problem = errorText(error ?? snapshot.error_code);

  return (
    <div className='aion-popup'>
      <header className='aion-row'>
        <Typography.Title heading={6} className='aion-title'>
          {t('title')}
        </Typography.Title>
        <Tag color={STATUS_COLOR[snapshot.status]} data-testid='status'>
          {t(`status.${snapshot.status}` as MessageKey, { host: hostOf(snapshot.address) })}
        </Tag>
      </header>
      {problem ? <Alert type='error' content={problem} /> : null}

      {!paired ? (
        <PairForm snapshot={snapshot} onDone={apply} />
      ) : (
        <div className='aion-stack'>
          <div className='aion-row'>
            <span>{t('tab.share')}</span>
            <Switch
              checked={activeShared}
              disabled={!shareable || snapshot.status === 'stopped'}
              aria-label={t('tab.share')}
              onChange={(on: boolean) =>
                activeTab?.id !== undefined &&
                void run(on ? { type: 'share', tab_id: activeTab.id } : { type: 'unshare', tab_id: activeTab.id })
              }
            />
          </div>
          {!shareable ? <Typography.Text type='secondary'>{t('tab.restricted')}</Typography.Text> : null}

          <Divider className='aion-divider' />
          <Typography.Text bold>{t('shared.title')}</Typography.Text>
          {snapshot.tabs.length === 0 ? (
            <Typography.Text type='secondary'>{t('shared.none')}</Typography.Text>
          ) : (
            <ul className='aion-list'>
              {snapshot.tabs.map((tab) => (
                <li key={tab.tab_id} className='aion-row'>
                  <span className='aion-ellipsis' title={tab.url}>
                    {tab.title || tab.url}
                  </span>
                  <Button
                    size='mini'
                    icon={<Close theme='outline' size={12} />}
                    aria-label={t('shared.unshare', { title: tab.title || tab.url })}
                    onClick={() => void run({ type: 'unshare', tab_id: tab.tab_id })}
                  />
                </li>
              ))}
            </ul>
          )}
          <Typography.Text type='secondary' className='aion-small'>
            {t('debugBar')}
          </Typography.Text>

          <Divider className='aion-divider' />
          <div className='aion-row'>
            <span>{t('newTabs.label')}</span>
            <Switch
              checked={snapshot.new_tabs}
              aria-label={t('newTabs.label')}
              onChange={(on: boolean) => void run({ type: 'new_tabs', allowed: on })}
            />
          </div>
          <Typography.Text type='secondary' className='aion-small'>
            {t('newTabs.hint')}
          </Typography.Text>

          <div className='aion-row aion-actions'>
            {snapshot.status === 'stopped' ? (
              <Button type='primary' onClick={() => void run({ type: 'resume' })}>
                {t('resume')}
              </Button>
            ) : (
              <Button status='danger' onClick={() => void run({ type: 'stop' })} data-testid='stop-all'>
                {t('stop')}
              </Button>
            )}
            <Button type='text' onClick={() => void run({ type: 'unpair' })}>
              {t('unpair')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.body.setAttribute('arco-theme', 'dark');
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'fa-IR' ? 'rtl' : 'ltr';
createRoot(document.getElementById('root') as HTMLElement).render(<Popup />);

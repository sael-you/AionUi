/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Browser in the WebUI (C30): the server-side Chrome. Agents can use
 * the browser (default on), how many instances and tabs, and per instance its
 * state, "Hide that the browser is automated" (applies at the next start, with
 * the owner's risk spelled out), Clear browsing data and Stop. Writes go
 * through httpBridge (CSRF). Instance 1 is the panel's, with the owner's logins.
 */

import { Alert, Button, Message, Modal, Select, Switch, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import {
  BROWSER_MAX_INSTANCES_LIMIT,
  BROWSER_MAX_TABS_LIMIT,
  type BrowserSettings,
  type BrowserSettingsUpdate,
  type BrowserStatusResponse,
} from '@/common/types/platform/serverBrowser';
import {
  SERVER_BROWSER_SETTINGS_KEY,
  SERVER_BROWSER_STATUS_KEY,
} from '@/renderer/pages/conversation/Preview/browser/server/useServerBrowserAvailability';
import { errorKey } from '@/renderer/pages/conversation/Preview/browser/server/streamProtocol';
import PreferenceRow from './PreferenceRow';

const range = (max: number) => Array.from({ length: max }, (_, index) => index + 1);

const ServerBrowserSettings: React.FC = () => {
  const { t } = useTranslation();
  const [modal, modalContextHolder] = Modal.useModal();
  const { data: settings, error: settingsError } = useSWR<BrowserSettings>(SERVER_BROWSER_SETTINGS_KEY, () =>
    serverBrowser.getSettings.invoke()
  );
  const { data: status } = useSWR<BrowserStatusResponse>(SERVER_BROWSER_STATUS_KEY, () =>
    serverBrowser.getStatus.invoke()
  );
  const [saving, setSaving] = useState(false);
  const [busyInstance, setBusyInstance] = useState<number | null>(null);

  const describeError = (error: unknown): string => {
    if (isBackendHttpError(error) && error.code === 'BROWSER_SETTING_OUT_OF_RANGE') {
      return t('settings.serverBrowser.errors.outOfRange');
    }
    if (isBackendHttpError(error) && error.code === 'BROWSER_BUSY') return t('settings.serverBrowser.errors.busy');
    return t('settings.serverBrowser.errors.generic');
  };

  const save = async (update: BrowserSettingsUpdate) => {
    setSaving(true);
    try {
      const next = await serverBrowser.updateSettings.invoke(update);
      await mutate(SERVER_BROWSER_SETTINGS_KEY, next, { revalidate: false });
      await mutate(SERVER_BROWSER_STATUS_KEY);
      Message.success(t('settings.serverBrowser.saved'));
    } catch (error) {
      Message.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const changeMaxInstances = (next: number) => {
    const stopped = (status?.instances ?? []).filter((row) => row.instance > next && row.running);
    if (stopped.length === 0) {
      void save({ max_instances: next });
      return;
    }
    modal.confirm?.({
      title: t('settings.serverBrowser.lowerInstancesTitle'),
      content: t('settings.serverBrowser.lowerInstancesContent', { count: stopped.length }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => save({ max_instances: next }),
    });
  };

  const changeHideAutomation = (instance: number, on: boolean) => {
    const update = () => save({ instances: [{ instance, hide_automation: on }] });
    if (!on) {
      void update();
      return;
    }
    modal.confirm?.({
      title: t('settings.serverBrowser.hideAutomationConfirmTitle'),
      content: t('settings.serverBrowser.hideAutomationWarning'),
      okText: t('settings.serverBrowser.hideAutomationConfirmOk'),
      cancelText: t('common.cancel'),
      onOk: update,
    });
  };

  const instanceAction = async (instance: number, action: 'clear' | 'stop') => {
    setBusyInstance(instance);
    try {
      const next =
        action === 'clear'
          ? await serverBrowser.clearInstance.invoke({ instance })
          : await serverBrowser.stopInstance.invoke({ instance });
      await mutate(SERVER_BROWSER_STATUS_KEY, next, { revalidate: false });
      Message.success(
        action === 'clear'
          ? t('settings.browserData.clearSuccess')
          : t('settings.serverBrowser.stopped', { n: instance })
      );
    } catch (error) {
      Message.error(action === 'clear' ? t('settings.browserData.clearFailed') : describeError(error));
    } finally {
      setBusyInstance(null);
    }
  };

  const confirmClear = (instance: number) => {
    modal.confirm?.({
      title: t('settings.browserData.clearConfirmTitle'),
      content: t('settings.browserData.clearConfirmContent'),
      okText: t('common.clear'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: () => instanceAction(instance, 'clear'),
    });
  };

  return (
    <section
      className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'
      aria-labelledby='server-browser-settings-title'
      data-testid='server-browser-settings'
    >
      {modalContextHolder}
      <h3 id='server-browser-settings-title' className='m-0 mb-8px text-14px font-medium text-t-primary'>
        {t('settings.serverBrowser.title')}
      </h3>
      {settingsError ? <Alert type='error' content={t('settings.serverBrowser.errors.generic')} /> : null}
      {status && !status.available ? (
        <Alert
          className='mb-8px'
          type='warning'
          content={t('settings.serverBrowser.unavailable', {
            reason: t(`preview.serverBrowser.errors.${errorKey(status.unavailable_reason ?? 'BROWSER_UNAVAILABLE')}`),
          })}
        />
      ) : null}
      {status?.chrome_version ? (
        <p className='m-0 mb-8px text-12px text-t-tertiary'>
          {t('settings.serverBrowser.chromeVersion', { version: status.chrome_version })}
        </p>
      ) : null}
      {settings ? (
        <>
          <PreferenceRow
            label={t('settings.serverBrowser.agentsLabel')}
            description={t('settings.serverBrowser.agentsDesc')}
          >
            <Switch
              checked={settings.agents_enabled}
              loading={saving}
              aria-label={t('settings.serverBrowser.agentsLabel')}
              onChange={(checked: boolean) => void save({ agents_enabled: checked })}
            />
          </PreferenceRow>
          <PreferenceRow
            label={t('settings.serverBrowser.maxInstancesLabel')}
            description={t('settings.serverBrowser.maxInstancesDesc')}
          >
            <Select
              size='small'
              className='w-80px'
              value={settings.max_instances}
              disabled={saving}
              aria-label={t('settings.serverBrowser.maxInstancesLabel')}
              onChange={(value: number) => changeMaxInstances(value)}
            >
              {range(BROWSER_MAX_INSTANCES_LIMIT).map((value) => (
                <Select.Option key={value} value={value}>
                  {value}
                </Select.Option>
              ))}
            </Select>
          </PreferenceRow>
          <PreferenceRow
            label={t('settings.serverBrowser.maxTabsLabel')}
            description={t('settings.serverBrowser.maxTabsDesc')}
          >
            <Select
              size='small'
              className='w-80px'
              value={settings.max_tabs}
              disabled={saving}
              aria-label={t('settings.serverBrowser.maxTabsLabel')}
              onChange={(value: number) => void save({ max_tabs: value })}
            >
              {range(BROWSER_MAX_TABS_LIMIT).map((value) => (
                <Select.Option key={value} value={value}>
                  {value}
                </Select.Option>
              ))}
            </Select>
          </PreferenceRow>

          <ul
            className='m-0 mt-8px p-0 list-none flex flex-col gap-8px'
            aria-label={t('settings.serverBrowser.instancesLabel')}
          >
            {settings.instances.map((row) => {
              const live = status?.instances.find((entry) => entry.instance === row.instance);
              const name =
                row.instance === 1
                  ? t('settings.serverBrowser.instanceMain')
                  : t('settings.serverBrowser.instanceN', { n: row.instance });
              const pendingRestart = Boolean(live?.running && live.hide_automation_active !== row.hide_automation);
              return (
                <li
                  key={row.instance}
                  className='flex flex-col gap-6px rd-12px border border-3 px-12px py-10px'
                  data-testid='server-browser-instance'
                >
                  <div className='flex flex-wrap items-center gap-8px'>
                    <span className='text-13px font-medium text-t-primary'>{name}</span>
                    <Tag size='small' color={live?.running ? 'green' : 'gray'}>
                      {live?.running
                        ? t('settings.serverBrowser.running', { count: live.tabs })
                        : t('settings.serverBrowser.notRunning')}
                    </Tag>
                    {live?.agent_active ? (
                      <Tag size='small' color='arcoblue'>
                        {t('settings.serverBrowser.agentActive')}
                      </Tag>
                    ) : null}
                    <div className='ms-auto flex items-center gap-6px'>
                      <Button
                        size='mini'
                        disabled={!live?.running}
                        loading={busyInstance === row.instance}
                        aria-label={t('settings.serverBrowser.stopLabel', { name })}
                        onClick={() => void instanceAction(row.instance, 'stop')}
                      >
                        {t('settings.serverBrowser.stop')}
                      </Button>
                      <Button
                        size='mini'
                        status='danger'
                        loading={busyInstance === row.instance}
                        aria-label={t('settings.serverBrowser.clearLabel', { name })}
                        onClick={() => confirmClear(row.instance)}
                      >
                        {t('common.clear')}
                      </Button>
                    </div>
                  </div>
                  <PreferenceRow
                    label={t('settings.serverBrowser.hideAutomationLabel')}
                    description={t('settings.serverBrowser.hideAutomationDesc')}
                  >
                    <Switch
                      size='small'
                      checked={row.hide_automation}
                      disabled={saving}
                      aria-label={t('settings.serverBrowser.hideAutomationAria', { name })}
                      onChange={(checked: boolean) => changeHideAutomation(row.instance, checked)}
                    />
                  </PreferenceRow>
                  {pendingRestart ? (
                    <span className='text-12px text-t-secondary' role='status'>
                      {t('settings.serverBrowser.appliesNextStart')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
};

export default ServerBrowserSettings;

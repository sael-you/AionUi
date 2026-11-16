/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSettings, BrowserStatusResponse } from '@/common/types/platform/serverBrowser';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return {
    getSettings: fn(),
    updateSettings: fn(),
    getStatus: fn(),
    clearInstance: fn(),
    stopInstance: fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ serverBrowser: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));

import ServerBrowserSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/ServerBrowserSettings';

const SETTINGS: BrowserSettings = {
  agents_enabled: true,
  max_instances: 3,
  max_tabs: 10,
  instances: [
    { instance: 1, hide_automation: false },
    { instance: 2, hide_automation: false },
    { instance: 3, hide_automation: true },
  ],
};

const STATUS: BrowserStatusResponse = {
  available: true,
  chrome_version: '155.0.7800.10',
  instances: [
    { instance: 1, running: true, tabs: 2, agent_active: true, hide_automation_active: false },
    { instance: 2, running: false, tabs: 0, agent_active: false, hide_automation_active: false },
    { instance: 3, running: true, tabs: 1, agent_active: false, hide_automation_active: false },
  ],
  idle_timeout_secs: 900,
};

const renderSettings = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ServerBrowserSettings />
    </SWRConfig>
  );

const confirmIn = async (title: string, okName: string) => {
  const heading = await screen.findByText(title);
  const dialog = heading.closest('.arco-modal') as HTMLElement;
  fireEvent.click(within(dialog).getByRole('button', { name: okName }));
};

describe('ServerBrowserSettings (C30 Settings > Browser)', () => {
  beforeEach(() => {
    api.getSettings.invoke.mockResolvedValue(SETTINGS);
    api.getStatus.invoke.mockResolvedValue(STATUS);
    api.updateSettings.invoke.mockImplementation(async (update: Partial<BrowserSettings>) => ({
      ...SETTINGS,
      ...update,
    }));
    api.clearInstance.invoke.mockResolvedValue(STATUS);
    api.stopInstance.invoke.mockResolvedValue(STATUS);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('shows every browser with its state, the Chrome version and the pending hide-automation restart', async () => {
    renderSettings();
    const rows = await screen.findAllByTestId('server-browser-instance');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.instanceMain');
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.running|{"count":2}');
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.agentActive');
    expect(rows[1]).toHaveTextContent('settings.serverBrowser.notRunning');
    expect(rows[2]).toHaveTextContent('settings.serverBrowser.appliesNextStart');
    expect(screen.getByText('settings.serverBrowser.chromeVersion|{"version":"155.0.7800.10"}')).toBeInTheDocument();
  });

  it('saves the agents switch and the tab limit as partial updates', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: 'settings.serverBrowser.agentsLabel' }));
    await waitFor(() => expect(api.updateSettings.invoke).toHaveBeenCalledWith({ agents_enabled: false }));

    fireEvent.click(screen.getByRole('combobox', { name: 'settings.serverBrowser.maxTabsLabel' }));
    fireEvent.click(await screen.findByRole('option', { name: '12' }));
    await waitFor(() => expect(api.updateSettings.invoke).toHaveBeenCalledWith({ max_tabs: 12 }));
  });

  it('asks before lowering the browser count below a running browser', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('combobox', { name: 'settings.serverBrowser.maxInstancesLabel' }));
    fireEvent.click(await screen.findByRole('option', { name: '2' }));

    expect(api.updateSettings.invoke).not.toHaveBeenCalled();
    await confirmIn('settings.serverBrowser.lowerInstancesTitle', 'common.confirm');
    await waitFor(() => expect(api.updateSettings.invoke).toHaveBeenCalledWith({ max_instances: 2 }));
  });

  it('turns hide-automation on only after the warning, and off without one', async () => {
    renderSettings();
    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'settings.serverBrowser.hideAutomationAria|{"name":"settings.serverBrowser.instanceMain"}',
      })
    );
    expect(api.updateSettings.invoke).not.toHaveBeenCalled();
    expect(await screen.findByText('settings.serverBrowser.hideAutomationWarning')).toBeInTheDocument();
    await confirmIn(
      'settings.serverBrowser.hideAutomationConfirmTitle',
      'settings.serverBrowser.hideAutomationConfirmOk'
    );
    await waitFor(() =>
      expect(api.updateSettings.invoke).toHaveBeenCalledWith({ instances: [{ instance: 1, hide_automation: true }] })
    );

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'settings.serverBrowser.hideAutomationAria|{"name":"settings.serverBrowser.instanceN|{\\"n\\":3}"}',
      })
    );
    await waitFor(() =>
      expect(api.updateSettings.invoke).toHaveBeenCalledWith({ instances: [{ instance: 3, hide_automation: false }] })
    );
  });

  it('clears a browser after confirmation and stops a running one', async () => {
    renderSettings();
    const rows = await screen.findAllByTestId('server-browser-instance');

    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole('button', { name: /settings\.serverBrowser\.clearLabel/ })
    );
    await confirmIn('settings.browserData.clearConfirmTitle', 'common.clear');
    await waitFor(() => expect(api.clearInstance.invoke).toHaveBeenCalledWith({ instance: 1 }));

    fireEvent.click(within(rows[2] as HTMLElement).getByRole('button', { name: /settings\.serverBrowser\.stopLabel/ }));
    await waitFor(() => expect(api.stopInstance.invoke).toHaveBeenCalledWith({ instance: 3 }));
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: /settings\.serverBrowser\.stopLabel/ })
    ).toBeDisabled();
  });

  it('explains an unavailable browser and an out-of-range value', async () => {
    api.getStatus.invoke.mockResolvedValue({ ...STATUS, available: false, unavailable_reason: 'BROWSER_START_FAILED' });
    const { BackendHttpError } = await import('@/common/adapter/httpBridge');
    api.updateSettings.invoke.mockRejectedValueOnce(
      new BackendHttpError({
        method: 'PUT',
        path: '/api/browser/settings',
        status: 400,
        body: { code: 'BROWSER_SETTING_OUT_OF_RANGE' },
      })
    );
    renderSettings();

    expect(
      await screen.findByText(
        'settings.serverBrowser.unavailable|{"reason":"preview.serverBrowser.errors.startFailed"}'
      )
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('switch', { name: 'settings.serverBrowser.agentsLabel' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('settings.serverBrowser.errors.outOfRange'));
  });
});

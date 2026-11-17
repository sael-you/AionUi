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
    createInstance: fn(),
    updateInstance: fn(),
    deleteInstance: fn(),
    createPairingCode: fn(),
    listDevices: fn(),
    deviceActivity: fn(),
    listApprovals: fn(),
    approvalRequested: { on: () => () => undefined },
    approvalResolved: { on: () => () => undefined },
    revokeDevice: fn(),
    listeners: new Map<string, () => void>(),
    devicesChanged: {
      on: (callback: () => void) => {
        api.listeners.set('devicesChanged', callback);
        return () => undefined;
      },
    },
  };
});

const devicesApi = vi.hoisted(() => ({
  list: { invoke: vi.fn(async () => []) },
  changed: { on: () => () => undefined },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ serverBrowser: api, devices: devicesApi }));
const platform = vi.hoisted(() => ({ desktop: false }));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }));
vi.mock('@/renderer/utils/ui/clipboard', () => clipboard);
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.desktop }));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDataSection', () => ({
  default: () => <div data-testid='browser-data-section' />,
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
    i18n: { language: 'en-US' },
  }),
}));

import BrowserProfileModal, {
  profileDraftProblem,
  profileFields,
} from '@/renderer/pages/conversation/Preview/browser/server/BrowserProfileModal';
import ServerBrowserSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/ServerBrowserSettings';
import BrowserApprovalsLog, {
  approvalLogRows,
} from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserApprovalsLog';
import BrowserExtensionInstall, {
  isOlderVersion,
  outdatedDevices,
  parseRelease,
} from '@/renderer/pages/conversation/Preview/browser/BrowserExtensionInstall';
import BrowserScopeSelect from '@/renderer/pages/conversation/Preview/browser/server/BrowserScopeSelect';
import DevicesSettings from '@/renderer/pages/settings/DevicesSettings';
import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';
import BrowserDevicesSettings, {
  formatCountdown,
} from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings';

const SETTINGS: BrowserSettings = {
  agents_enabled: true,
  max_instances: 4,
  max_tabs: 10,
  instances: [
    { instance: 1, name: 'Main', hide_automation: false },
    { instance: 2, name: 'TB Discord', color: 'blue', emoji: '🎮', hide_automation: false },
    { instance: 3, name: 'Personal', hide_automation: true },
  ],
};

const STATUS: BrowserStatusResponse = {
  available: true,
  chrome_version: '155.0.7800.10',
  instances: [
    { instance: 1, name: 'Main', running: true, tabs: 2, agent_active: true, hide_automation_active: false },
    {
      instance: 2,
      name: 'TB Discord',
      color: 'blue',
      emoji: '🎮',
      running: false,
      tabs: 0,
      agent_active: false,
      hide_automation_active: false,
    },
    { instance: 3, name: 'Personal', running: true, tabs: 1, agent_active: false, hide_automation_active: false },
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
    api.createInstance.invoke.mockResolvedValue(SETTINGS);
    api.updateInstance.invoke.mockResolvedValue(SETTINGS);
    api.deleteInstance.invoke.mockResolvedValue(SETTINGS);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('shows every profile with its name, state, the Chrome version and the pending hide-automation restart', async () => {
    renderSettings();
    const rows = await screen.findAllByTestId('server-browser-instance');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Main');
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.profile.panelDefault');
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.running|{"count":2}');
    expect(rows[0]).toHaveTextContent('settings.serverBrowser.agentActive');
    expect(rows[1]).toHaveTextContent('🎮');
    expect(rows[1]).toHaveTextContent('TB Discord');
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

  it('saves the profile limit directly and never offers a limit below the existing profiles', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('combobox', { name: 'settings.serverBrowser.maxInstancesLabel' }));
    const two = await screen.findByRole('option', { name: '2' });
    const twoOption = two.querySelector('.arco-select-option') ?? two;
    expect(twoOption.className).toContain('arco-select-option-disabled');
    fireEvent.click(twoOption);
    expect(api.updateSettings.invoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('option', { name: '5' }));
    await waitFor(() => expect(api.updateSettings.invoke).toHaveBeenCalledWith({ max_instances: 5 }));
  });

  it('turns hide-automation on only after the warning, and off without one', async () => {
    renderSettings();
    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'settings.serverBrowser.hideAutomationAria|{"name":"Main"}',
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
        name: 'settings.serverBrowser.hideAutomationAria|{"name":"Personal"}',
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

  it('adds a profile with only the fields that were filled in, colour picked by its name', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /settings\.serverBrowser\.profile\.add/ }));
    const dialog = await screen.findByTestId('browser-profile-modal');
    fireEvent.change(within(dialog).getByPlaceholderText('settings.serverBrowser.profile.namePlaceholder'), {
      target: { value: '  Work  ' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'conversation.history.projectColors.teal' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(api.createInstance.invoke).toHaveBeenCalledWith({ name: 'Work', color: 'teal' }));
    expect(Message.success).toHaveBeenCalledWith('settings.serverBrowser.profile.added');
  });

  it('edits a profile and clears its colour and emoji with empty strings', async () => {
    renderSettings();
    const rows = await screen.findAllByTestId('server-browser-instance');
    fireEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: /settings\.serverBrowser\.profile\.editLabel/ })
    );
    const dialog = await screen.findByTestId('browser-profile-modal');
    expect(within(dialog).getByPlaceholderText('settings.serverBrowser.profile.namePlaceholder')).toHaveValue(
      'TB Discord'
    );
    fireEvent.click(within(dialog).getByText('settings.serverBrowser.profile.noColor'));
    fireEvent.change(within(dialog).getByPlaceholderText('🎮'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() =>
      expect(api.updateInstance.invoke).toHaveBeenCalledWith({
        instance: 2,
        data: { name: 'TB Discord', color: '', emoji: '' },
      })
    );
  });

  it('keeps the dialog open and says why when the name is already taken', async () => {
    const { BackendHttpError } = await import('@/common/adapter/httpBridge');
    api.createInstance.invoke.mockRejectedValueOnce(
      new BackendHttpError({
        method: 'POST',
        path: '/api/browser/instances',
        status: 409,
        body: { code: 'BROWSER_PROFILE_NAME_TAKEN' },
      })
    );
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /settings\.serverBrowser\.profile\.add/ }));
    const dialog = await screen.findByTestId('browser-profile-modal');
    fireEvent.change(within(dialog).getByPlaceholderText('settings.serverBrowser.profile.namePlaceholder'), {
      target: { value: 'Main' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('settings.serverBrowser.errors.nameTaken'));
    expect(screen.getByTestId('browser-profile-modal')).toBeInTheDocument();
  });

  it('deletes a profile only after confirmation, and never offers to delete Main', async () => {
    renderSettings();
    const rows = await screen.findAllByTestId('server-browser-instance');
    expect(
      within(rows[0] as HTMLElement).queryByRole('button', { name: /settings\.serverBrowser\.profile\.deleteLabel/ })
    ).toBeNull();

    fireEvent.click(
      within(rows[2] as HTMLElement).getByRole('button', { name: /settings\.serverBrowser\.profile\.deleteLabel/ })
    );
    expect(api.deleteInstance.invoke).not.toHaveBeenCalled();
    await confirmIn('settings.serverBrowser.profile.deleteTitle|{"name":"Personal"}', 'common.delete');
    await waitFor(() => expect(api.deleteInstance.invoke).toHaveBeenCalledWith({ instance: 3 }));
  });

  it('disables Add profile once the profile limit is reached', async () => {
    api.getSettings.invoke.mockResolvedValue({ ...SETTINGS, max_instances: 3 });
    renderSettings();
    const add = await screen.findByRole('button', { name: /settings\.serverBrowser\.profile\.add/ });
    expect(add).toBeDisabled();
  });
});

describe('browser profile draft rules (TASK-124)', () => {
  it('sends the engine only when one is chosen', () => {
    expect(profileFields({ name: 'Work', color: '', emoji: '', engine: 'brave' }, true)).toEqual({
      name: 'Work',
      color: '',
      emoji: '',
      engine: 'brave',
    });
    expect(profileFields({ name: 'Work', color: '', emoji: '', engine: 'edge' }, false)).toEqual({
      name: 'Work',
      engine: 'edge',
    });
  });

  it('a profile picks its engine among the downloaded ones; it applies at the next start (TASK-134)', async () => {
    const onSave = vi.fn();
    const engines = [
      { engine: 'chrome', installed_version: '142.0', verification: 'signed-repository' as const },
      { engine: 'brave', verification: 'signed-repository' as const },
      { engine: 'headless-shell', installed_version: '142.0', verification: 'tls-only' as const, agents_only: true },
    ];
    render(
      <BrowserProfileModal
        target={{ instance: 2, name: 'Work', hide_automation: false, engine: 'chrome' }}
        saving={false}
        engines={engines}
        onSave={onSave}
        onClose={() => undefined}
      />
    );
    const dialog = await screen.findByTestId('browser-profile-modal');
    expect(dialog).toHaveTextContent('settings.serverBrowser.profile.engineHint');
    fireEvent.click(within(dialog).getByTestId('browser-profile-engine'));
    const brave = await screen.findByRole('option', { name: /settings\.devices\.engine\.names\.brave/ });
    expect(brave).toHaveTextContent('settings.serverBrowser.profile.engineNotDownloaded');
    expect(brave).toHaveClass('arco-select-option-disabled');
    const headless = screen.getByRole('option', { name: /headless-shell/ });
    expect(headless).toHaveTextContent('settings.devices.engine.agentsOnly');
    fireEvent.click(headless);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Work', engine: 'headless-shell' }));
  });

  it('without engines (older AionCore) the profile dialog has no engine choice', async () => {
    render(
      <BrowserProfileModal
        target={{ instance: 2, name: 'Work', hide_automation: false }}
        saving={false}
        onSave={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(await screen.findByTestId('browser-profile-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-profile-engine')).toBeNull();
  });

  it('the panel switcher does not offer a profile whose engine is for agents only', async () => {
    render(
      <BrowserScopeSelect
        profiles={[
          { instance: 1, name: 'Main' },
          { instance: 2, name: 'Crawler', agentsOnly: true },
        ]}
        devices={[]}
        value={{ kind: 'profile', instance: 1 }}
        onChange={() => undefined}
      />
    );
    fireEvent.click(screen.getByTestId('server-browser-profile'));
    const crawler = await screen.findByRole('option', { name: /Crawler/ });
    expect(crawler).toHaveClass('arco-select-option-disabled');
    expect(screen.getByRole('option', { name: /Main/ })).not.toHaveClass('arco-select-option-disabled');
  });

  it('needs a name of at most 40 characters and an emoji of at most 16 bytes', () => {
    expect(profileDraftProblem({ name: '   ', color: '', emoji: '' })).toBe('nameRequired');
    expect(profileDraftProblem({ name: 'x'.repeat(41), color: '', emoji: '' })).toBe('nameTooLong');
    expect(profileDraftProblem({ name: 'é'.repeat(40), color: '', emoji: '' })).toBeNull();
    expect(profileDraftProblem({ name: 'Work', color: '', emoji: '🎮🎮🎮🎮🎮' })).toBe('emojiTooLong');
    expect(profileDraftProblem({ name: 'Work', color: 'teal', emoji: '🎮' })).toBeNull();
  });

  it('clears colour and emoji with empty strings only on an existing profile', () => {
    const draft = { name: ' Work ', color: '', emoji: ' ' };
    expect(profileFields(draft, true)).toEqual({ name: 'Work', color: '', emoji: '' });
    expect(profileFields(draft, false)).toEqual({ name: 'Work' });
    expect(profileFields({ name: 'Work', color: 'teal', emoji: '🎮' }, false)).toEqual({
      name: 'Work',
      color: 'teal',
      emoji: '🎮',
    });
  });
});

const MAC = {
  device_id: 'dev_mac',
  name: 'Mac · Chrome',
  browser: 'Chrome 157',
  created_at: 1,
  last_seen_at: 1_700_000_000_000,
  online: true,
  new_tabs: true,
  shared_tabs: 2,
};

const renderDevices = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BrowserDevicesSettings />
    </SWRConfig>
  );

describe('BrowserDevicesSettings (C34 Settings > Browser > your own browser)', () => {
  beforeEach(() => {
    api.getSettings.invoke.mockResolvedValue({ ...SETTINGS, devices_agents_enabled: false });
    api.updateSettings.invoke.mockImplementation(async (update: Partial<BrowserSettings>) => ({
      ...SETTINGS,
      devices_agents_enabled: false,
      ...update,
    }));
    api.listDevices.invoke.mockResolvedValue([MAC]);
    api.createPairingCode.invoke.mockResolvedValue({ code: 'ABCD-2345', expires_at: Date.now() + 300_000 });
    api.revokeDevice.invoke.mockResolvedValue(undefined);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('lists paired browsers with their state and shared tabs', async () => {
    renderDevices();
    const row = await screen.findByTestId('browser-device-row');
    expect(row).toHaveTextContent('Mac · Chrome');
    expect(row).toHaveTextContent('Chrome 157');
    expect(row).toHaveTextContent('settings.browserDevices.sharedTabs|{"count":2}');
    expect(row).toHaveTextContent('preview.browserDevices.online');
  });

  it('"Agents may use my Mac browser" saves devices_agents_enabled only', async () => {
    renderDevices();
    fireEvent.click(await screen.findByRole('switch', { name: 'settings.browserDevices.agentsLabel' }));
    await waitFor(() => expect(api.updateSettings.invoke).toHaveBeenCalledWith({ devices_agents_enabled: true }));
  });

  it('pairing shows the one-time code and the address, and closes once the new browser shows up', async () => {
    api.listDevices.invoke.mockResolvedValue([]);
    renderDevices();
    fireEvent.click(await screen.findByTestId('browser-devices-pair'));
    expect(await screen.findByTestId('browser-pairing-code')).toHaveTextContent('ABCD-2345');
    expect(screen.getByTestId('browser-pairing')).toHaveTextContent(window.location.origin);
    api.listDevices.invoke.mockResolvedValue([MAC]);
    api.listeners.get('devicesChanged')?.();
    await waitFor(() => expect(screen.queryByTestId('browser-pairing')).toBeNull());
    expect(Message.success).toHaveBeenCalledWith('settings.browserDevices.pair.done|{"name":"Mac · Chrome"}');
  });

  it('revokes a browser after confirmation', async () => {
    renderDevices();
    fireEvent.click(
      await screen.findByRole('button', { name: 'settings.browserDevices.revokeLabel|{"name":"Mac · Chrome"}' })
    );
    await confirmIn('settings.browserDevices.revokeTitle|{"name":"Mac · Chrome"}', 'settings.browserDevices.revoke');
    await waitFor(() => expect(api.revokeDevice.invoke).toHaveBeenCalledWith({ device_id: 'dev_mac' }));
  });

  it('formats the countdown', () => {
    expect(formatCountdown(299)).toBe('4:59');
    expect(formatCountdown(5)).toBe('0:05');
  });
});

describe('Settings → Devices keeps the browser settings (TASK-128 → TASK-136)', () => {
  const activity = [
    {
      at: 30,
      conversation_id: null,
      tab_id: 1,
      origin: 'https://mail.google.com',
      method: 'Input.insertText',
      outcome: 'approved',
    },
    { at: 20, conversation_id: null, tab_id: 1, origin: 'https://example.com', method: 'Page.navigate', outcome: 'ok' },
    {
      at: 10,
      conversation_id: null,
      tab_id: 1,
      origin: 'https://accounts.google.com',
      method: 'Runtime.evaluate',
      outcome: 'timeout',
    },
  ];

  beforeEach(() => {
    platform.desktop = false;
    api.getSettings.invoke.mockResolvedValue({ ...SETTINGS, devices_agents_enabled: false });
    api.getStatus.invoke.mockResolvedValue(STATUS);
    api.listDevices.invoke.mockResolvedValue([MAC]);
    api.listApprovals.invoke.mockResolvedValue([]);
    api.deviceActivity.invoke.mockResolvedValue(activity);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderPage = () =>
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DevicesSettings />
      </SWRConfig>
    );

  it('is a top-level settings entry right after Tools, in place of Browser', () => {
    expect(BUILTIN_TAB_IDS.indexOf('devices')).toBe(BUILTIN_TAB_IDS.indexOf('tools') + 1);
    expect(BUILTIN_TAB_IDS).not.toContain('browser');
  });

  it('WebUI: server browser settings under Server browsers; your own browsers and the approvals log under My browsers', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('settings.devices.title');
    expect(await screen.findByTestId('server-browser-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-devices-settings')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /settings\.devices\.categories\.my_browser/ }));
    expect(await screen.findByTestId('browser-devices-settings')).toBeInTheDocument();
    expect(screen.getByTestId('browser-approvals-log')).toBeInTheDocument();
    expect(screen.queryByTestId('server-browser-settings')).toBeNull();
    expect(screen.queryByTestId('browser-data-section')).toBeNull();
  });

  it('desktop: the in-app browser data section only', () => {
    platform.desktop = true;
    renderPage();
    expect(screen.getByTestId('browser-data-section')).toBeInTheDocument();
    expect(screen.queryByTestId('server-browser-settings')).toBeNull();
    expect(screen.queryByTestId('browser-approvals-log')).toBeNull();
  });

  it('the approvals log lists only approval outcomes, newest first, and says what is pending', async () => {
    api.listApprovals.invoke.mockResolvedValue([
      { approval_id: 'a1', expires_at: Date.now() + 60_000, requested_at: Date.now() },
    ]);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BrowserApprovalsLog />
      </SWRConfig>
    );
    const rows = await screen.findAllByTestId('browser-approvals-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('https://mail.google.com');
    expect(rows[0]).toHaveTextContent('preview.browserDevices.outcome.approved');
    expect(rows[1]).toHaveTextContent('preview.browserDevices.outcome.timeout');
    expect(api.deviceActivity.invoke).toHaveBeenCalledWith({ device_id: 'dev_mac', limit: 200 });
    expect(await screen.findByTestId('browser-approvals-pending')).toHaveTextContent('{"count":1}');
  });

  it('merges several browsers into one log', () => {
    const rows = approvalLogRows(
      [
        { device_id: 'a', name: 'Mac' },
        { device_id: 'b', name: 'Work' },
      ],
      [
        [{ at: 5, conversation_id: null, tab_id: 1, origin: 'o1', method: 'm', outcome: 'denied' }],
        [
          { at: 9, conversation_id: null, tab_id: 2, origin: 'o2', method: 'm', outcome: 'paused' },
          { at: 7, conversation_id: null, tab_id: 2, origin: 'o3', method: 'm', outcome: 'refused' },
        ],
      ]
    );
    expect(rows.map((row) => [row.device_name, row.origin])).toEqual([
      ['Work', 'o2'],
      ['Mac', 'o1'],
    ]);
  });
});

describe('Settings → Browser → Install on your computer (TASK-133)', () => {
  const RELEASE = {
    version: '0.1.2',
    file: 'aionui-browser-bridge-0.1.2.zip',
    sha256: 'ab'.repeat(32),
    size: 20480,
  };
  const serve = (body: unknown, ok = true) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, json: async () => body }))
    );

  beforeEach(() => {
    api.listDevices.invoke.mockResolvedValue([MAC]);
    clipboard.copyText.mockResolvedValue(undefined);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const renderInstall = () =>
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BrowserExtensionInstall />
      </SWRConfig>
    );

  it('compares dotted versions numerically and ignores malformed ones', () => {
    expect(isOlderVersion('0.1.1', '0.1.2')).toBe(true);
    expect(isOlderVersion('0.1.9', '0.1.10')).toBe(true);
    expect(isOlderVersion('0.1.2', '0.1.2')).toBe(false);
    expect(isOlderVersion('0.2.0', '0.1.9')).toBe(false);
    expect(isOlderVersion('dev', '0.1.2')).toBe(false);
  });

  it('accepts only a well-formed release descriptor', () => {
    expect(parseRelease(RELEASE)).toEqual(RELEASE);
    expect(parseRelease({ ...RELEASE, sha256: 'nope' })).toBeNull();
    expect(parseRelease({ ...RELEASE, file: '../evil.zip' })).toBeNull();
    expect(parseRelease('<!doctype html>')).toBeNull();
  });

  it('flags only browsers known to run an older extension', () => {
    const rows = [
      { ...MAC, device_id: 'a', extension_version: '0.1.1' },
      { ...MAC, device_id: 'b', extension_version: '0.1.2' },
      { ...MAC, device_id: 'c' },
    ];
    expect(outdatedDevices(rows, '0.1.2').map((row) => row.device_id)).toEqual(['a']);
  });

  it('offers the versioned download with its SHA-256 and the four steps', async () => {
    serve(RELEASE);
    renderInstall();
    const download = await screen.findByTestId('browser-extension-download');
    expect(download.getAttribute('href')).toBe('/extension/aionui-browser-bridge-0.1.2.zip');
    expect(download.getAttribute('download')).toBe('aionui-browser-bridge-0.1.2.zip');
    expect(download.textContent).toContain('"version":"0.1.2"');
    expect(screen.getByTestId('browser-extension-sha256').textContent).toBe(RELEASE.sha256);
    expect(within(screen.getByTestId('browser-extension-steps')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByTestId('browser-extension-update')).toBeNull();
  });

  it('copies chrome://extensions and arc://extensions instead of linking to them', async () => {
    serve(RELEASE);
    renderInstall();
    const buttons = await screen.findAllByTestId('browser-extension-copy-address');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.getAttribute('href') === null)).toBe(true);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(clipboard.copyText).toHaveBeenCalledWith('chrome://extensions'));
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(clipboard.copyText).toHaveBeenCalledWith('arc://extensions'));
  });

  it('says a new version is available when a paired browser runs an older one', async () => {
    serve(RELEASE);
    api.listDevices.invoke.mockResolvedValue([{ ...MAC, extension_version: '0.1.1' }]);
    renderInstall();
    const notice = await screen.findByTestId('browser-extension-update');
    expect(notice.textContent).toContain('"version":"0.1.2"');
    expect(notice.textContent).toContain(`${MAC.name} (0.1.1)`);
  });

  it('keeps the steps and explains when the build has no extension download', async () => {
    serve('<!doctype html>');
    renderInstall();
    expect(await screen.findByTestId('browser-extension-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('browser-extension-download')).toBeNull();
    expect(screen.getByTestId('browser-extension-steps')).toBeTruthy();
  });
});

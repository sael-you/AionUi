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
import type { Device } from '@/common/types/platform/devices';

const api = vi.hoisted(() => ({
  list: { invoke: vi.fn() },
  update: { invoke: vi.fn() },
  install: { invoke: vi.fn() },
  remove: { invoke: vi.fn() },
  job: { invoke: vi.fn() },
  audit: { invoke: vi.fn(async () => ({ rows: [], next_cursor: null })) },
  createPairingCode: { invoke: vi.fn() },
  changed: { on: () => () => undefined },
}));
const status = vi.hoisted(() => ({ invoke: vi.fn(async (): Promise<unknown> => null) }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  devices: api,
  serverBrowser: {
    getSettings: { invoke: vi.fn(async () => ({})) },
    getStatus: status,
    listDevices: { invoke: vi.fn(async () => []) },
    devicesChanged: { on: () => () => undefined },
  },
}));
vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (error: unknown) => typeof (error as { status?: unknown })?.status === 'number',
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// The moved browser sections have their own tests (ServerBrowserSettings.dom.test.tsx).
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/ServerBrowserSettings', () => ({
  default: () => <div data-testid='server-browser-settings' />,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings', () => ({
  default: () => <div data-testid='browser-devices-settings' />,
  formatCountdown: (seconds: number) => `${seconds}s`,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserApprovalsLog', () => ({
  default: () => <div data-testid='browser-approvals-log' />,
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserExtensionInstall', () => ({
  default: () => <div data-testid='browser-extension-install' />,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
    i18n: { language: 'en-US' },
  }),
}));

import DevicesSettings from '@/renderer/pages/settings/DevicesSettings';
import {
  categoryCounts,
  descriptionKey,
  devicesOn,
  formatDiskSize,
  isActiveDevice,
  isOfflineDuplicate,
  knownAddon,
  minutesLeft,
} from '@/renderer/pages/settings/DevicesSettings/devicesModel';
import { JOB_LOST, loadJob } from '@/renderer/pages/settings/DevicesSettings/useDevices';

const KEY = 'settings.devices';

const device = (patch: Partial<Device>): Device => ({
  id: 'd',
  kind: 'server_browser',
  source_id: null,
  name: 'Chrome',
  status: 'off',
  available: 'now',
  enabled: false,
  enabled_until: null,
  installed: true,
  disk_bytes: null,
  version: null,
  job_id: null,
  last_seen_at: null,
  ...patch,
});

const CHROME = device({
  id: 'chrome',
  name: 'Chrome',
  status: 'on',
  enabled: true,
  version: '142.0',
  disk_bytes: 312_000_000,
});
const BRAVE = device({ id: 'brave', name: 'Brave', installed: false });
const CAMOUFOX = device({ id: 'camoufox', name: 'Camoufox', installed: false, available: 'later' });
const PIXEL = device({ id: 'pixel', kind: 'phone', name: 'Pixel 9', status: 'off' });
const NEW_PHONE = device({ id: 'new', kind: 'phone', name: 'Phone', status: 'needs_pairing', installed: false });
const MAC = device({ id: 'mac', kind: 'mac', name: 'Mac', installed: false, available: 'later' });
const ALL = [CHROME, BRAVE, CAMOUFOX, PIXEL, NEW_PHONE, MAC];

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <DevicesSettings />
    </SWRConfig>
  );

const cardOf = async (name: string) => {
  const open = await screen.findByRole('button', { name });
  return open.closest('[data-testid="library-card"]') as HTMLElement;
};

const railButton = (kind: string) => screen.getByRole('button', { name: new RegExp(`${KEY}\\.categories\\.${kind}`) });

describe('Settings → Devices model (TASK-136)', () => {
  it('puts installed, available, paired devices on Active and everything on Library', () => {
    expect(isActiveDevice(CHROME)).toBe(true);
    expect(isActiveDevice(BRAVE)).toBe(false);
    expect(isActiveDevice(CAMOUFOX)).toBe(false);
    expect(isActiveDevice(NEW_PHONE)).toBe(false);
    expect(devicesOn(ALL, 'server_browser', 'active').map((d) => d.id)).toEqual(['chrome']);
    expect(devicesOn(ALL, 'server_browser', 'library').map((d) => d.id)).toEqual(['chrome', 'brave', 'camoufox']);
    expect(categoryCounts(ALL, 'active')).toEqual({ server_browser: 1, my_browser: 0, phone: 1, addon: 0, mac: 0 });
    expect(categoryCounts(ALL, 'library')).toEqual({ server_browser: 3, my_browser: 0, phone: 2, addon: 0, mac: 1 });
  });

  it('formats sizes and the minutes left', () => {
    expect(formatDiskSize(312_000_000, 'en-US')).toBe('312 MB');
    expect(formatDiskSize(1_400_000_000, 'en-US')).toBe('1.4 GB');
    expect(formatDiskSize(900, 'en-US')).toBe('900 B');
    expect(minutesLeft(null, 0)).toBeNull();
    expect(minutesLeft(90_000, 0)).toBe(2);
    expect(minutesLeft(0, 10)).toBe(0);
  });

  it('a job AionCore lost in a restart reads as failed', async () => {
    api.job.invoke.mockRejectedValueOnce({ status: 404, code: 'DEVICE_JOB_NOT_FOUND' });
    expect(await loadJob('j1', 'brave')).toEqual({
      job_id: 'j1',
      device_id: 'brave',
      state: 'failed',
      progress: 0,
      error: JOB_LOST,
    });
    api.job.invoke.mockRejectedValueOnce({ status: 500 });
    await expect(loadJob('j1', 'brave')).rejects.toEqual({ status: 500 });
  });
});

describe('Settings → Devices page (TASK-136 U1)', () => {
  beforeEach(() => {
    // Arco Descriptions (drawer) observes breakpoints.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
    );
    api.list.invoke.mockResolvedValue(ALL);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'info').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the rail with counts and the active server browsers with their switch and size', async () => {
    renderPage();
    const chrome = await cardOf('Chrome');
    expect(chrome).toHaveTextContent(`${KEY}.status.on`);
    expect(chrome).toHaveTextContent(`${KEY}.disk|{"size":"312 MB"}`);
    expect(within(chrome).getByTestId('library-card-toggle')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: 'Brave' })).toBeNull();
    expect(screen.getByTestId('server-browser-settings')).toBeInTheDocument();
    expect(railButton('phone')).toHaveAccessibleName(/settings\.library\.count\|\{"count":1\}/);
  });

  it('Library offers Install, greys out what comes later, and starts the job', async () => {
    api.install.invoke.mockResolvedValue({ job_id: 'j1' });
    renderPage();
    await cardOf('Chrome');
    fireEvent.click(screen.getByTestId('library-tab-library'));
    const brave = await cardOf('Brave');
    const camoufox = await cardOf('Camoufox');
    expect(camoufox).toHaveTextContent(`${KEY}.later`);
    expect(within(camoufox).queryByTestId('device-install')).toBeNull();
    expect(within(camoufox).queryByTestId('library-card-toggle')).toBeNull();
    fireEvent.click(within(brave).getByTestId('device-install'));
    await waitFor(() => expect(api.install.invoke).toHaveBeenCalledWith({ id: 'brave' }));
  });

  it('a phone switches on with the 30-minute timeout; one that needs pairing has no switch', async () => {
    api.update.invoke.mockResolvedValue({ ...PIXEL, enabled: true });
    renderPage();
    await cardOf('Chrome');
    fireEvent.click(railButton('phone'));
    const pixel = await cardOf('Pixel 9');
    fireEvent.click(within(pixel).getByTestId('library-card-toggle'));
    await waitFor(() =>
      expect(api.update.invoke).toHaveBeenCalledWith({ id: 'pixel', enabled: true, timeout_minutes: 30 })
    );
    fireEvent.click(screen.getByTestId('library-tab-library'));
    const fresh = await cardOf('Phone');
    expect(within(fresh).queryByTestId('library-card-toggle')).toBeNull();
    expect(fresh).toHaveTextContent(`${KEY}.status.needs_pairing`);
  });

  it('a server browser switches off without a timeout', async () => {
    api.update.invoke.mockResolvedValue({ ...CHROME, enabled: false });
    renderPage();
    const chrome = await cardOf('Chrome');
    fireEvent.click(within(chrome).getByTestId('library-card-toggle'));
    await waitFor(() => expect(api.update.invoke).toHaveBeenCalledWith({ id: 'chrome', enabled: false }));
  });

  it('Remove asks first with the size it frees, and explains an engine still in use', async () => {
    api.remove.invoke.mockRejectedValue({ status: 409, code: 'DEVICE_IN_USE' });
    renderPage();
    const chrome = await cardOf('Chrome');
    fireEvent.click(within(chrome).getByTestId('library-card-more'));
    fireEvent.click(await screen.findByText(`${KEY}.remove`));
    const content = await screen.findByText(`${KEY}.removeFrees|{"size":"312 MB"}`);
    const dialog = content.closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: `${KEY}.remove` }));
    await waitFor(() => expect(api.remove.invoke).toHaveBeenCalledWith({ id: 'chrome' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(`${KEY}.removeInUse|{"name":"Chrome"}`));
  });

  it('shows install progress, then a job lost in a restart as interrupted', async () => {
    api.list.invoke.mockResolvedValue([{ ...BRAVE, status: 'installing', job_id: 'j1' }]);
    api.job.invoke.mockResolvedValueOnce({
      job_id: 'j1',
      device_id: 'brave',
      state: 'running',
      progress: 40,
      error: null,
    });
    renderPage();
    fireEvent.click(screen.getByTestId('library-tab-library'));
    const brave = await cardOf('Brave');
    expect(await within(brave).findByTestId('device-job-progress')).toBeInTheDocument();
    api.job.invoke.mockRejectedValue({ status: 404, code: 'DEVICE_JOB_NOT_FOUND' });
    expect(await within(brave).findByTestId('device-job-failed', {}, { timeout: 3000 })).toHaveTextContent(
      `${KEY}.jobFailed|{"error":"${KEY}.jobLost"}`
    );
  });

  it('opens the details drawer from a card', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Chrome' }));
    const drawer = await screen.findByTestId('device-drawer');
    expect(drawer).toHaveTextContent('142.0');
    expect(drawer).toHaveTextContent('312 MB');
  });

  it('a phone opens with its access, connection options and activity; Add a phone starts pairing', async () => {
    api.list.invoke.mockResolvedValue([
      { ...PIXEL, routes: [{ route: 'mac_relay', enabled: true, status: 'on', experimental: false }] },
    ]);
    api.createPairingCode.invoke.mockResolvedValue({
      code: 'ABCD-2345',
      expires_at: Date.now() + 300_000,
      download_url: null,
      qr_payload: null,
    });
    renderPage();
    fireEvent.click(railButton('phone'));
    fireEvent.click(await screen.findByRole('button', { name: 'Pixel 9' }));
    const drawer = await screen.findByTestId('device-drawer');
    expect(within(drawer).getByTestId('device-access')).toBeInTheDocument();
    expect(within(drawer).getAllByTestId('device-route')).toHaveLength(1);
    expect(await within(drawer).findByTestId('device-audit-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('devices-add-phone'));
    fireEvent.click(await screen.findByText(`${KEY}.routes.companion.name`, { selector: '.arco-dropdown-menu-item' }));
    await waitFor(() => expect(api.createPairingCode.invoke).toHaveBeenCalledWith({ kind: 'companion' }));
  });

  it('add-ons say what they are, how tasks are approved and where they run; the Mac card waits greyed', async () => {
    const artemis = device({
      id: 'artemis',
      kind: 'addon',
      name: 'Artemis',
      source_id: 'artemis',
      addon_host: 'pixel',
    });
    const other = device({ id: 'x', kind: 'addon', name: 'Other', installed: false });
    api.list.invoke.mockResolvedValue([artemis, other, PIXEL, MAC]);
    renderPage();
    fireEvent.click(railButton('addon'));
    const card = await cardOf('Artemis');
    expect(card).toHaveTextContent(`${KEY}.addons.artemis.desc`);
    fireEvent.click(screen.getByRole('button', { name: 'Artemis' }));
    const drawer = await screen.findByTestId('device-drawer');
    expect(within(drawer).getByTestId('device-addon')).toHaveTextContent(`${KEY}.addons.artemis.licence`);
    expect(within(drawer).getByTestId('device-addon')).toHaveTextContent(`${KEY}.addons.approval`);
    expect(within(drawer).getByTestId('device-addon-host')).toHaveTextContent(
      `${KEY}.addons.runsOn|{"name":"Pixel 9"}`
    );
    expect(await within(drawer).findByTestId('device-audit-empty')).toBeInTheDocument();
    expect(knownAddon(other)).toBeNull();
    expect(descriptionKey(other)).toBe(`${KEY}.addons.generic.desc`);
    expect(descriptionKey(MAC)).toBe(`${KEY}.mac.desc`);
    expect(descriptionKey(CHROME)).toBeNull();
  });

  it('the Mac that comes later explains itself and has no switch', async () => {
    renderPage();
    await cardOf('Chrome');
    fireEvent.click(railButton('mac'));
    fireEvent.click(screen.getByTestId('library-tab-library'));
    const card = await cardOf('Mac');
    expect(card).toHaveTextContent(`${KEY}.later`);
    expect(within(card).queryByTestId('library-card-toggle')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mac' }));
    const drawer = await screen.findByTestId('device-drawer');
    expect(within(drawer).getByTestId('device-mac')).toHaveTextContent(`${KEY}.mac.permissions`);
    expect(within(drawer).queryByTestId('device-access')).toBeNull();
    expect(drawer).toHaveTextContent(`${KEY}.laterHint`);
  });

  it('engines show how the download was verified, agents-only, a failed download, and Update (TASK-134)', async () => {
    api.install.invoke.mockResolvedValue({ job_id: 'j2' });
    api.list.invoke.mockResolvedValue([
      { ...CHROME, source_id: 'chrome' },
      device({ id: 'cft', name: 'Chrome for Testing', source_id: 'chrome-for-testing', installed: true }),
      device({ id: 'hs', name: 'Headless shell', source_id: 'headless-shell', installed: true }),
      { ...BRAVE, source_id: 'brave' },
    ]);
    status.invoke.mockResolvedValue({
      available: true,
      instances: [],
      idle_timeout_secs: 900,
      engines: [
        { engine: 'chrome', installed_version: '142.0', verification: 'signed-repository' },
        { engine: 'chrome-for-testing', installed_version: '142.0', verification: 'tls-only' },
        { engine: 'headless-shell', installed_version: '142.0', verification: 'tls-only', agents_only: true },
        { engine: 'brave', verification: 'signed-repository', error: 'sha256 mismatch' },
      ],
    });
    renderPage();
    const chrome = await cardOf('Chrome');
    expect(await within(chrome).findByTestId('engine-verification')).toHaveTextContent(`${KEY}.engine.signed`);
    expect(within(chrome).queryByTestId('engine-agents-only')).toBeNull();
    const cft = await cardOf('Chrome for Testing');
    expect(within(cft).getByTestId('engine-verification')).toHaveTextContent(`${KEY}.engine.tlsOnly`);
    const headless = await cardOf('Headless shell');
    expect(within(headless).getByTestId('engine-agents-only')).toHaveTextContent(`${KEY}.engine.agentsOnly`);
    fireEvent.click(within(chrome).getByTestId('library-card-more'));
    fireEvent.click(await screen.findByText(`${KEY}.engine.update`));
    await waitFor(() => expect(api.install.invoke).toHaveBeenCalledWith({ id: 'chrome' }));
    fireEvent.click(screen.getByTestId('library-tab-library'));
    const brave = await cardOf('Brave');
    expect(brave).toHaveTextContent(`${KEY}.engine.failed|{"error":"sha256 mismatch"}`);
    expect(within(brave).getByTestId('device-install')).toBeInTheDocument();
    status.invoke.mockResolvedValue(null);
  });

  it('a phone card shows its health and the app version; what blocks agents is flagged (TASK-173)', async () => {
    api.list.invoke.mockResolvedValue([
      {
        ...PIXEL,
        status: 'on',
        version: '0.2.0',
        health: {
          battery_percent: 82,
          charging: true,
          locked: true,
          accessibility_on: false,
          android_version: '16',
          model: 'Pixel 9',
        },
      },
    ]);
    renderPage();
    fireEvent.click(railButton('phone'));
    const card = await cardOf('Pixel 9');
    expect(card).toHaveTextContent(`${KEY}.version|{"version":"0.2.0"}`);
    expect(within(card).getByTestId('device-battery')).toHaveTextContent(
      `${KEY}.health.batteryCharging|{"percent":82}`
    );
    expect(within(card).getByTestId('device-locked')).toHaveTextContent(`${KEY}.health.locked`);
    expect(within(card).getByTestId('device-accessibility-off')).toHaveTextContent(`${KEY}.health.accessibilityOff`);
    fireEvent.click(screen.getByRole('button', { name: 'Pixel 9' }));
    const drawer = await screen.findByTestId('device-drawer');
    expect(drawer).toHaveTextContent(`${KEY}.drawer.model`);
    expect(drawer).toHaveTextContent(`${KEY}.drawer.android`);
    expect(drawer).toHaveTextContent('16');
  });

  it('a healthy phone shows no warning; one that never reported shows no health at all', async () => {
    api.list.invoke.mockResolvedValue([
      {
        ...PIXEL,
        id: 'a',
        name: 'Fine',
        health: { battery_percent: 40, charging: false, locked: false, accessibility_on: true },
      },
      { ...PIXEL, id: 'b', name: 'Silent' },
    ]);
    renderPage();
    fireEvent.click(railButton('phone'));
    const fine = await cardOf('Fine');
    expect(within(fine).getByTestId('device-battery')).toHaveTextContent(`${KEY}.health.battery|{"percent":40}`);
    expect(within(fine).queryByTestId('device-locked')).toBeNull();
    expect(within(fine).queryByTestId('device-accessibility-off')).toBeNull();
    const silent = await cardOf('Silent');
    expect(within(silent).queryByTestId('device-battery')).toBeNull();
    expect(within(silent).queryByTestId('device-accessibility-off')).toBeNull();
  });

  it('two cards of one phone: the connected one first; the offline one says so, cannot be switched on, and can be removed', async () => {
    api.remove.invoke.mockResolvedValue({ job_id: 'j9' });
    const stale = { ...PIXEL, id: 'phone:old:self', status: 'offline' as const, last_seen_at: 1_700_000_000_000 };
    const live = { ...PIXEL, id: 'phone:new:self', status: 'on' as const, enabled: true };
    api.list.invoke.mockResolvedValue([stale, live]);
    expect(devicesOn([stale, live], 'phone', 'active').map((d) => d.id)).toEqual(['phone:new:self', 'phone:old:self']);
    expect(isOfflineDuplicate(stale, [stale, live])).toBe(true);
    expect(isOfflineDuplicate(live, [stale, live])).toBe(false);
    expect(isOfflineDuplicate(stale, [stale])).toBe(false);
    renderPage();
    fireEvent.click(railButton('phone'));
    await waitFor(() => expect(screen.getAllByTestId('library-card')).toHaveLength(2));
    const [first, second] = screen.getAllByTestId('library-card');
    expect(first).toHaveAttribute('data-card-id', 'phone:new:self');
    expect(within(first).getByTestId('library-card-toggle')).toBeInTheDocument();
    expect(second).toHaveTextContent(`${KEY}.status.offline`);
    expect(within(second).getByTestId('device-last-seen')).toHaveTextContent('settings.browserDevices.lastSeen');
    expect(second).toHaveTextContent(`${KEY}.health.duplicate`);
    expect(within(second).queryByTestId('library-card-toggle')).toBeNull();
    expect(within(first).queryByTestId('device-last-seen')).toBeNull();
    fireEvent.click(within(second).getByTestId('library-card-more'));
    fireEvent.click(await screen.findByText(`${KEY}.remove`));
    const content = await screen.findByText(`${KEY}.health.removeCompanion`);
    fireEvent.click(
      within(content.closest('.arco-modal') as HTMLElement).getByRole('button', { name: `${KEY}.remove` })
    );
    await waitFor(() => expect(api.remove.invoke).toHaveBeenCalledWith({ id: 'phone:old:self' }));
  });

  it('an offline phone that was left on can still be switched off', async () => {
    api.update.invoke.mockResolvedValue(PIXEL);
    api.list.invoke.mockResolvedValue([{ ...PIXEL, status: 'offline', enabled: true }]);
    renderPage();
    fireEvent.click(railButton('phone'));
    const card = await cardOf('Pixel 9');
    fireEvent.click(within(card).getByTestId('library-card-toggle'));
    await waitFor(() => expect(api.update.invoke).toHaveBeenCalledWith({ id: 'pixel', enabled: false }));
    expect(within(card).queryByTestId('library-card-more')).toBeInTheDocument();
  });

  it('My browsers keeps the extension install, pairing and the approvals log', async () => {
    renderPage();
    await cardOf('Chrome');
    fireEvent.click(railButton('my_browser'));
    expect(screen.getByTestId('browser-devices-settings')).toBeInTheDocument();
    expect(screen.getByTestId('browser-approvals-log')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('library-tab-library'));
    expect(screen.getByTestId('browser-extension-install')).toBeInTheDocument();
  });

  it('an empty category says so and points at the Library', async () => {
    renderPage();
    await cardOf('Chrome');
    fireEvent.click(railButton('addon'));
    expect(screen.getByTestId('library-empty')).toHaveTextContent(`${KEY}.empty.active.addon`);
    fireEvent.click(screen.getByTestId('library-empty-action'));
    expect(screen.getByTestId('library-tab-library')).toHaveAttribute('aria-selected', 'true');
  });
});

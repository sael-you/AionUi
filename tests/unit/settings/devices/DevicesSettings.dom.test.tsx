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
vi.mock('@/common/adapter/ipcBridge', () => ({
  devices: api,
  serverBrowser: {
    getSettings: { invoke: vi.fn(async () => ({})) },
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
  devicesOn,
  formatDiskSize,
  isActiveDevice,
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

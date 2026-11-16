/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  desktop: false,
  getStatus: vi.fn(),
  getSettings: vi.fn(),
  listDevices: vi.fn(),
  deviceActivity: vi.fn(),
  listApprovals: vi.fn(),
  decideApproval: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
  emitter: (name: string) => ({
    on: (callback: (payload: unknown) => void) => {
      env.listeners.set(name, callback);
      return () => env.listeners.delete(name);
    },
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => env.desktop }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  serverBrowser: {
    getStatus: { invoke: env.getStatus },
    getSettings: { invoke: env.getSettings },
    listDevices: { invoke: env.listDevices },
    deviceActivity: { invoke: env.deviceActivity },
    listApprovals: { invoke: env.listApprovals },
    decideApproval: { invoke: env.decideApproval },
    devicesChanged: env.emitter('browser.devicesChanged'),
    approvalRequested: env.emitter('browser.approvalRequested'),
    approvalResolved: env.emitter('browser.approvalResolved'),
  },
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: ({ url }: { url: string }) => <div data-testid='webview-host'>{url}</div>,
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/server/ServerBrowserView', () => ({
  default: ({
    profiles,
    requestedUrl,
    devices = [],
    onSelectDevice,
  }: {
    profiles: Array<{ name: string }>;
    requestedUrl?: string;
    devices?: Array<{ device_id: string; name: string }>;
    onSelectDevice?: (id: string) => void;
  }) => (
    <div data-testid='server-browser-host'>
      {`${profiles.map((p) => p.name).join(',')}|${requestedUrl}`}
      {devices.map((device) => (
        <button key={device.device_id} type='button' onClick={() => onSelectDevice?.(device.device_id)}>
          {`pick ${device.name}`}
        </button>
      ))}
    </div>
  ),
}));

import BrowserTabLayer from '@/renderer/pages/conversation/Preview/browser/BrowserTabLayer';
import BrowserApprovalPrompts from '@/renderer/pages/conversation/Preview/browser/server/BrowserApprovalPrompts';
import type { PreviewTab } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

const tabs = [
  { id: 'b1', type: 'browser', title: 'Discord', content: 'https://discord.com/login' },
  { id: 'b2', type: 'browser', title: 'Example', content: 'https://example.com' },
] as unknown as PreviewTab[];

const renderLayer = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BrowserTabLayer browserTabs={tabs} activeTabId='b2' updateTab={vi.fn()} />
    </SWRConfig>
  );

describe('browser panel host (C30)', () => {
  beforeEach(() => {
    env.desktop = false;
    env.getStatus.mockResolvedValue({ available: true, instances: [], idle_timeout_secs: 900 });
    env.listDevices.mockResolvedValue([]);
    env.deviceActivity.mockResolvedValue([]);
    env.listApprovals.mockResolvedValue([]);
    env.getSettings.mockResolvedValue({
      agents_enabled: true,
      max_instances: 3,
      max_tabs: 10,
      instances: [
        { instance: 1, name: 'Main', hide_automation: false },
        { instance: 2, name: 'TB Discord', hide_automation: false },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses one server browser view in the WebUI when the server browser is available', async () => {
    renderLayer();
    expect(await screen.findByTestId('server-browser-host')).toHaveTextContent('Main,TB Discord|https://example.com');
    expect(screen.queryByTestId('webview-host')).toBeNull();
  });

  it('keeps the per-tab hosts (iframe fallback) when the server browser is unavailable', async () => {
    env.getStatus.mockResolvedValue({ available: false, instances: [], idle_timeout_secs: 900 });
    renderLayer();
    await waitFor(() => expect(env.getStatus).toHaveBeenCalled());
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
    expect(screen.queryByTestId('server-browser-host')).toBeNull();
    expect(env.getSettings).not.toHaveBeenCalled();
  });

  it('never asks for the server browser on desktop', async () => {
    env.desktop = true;
    renderLayer();
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
    expect(env.getStatus).not.toHaveBeenCalled();
  });

  it('falls back to the iframe hosts when the status request fails', async () => {
    env.getStatus.mockRejectedValue(new Error('offline'));
    renderLayer();
    await waitFor(() => expect(env.getStatus).toHaveBeenCalled());
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
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

describe("the owner's own browser in the panel (C34)", () => {
  beforeEach(() => {
    env.desktop = false;
    env.getStatus.mockResolvedValue({ available: true, instances: [], idle_timeout_secs: 900 });
    env.getSettings.mockResolvedValue({
      agents_enabled: true,
      devices_agents_enabled: false,
      max_instances: 3,
      max_tabs: 10,
      instances: [{ instance: 1, name: 'Main', hide_automation: false }],
    });
    env.listDevices.mockResolvedValue([MAC]);
    env.listApprovals.mockResolvedValue([]);
    env.deviceActivity.mockResolvedValue([
      {
        at: 1_700_000_000_000,
        conversation_id: null,
        tab_id: 5,
        origin: 'https://mail.google.com',
        method: 'Input.dispatchKeyEvent',
        outcome: 'paused',
      },
      {
        at: 1_699_999_999_000,
        conversation_id: null,
        tab_id: 5,
        origin: 'https://example.com',
        method: 'Page.navigate',
        outcome: 'ok',
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers the paired browser in the switcher and shows its live view (no screencast) with the activity', async () => {
    renderLayer();
    fireEvent.click(await screen.findByRole('button', { name: 'pick Mac · Chrome' }));
    const view = await screen.findByTestId('device-browser-view');
    expect(screen.queryByTestId('server-browser-host')).toBeNull();
    expect(screen.getByTestId('device-browser-status')).toHaveTextContent('preview.browserDevices.live');
    expect(screen.getByTestId('device-shared-tabs')).toHaveTextContent('2');
    // "Agents may use my Mac browser" is off: say so.
    expect(screen.getByTestId('device-agents-off')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('device-activity-row')).toHaveLength(2));
    expect(env.deviceActivity).toHaveBeenCalledWith({ device_id: 'dev_mac', limit: 50 });
    expect(view).toHaveTextContent('Input.dispatchKeyEvent');
    expect(view).toHaveTextContent('preview.browserDevices.outcome.paused');
  });

  it('refreshes the device list when AionCore says devices changed', async () => {
    renderLayer();
    await screen.findByRole('button', { name: 'pick Mac · Chrome' });
    env.listDevices.mockResolvedValue([MAC, { ...MAC, device_id: 'dev_work', name: 'Work · Arc' }]);
    act(() => env.listeners.get('browser.devicesChanged')?.({}));
    expect(await screen.findByRole('button', { name: 'pick Work · Arc' })).toBeInTheDocument();
  });
});

const APPROVAL = {
  approval_id: 'ap_1',
  device_id: 'dev_mac',
  device_name: 'Mac · Chrome',
  tab_id: 5,
  origin: 'https://mail.google.com',
  url: 'https://mail.google.com/mail/u/0/',
  method: 'Input.dispatchKeyEvent',
  summary: 'Input.dispatchKeyEvent "Send"',
  requested_at: Date.now(),
  expires_at: Date.now() + 120_000,
};

const renderPrompts = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BrowserApprovalPrompts />
    </SWRConfig>
  );

describe('approval prompts for high-value origins (C34 decision a)', () => {
  beforeEach(() => {
    env.desktop = false;
    env.listApprovals.mockResolvedValue([APPROVAL]);
    env.decideApproval.mockResolvedValue(undefined);
    vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
    vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows what the agent wants to do and sends Allow for that approval', async () => {
    renderPrompts();
    const card = await screen.findByRole('alertdialog');
    expect(card).toHaveAccessibleName('preview.browserDevices.approval.title');
    expect(card).toHaveTextContent('Input.dispatchKeyEvent "Send"');
    fireEvent.click(screen.getByTestId('browser-approval-allow'));
    await waitFor(() => expect(env.decideApproval).toHaveBeenCalledWith({ approval_id: 'ap_1', approve: true }));
  });

  it('Deny sends approve false; an already expired approval reads as expired', async () => {
    env.decideApproval.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'BackendHttpError', status: 410, code: 'BROWSER_APPROVAL_EXPIRED' })
    );
    renderPrompts();
    fireEvent.click(await screen.findByTestId('browser-approval-deny'));
    await waitFor(() => expect(env.decideApproval).toHaveBeenCalledWith({ approval_id: 'ap_1', approve: false }));
  });

  it('a new request appears live and a resolved one disappears', async () => {
    env.listApprovals.mockResolvedValue([]);
    renderPrompts();
    await waitFor(() => expect(env.listApprovals).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => env.listeners.get('browser.approvalRequested')?.(APPROVAL));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    act(() => env.listeners.get('browser.approvalResolved')?.({ approval_id: 'ap_1', approved: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('asks nothing on desktop', async () => {
    env.desktop = true;
    renderPrompts();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.listApprovals).not.toHaveBeenCalled();
  });
});

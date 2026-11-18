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
import type { Device, DeviceAccess, DeviceApproval } from '@/common/types/platform/devices';

const api = vi.hoisted(() => ({
  setAccess: { invoke: vi.fn() },
  setTrustedApps: { invoke: vi.fn() },
  decideApproval: { invoke: vi.fn() },
  audit: { invoke: vi.fn() },
  job: { invoke: vi.fn() },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ devices: api }));
vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (error: unknown) => typeof (error as { status?: unknown })?.status === 'number',
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
    i18n: { language: 'en-US' },
  }),
}));

import DeviceCard from '@/renderer/pages/settings/DevicesSettings/DeviceCard';
import {
  AccessModeBlock,
  AccessModeControl,
  accessOf,
  FullAccessChip,
  isAppId,
} from '@/renderer/pages/settings/DevicesSettings/phones/AccessMode';
import { DeviceApprovalCard } from '@/renderer/pages/settings/DevicesSettings/phones/DeviceApprovalPrompts';

const KEY = 'settings.devices.accessMode';
const NOW = 1_800_000_000_000;

const access = (patch: Partial<DeviceAccess> = {}): DeviceAccess => ({
  mode: 'ask',
  full_until: null,
  include_sensitive: false,
  trusted_apps: [],
  ...patch,
});

const phone = (patch: Partial<Device> = {}): Device => ({
  id: 'pixel',
  kind: 'phone',
  source_id: null,
  name: 'Pixel 9',
  status: 'on',
  available: 'now',
  enabled: true,
  enabled_until: NOW + 20 * 60_000,
  installed: true,
  disk_bytes: null,
  version: null,
  job_id: null,
  last_seen_at: null,
  access: access(),
  ...patch,
});

const approval = (patch: Partial<DeviceApproval> = {}): DeviceApproval => ({
  id: 'a1',
  device_id: 'pixel',
  device_name: 'Pixel 9',
  verb: 'launch',
  summary: 'launch com.shop.app',
  task: null,
  package: 'com.shop.app',
  origin: null,
  conversation_id: null,
  created_at: 1_000,
  expires_at: 61_000,
  ...patch,
});

const radio = (name: string) => screen.getByLabelText(name);

beforeEach(() => {
  api.setAccess.invoke.mockResolvedValue(phone());
  api.setTrustedApps.invoke.mockResolvedValue(phone());
  api.audit.invoke.mockResolvedValue({ rows: [], next_cursor: null });
  vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
  vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('device access mode (TASK-175)', () => {
  it('only phones and the Mac have an access mode; app ids follow the server rule', () => {
    expect(accessOf(phone())).toEqual(access());
    expect(accessOf(phone({ kind: 'server_browser' }))).toBeNull();
    expect(accessOf(phone({ access: undefined }))).toBeNull();
    expect(isAppId('com.example.app')).toBe(true);
    expect(isAppId('com.example app')).toBe(false);
    expect(isAppId('')).toBe(false);
    expect(isAppId('a'.repeat(201))).toBe(false);
  });

  it('the amber chip says how long Full access still runs, or that it runs until turned off', () => {
    const { rerender, container } = render(
      <FullAccessChip access={access({ mode: 'full', full_until: NOW + 52 * 60_000 })} now={NOW} />
    );
    expect(screen.getByTestId('device-full-access')).toHaveTextContent(`${KEY}.fullChip|{"count":52}`);
    rerender(<FullAccessChip access={access({ mode: 'full', full_until: null })} now={NOW} />);
    expect(screen.getByTestId('device-full-access')).toHaveTextContent(`${KEY}.fullChipUntilOff`);
    rerender(<FullAccessChip access={access({ mode: 'trusted' })} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Ask and Trusted apps apply at once', async () => {
    const onChanged = vi.fn();
    render(<AccessModeControl device={phone()} access={access()} onChanged={onChanged} />);
    fireEvent.click(radio(`${KEY}.modes.trusted`));
    await waitFor(() => expect(api.setAccess.invoke).toHaveBeenCalledWith({ id: 'pixel', mode: 'trusted' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('Full access asks first: duration, an unchecked banking box and a plain warning; nothing is sent before Confirm', async () => {
    render(<AccessModeControl device={phone()} access={access()} onChanged={() => undefined} />);
    fireEvent.click(radio(`${KEY}.modes.full`));
    const dialog = await screen.findByTestId('device-full-confirm');
    expect(api.setAccess.invoke).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent(`${KEY}.fullWarning`);
    const box = within(dialog).getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(dialog).toHaveTextContent(`${KEY}.sensitiveOffHint`);
    expect(within(dialog).getByLabelText(`${KEY}.durations.1h`)).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText(`${KEY}.durations.8h`));
    fireEvent.click(box);
    expect(dialog).toHaveTextContent(`${KEY}.sensitiveOnHint`);
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.fullConfirm` }));
    await waitFor(() =>
      expect(api.setAccess.invoke).toHaveBeenCalledWith({
        id: 'pixel',
        mode: 'full',
        full_duration: '8h',
        include_sensitive: true,
      })
    );
  });

  it('cancelling the Full access question changes nothing, and the box is unchecked again next time', async () => {
    render(<AccessModeControl device={phone()} access={access()} onChanged={() => undefined} />);
    fireEvent.click(radio(`${KEY}.modes.full`));
    const dialog = await screen.findByTestId('device-full-confirm');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByTestId('device-full-confirm')).toBeNull());
    expect(api.setAccess.invoke).not.toHaveBeenCalled();
    fireEvent.click(radio(`${KEY}.modes.full`));
    expect(within(await screen.findByTestId('device-full-confirm')).getByRole('checkbox')).not.toBeChecked();
  });

  it('the drawer explains the mode and edits the trusted apps: remove one, add one from recent approvals', async () => {
    const row = (pkg: string | null, outcome: string) => ({
      at: 1,
      verb: 'launch',
      package: pkg,
      origin: null,
      outcome,
      conversation_id: null,
      detail: null,
    });
    api.audit.invoke.mockResolvedValue({
      rows: [
        row('com.maps.app', 'approved'),
        row('com.shop.app', 'approved'),
        row('com.bank.app', 'denied'),
        row('unknown', 'approved'),
      ],
      next_cursor: null,
    });
    const device = phone({ access: access({ mode: 'trusted', trusted_apps: ['com.shop.app', 'com.mail.app'] }) });
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AccessModeBlock device={device} now={NOW} onChanged={() => undefined} />
      </SWRConfig>
    );
    expect(screen.getByTestId('device-access-mode-hint')).toHaveTextContent(`${KEY}.hints.trusted`);
    const apps = screen.getAllByTestId('device-trusted-app');
    expect(apps.map((app) => app.getAttribute('data-app'))).toEqual(['com.shop.app', 'com.mail.app']);
    fireEvent.click(within(apps[1]).getByRole('button'));
    await waitFor(() =>
      expect(api.setTrustedApps.invoke).toHaveBeenCalledWith({ id: 'pixel', apps: ['com.shop.app'] })
    );
    // Offered: approved, not yet trusted, a real app id.
    fireEvent.click(screen.getByTestId('device-trusted-add'));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['com.maps.app']);
    fireEvent.click(options[0]);
    fireEvent.click(screen.getByTestId('device-trusted-add-button'));
    await waitFor(() =>
      expect(api.setTrustedApps.invoke).toHaveBeenLastCalledWith({
        id: 'pixel',
        apps: ['com.shop.app', 'com.mail.app', 'com.maps.app'],
      })
    );
    // Banking and password apps on the list still ask unless included.
    fireEvent.click(screen.getByTestId('device-trusted-sensitive'));
    await waitFor(() =>
      expect(api.setAccess.invoke).toHaveBeenCalledWith({ id: 'pixel', mode: 'trusted', include_sensitive: true })
    );
  });

  it('the card shows the control and, in Full access, the amber chip instead of the switch timer', () => {
    const props = {
      now: NOW,
      saving: false,
      onToggle: () => undefined,
      onInstall: () => undefined,
      onRemove: () => undefined,
      onOpen: () => undefined,
      onJobFinished: () => undefined,
    };
    const { rerender } = render(<DeviceCard device={phone()} {...props} />);
    expect(screen.getByTestId('device-access-mode')).toBeInTheDocument();
    expect(screen.getByTestId('device-off-in')).toBeInTheDocument();
    expect(screen.queryByTestId('device-full-access')).toBeNull();
    rerender(
      <DeviceCard device={phone({ access: access({ mode: 'full', full_until: NOW + 52 * 60_000 }) })} {...props} />
    );
    expect(screen.getByTestId('device-full-access')).toHaveTextContent(`${KEY}.fullChip|{"count":52}`);
    expect(screen.queryByTestId('device-off-in')).toBeNull();
    rerender(<DeviceCard device={phone({ kind: 'server_browser', access: undefined })} {...props} />);
    expect(screen.queryByTestId('device-access-mode')).toBeNull();
  });

  it('an approval offers "Always allow this app"; not for an unknown app or an add-on task', async () => {
    api.decideApproval.invoke.mockResolvedValue(undefined);
    const view = render(<DeviceApprovalCard approval={approval()} now={1_000} onDecided={() => undefined} />);
    expect(screen.queryByTestId('device-approval-sensitive')).toBeNull();
    fireEvent.click(screen.getByTestId('device-approval-always'));
    await waitFor(() =>
      expect(api.decideApproval.invoke).toHaveBeenCalledWith({ id: 'a1', decision: 'allow', always: true })
    );
    await waitFor(() =>
      expect(Message.success).toHaveBeenCalledWith('settings.devices.approval.alwaysDone|{"app":"com.shop.app"}')
    );
    view.unmount();
    const sensitive = render(
      <DeviceApprovalCard approval={approval({ sensitive: true })} now={1_000} onDecided={() => undefined} />
    );
    expect(screen.getByTestId('device-approval-sensitive')).toHaveTextContent(
      'settings.devices.approval.alwaysSensitive'
    );
    sensitive.unmount();
    for (const patch of [{ package: 'unknown' }, { package: null }, { task: 'Book a train' }]) {
      const card = render(<DeviceApprovalCard approval={approval(patch)} now={1_000} onDecided={() => undefined} />);
      expect(screen.queryByTestId('device-approval-always')).toBeNull();
      card.unmount();
    }
  });

  it('a plain Allow still sends no "always"', async () => {
    api.decideApproval.invoke.mockResolvedValue(undefined);
    render(<DeviceApprovalCard approval={approval()} now={1_000} onDecided={() => undefined} />);
    fireEvent.click(screen.getByTestId('device-approval-allow'));
    await waitFor(() => expect(api.decideApproval.invoke).toHaveBeenCalledWith({ id: 'a1', decision: 'allow' }));
  });
});

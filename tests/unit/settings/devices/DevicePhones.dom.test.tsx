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
import type { Device, DeviceApproval } from '@/common/types/platform/devices';

const api = vi.hoisted(() => ({
  update: { invoke: vi.fn() },
  setRoute: { invoke: vi.fn() },
  createPairingCode: { invoke: vi.fn() },
  decideApproval: { invoke: vi.fn() },
  audit: { invoke: vi.fn() },
  listApprovals: { invoke: vi.fn() },
  approval: { on: () => () => undefined },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({ devices: api }));
vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (error: unknown) => typeof (error as { status?: unknown })?.status === 'number',
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings', () => ({
  formatCountdown: (seconds: number) => `${seconds}s`,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
    i18n: { language: 'en-US' },
  }),
}));

import DeviceApprovalPrompts, {
  DeviceApprovalCard,
} from '@/renderer/pages/settings/DevicesSettings/phones/DeviceApprovalPrompts';
import DevicePairingModal from '@/renderer/pages/settings/DevicesSettings/phones/DevicePairingModal';
import {
  DeviceAccessBlock,
  DeviceAuditBlock,
  DeviceRoutesBlock,
} from '@/renderer/pages/settings/DevicesSettings/phones/PhoneBlocks';
import { addonRunDetail, knownAddon } from '@/renderer/pages/settings/DevicesSettings/devicesModel';
import { pendingDeviceApprovals } from '@/renderer/pages/settings/DevicesSettings/useDevices';

const KEY = 'settings.devices';
const SHARED = 'preview.browserDevices.approval';

const PHONE: Device = {
  id: 'pixel',
  kind: 'phone',
  source_id: null,
  name: 'Pixel 9',
  status: 'off',
  available: 'now',
  enabled: false,
  enabled_until: null,
  installed: true,
  disk_bytes: null,
  version: null,
  job_id: null,
  last_seen_at: null,
  routes: [
    { route: 'mac_relay', enabled: true, status: 'on', experimental: false },
    { route: 'companion', enabled: false, status: 'needs_pairing', experimental: false },
    { route: 'wifi_direct', enabled: false, status: 'off', experimental: true },
  ],
};

const approval = (patch: Partial<DeviceApproval>): DeviceApproval => ({
  id: 'a1',
  device_id: 'pixel',
  device_name: 'Pixel 9',
  verb: 'launch',
  summary: 'launch com.bank.app',
  task: null,
  package: 'com.bank.app',
  origin: null,
  conversation_id: null,
  created_at: 1_000,
  expires_at: 61_000,
  ...patch,
});

const swr = (node: React.ReactNode) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>
);

beforeEach(() => {
  vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
  vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('device approvals (TASK-136 U2/U3)', () => {
  it('keeps pending approvals oldest first and drops expired ones', () => {
    const rows = [
      approval({ id: 'b', created_at: 5 }),
      approval({ id: 'a', created_at: 2 }),
      approval({ id: 'old', expires_at: 10 }),
    ];
    expect(pendingDeviceApprovals(rows, 1_000).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('shows what the agent wants and where, and sends Allow', async () => {
    api.decideApproval.invoke.mockResolvedValue(undefined);
    const onDecided = vi.fn();
    render(<DeviceApprovalCard approval={approval({})} now={1_000} onDecided={onDecided} />);
    const card = screen.getByTestId('device-approval');
    expect(card).toHaveTextContent(`${KEY}.approval.title|{"device":"Pixel 9"}`);
    expect(card).toHaveTextContent(`${KEY}.approval.target|{"target":"com.bank.app"}`);
    expect(screen.getByTestId('device-approval-summary')).toHaveTextContent('launch com.bank.app');
    expect(card).toHaveTextContent(`${SHARED}.countdown|{"count":60}`);
    fireEvent.click(screen.getByTestId('device-approval-allow'));
    await waitFor(() => expect(api.decideApproval.invoke).toHaveBeenCalledWith({ id: 'a1', decision: 'allow' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('a1'));
    expect(Message.success).toHaveBeenCalledWith(`${KEY}.approval.allowed`);
  });

  it('a grant says how long Allow covers that device and app; an add-on task has none', async () => {
    api.decideApproval.invoke.mockResolvedValue(undefined);
    render(<DeviceApprovalCard approval={approval({ grant_minutes: 5 })} now={1_000} onDecided={() => undefined} />);
    expect(screen.getByTestId('device-approval-grant')).toHaveTextContent(`${KEY}.approval.grantHint|{"count":5}`);
    const allow = screen.getByTestId('device-approval-allow');
    expect(allow).toHaveTextContent(`${KEY}.approval.allowFor|{"count":5}`);
    fireEvent.click(allow);
    await waitFor(() => expect(Message.success).toHaveBeenCalledWith(`${KEY}.approval.allowedFor|{"count":5}`));
  });

  it('an add-on run shows the whole task text; Deny on an expired one says so', async () => {
    api.decideApproval.invoke.mockRejectedValue({ status: 410 });
    render(
      <DeviceApprovalCard
        approval={approval({ verb: 'addon_run', task: 'Book the 9:00 train to Lyon', package: null })}
        now={1_000}
        onDecided={() => undefined}
      />
    );
    const card = screen.getByTestId('device-approval');
    expect(card).toHaveTextContent(`${KEY}.approval.titleTask|{"device":"Pixel 9"}`);
    expect(screen.getByTestId('device-approval-summary')).toHaveTextContent('Book the 9:00 train to Lyon');
    expect(card).toHaveTextContent(`${KEY}.approval.taskHint`);
    expect(screen.queryByTestId('device-approval-grant')).toBeNull();
    expect(screen.getByTestId('device-approval-allow')).toHaveTextContent(`${KEY}.approval.allow`);
    fireEvent.click(screen.getByTestId('device-approval-deny'));
    await waitFor(() => expect(api.decideApproval.invoke).toHaveBeenCalledWith({ id: 'a1', decision: 'deny' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith(`${SHARED}.expired`));
  });

  it('the app-wide prompts list what is pending and nothing otherwise', async () => {
    api.listApprovals.invoke.mockResolvedValue([approval({ expires_at: Date.now() + 60_000 })]);
    const view = render(swr(<DeviceApprovalPrompts />));
    expect(await screen.findByTestId('device-approvals')).toBeInTheDocument();
    view.unmount();
    api.listApprovals.invoke.mockResolvedValue([]);
    const empty = render(swr(<DeviceApprovalPrompts />));
    await waitFor(() => expect(api.listApprovals.invoke).toHaveBeenCalledTimes(2));
    expect(empty.container).toBeEmptyDOMElement();
  });
});

describe('pairing a phone route (TASK-136 U2)', () => {
  it('companion app: a download QR, a pairing QR, the code and the limits said plainly', async () => {
    api.createPairingCode.invoke.mockResolvedValue({
      code: 'ABCD-2345',
      expires_at: Date.now() + 300_000,
      download_url: 'https://y.example.com/api/devices/apk?sig=1',
      qr_payload: 'aionui-pair:v1?host=y.example.com&code=ABCD-2345',
    });
    render(<DevicePairingModal kind='companion' onClose={() => undefined} />);
    await waitFor(() => expect(api.createPairingCode.invoke).toHaveBeenCalledWith({ kind: 'companion' }));
    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('ABCD-2345');
    expect(screen.getByTestId('device-pairing-qr-install')).toHaveAttribute(
      'data-value',
      'https://y.example.com/api/devices/apk?sig=1'
    );
    expect(screen.getByTestId('device-pairing-qr-pair')).toHaveAttribute(
      'data-value',
      'aionui-pair:v1?host=y.example.com&code=ABCD-2345'
    );
    expect(within(screen.getByTestId('device-pairing-limits')).getAllByRole('listitem')).toHaveLength(6);
  });

  it('Mac helper: download, the Gatekeeper step, the code; no QR', async () => {
    api.createPairingCode.invoke.mockResolvedValue({
      code: 'WXYZ-6789',
      expires_at: Date.now() + 300_000,
      download_url: 'https://y.example.com/mac-helper/AionUi-Helper.zip',
      qr_payload: null,
    });
    render(<DevicePairingModal kind='mac_helper' onClose={() => undefined} />);
    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('WXYZ-6789');
    expect(screen.getByTestId('device-pairing')).toHaveTextContent(`${KEY}.pair.mac.stepGatekeeper`);
    expect(screen.getByTestId('device-pairing-download')).toHaveAttribute(
      'href',
      'https://y.example.com/mac-helper/AionUi-Helper.zip'
    );
    expect(screen.queryByTestId('device-pairing-qr-pair')).toBeNull();
  });

  it('offers a new code when none could be made', async () => {
    api.createPairingCode.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      code: 'NEW1-2345',
      expires_at: Date.now() + 300_000,
      download_url: null,
      qr_payload: null,
    });
    render(<DevicePairingModal kind='companion' onClose={() => undefined} />);
    fireEvent.click(await screen.findByTestId('device-pairing-renew'));
    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('NEW1-2345');
    expect(api.createPairingCode.invoke).toHaveBeenCalledTimes(2);
  });
});

describe('phone drawer blocks (TASK-136 U2)', () => {
  it('each connection option has its own switch; unpaired ones offer Pair; experimental ones are locked', async () => {
    api.setRoute.invoke.mockResolvedValue(PHONE);
    const onPair = vi.fn();
    const onChanged = vi.fn();
    render(<DeviceRoutesBlock device={PHONE} onChanged={onChanged} onPair={onPair} />);
    const [mac, companion, wifi] = screen.getAllByTestId('device-route');
    fireEvent.click(within(mac).getByTestId('device-route-switch'));
    await waitFor(() =>
      expect(api.setRoute.invoke).toHaveBeenCalledWith({ id: 'pixel', route: 'mac_relay', enabled: false })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(within(mac).queryByTestId('device-route-pair')).toBeNull();
    expect(within(companion).getByTestId('device-route-switch')).toBeDisabled();
    fireEvent.click(within(companion).getByTestId('device-route-pair'));
    expect(onPair).toHaveBeenCalledWith('companion');
    expect(wifi).toHaveTextContent(`${KEY}.routes.experimental`);
    expect(within(wifi).getByTestId('device-route-switch')).toBeDisabled();
    expect(within(wifi).queryByTestId('device-route-pair')).toBeNull();
  });

  it('switching on sends the chosen timeout; changing it while on restarts the clock', async () => {
    api.update.invoke.mockResolvedValue(PHONE);
    const view = render(<DeviceAccessBlock device={PHONE} onChanged={() => undefined} />);
    fireEvent.click(screen.getByLabelText(`${KEY}.access.minutes|{"count":15}`));
    expect(api.update.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('device-access-switch'));
    await waitFor(() =>
      expect(api.update.invoke).toHaveBeenCalledWith({ id: 'pixel', enabled: true, timeout_minutes: 15 })
    );
    view.rerender(<DeviceAccessBlock device={{ ...PHONE, enabled: true }} onChanged={() => undefined} />);
    fireEvent.click(screen.getByLabelText(`${KEY}.access.minutes|{"count":60}`));
    await waitFor(() =>
      expect(api.update.invoke).toHaveBeenLastCalledWith({ id: 'pixel', enabled: true, timeout_minutes: 60 })
    );
    fireEvent.click(screen.getByTestId('device-access-switch'));
    await waitFor(() => expect(api.update.invoke).toHaveBeenLastCalledWith({ id: 'pixel', enabled: false }));
  });

  it('the audit lists verb, app and outcome and loads older rows by cursor', async () => {
    const row = (at: number, verb: string) => ({
      at,
      verb,
      package: 'com.android.chrome',
      origin: null,
      outcome: 'ok' as const,
      conversation_id: null,
      detail: null,
    });
    api.audit.invoke
      .mockResolvedValueOnce({ rows: [row(2, 'tap'), row(1, 'screenshot')], next_cursor: 'c2' })
      .mockResolvedValueOnce({ rows: [{ ...row(0, 'install_apk'), outcome: 'error' }], next_cursor: null });
    render(swr(<DeviceAuditBlock device={PHONE} />));
    expect(await screen.findAllByTestId('device-audit-row')).toHaveLength(2);
    expect(api.audit.invoke).toHaveBeenCalledWith({ id: 'pixel', limit: 50 });
    fireEvent.click(screen.getByTestId('device-audit-more'));
    await waitFor(() => expect(screen.getAllByTestId('device-audit-row')).toHaveLength(3));
    expect(api.audit.invoke).toHaveBeenLastCalledWith({ id: 'pixel', cursor: 'c2', limit: 50 });
    expect(screen.getAllByTestId('device-audit-row')[2]).toHaveTextContent(`${KEY}.audit.error`);
    expect(screen.queryByTestId('device-audit-more')).toBeNull();
  });

  it('an add-on run in the audit shows its task and a trace link, http(s) only', async () => {
    const run = (detail: unknown) => ({
      at: 5,
      verb: 'addon_run',
      package: null,
      origin: null,
      outcome: 'ok' as const,
      conversation_id: null,
      detail: JSON.stringify(detail),
    });
    api.audit.invoke.mockResolvedValue({
      rows: [
        run({ task: 'Book the train', state: 'done', duration_ms: 9000, trace_url: 'https://trace.example/1' }),
        run({ task: 'Other', state: 'failed', message: 'phone locked', trace_url: 'javascript:alert(1)' }),
      ],
      next_cursor: null,
    });
    render(swr(<DeviceAuditBlock device={{ ...PHONE, id: 'addon:p1:artemis', kind: 'addon' }} />));
    const rows = await screen.findAllByTestId('device-audit-row');
    expect(within(rows[0]).getByTestId('device-audit-task')).toHaveTextContent('Book the train');
    expect(within(rows[0]).getByTestId('device-audit-trace')).toHaveAttribute('href', 'https://trace.example/1');
    expect(rows[1]).toHaveTextContent('phone locked');
    expect(within(rows[1]).queryByTestId('device-audit-trace')).toBeNull();
    expect(addonRunDetail('not json')).toBeNull();
    expect(addonRunDetail(null)).toBeNull();
    expect(knownAddon({ ...PHONE, id: 'addon:p1:mobilerun', kind: 'addon', name: 'x' })).toBe('mobilerun');
    expect(knownAddon({ ...PHONE, id: 'addon:artemis', kind: 'addon', name: 'x' })).toBe('artemis');
  });
});

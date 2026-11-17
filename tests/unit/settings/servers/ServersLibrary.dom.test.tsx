/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitAttachmentResponse } from '@/common/config/storage';
import type { ServerResponse } from '@/common/types/platform/serverPools';

const api = vi.hoisted(() => ({
  servers: [] as unknown[],
  attachments: [] as unknown[],
  origin: null as string | null,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  test: vi.fn(),
  scan: vi.fn(),
  audit: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}));

// One fake bridge for both import paths (`@/common` and the adapter module itself).
const bridge = vi.hoisted(() => ({
  servers: {
    list: { invoke: (...args: unknown[]) => api.list(...args) },
    create: { invoke: (...args: unknown[]) => api.create(...args) },
    update: { invoke: (...args: unknown[]) => api.update(...args) },
    remove: { invoke: (...args: unknown[]) => api.remove(...args) },
    test: { invoke: (...args: unknown[]) => api.test(...args) },
    scanHostKey: { invoke: (...args: unknown[]) => api.scan(...args) },
    audit: { invoke: (...args: unknown[]) => api.audit(...args) },
  },
  kits: {
    listAttachments: { invoke: async () => api.attachments },
    attach: { invoke: (...args: unknown[]) => api.attach(...args) },
    detach: { invoke: (...args: unknown[]) => api.detach(...args) },
  },
}));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  kits: bridge.kits,
  servers: bridge.servers,
}));
vi.mock('@/common', () => ({ ipcBridge: bridge }));
// Arco's static Message cannot mount under jsdom + React 19; the toasts are spied instead.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: api.messageSuccess, error: api.messageError } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'scope' in options ? `${key}:${String(options.scope)}` : key,
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/renderer/components/settings/SettingsModal/library/useOriginProjectId', () => ({
  useOriginProjectId: () => api.origin,
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => [{ workspace: '/root/projects/tb', name: 'TB', project_id: 'p1' }],
}));
vi.mock('@/renderer/hooks/assistant/useAssistantList', () => ({
  useAssistantList: () => ({ assistants: [{ id: 'a1', name: 'Builder' }] }),
}));
vi.mock('@/renderer/components/workspace/ProjectIdentity', () => ({
  useProjectTheme: () => null,
  ProjectChip: () => null,
}));

import ServersLibrary from '@/renderer/pages/settings/ServersSettings/ServersLibrary';

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';

const server = (over: Partial<ServerResponse>): ServerResponse => ({
  id: 's1',
  name: 'web-1',
  host: 'web1.example.com',
  port: 22,
  ssh_user: 'deploy',
  host_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKKUmej5+uq4elbDcluSJ9ySH9I4u8QmlVuNVi3i4qKZ',
  labels: ['tb'],
  environment: 'staging',
  tier: 'read',
  notes: '',
  enabled: true,
  has_key: true,
  crucial_commands_ask: false,
  tier_note: 'core tier note',
  created_at: 1,
  updated_at: 2,
  ...over,
});

const attachment = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'att-1',
  level: 'global',
  target_id: '',
  item_kind: 'server',
  item_ref: 's1',
  item_name: 'web-1',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ServersLibrary />
    </SWRConfig>
  );

const cardOf = async (name: string) => {
  const title = await screen.findByText(name);
  return title.closest('[data-testid="library-card"]') as HTMLElement;
};

describe('Settings → Servers (C36)', () => {
  beforeEach(() => {
    api.origin = null;
    api.servers = [
      server({}),
      server({ id: 's2', name: 'db-prod', environment: 'production', tier: 'write', crucial_commands_ask: true }),
    ];
    api.attachments = [attachment({})];
    api.list.mockImplementation(async () => api.servers);
    api.audit.mockResolvedValue([]);
    api.attach.mockResolvedValue({});
    api.detach.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Global → Active: the server that is on, with its chips; turning it off drops the attachment', async () => {
    renderPage();
    const card = await cardOf('web-1');
    expect(within(card).getByText('settings.servers.chips.keyStored')).toBeInTheDocument();
    expect(within(card).getByText('deploy@web1.example.com')).toBeInTheDocument();
    expect(screen.queryByText('db-prod')).toBeNull();

    const toggle = within(card).getByTestId('library-card-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.detach).toHaveBeenCalledWith({ id: 'att-1' }));
  });

  it('Library: turning a server on in Global attaches it with exactly these fields', async () => {
    renderPage();
    await cardOf('web-1');
    fireEvent.click(screen.getByRole('tab', { name: /settings\.library\.tabLibrary/ }));
    const card = await cardOf('db-prod');
    expect(within(card).getByText('settings.servers.chips.asks')).toBeInTheDocument();
    fireEvent.click(within(card).getByTestId('library-card-toggle'));
    await waitFor(() =>
      expect(api.attach).toHaveBeenCalledWith({ level: 'global', item_kind: 'server', item_ref: 's2', op: 'add' })
    );
  });

  it('a project: an inherited Global server is turned off here with a remove at the project', async () => {
    api.origin = 'p1';
    renderPage();
    expect(await screen.findByText('settings.library.group.fromGlobal')).toBeInTheDocument();
    const card = await cardOf('web-1');
    fireEvent.click(within(card).getByTestId('library-card-toggle'));
    await waitFor(() =>
      expect(api.attach).toHaveBeenCalledWith({
        level: 'project',
        target_id: 'p1',
        item_kind: 'server',
        item_ref: 's1',
        op: 'remove',
      })
    );
  });

  it('a switched-off server cannot be turned on in a scope', async () => {
    api.servers = [server({ enabled: false })];
    renderPage();
    const card = await cardOf('web-1');
    expect(within(card).getByTestId('library-card-toggle')).toBeDisabled();
    expect(within(card).getByText('settings.servers.chips.off')).toBeInTheDocument();
  });

  it('Add server: refuses an incomplete form, then sends the exact create body', async () => {
    api.servers = [];
    api.create.mockImplementation(async (body) => server({ id: 's9', name: body.name }));
    renderPage();
    fireEvent.click(await screen.findByTestId('server-add'));
    const drawer = await screen.findByTestId('server-drawer');

    fireEvent.click(screen.getByTestId('server-save'));
    expect(await within(drawer).findByText('settings.servers.problems.nameRequired')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(within(drawer).getByLabelText('settings.servers.fields.name'), { target: { value: 'Web-9' } });
    fireEvent.change(within(drawer).getByLabelText('settings.servers.fields.user'), { target: { value: 'deploy' } });
    fireEvent.change(within(drawer).getByLabelText('settings.servers.fields.host'), {
      target: { value: '203.0.113.9' },
    });
    fireEvent.change(within(drawer).getByTestId('server-key-input'), { target: { value: KEY } });
    fireEvent.click(screen.getByTestId('server-save'));

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({
        name: 'web-9',
        host: '203.0.113.9',
        port: 22,
        ssh_user: 'deploy',
        private_key: KEY,
        labels: [],
        environment: 'staging',
        tier: 'read',
        notes: '',
        enabled: true,
      })
    );
  });

  it('editing: the key is shown as stored, never as text, and only the change is sent', async () => {
    api.update.mockImplementation(async ({ data }) => server({ ...data, updated_at: 3 }));
    renderPage();
    fireEvent.click(within(await cardOf('web-1')).getByTestId('library-card-open'));
    const drawer = await screen.findByTestId('server-drawer');
    expect(within(drawer).getByTestId('server-key-stored')).toBeInTheDocument();
    expect(within(drawer).queryByTestId('server-key-input')).toBeNull();
    expect(within(drawer).getByTestId('server-host-key-fingerprints')).toHaveTextContent(
      'SHA256:F5PC1joOfsbtrInNkCVG7u0x3TsD8rQtKGLDgxK2+bc'
    );

    fireEvent.change(within(drawer).getByLabelText('settings.servers.fields.notes'), {
      target: { value: 'web front' },
    });
    fireEvent.click(screen.getByTestId('server-save'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ id: 's1', data: { notes: 'web front' } }));
  });

  it('Test connection: a changed host key is reported and can be adopted into the field', async () => {
    api.test.mockResolvedValue({
      ok: false,
      error_code: 'host_key_mismatch',
      seen_host_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINEW',
    });
    renderPage();
    fireEvent.click(within(await cardOf('web-1')).getByTestId('library-card-open'));
    const drawer = await screen.findByTestId('server-drawer');
    fireEvent.click(within(drawer).getByText('settings.servers.test.run'));
    const result = await within(drawer).findByTestId('server-test-result');
    expect(result).toHaveTextContent('settings.servers.test.errors.host_key_mismatch');
    fireEvent.click(within(result).getByText('settings.servers.test.useSeenKey'));
    expect(within(drawer).getByTestId('server-host-key-input')).toHaveValue('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINEW');
    expect(api.test).toHaveBeenCalledWith({ id: 's1' });
  });

  it('a production + write server warns that crucial commands ask first', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /settings\.library\.tabLibrary/ }));
    fireEvent.click(within(await cardOf('db-prod')).getByTestId('library-card-open'));
    const note = await within(await screen.findByTestId('server-drawer')).findByTestId('server-tier-note');
    expect(note).toHaveTextContent('core tier note');
    expect(note).toHaveTextContent('settings.servers.crucialAsks');
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tools page in the library layout (C33, TASK-119; market C15): Active by
 * scope (custom servers, instances attached nowhere, a project's instances),
 * the rail, states, search, the card switch and the drawer's attach / detach.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IMcpServer, McpMarketAssignment, McpMarketInstance } from '@/common/config/storage';

// TASK-122: these tests wait for the UI to be ready (findBy / waitFor), never for a fixed time. The library's default
// 1 s bound for those waits is itself a wall clock: on a loaded gate machine a dialog can take longer to appear. A wait
// still returns the moment its condition holds, so the larger bound costs nothing when the UI is fast.
configure({ asyncUtilTimeout: 15_000 });
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  market: {} as Record<string, unknown>,
  projects: [] as Array<{ workspace: string; name: string; project_id?: string }>,
  kits: [] as unknown[],
  kitAttachments: [] as unknown[],
  effective: null as unknown,
  origin: null as string | null,
  confirm: null as null | { onOk?: () => Promise<void> | void },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/mcp/market/useKits', () => ({
  useKitList: () => ({ kits: state.kits ?? [] }),
  useKitAttachments: () => ({ attachments: state.kitAttachments ?? [] }),
  useKitEffective: () => ({ effective: state.effective ?? null, isLoading: false, reload: vi.fn() }),
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/kits/KitsSection', () => ({
  default: () => <div data-testid='kits-section-stub' />,
}));

vi.mock('@/renderer/components/settings/SettingsModal/library/useOriginProjectId', () => ({
  useOriginProjectId: () => state.origin ?? null,
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    Modal: Object.assign(actual.Modal, {
      confirm: (config: { onOk?: () => Promise<void> | void }) => {
        state.confirm = config;
      },
    }),
  };
});

vi.mock('@/renderer/hooks/mcp/market/useMcpMarket', () => ({
  useMcpMarket: () => state.market,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => state.projects,
}));

vi.mock('@/renderer/components/workspace/ProjectIdentity', () => ({
  useProjectTheme: (workspace?: string | null) => (workspace ? { workspace, name: workspace.split('/').pop() } : null),
  ProjectChip: ({ project }: { project: { name: string } }) => <span data-testid='project-chip'>{project.name}</span>,
}));

import McpMarketView from '@/renderer/pages/settings/ToolsSettings/market';
import { BackendHttpError } from '@/common/adapter/httpBridge';

const inst = (name: string, extra: Partial<McpMarketInstance> = {}): McpMarketInstance => ({
  id: `id-${name}`,
  name,
  template_id: 'paddle',
  transport: 'stdio',
  environment: 'production',
  tier: 'read',
  enforcement: 'server',
  status: 'dormant',
  clis: ['claude', 'codex', 'gemini'],
  plain_env: {},
  secrets: [],
  missing: [],
  tools_allow: [],
  tools_block: [],
  tools_seen: [],
  last_test_status: 'unknown',
  template_in_catalogue: true,
  template_update_available: false,
  created_at: 1,
  updated_at: 1,
  ...extra,
});

const paddle = inst('tb-paddle-prod-read', {
  secrets: [
    {
      key: 'PADDLE_API_KEY',
      name: 'TB_PADDLE_PROD_READ__PADDLE_API_KEY',
      instance_id: 'id-tb-paddle-prod-read',
      instance_name: 'tb-paddle-prod-read',
      required: true,
      set: true,
      updated_at: 1,
    },
  ],
});
const ctx = inst('context7', { template_id: 'context7', environment: 'local' });
const lonely = inst('tb-lonely');

const assignment = (instance: McpMarketInstance, cli: string, project_id?: string): McpMarketAssignment => ({
  id: `as-${instance.name}-${cli}-${project_id ?? 'g'}`,
  instance_id: instance.id,
  instance_name: instance.name,
  project_id,
  cli,
  created_at: 1,
});

const legacy = (id: string, name: string) => ({ id, name, enabled: true }) as IMcpServer;

const renderView = () =>
  render(
    <McpMarketView
      legacyServers={[legacy('legacy-1', 'my-server'), legacy(paddle.id, paddle.name)]}
      extensionServers={[]}
      renderLegacyServer={(server, readOnly) => (
        <div data-testid='legacy-row'>
          {server.name}
          {readOnly ? ' (read-only)' : ''}
        </div>
      )}
    />
  );

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  state.origin = null;
  state.confirm = null;
  state.projects = [
    { workspace: '/root/projects/alpha', name: 'alpha', project_id: 'p-alpha' },
    { workspace: '/root/projects/empty', name: 'empty', project_id: 'p-empty' },
  ];
  state.market = {
    templates: [
      {
        id: 'paddle',
        name: 'Paddle',
        transport: 'stdio',
        env: {},
        tiers: ['read'],
        enforcement: 'server',
        clis: ['claude'],
      },
    ],
    instances: [paddle, ctx, lonely],
    assignments: [assignment(paddle, 'claude', 'p-alpha'), assignment(paddle, 'codex', 'p-alpha')],
    health: {},
    assistants: [],
    loading: false,
    error: null,
    templatesError: null,
    reload: vi.fn(() => Promise.resolve()),
    attach: vi.fn(() => Promise.resolve([])),
    detach: vi.fn(() => Promise.resolve()),
  };
});

afterEach(() => cleanup());

const section = (key: string) =>
  screen.getAllByTestId('library-section').find((el) => el.getAttribute('data-section-key') === key) as HTMLElement;
const sectionKeys = () => screen.getAllByTestId('library-section').map((el) => el.getAttribute('data-section-key'));
const cardIds = (el: HTMLElement) =>
  within(el)
    .queryAllByTestId('library-card')
    .map((c) => c.getAttribute('data-card-id'));
const openCard = (name: string) =>
  fireEvent.click(screen.getAllByTestId('library-card-open').find((b) => b.textContent === name) as HTMLElement);
const pickScope = (key: string) =>
  fireEvent.click(
    screen.getAllByTestId('library-rail-scope').find((b) => b.getAttribute('data-key') === key) as HTMLElement
  );

describe('McpMarketView (C33 library layout)', () => {
  it('Global Active: custom servers (legacy rows without market rows) and instances attached nowhere', () => {
    renderView();
    expect(screen.getByTestId('library-tab-active')).toHaveAttribute('aria-selected', 'true');
    expect(sectionKeys()).toEqual(['attached', 'unassigned', 'custom']);
    expect(
      within(section('custom'))
        .getAllByTestId('legacy-row')
        .map((n) => n.textContent)
    ).toEqual(['my-server']);
    // Attached nowhere is folded; it opens on click.
    const toggle = within(section('unassigned')).getByTestId('library-section-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(cardIds(section('unassigned'))).toEqual([ctx.id, lonely.id]);
  });

  it('rail: Global, projects with something; empty projects folded', () => {
    renderView();
    expect(screen.getAllByTestId('library-rail-scope').map((b) => b.getAttribute('data-key'))).toEqual([
      'global',
      'project:p-alpha',
    ]);
    expect(screen.getByTestId('library-rail-empty-toggle')).toHaveTextContent('settings.library.emptyProjects');
  });

  it('a project shows what is attached to it; switching it off detaches every CLI after a confirm', async () => {
    renderView();
    pickScope('project:p-alpha');
    expect(cardIds(section('attached'))).toEqual([paddle.id]);
    const toggle = within(section('attached')).getByTestId('library-card-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await state.confirm?.onOk?.();
    expect(state.market.detach).toHaveBeenCalledWith([
      `as-${paddle.name}-claude-p-alpha`,
      `as-${paddle.name}-codex-p-alpha`,
    ]);
  });

  it('switching an unattached instance on opens the attach dialog for that scope', async () => {
    renderView();
    fireEvent.click(within(section('unassigned')).getByTestId('library-section-toggle'));
    const card = within(section('unassigned'))
      .getAllByTestId('library-card')
      .find((c) => c.getAttribute('data-card-id') === ctx.id) as HTMLElement;
    fireEvent.click(within(card).getByTestId('library-card-toggle'));
    expect(await screen.findByTestId('mcp-market-attach')).toBeInTheDocument();
  });

  it('filters by search text', () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText('mcp.market.search'), { target: { value: 'lonely' } });
    expect(within(section('unassigned')).getByTestId('library-section-toggle')).toHaveTextContent('1');
    // Legacy rows only match their own name.
    expect(screen.queryByTestId('legacy-row')).toBeNull();
  });

  it('shows loading, then an error with retry', () => {
    state.market = { ...state.market, loading: true };
    const { unmount } = renderView();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    unmount();

    state.market = { ...state.market, loading: false, error: new Error('down') };
    renderView();
    fireEvent.click(screen.getAllByText('mcp.market.actions.retry')[0]);
    expect(state.market.reload).toHaveBeenCalled();
  });

  it('opens on the Market when nothing is set up yet', () => {
    state.market = { ...state.market, instances: [], assignments: [] };
    render(<McpMarketView legacyServers={[]} extensionServers={[]} renderLegacyServer={() => null} />);
    expect(screen.getByTestId('library-tab-market')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByTestId('library-card').map((c) => c.getAttribute('data-card-id'))).toEqual(['paddle']);
  });

  it('opens on the project of the conversation the settings came from', () => {
    state.origin = 'p-alpha';
    renderView();
    expect(screen.getByTestId('library-scope-title')).toHaveTextContent('alpha');
    expect(cardIds(section('attached'))).toEqual([paddle.id]);
  });

  it('the drawer shows key names as set / not set and never a ref value', async () => {
    renderView();
    pickScope('project:p-alpha');
    openCard(paddle.name);
    expect(await screen.findByTestId('mcp-market-drawer-actions')).toBeInTheDocument();
    expect(document.body.textContent).toContain('PADDLE_API_KEY');
    expect(document.body.innerHTML).not.toContain('TB_PADDLE_PROD_READ__PADDLE_API_KEY');
  });

  it('attaches context7 globally and detaches a project attachment from the drawer', async () => {
    renderView();
    fireEvent.click(within(section('unassigned')).getByTestId('library-section-toggle'));
    openCard('context7');
    const drawerActions = await screen.findByTestId('mcp-market-drawer-actions');
    fireEvent.click(within(drawerActions).getByText('mcp.market.actions.attach'));

    expect(await screen.findByTestId('mcp-market-attach')).toBeInTheDocument();
    // context7 may be global: Global is the default scope, every CLI it supports is pre-selected.
    // The dialog's own Attach button exists once the dialog body is rendered: wait for it instead of reading the
    // buttons at whatever moment the dialog shell appeared (TASK-122).
    const drawerAttach = within(drawerActions).getByText('mcp.market.actions.attach').closest('button');
    const dialogAttach = await waitFor(() => {
      const buttons = screen
        .getAllByText('mcp.market.actions.attach')
        .map((n) => n.closest('button')!)
        .filter((button) => button !== drawerAttach);
      expect(buttons.length).toBeGreaterThan(0);
      return buttons[buttons.length - 1];
    });
    fireEvent.click(dialogAttach);
    await waitFor(() =>
      expect(state.market.attach).toHaveBeenCalledWith({ instance_id: ctx.id, clis: ['claude', 'codex', 'gemini'] })
    );

    cleanup();
    renderView();
    pickScope('project:p-alpha');
    openCard(paddle.name);
    const attachments = await screen.findByTestId('mcp-market-drawer-attachments');
    fireEvent.click(within(attachments).getByText('mcp.market.actions.detach'));
    await waitFor(() =>
      expect(state.market.detach).toHaveBeenCalledWith([
        `as-${paddle.name}-claude-p-alpha`,
        `as-${paddle.name}-codex-p-alpha`,
      ])
    );
  });

  describe('template update', () => {
    const outdated = inst('tb-outdated', {
      template_update_available: true,
      template_version: '0.1.0',
      template_current_version: '0.2.0',
    });

    beforeEach(() => {
      state.market = {
        ...state.market,
        templates: [
          {
            id: 'paddle',
            name: 'Paddle',
            version: '0.2.0',
            transport: 'stdio',
            env: { NEW_TOKEN: { kind: 'secret', required: true } },
            tiers: ['read'],
            enforcement: 'server',
            clis: ['claude'],
          },
        ],
        instances: [outdated],
        assignments: [],
        refreshTemplate: vi.fn(),
        setSecret: vi.fn(() => Promise.resolve()),
      };
    });

    const openAndRefresh = async () => {
      renderView();
      fireEvent.click(within(section('unassigned')).getByTestId('library-section-toggle'));
      expect(screen.getByTestId('mcp-market-template-update')).toHaveTextContent(
        'mcp.market.template.updateAvailableVersions'
      );
      openCard('tb-outdated');
      fireEvent.click(await screen.findByTestId('mcp-market-refresh'));
      fireEvent.click(await screen.findByText('mcp.market.confirm.refresh.ok'));
    };

    it('shows the added and removed keys after a refresh', async () => {
      (state.market.refreshTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
        instance: outdated,
        from_version: '0.1.0',
        to_version: '0.2.0',
        added_keys: ['NEW_MODE'],
        removed_keys: ['OLD_MODE'],
        changed: true,
      });
      await openAndRefresh();
      const result = await screen.findByTestId('mcp-market-refresh-result');
      expect(state.market.refreshTemplate).toHaveBeenCalledWith(outdated.id);
      expect(result).toHaveTextContent('mcp.market.template.refreshed');
      expect(result).toHaveTextContent('mcp.market.template.added');
      expect(result).toHaveTextContent('mcp.market.template.removed');
    });

    it('explains MCP_TEMPLATE_SECRET_MISSING and offers the missing secret', async () => {
      (state.market.refreshTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new BackendHttpError({
          method: 'POST',
          path: '/api/mcp/market/instances/x/refresh-template',
          status: 409,
          body: {
            success: false,
            code: 'MCP_TEMPLATE_SECRET_MISSING',
            error: 'template paddle 0.2.0 needs secret NEW_TOKEN first; the instance stays on its current version',
          },
        })
      );
      await openAndRefresh();
      expect(await screen.findByText('mcp.market.errors.templateSecretMissing')).toBeInTheDocument();
      const pending = screen.getByTestId('mcp-market-drawer-pending-secrets');
      expect(within(pending).getByText('NEW_TOKEN')).toBeInTheDocument();
    });
  });
});

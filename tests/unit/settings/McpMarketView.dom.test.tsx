/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP market view of the Tools page (card C15): groups, legacy rows, states,
 * search, and the attach / detach calls made from an instance's drawer.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IMcpServer, McpMarketAssignment, McpMarketInstance } from '@/common/config/storage';

const state = vi.hoisted(() => ({
  market: {} as Record<string, unknown>,
  projects: [] as Array<{ workspace: string; name: string; project_id?: string }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
  state.projects = [{ workspace: '/root/projects/alpha', name: 'alpha', project_id: 'p-alpha' }];
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

describe('McpMarketView', () => {
  it('groups Global (legacy rows without market rows), projects and Unassigned', () => {
    renderView();
    const global = screen.getByTestId('mcp-market-group-global');
    expect(
      within(global)
        .getAllByTestId('legacy-row')
        .map((n) => n.textContent)
    ).toEqual(['my-server']);

    const project = screen.getByTestId('mcp-market-group-project');
    expect(project.getAttribute('data-project-id')).toBe('p-alpha');
    expect(within(project).getByText('tb-paddle-prod-read')).toBeInTheDocument();
    expect(screen.getAllByTestId('project-chip').some((n) => n.textContent === 'alpha')).toBe(true);

    const unassigned = screen.getByTestId('mcp-market-group-unassigned');
    expect(
      within(unassigned)
        .getAllByTestId('mcp-market-instance')
        .map((n) => n.getAttribute('data-instance-name'))
    ).toEqual(['context7', 'tb-lonely']);
  });

  it('shows secret keys as set / not set and no ref value', () => {
    renderView();
    const secrets = screen.getByTestId('mcp-market-instance-secrets');
    expect(secrets).toHaveTextContent('PADDLE_API_KEY');
    expect(secrets).toHaveTextContent('mcp.market.secret.set');
    expect(document.body.innerHTML).not.toContain('TB_PADDLE_PROD_READ__PADDLE_API_KEY');
  });

  it('filters by search text', () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText('mcp.market.search'), { target: { value: 'lonely' } });
    expect(screen.queryByText('tb-paddle-prod-read')).toBeNull();
    expect(screen.getByText('tb-lonely')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('mcp.market.actions.retry'));
    expect(state.market.reload).toHaveBeenCalled();
  });

  it('shows the empty state with Browse templates', () => {
    state.market = { ...state.market, instances: [], assignments: [] };
    render(<McpMarketView legacyServers={[]} extensionServers={[]} renderLegacyServer={() => null} />);
    expect(screen.getByText('mcp.market.empty')).toBeInTheDocument();
    expect(screen.getByText('mcp.market.browseTemplates')).toBeInTheDocument();
  });

  it('attaches context7 globally and detaches a project attachment from the drawer', async () => {
    renderView();
    const card = screen
      .getAllByTestId('mcp-market-instance')
      .find((n) => n.getAttribute('data-instance-name') === 'context7')!;
    fireEvent.click(within(card).getByText('mcp.market.actions.manage'));
    const drawerActions = await screen.findByTestId('mcp-market-drawer-actions');
    fireEvent.click(within(drawerActions).getByText('mcp.market.actions.attach'));

    const dialog = await screen.findByTestId('mcp-market-attach');
    expect(dialog).toBeInTheDocument();
    // context7 may be global: Global is the default scope, every CLI it supports is pre-selected.
    const okButtons = screen.getAllByText('mcp.market.actions.attach').map((n) => n.closest('button')!);
    fireEvent.click(okButtons[okButtons.length - 1]);
    await waitFor(() =>
      expect(state.market.attach).toHaveBeenCalledWith({ instance_id: ctx.id, clis: ['claude', 'codex', 'gemini'] })
    );

    cleanup();
    renderView();
    const paddleCard = screen
      .getAllByTestId('mcp-market-instance')
      .find((n) => n.getAttribute('data-instance-name') === paddle.name)!;
    fireEvent.click(within(paddleCard).getByText('mcp.market.actions.manage'));
    const attachments = await screen.findByTestId('mcp-market-drawer-attachments');
    fireEvent.click(within(attachments).getByText('mcp.market.actions.detach'));
    await waitFor(() =>
      expect(state.market.detach).toHaveBeenCalledWith([
        `as-${paddle.name}-claude-p-alpha`,
        `as-${paddle.name}-codex-p-alpha`,
      ])
    );
  });
});

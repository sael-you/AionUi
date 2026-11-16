/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP library browse (C23, D49/D50): templates grouped by category, the
 * needs-key / read-only / mode lines, the category filter, the no-match and
 * error states, and Add opening the add-from-template flow with full tools.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { McpMarketTemplate } from '@/common/config/storage';

const state = vi.hoisted(() => ({
  market: {} as Record<string, unknown>,
  kits: [] as unknown[],
  kitAttachments: [] as unknown[],
  effective: null as unknown,
  origin: null as string | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'keys' in options ? `${key}:${String(options.keys)}` : key,
  }),
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

vi.mock('@/renderer/hooks/mcp/market/useMcpMarket', () => ({
  useMcpMarket: () => state.market,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => [],
}));

vi.mock('@/renderer/components/workspace/ProjectIdentity', () => ({
  useProjectTheme: () => null,
  ProjectChip: () => null,
}));

// Arco's Select is a portal popup; a native select keeps the test about the browse.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  const Select = ({
    value,
    onChange,
    children,
    ...rest
  }: {
    value?: string;
    onChange: (v: string) => void;
    children?: React.ReactNode;
    'data-testid'?: string;
    'aria-label'?: string;
  }) => (
    <select
      data-testid={rest['data-testid']}
      aria-label={rest['aria-label']}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value='' />
      {children}
    </select>
  );
  const Option = ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return { ...actual, Select: Object.assign(Select, { Option }) };
});

import McpMarketView from '@/renderer/pages/settings/ToolsSettings/market';

const tpl = (id: string, extra: Partial<McpMarketTemplate>): McpMarketTemplate => ({
  id,
  name: id,
  transport: 'stdio',
  env: {},
  tiers: ['read', 'write'],
  enforcement: 'server',
  clis: ['claude', 'codex', 'gemini'],
  ...extra,
});

const templates: McpMarketTemplate[] = [
  tpl('supabase', {
    name: 'Supabase',
    category: 'developer',
    vendor: 'Supabase',
    official: true,
    summary: 'Database of one project',
    env: {
      SUPABASE_ACCESS_TOKEN: { kind: 'secret', required: true },
      SUPABASE_PROJECT_REF: { kind: 'plain', required: true, pattern: '^[a-z]{20}$' },
    },
  }),
  tpl('deepwiki', { name: 'DeepWiki', category: 'developer', official: true, tiers: ['read'] }),
  tpl('chrome-devtools', {
    name: 'Chrome DevTools',
    category: 'developer',
    official: true,
    enforcement: 'proxy',
    read_tools: ['lighthouse_audit'],
  }),
  tpl('brevo', {
    name: 'Brevo',
    category: 'email',
    official: true,
    enforcement: 'tools-only',
    env: { BREVO_API_KEY: { kind: 'secret', required: true } },
  }),
  tpl('reddit', { name: 'Reddit', category: 'research', vendor: 'Community', optional: true, tiers: ['read'] }),
];

const renderView = () =>
  render(<McpMarketView legacyServers={[]} extensionServers={[]} renderLegacyServer={() => null} />);

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
  state.market = {
    templates,
    instances: [],
    assignments: [],
    health: {},
    assistants: [],
    loading: false,
    error: null,
    templatesError: null,
    reload: vi.fn(() => Promise.resolve()),
    createInstance: vi.fn(),
    duplicateInstance: vi.fn(),
  };
});

afterEach(() => cleanup());

const sections = () => screen.getAllByTestId('library-section');
const card = (id: string) =>
  screen.getAllByTestId('library-card').find((n) => n.getAttribute('data-card-id') === id) as HTMLElement;
const openDrawer = async (id: string) => {
  fireEvent.click(within(card(id)).getByTestId('library-card-open'));
  return screen.findByTestId('mcp-template-drawer');
};

describe('MCP market tab (C33)', () => {
  it('groups the templates by category, in catalogue order, as compact cards', () => {
    renderView();
    expect(screen.getByTestId('library-tab-market')).toHaveAttribute('aria-selected', 'true');
    expect(sections().map((s) => s.getAttribute('data-section-key'))).toEqual(['developer', 'email', 'research']);
    expect(within(sections()[0]).getAllByTestId('library-card')).toHaveLength(3);
    // The card keeps one key chip; keys, read-only and mode details live in the drawer.
    expect(within(card('supabase')).getByTestId('mcp-template-key-chip')).toHaveTextContent(
      'settings.toolsLibrary.needsKey'
    );
    expect(within(card('deepwiki')).getByTestId('mcp-template-key-chip')).toHaveTextContent(
      'settings.toolsLibrary.noKey'
    );
    expect(within(card('supabase')).queryByTestId('mcp-market-template-enforcement')).toBeNull();
  });

  it('shows loading, then the catalogue error with a retry instead of the library', () => {
    state.market = { ...state.market, loading: true };
    const first = renderView();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('library-section')).toBeNull();
    first.unmount();

    state.market = { ...state.market, loading: false, templates: [], templatesError: new Error('down') };
    renderView();
    expect(screen.queryByTestId('library-section')).toBeNull();
    fireEvent.click(screen.getByText('mcp.market.actions.retry'));
    expect(state.market.reload).toHaveBeenCalled();
  });

  it('the drawer shows which keys are needed, how read-only is enforced, the mode and the badges', async () => {
    renderView();
    let drawer = await openDrawer('supabase');
    expect(within(drawer).getByTestId('mcp-market-template-keys')).toHaveTextContent(
      'mcp.market.library.needsKey:SUPABASE_ACCESS_TOKEN'
    );
    expect(within(drawer).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.server'
    );
    expect(within(drawer).getByTestId('mcp-market-template-mode')).toHaveTextContent('mcp.market.library.modeFull');
    cleanup();
    renderView();
    drawer = await openDrawer('deepwiki');
    expect(within(drawer).getByTestId('mcp-market-template-keys')).toHaveTextContent('mcp.market.library.noKey');
    expect(within(drawer).getByTestId('mcp-market-template-mode')).toHaveTextContent('mcp.market.library.modeReadOnly');
    cleanup();
    renderView();
    drawer = await openDrawer('chrome-devtools');
    expect(within(drawer).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.proxy'
    );
    cleanup();
    renderView();
    drawer = await openDrawer('brevo');
    expect(within(drawer).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.none'
    );
    cleanup();
    renderView();
    expect(within(card('supabase')).getByText('mcp.market.library.official')).toBeInTheDocument();
    expect(within(card('reddit')).getByText('mcp.market.library.community')).toBeInTheDocument();
    drawer = await openDrawer('reddit');
    expect(within(drawer).getByText('mcp.market.library.optional')).toBeInTheDocument();
  });

  it('filters by category (rail), source and search, with a no-match state', () => {
    renderView();
    fireEvent.click(
      screen.getAllByTestId('library-rail-category').find((b) => b.getAttribute('data-key') === 'email') as HTMLElement
    );
    expect(screen.getAllByTestId('library-card').map((n) => n.getAttribute('data-card-id'))).toEqual(['brevo']);
    fireEvent.click(
      screen.getAllByTestId('library-rail-category').find((b) => b.getAttribute('data-key') === 'all') as HTMLElement
    );
    fireEvent.click(within(screen.getByTestId('library-sources')).getByText('settings.toolsLibrary.filter.community'));
    expect(screen.getAllByTestId('library-card').map((n) => n.getAttribute('data-card-id'))).toEqual(['reddit']);
    fireEvent.click(within(screen.getByTestId('library-sources')).getByText('settings.toolsLibrary.filter.all'));
    fireEvent.change(screen.getByPlaceholderText('mcp.market.search'), { target: { value: 'nothing-like-this' } });
    expect(screen.queryAllByTestId('library-card')).toHaveLength(0);
    expect(screen.getByText('settings.library.noMatch')).toBeInTheDocument();
  });

  it('Add opens the add-from-template flow with full tools selected', () => {
    renderView();
    fireEvent.click(within(card('supabase')).getByTestId('mcp-template-add'));
    const modal = screen.getByTestId('mcp-market-create');
    expect(within(modal).getByTestId('mcp-market-create-mode')).toHaveTextContent('mcp.market.create.fullToolsNote');
    const write = within(modal).getByDisplayValue('write') as HTMLInputElement;
    expect(write.checked).toBe(true);
  });
});

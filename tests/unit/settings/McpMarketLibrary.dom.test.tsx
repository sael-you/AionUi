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

const state = vi.hoisted(() => ({ market: {} as Record<string, unknown> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'keys' in options ? `${key}:${String(options.keys)}` : key,
  }),
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

const entry = (id: string) =>
  screen.getAllByTestId('mcp-market-template').find((n) => n.getAttribute('data-template-id') === id)!;

describe('MCP library browse', () => {
  it('groups the templates by category, in catalogue order', () => {
    renderView();
    const sections = screen.getAllByTestId('mcp-market-category');
    expect(sections.map((s) => s.querySelector('h4')?.textContent)).toEqual([
      'mcp.market.library.category.developer',
      'mcp.market.library.category.email',
      'mcp.market.library.category.research',
    ]);
    expect(within(sections[0]).getAllByTestId('mcp-market-template')).toHaveLength(3);
  });

  it('shows loading, then the catalogue error with a retry instead of the library', () => {
    state.market = { ...state.market, loading: true };
    const first = renderView();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('mcp-market-category')).toBeNull();
    first.unmount();

    state.market = { ...state.market, loading: false, templates: [], templatesError: new Error('down') };
    renderView();
    expect(screen.queryByTestId('mcp-market-category-filter')).toBeNull();
    fireEvent.click(screen.getByText('mcp.market.actions.retry'));
    expect(state.market.reload).toHaveBeenCalled();

    // Back with templates: the library (category filter) is there.
    cleanup();
    state.market = { ...state.market, templates, templatesError: null };
    renderView();
    expect(screen.getByTestId('mcp-market-category-filter')).toBeInTheDocument();
  });

  it('shows which keys are needed, how read-only is enforced, the mode and the badges', () => {
    renderView();
    expect(within(entry('supabase')).getByTestId('mcp-market-template-keys')).toHaveTextContent(
      'mcp.market.library.needsKey:SUPABASE_ACCESS_TOKEN'
    );
    expect(within(entry('deepwiki')).getByTestId('mcp-market-template-keys')).toHaveTextContent(
      'mcp.market.library.noKey'
    );
    expect(within(entry('supabase')).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.server'
    );
    expect(within(entry('chrome-devtools')).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.proxy'
    );
    expect(within(entry('brevo')).getByTestId('mcp-market-template-enforcement')).toHaveTextContent(
      'mcp.market.library.enforcement.none'
    );
    expect(within(entry('supabase')).getByTestId('mcp-market-template-mode')).toHaveTextContent(
      'mcp.market.library.modeFull'
    );
    expect(within(entry('deepwiki')).getByTestId('mcp-market-template-mode')).toHaveTextContent(
      'mcp.market.library.modeReadOnly'
    );
    expect(within(entry('supabase')).getByText('mcp.market.library.official')).toBeInTheDocument();
    expect(within(entry('reddit')).getByText('mcp.market.library.community')).toBeInTheDocument();
    expect(within(entry('reddit')).getByText('mcp.market.library.optional')).toBeInTheDocument();
  });

  it('filters by category and by search, with a no-match state', () => {
    renderView();
    fireEvent.change(screen.getByTestId('mcp-market-category-filter'), { target: { value: 'email' } });
    expect(screen.getAllByTestId('mcp-market-template').map((n) => n.getAttribute('data-template-id'))).toEqual([
      'brevo',
    ]);
    fireEvent.change(screen.getByTestId('mcp-market-category-filter'), { target: { value: 'all' } });
    fireEvent.change(screen.getByPlaceholderText('mcp.market.search'), { target: { value: 'nothing-like-this' } });
    expect(screen.queryAllByTestId('mcp-market-template')).toHaveLength(0);
    expect(screen.getByText('mcp.market.library.noMatch')).toBeInTheDocument();
  });

  it('Add opens the add-from-template flow with full tools selected', () => {
    renderView();
    fireEvent.click(within(entry('supabase')).getByText('mcp.market.actions.add'));
    const modal = screen.getByTestId('mcp-market-create');
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByTestId('mcp-market-create-mode')).toHaveTextContent('mcp.market.create.fullToolsNote');
    const write = within(modal).getByDisplayValue('write') as HTMLInputElement;
    expect(write.checked).toBe(true);
  });
});

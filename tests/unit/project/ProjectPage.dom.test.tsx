/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ProjectOverviewResponse,
  ProjectStorageResponse,
  ProjectUsageResponse,
  UsageTotals,
} from '@/common/types/platform/projectPage';

const api = vi.hoisted(() => ({
  project: vi.fn(),
  overview: vi.fn(),
  usage: vi.fn(),
  storage: vi.fn(),
  rescan: vi.fn(),
  effective: vi.fn(),
}));

// One fake bridge for both import paths (`@/common` and the adapter module itself).
const bridge = vi.hoisted(() => ({
  project: { get: { invoke: (...args: unknown[]) => api.project(...args) } },
  projectPage: {
    overview: { invoke: (...args: unknown[]) => api.overview(...args) },
    usage: { invoke: (...args: unknown[]) => api.usage(...args) },
    storage: { invoke: (...args: unknown[]) => api.storage(...args) },
    rescanStorage: { invoke: (...args: unknown[]) => api.rescan(...args) },
  },
  kits: { effective: { invoke: (...args: unknown[]) => api.effective(...args) } },
  rules: { list: { invoke: async () => [{ id: 'r1', name: 'Commit messages' }] } },
  servers: { list: { invoke: async () => [{ id: 's1', name: 'web-1' }] } },
}));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  kits: bridge.kits,
}));
vi.mock('@/common', () => ({ ipcBridge: bridge }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const shown = ['count', 'n', 'total', 'percent', 'name', 'ago'].filter((name) => options && name in options);
      return shown.length > 0 ? `${key}:${shown.map((name) => String(options?.[name])).join(',')}` : key;
    },
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/renderer/components/workspace/ProjectIdentity', () => ({
  useProjectTheme: () => null,
  ProjectChip: () => null,
}));

import ProjectPage from '@/renderer/pages/project';

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  thought: 0,
  turns: 0,
  ...over,
});

const OVERVIEW: ProjectOverviewResponse = {
  project_id: 'p1',
  name: 'TB-test',
  conversations: { active: 4, total: 9 },
  open_cards: 7,
  kit: { skills: 3, mcps: 2, rules: 1, servers: 1 },
  memory_files: 5,
  tokens_today: totals({ input: 10_000, output: 2_300, turns: 6 }),
  storage: {
    total_bytes: 2 * 1024 ** 3,
    scanned_at: Date.now() - 120_000,
    disk: { total_bytes: 100 * 1024 ** 3, free_bytes: 40 * 1024 ** 3 },
  },
};

const USAGE: ProjectUsageResponse = {
  since: Date.UTC(2026, 10, 17),
  range_days: 30,
  totals: totals({ input: 30_000, output: 9_000, cache_read: 1_000, turns: 12, cost_micro_usd: 1_230_000 }),
  days: [
    { day: '2026-11-17', ...totals({ input: 10_000, output: 3_000, turns: 4 }) },
    { day: '2026-11-18', ...totals({ input: 20_000, output: 6_000, cache_read: 1_000, turns: 8 }) },
  ],
  by_conversation: [
    { conversation_id: 'c1', name: 'Fix login', last_at: 1, ...totals({ input: 25_000, output: 8_000, turns: 9 }) },
    { conversation_id: 'c2', name: '', last_at: 1, ...totals({ input: 5_000, output: 1_000, turns: 3 }) },
  ],
  by_model: [{ model: 'claude-opus-5-5', backend: 'claude', ...totals({ input: 30_000, output: 9_000, turns: 12 }) }],
};

const STORAGE: ProjectStorageResponse = {
  scanned_at: Date.now() - 120_000,
  total_bytes: 3 * 1024 ** 3,
  disk: { total_bytes: 100 * 1024 ** 3, free_bytes: 40 * 1024 ** 3 },
  roots: [
    {
      label: 'workspace',
      path: '/root/projects/tb',
      exists: true,
      bytes: 3 * 1024 ** 3,
      entries: 1200,
      truncated: true,
      children: [
        { name: 'node_modules', bytes: 2 * 1024 ** 3, kind: 'dir' },
        { name: 'dump.sql', bytes: 512 * 1024 ** 2, kind: 'file' },
      ],
      largest_files: [{ path: 'data/dump.sql', bytes: 512 * 1024 ** 2 }],
    },
    {
      label: 'memory',
      path: '/root/.claude/tb/memory',
      exists: false,
      bytes: 0,
      entries: 0,
      truncated: false,
      children: [],
      largest_files: [],
    },
  ],
};

const notFound = () =>
  new BackendHttpError({
    method: 'GET',
    path: '/api/projects/p1/overview',
    status: 404,
    body: { code: 'project_not_found', error: 'no such project' },
  });

const Where: React.FC = () => {
  const location = useLocation();
  return <output data-testid='where'>{`${location.pathname}${location.search}`}</output>;
};

const renderPage = (entry = '/project/p1') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Routes>
          <Route path='/project/:projectId' element={<ProjectPage />} />
          <Route path='*' element={null} />
        </Routes>
        <Where />
      </SWRConfig>
    </MemoryRouter>
  );

const pending = <T,>() => new Promise<T>(() => undefined);

describe('Project page (C42)', () => {
  beforeEach(() => {
    api.project.mockResolvedValue({
      project_id: 'p1',
      name: 'TB-test',
      explorer: { workspace_pe_id: 'pe1', entries: [{ pe_id: 'pe1', display_path: '/root/projects/tb' }] },
    });
    api.overview.mockResolvedValue(OVERVIEW);
    api.usage.mockResolvedValue(USAGE);
    api.storage.mockResolvedValue(STORAGE);
    api.effective.mockResolvedValue({
      project_id: 'p1',
      skills: [
        { kind: 'skill', item_ref: 'cs-build', included: true, provenance: { level: 'project', op: 'add' } },
        { kind: 'skill', item_ref: 'pf-ui', included: true, provenance: { level: 'global', op: 'add' } },
        { kind: 'skill', item_ref: 'gone', included: false, provenance: { level: 'project', op: 'remove' } },
      ],
      mcps: [
        {
          kind: 'mcp',
          item_ref: 'inst-1',
          included: true,
          provenance: { level: 'project', op: 'add', kit_id: 'k1', kit_name: 'Platform Dev' },
          mcp: {
            instance_name: 'context7',
            status: 'active',
            clis: [],
            delivered: true,
            shadowed_by_project_file: false,
          },
        },
      ],
      rules: [{ kind: 'rule', item_ref: 'r1', included: true, provenance: { level: 'global', op: 'add' } }],
      servers: [{ kind: 'server', item_ref: 's1', included: true, provenance: { level: 'project', op: 'add' } }],
      missing_templates: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('shell', () => {
    it('shows the project name, opens on Overview and loads only that tab', async () => {
      renderPage();
      expect(await screen.findByRole('heading', { level: 1, name: 'TB-test' })).toBeInTheDocument();
      expect(await screen.findByTestId('project-overview')).toBeInTheDocument();
      expect(api.overview).toHaveBeenCalledWith({ project_id: 'p1' });
      expect(api.usage).not.toHaveBeenCalled();
      expect(api.storage).not.toHaveBeenCalled();
      expect(api.effective).not.toHaveBeenCalled();
    });

    it('a tab click moves to ?tab= and ?tab= opens that tab', async () => {
      renderPage();
      await screen.findByTestId('project-overview');
      fireEvent.click(screen.getByTestId('project-tab-usage'));
      expect(await screen.findByTestId('project-usage')).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent('/project/p1?tab=usage');
      cleanup();

      renderPage('/project/p1?tab=storage');
      expect(await screen.findByTestId('project-storage')).toBeInTheDocument();
    });

    it('header actions: board, memory and a new conversation in the workspace', async () => {
      renderPage();
      await screen.findByTestId('project-overview');
      await waitFor(() => expect(screen.getByTestId('project-new-conversation')).not.toBeDisabled());
      fireEvent.click(screen.getByTestId('project-open-board'));
      expect(screen.getByTestId('where')).toHaveTextContent('/board/p1');
    });

    it('a project that no longer exists says so', async () => {
      api.project.mockRejectedValue(notFound());
      renderPage();
      expect(await screen.findByTestId('project-error')).toHaveTextContent('conversation.projectPage.errors.notFound');
      expect(screen.queryByTestId('project-overview')).toBeNull();
    });
  });

  describe('Overview', () => {
    it('loading, then the four tiles and what conversations get', async () => {
      let resolve: (value: ProjectOverviewResponse) => void = () => undefined;
      api.overview.mockReturnValue(new Promise<ProjectOverviewResponse>((done) => (resolve = done)));
      renderPage();
      expect(await screen.findByLabelText('conversation.projectPage.loading')).toHaveAttribute('aria-busy', 'true');
      resolve(OVERVIEW);

      expect(await screen.findByTestId('project-tile-conversations')).toHaveTextContent('4');
      expect(screen.getByTestId('project-tile-conversations')).toHaveTextContent('conversationsSub:9');
      expect(screen.getByTestId('project-tile-tokens')).toHaveTextContent('12.3K');
      expect(screen.getByTestId('project-tile-tokens')).toHaveTextContent('overview.turns:6');
      expect(screen.getByTestId('project-tile-disk')).toHaveTextContent('2.0 GB');
      expect(screen.getByTestId('project-tile-disk')).toHaveTextContent('diskShare:2.0');
      expect(screen.getByTestId('project-tile-cards')).toHaveTextContent('7');
      expect(screen.getByTestId('project-gets-skills')).toHaveTextContent('3');
      expect(screen.getByTestId('project-gets-mcps')).toHaveTextContent('2');
      expect(screen.getByTestId('project-gets-memory')).toHaveTextContent('5');
    });

    it('rows lead on: a kit row to the Kit tab, memory to the memory page', async () => {
      renderPage();
      fireEvent.click(await screen.findByTestId('project-gets-rules'));
      expect(await screen.findByTestId('project-kit')).toBeInTheDocument();
      cleanup();

      renderPage();
      fireEvent.click(await screen.findByTestId('project-gets-memory'));
      expect(screen.getByTestId('where')).toHaveTextContent('/memory/p1');
    });

    it('before a scan the disk tile says so; without a workspace there is no memory row', async () => {
      api.overview.mockResolvedValue({ ...OVERVIEW, storage: undefined, memory_files: undefined });
      renderPage();
      const disk = await screen.findByTestId('project-tile-disk');
      expect(disk).toHaveTextContent('—');
      expect(disk).toHaveTextContent('conversation.projectPage.overview.diskNotScanned');
      expect(screen.queryByTestId('project-gets-memory')).toBeNull();
    });

    it('an error offers Retry and loads again', async () => {
      api.overview.mockRejectedValueOnce(new Error('offline'));
      renderPage();
      const error = await screen.findByTestId('project-error');
      expect(error).toHaveTextContent('offline');
      fireEvent.click(within(error).getByText('conversation.projectPage.retry'));
      expect(await screen.findByTestId('project-overview')).toBeInTheDocument();
    });
  });

  describe('Kit', () => {
    it('groups the effective set by source as read-only cards with names and MCP status', async () => {
      renderPage('/project/p1?tab=kit');
      const kit = await screen.findByTestId('project-kit');
      expect(api.effective).toHaveBeenCalledWith({ project_id: 'p1' });
      expect(within(kit).getByText('conversation.projectPage.kit.source.project')).toBeInTheDocument();
      expect(within(kit).getByText('conversation.projectPage.kit.source.kit:Platform Dev')).toBeInTheDocument();
      expect(within(kit).getByText('conversation.projectPage.kit.source.global')).toBeInTheDocument();
      expect(within(kit).getByText('cs-build')).toBeInTheDocument();
      expect(within(kit).getByText('context7')).toBeInTheDocument();
      expect(await within(kit).findByText('Commit messages')).toBeInTheDocument();
      expect(await within(kit).findByText('web-1')).toBeInTheDocument();
      expect(within(kit).queryByText('gone')).toBeNull();
      expect(within(kit).getByTestId('project-kit-mcp-status')).toHaveTextContent('mcp.market.status.active');
      // Read-only: no "On in <scope>" switch on any card.
      expect(within(kit).queryByTestId('library-card-toggle')).toBeNull();
    });

    it('Manage and a card open the managing page scoped to the project', async () => {
      renderPage('/project/p1?tab=kit');
      const manage = await screen.findByTestId('project-kit-manage-rule');
      expect(manage).toHaveTextContent('kit.manage.rule:1');
      expect(screen.getByTestId('project-kit-manage-skill')).toHaveTextContent('kit.manage.skill:2');
      fireEvent.click(manage);
      expect(screen.getByTestId('where')).toHaveTextContent('/settings/rules?project=p1');
      cleanup();

      renderPage('/project/p1?tab=kit');
      fireEvent.click(await screen.findByText('context7'));
      expect(screen.getByTestId('where')).toHaveTextContent('/settings/tools?project=p1');
    });

    it('empty and error states', async () => {
      api.effective.mockResolvedValue({ skills: [], mcps: [], missing_templates: [] });
      renderPage('/project/p1?tab=kit');
      expect(await screen.findByTestId('project-empty')).toHaveTextContent('conversation.projectPage.kit.empty');
      cleanup();

      api.effective.mockRejectedValue(new Error('boom'));
      renderPage('/project/p1?tab=kit');
      expect(await screen.findByTestId('project-error')).toHaveTextContent('boom');
    });
  });

  describe('Storage', () => {
    it('while the first scan runs the tab says so and the page stays usable', async () => {
      api.storage.mockReturnValue(pending());
      renderPage('/project/p1?tab=storage');
      expect(await screen.findByTestId('project-storage-scanning')).toHaveTextContent(
        'conversation.projectPage.storage.scanning'
      );
      fireEvent.click(screen.getByTestId('project-tab-overview'));
      expect(await screen.findByTestId('project-overview')).toBeInTheDocument();
    });

    it('shows the total, its share of the disk and each root with size rows', async () => {
      renderPage('/project/p1?tab=storage');
      const total = await screen.findByTestId('project-storage-total');
      expect(total).toHaveTextContent('3.0 GB');
      expect(total).toHaveTextContent('shareOfDisk:100 GB,3.0');
      expect(screen.getByTestId('project-storage-scanned')).toHaveTextContent('storage.scanned:2 minutes ago');

      const [workspace, memory] = screen.getAllByTestId('project-storage-root');
      expect(workspace).toHaveTextContent('conversation.projectPage.storage.root.workspace');
      expect(workspace).toHaveTextContent('/root/projects/tb');
      expect(within(workspace).getByTestId('project-storage-truncated')).toBeInTheDocument();
      const rows = within(workspace).getAllByTestId('project-size-row');
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent('node_modules');
      expect(rows[0]).toHaveTextContent('2.0 GB');
      expect(rows[2]).toHaveTextContent('data/dump.sql');
      expect(memory).toHaveTextContent('conversation.projectPage.storage.missing');
    });

    it('Rescan posts, replaces the result and refreshes the overview tile', async () => {
      api.rescan.mockResolvedValue({ ...STORAGE, total_bytes: 5 * 1024 ** 3, scanned_at: Date.now() });
      renderPage('/project/p1?tab=storage');
      fireEvent.click(await screen.findByTestId('project-storage-rescan'));
      await waitFor(() => expect(api.rescan).toHaveBeenCalledWith({ project_id: 'p1' }));
      await waitFor(() => expect(screen.getByTestId('project-storage-total')).toHaveTextContent('5.0 GB'));
      expect(screen.getByTestId('project-storage-scanned')).toHaveTextContent('storage.scannedNow');
      expect(api.storage).toHaveBeenCalledTimes(1);
    });

    it('a failed rescan keeps the last result and shows the error', async () => {
      api.rescan.mockRejectedValue(new Error('scan failed'));
      renderPage('/project/p1?tab=storage');
      fireEvent.click(await screen.findByTestId('project-storage-rescan'));
      expect(await screen.findByTestId('project-storage-rescan-error')).toHaveTextContent('scan failed');
      expect(screen.getByTestId('project-storage-total')).toHaveTextContent('3.0 GB');
    });

    it('empty and error states', async () => {
      api.storage.mockResolvedValue({ scanned_at: Date.now(), total_bytes: 0, roots: [] });
      renderPage('/project/p1?tab=storage');
      expect(await screen.findByTestId('project-empty')).toHaveTextContent('conversation.projectPage.storage.empty');
      cleanup();

      api.storage.mockRejectedValue(notFound());
      renderPage('/project/p1?tab=storage');
      const errors = await screen.findAllByTestId('project-error');
      expect(errors.at(-1)).toHaveTextContent('conversation.projectPage.errors.notFound');
    });
  });

  describe('Usage', () => {
    it('asks for 30 days first; the range switch asks again', async () => {
      renderPage('/project/p1?tab=usage');
      await screen.findByTestId('project-usage');
      expect(api.usage).toHaveBeenCalledWith({ project_id: 'p1', days: 30 });
      fireEvent.click(screen.getByText('conversation.projectPage.usage.rangeDays:7'));
      await waitFor(() => expect(api.usage).toHaveBeenCalledWith({ project_id: 'p1', days: 7 }));
    });

    it('draws one stacked bar per day with a legend, totals and the cost', async () => {
      renderPage('/project/p1?tab=usage');
      await screen.findByTestId('project-usage');
      const bars = screen.getAllByTestId('usage-bar');
      expect(bars.map((bar) => bar.getAttribute('data-day'))).toEqual(['2026-11-17', '2026-11-18']);
      expect(
        [...bars[1].querySelectorAll('rect[data-series]')].map((rect) => rect.getAttribute('data-series'))
      ).toEqual(['input', 'output', 'cache_read']);
      expect(within(screen.getByTestId('usage-legend')).getAllByRole('listitem')).toHaveLength(4);
      expect(screen.getByTestId('usage-tile-total')).toHaveTextContent('40K');
      expect(screen.getByTestId('usage-tile-cost')).toHaveTextContent('$1.23');
      expect(screen.getByTestId('usage-since')).toHaveTextContent('conversation.projectPage.usage.since');
    });

    it('the arrow keys read a day in the tooltip; Escape closes it', async () => {
      renderPage('/project/p1?tab=usage');
      await screen.findByTestId('project-usage');
      const chart = screen.getByRole('img', { name: 'conversation.projectPage.usage.chartLabel' });
      fireEvent.keyDown(chart, { key: 'ArrowLeft' });
      const tooltip = screen.getByTestId('usage-tooltip');
      expect(tooltip).toHaveTextContent('Nov 17');
      expect(tooltip).toHaveTextContent('13K');
      fireEvent.keyDown(chart, { key: 'ArrowRight' });
      expect(screen.getByTestId('usage-tooltip')).toHaveTextContent('Nov 18');
      fireEvent.keyDown(chart, { key: 'Escape' });
      expect(screen.queryByTestId('usage-tooltip')).toBeNull();
    });

    it('the table view carries the same numbers, newest day first', async () => {
      renderPage('/project/p1?tab=usage');
      await screen.findByTestId('project-usage');
      fireEvent.click(screen.getByTestId('usage-table-switch'));
      const rows = within(screen.getByTestId('usage-table')).getAllByRole('row');
      expect(rows).toHaveLength(3);
      expect(rows[1]).toHaveTextContent('Nov 18');
      expect(rows[1]).toHaveTextContent('20,000');
      expect(rows[1]).toHaveTextContent('6,000');
      expect(screen.queryByTestId('usage-chart')).toBeNull();
    });

    it('ranks conversations and models; a deleted conversation is named as such', async () => {
      renderPage('/project/p1?tab=usage');
      const conversations = await screen.findByTestId('usage-by-conversation');
      const rows = within(conversations).getAllByTestId('usage-rank-row');
      expect(rows[0]).toHaveTextContent('Fix login');
      expect(rows[0]).toHaveTextContent('33K');
      expect(rows[1]).toHaveTextContent('conversation.projectPage.usage.deletedConversation');
      fireEvent.click(within(rows[0]).getByText('Fix login'));
      expect(screen.getByTestId('where')).toHaveTextContent('/conversation/c1');
    });

    it('nothing recorded yet: says so, no chart', async () => {
      api.usage.mockResolvedValue({ range_days: 30, totals: totals(), days: [], by_conversation: [], by_model: [] });
      renderPage('/project/p1?tab=usage');
      expect(await screen.findByTestId('project-empty')).toHaveTextContent('conversation.projectPage.usage.none');
      expect(screen.queryByTestId('usage-chart')).toBeNull();
    });

    it('an error keeps the range switch and offers Retry', async () => {
      api.usage.mockRejectedValueOnce(new Error('offline'));
      renderPage('/project/p1?tab=usage');
      expect(await screen.findByTestId('project-error')).toHaveTextContent('offline');
      expect(screen.getByTestId('usage-range')).toBeInTheDocument();
      fireEvent.click(screen.getByText('conversation.projectPage.retry'));
      expect(await screen.findByTestId('project-usage')).toBeInTheDocument();
    });
  });
});

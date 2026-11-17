/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { KitAttachmentResponse } from '@/common/config/storage';
import type { RuleResponse } from '@/common/types/platform/rules';

const api = vi.hoisted(() => ({
  rules: [] as unknown[],
  attachments: [] as Array<{ item_ref: string; item_kind: string }>,
  origin: null as string | null,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  effective: vi.fn(),
  sources: vi.fn(),
  preview: vi.fn(),
  importRules: vi.fn(),
  manage: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}));

// One fake bridge for both import paths (`@/common` and the adapter module itself).
const bridge = vi.hoisted(() => ({
  rules: {
    list: { invoke: (...args: unknown[]) => api.list(...args) },
    create: { invoke: (...args: unknown[]) => api.create(...args) },
    update: { invoke: (...args: unknown[]) => api.update(...args) },
    remove: { invoke: (...args: unknown[]) => api.remove(...args) },
    effective: { invoke: (...args: unknown[]) => api.effective(...args) },
    sources: { invoke: (...args: unknown[]) => api.sources(...args) },
    importPreview: { invoke: (...args: unknown[]) => api.preview(...args) },
    import: { invoke: (...args: unknown[]) => api.importRules(...args) },
    manageFiles: { invoke: (...args: unknown[]) => api.manage(...args) },
  },
  kits: {
    listAttachments: {
      invoke: async (query?: { item_kind?: string; item_ref?: string }) =>
        api.attachments.filter(
          (row) =>
            (!query?.item_kind || row.item_kind === query.item_kind) &&
            (!query?.item_ref || row.item_ref === query.item_ref)
        ),
    },
    attach: { invoke: (...args: unknown[]) => api.attach(...args) },
    detach: { invoke: (...args: unknown[]) => api.detach(...args) },
  },
}));
vi.mock('@/common/adapter/ipcBridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  kits: bridge.kits,
  rules: bridge.rules,
}));
vi.mock('@/common', () => ({ ipcBridge: bridge }));
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
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown'>{children}</div>,
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

import RulesLibrary from '@/renderer/pages/settings/RulesSettings/RulesLibrary';

const rule = (over: Partial<RuleResponse>): RuleResponse => ({
  id: 'r1',
  name: 'Commit messages',
  description: 'Conventional Commits',
  body: '- Use `feat:`',
  enabled: true,
  origin: 'owner',
  created_at: 1,
  updated_at: 2,
  ...over,
});

const attachment = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'att-1',
  level: 'global',
  target_id: '',
  item_kind: 'rule',
  item_ref: 'r1',
  item_name: 'Commit messages',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RulesLibrary />
    </SWRConfig>
  );

const cardOf = async (name: string) => {
  const titles = await screen.findAllByText(name);
  const card = titles.map((el) => el.closest('[data-testid="library-card"]')).find(Boolean);
  return card as HTMLElement;
};

const openLibrary = async () => {
  fireEvent.click(await screen.findByRole('tab', { name: /settings\.library\.tabLibrary/ }));
};

describe('Settings → Rules (C37)', () => {
  beforeEach(() => {
    api.origin = null;
    api.rules = [
      rule({}),
      rule({ id: 'r2', name: 'Deploy', description: '', origin: 'import', source_path: '/root/AGENTS.md' }),
    ];
    api.attachments = [attachment({})];
    api.list.mockImplementation(async () => api.rules);
    api.effective.mockResolvedValue({
      rules: [
        { id: 'r1', name: 'Commit messages', level: 'global', bytes: 13, delivered: true },
        { id: 'r3', name: 'Huge', level: 'global', bytes: 9000, delivered: false },
      ],
      block: '# Rules\n- Use `feat:`',
      bytes: 13,
      max_bytes: 24576,
    });
    api.sources.mockResolvedValue([]);
    api.attach.mockResolvedValue({});
    api.detach.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Global → Active: what Global gets (capped rule warned), the rule on; turning it off drops the attachment', async () => {
    renderPage();
    const gets = await screen.findByTestId('rules-scope-gets');
    expect(await within(gets).findByTestId('rules-effective-capped')).toHaveTextContent(
      'settings.rules.effective.capped'
    );
    expect(within(gets).getAllByTestId('rules-effective-row')).toHaveLength(2);
    expect(api.effective).toHaveBeenCalledWith({});

    const card = await cardOf('Commit messages');
    expect(screen.queryByText('Deploy')).toBeNull();
    const toggle = within(card).getByTestId('library-card-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.detach).toHaveBeenCalledWith({ id: 'att-1' }));
  });

  it('Library: turning a rule on in Global attaches it as a rule', async () => {
    renderPage();
    await openLibrary();
    const card = await cardOf('Deploy');
    expect(within(card).getByText('settings.rules.source.imported')).toBeInTheDocument();
    fireEvent.click(within(card).getByTestId('library-card-toggle'));
    await waitFor(() =>
      expect(api.attach).toHaveBeenCalledWith({ level: 'global', item_kind: 'rule', item_ref: 'r2', op: 'add' })
    );
  });

  it('a project: a Global rule is shown inherited and read-only; the preview asks for the project', async () => {
    api.origin = 'p1';
    renderPage();
    expect(await screen.findByText('settings.library.group.fromGlobal')).toBeInTheDocument();
    const card = await cardOf('Commit messages');
    const toggle = within(card).getByTestId('library-card-toggle');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(api.attach).not.toHaveBeenCalled();
    await waitFor(() => expect(api.effective).toHaveBeenCalledWith({ project_id: 'p1' }));
  });

  it('a switched-off rule cannot be turned on in a scope', async () => {
    api.rules = [rule({ id: 'r2', name: 'Deploy', enabled: false })];
    renderPage();
    await openLibrary();
    const card = await cardOf('Deploy');
    expect(within(card).getByTestId('library-card-toggle')).toBeDisabled();
    expect(within(card).getByText('settings.rules.chips.off')).toBeInTheDocument();
  });

  it('Add rule: refuses an empty form, then sends the exact create body', async () => {
    api.rules = [];
    api.create.mockImplementation(async (body) => rule({ id: 'r9', ...body }));
    renderPage();
    fireEvent.click(await screen.findByTestId('rule-add'));
    const drawer = await screen.findByTestId('rule-drawer');

    fireEvent.click(screen.getByTestId('rule-save'));
    expect(await within(drawer).findByText('settings.rules.problems.nameRequired')).toBeInTheDocument();
    expect(within(drawer).getByText('settings.rules.problems.bodyRequired')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.change(within(drawer).getByLabelText('settings.rules.fields.name'), { target: { value: ' Tests ' } });
    fireEvent.change(within(drawer).getByTestId('rule-body'), { target: { value: '- Run vitest\n' } });
    fireEvent.click(screen.getByTestId('rule-save'));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith({ name: 'Tests', description: '', body: '- Run vitest\n', enabled: true })
    );
  });

  it('editing: preview renders the markdown; save sends only the change with the edited version', async () => {
    api.update.mockImplementation(async ({ data }) => rule({ ...data, updated_at: 3 }));
    renderPage();
    fireEvent.click(within(await cardOf('Commit messages')).getByTestId('library-card-open'));
    const drawer = await screen.findByTestId('rule-drawer');
    fireEvent.change(within(drawer).getByTestId('rule-body'), { target: { value: '- Use `fix:` too' } });

    fireEvent.click(within(drawer).getByText('settings.rules.preview'));
    expect(await within(drawer).findByTestId('rule-preview')).toHaveTextContent('- Use `fix:` too');

    fireEvent.click(screen.getByTestId('rule-save'));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({ id: 'r1', data: { body: '- Use `fix:` too', expected_updated_at: 2 } })
    );
  });

  it('a body over 8 KB is flagged at once and not saved', async () => {
    renderPage();
    fireEvent.click(within(await cardOf('Commit messages')).getByTestId('library-card-open'));
    const drawer = await screen.findByTestId('rule-drawer');
    fireEvent.change(within(drawer).getByTestId('rule-body'), { target: { value: 'x'.repeat(8 * 1024 + 1) } });
    expect(within(drawer).getByTestId('rule-size-meter')).toHaveAttribute('data-state', 'over');
    expect(within(drawer).getAllByText('settings.rules.problems.bodyTooLarge').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('rule-save'));
    expect(api.update).not.toHaveBeenCalled();
  });

  it('a stale save tells the owner and reloads the rules', async () => {
    api.update.mockRejectedValue(
      new BackendHttpError({
        method: 'PUT',
        path: '/api/rules/r1',
        status: 409,
        body: { code: 'RULE_STALE', error: 'stale' },
      })
    );
    renderPage();
    fireEvent.click(within(await cardOf('Commit messages')).getByTestId('library-card-open'));
    const drawer = await screen.findByTestId('rule-drawer');
    fireEvent.change(within(drawer).getByLabelText('settings.rules.fields.name'), { target: { value: 'Commits' } });
    const before = api.list.mock.calls.length;
    fireEvent.click(screen.getByTestId('rule-save'));
    await waitFor(() => expect(api.messageError).toHaveBeenCalledWith('settings.rules.errors.stale'));
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(before));
  });

  it('Import: the preview shows the files; a taken name blocks the import', async () => {
    api.preview.mockResolvedValue({
      scope: 'global',
      files: [
        {
          path: '/root/AGENTS.md',
          status: 'new',
          bytes: 2048,
          rules: [
            { name: 'Hard rules', description: '', body: '- Never push', bytes: 12, name_taken: false },
            { name: 'Commit messages', description: '', body: '- feat', bytes: 6, name_taken: true },
          ],
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByTestId('rule-import-open'));
    const modal = await screen.findByTestId('rule-import');
    expect(await within(modal).findByTestId('rule-import-file')).toHaveTextContent('/root/AGENTS.md');
    expect(api.preview).toHaveBeenCalledWith({ scope: 'global' });
    expect(within(modal).getByText('settings.rules.import.blocked')).toBeInTheDocument();
    expect(within(modal).getByTestId('rule-import-run')).toBeDisabled();
  });

  it('Import: runs with confirm; handing the files over needs the acknowledgement', async () => {
    api.origin = 'p1';
    api.preview.mockResolvedValue({
      scope: 'project',
      project_id: 'p1',
      files: [
        {
          path: '/root/projects/tb/AGENTS.md',
          status: 'new',
          bytes: 100,
          rules: [{ name: 'TB rules', description: '', body: '- x', bytes: 3, name_taken: false }],
        },
      ],
    });
    api.sources.mockResolvedValue([
      {
        id: 'src1',
        scope: 'project',
        project_id: 'p1',
        path: '/root/projects/tb/CLAUDE.md',
        status: 'imported',
        imported_at: 1,
      },
    ]);
    api.importRules.mockResolvedValue({ sources: [], rules: [rule({ id: 'r7', name: 'TB rules' })] });
    api.manage.mockResolvedValue({ written: [] });
    renderPage();
    fireEvent.click(await screen.findByTestId('rule-import-open'));
    const modal = await screen.findByTestId('rule-import');
    fireEvent.click(await within(modal).findByTestId('rule-import-run'));
    await waitFor(() =>
      expect(api.importRules).toHaveBeenCalledWith({ scope: 'project', project_id: 'p1', confirm: true })
    );
    expect(api.preview).toHaveBeenCalledWith({ scope: 'project', project_id: 'p1' });

    const handOver = await within(modal).findByTestId('rule-import-hand-over');
    expect(handOver).toHaveTextContent('/root/projects/tb/CLAUDE.md');
    const manage = within(handOver).getByTestId('rule-import-manage');
    expect(manage).toBeDisabled();
    fireEvent.click(within(handOver).getByText('settings.rules.import.ackProject'));
    await waitFor(() => expect(manage).not.toBeDisabled());
    fireEvent.click(manage);
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ scope: 'project', project_id: 'p1', confirm: true }));
  });
});

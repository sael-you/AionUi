/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memory review panel (C29 §3) against a mocked memory API: grouped list with
 * lint tags, filters, edit/save with the 409 path, delete with undo (restore),
 * and the Review-with-AI request shape.
 */

import { Notification } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { MemoryItem, MemoryListResponse } from '@/common/types/memory';
import enCommon from '@/renderer/services/i18n/locales/en-US/common.json';
import enMemory from '@/renderer/services/i18n/locales/en-US/memory.json';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  assistants: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/common', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const p = (fn: (params: unknown) => unknown) => ({ invoke: (params: unknown) => fn(params) });
  return {
    ...actual,
    ipcBridge: {
      ...(actual.ipcBridge as Record<string, unknown>),
      memory: {
        list: p(api.list),
        get: p(api.get),
        update: p(api.update),
        remove: p(api.remove),
        restore: p(api.restore),
      },
      assistants: { list: p(api.assistants) },
      conversation: { create: p(api.create) },
    },
  };
});
// The real renderer draws into a shadow root; the body text is what matters here.
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown'>{children}</div>,
}));
vi.mock('@/renderer/components/board/hooks/useMediaQuery', () => ({ useBoardNarrow: () => false }));

import { MemoryPanel } from '@/renderer/pages/memory/MemoryPanel';

let notifyInfo: ReturnType<typeof vi.spyOn>;

const NOW = Date.now();
const item = (over: Partial<MemoryItem> & { file: string }): MemoryItem => ({
  name: over.file.replace(/\.md$/, ''),
  description: null,
  type: 'feedback',
  modified: NOW - 1000,
  frontmatter_modified: null,
  size: 120,
  links: [],
  in_index: true,
  broken_links: [],
  stale: false,
  ...over,
});

const LIST: MemoryListResponse = {
  dir_exists: true,
  index_lines: 3,
  items: [
    item({ file: 'use-bun.md', name: 'Use bun', description: 'Package manager rule', links: ['deploy'] }),
    item({ file: 'deploy.md', name: 'Deploy train', type: 'project' }),
    item({ file: 'orphan.md', name: 'Orphan', type: 'user', in_index: false }),
  ],
  lint: [{ kind: 'not_in_index', file: 'orphan.md', detail: 'no MEMORY.md line' }],
};

const renderPanel = () => {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng: 'en-US',
    initImmediate: false,
    interpolation: { escapeValue: false },
    resources: { 'en-US': { translation: { memory: enMemory, common: enCommon } } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/memory/p1']}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Routes>
            <Route
              path='/memory/:projectId'
              element={<MemoryPanel projectId='p1' workspace='/root/projects/alpha' />}
            />
            <Route path='/conversation/:id' element={<div>conversation page</div>} />
          </Routes>
        </SWRConfig>
      </MemoryRouter>
    </I18nextProvider>
  );
};

const openFile = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  return screen.findByRole('region', { name });
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.list.mockResolvedValue(LIST);
  api.get.mockImplementation(async ({ file }: { file: string }) => ({
    file,
    frontmatter_raw: `name: ${file}\nmetadata:\n  type: feedback`,
    body: `Body of ${file}`,
    modified: 111,
  }));
  sessionStorage.clear();
  notifyInfo = vi.spyOn(Notification, 'info').mockImplementation(() => undefined as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MemoryPanel', () => {
  it('lists memories grouped by type with counts and lint tags', async () => {
    renderPanel();
    const list = await screen.findByRole('navigation', { name: 'Memory files' });
    expect(within(list).getByText('3 memories · index 3 lines')).toBeTruthy();
    const feedback = within(list).getByRole('region', { name: 'Feedback' });
    expect(within(feedback).getByText('Use bun')).toBeTruthy();
    expect(within(list).getByRole('region', { name: 'Project' })).toBeTruthy();
    const user = within(list).getByRole('region', { name: 'User' });
    expect(within(user).getByText('Not in index')).toBeTruthy();
  });

  it('filters by search text and by lint issues', async () => {
    renderPanel();
    await screen.findByText('Use bun');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search memories' }), { target: { value: 'package' } });
    await waitFor(() => expect(screen.queryByText('Deploy train')).toBeNull());
    expect(screen.getByText('Use bun')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search memories' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'With issues' }));
    await waitFor(() => expect(screen.queryByText('Use bun')).toBeNull());
    expect(screen.getByText('Orphan')).toBeTruthy();
  });

  it('opens a memory, follows a [[link]], edits and saves with the mtime it read', async () => {
    api.update.mockImplementation(async (p: { file: string; body: string; frontmatter_raw: string }) => ({
      file: p.file,
      body: p.body,
      frontmatter_raw: p.frontmatter_raw,
      modified: 222,
    }));
    renderPanel();
    const detail = await openFile('Use bun');
    expect(await within(detail).findByText('Body of use-bun.md')).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(detail).getByLabelText('Content (markdown)'), { target: { value: 'Always use bun.' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        project_id: 'p1',
        file: 'use-bun.md',
        body: 'Always use bun.',
        frontmatter_raw: 'name: use-bun.md\nmetadata:\n  type: feedback',
        expected_modified: 111,
      })
    );
    expect(await within(detail).findByText('Always use bun.')).toBeTruthy();

    fireEvent.click(within(detail).getByRole('button', { name: 'deploy' }));
    expect(await screen.findByRole('region', { name: 'Deploy train' })).toBeTruthy();
  });

  it('a save on a file changed meanwhile (409) asks to reload instead of overwriting', async () => {
    api.update.mockRejectedValue(
      new BackendHttpError({
        method: 'PUT',
        path: '/api/projects/p1/memory/use-bun.md',
        status: 409,
        body: { success: false, code: 'MEMORY_CHANGED', details: { current_modified: 333 } },
      })
    );
    renderPanel();
    const detail = await openFile('Use bun');
    await within(detail).findByText('Body of use-bun.md');
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(detail).getByRole('button', { name: 'Save' }));
    expect(await within(detail).findByText(/changed meanwhile/)).toBeTruthy();
    expect((within(detail).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    api.get.mockResolvedValue({
      file: 'use-bun.md',
      frontmatter_raw: 'name: x',
      body: 'Agent wrote this',
      modified: 333,
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(within(detail).queryByText(/changed meanwhile/)).toBeNull());
    expect((within(detail).getByLabelText('Content (markdown)') as HTMLTextAreaElement).value).toBe('Agent wrote this');
  });

  it('deletes with an undo toast that restores the file', async () => {
    api.remove.mockResolvedValue({ file: 'use-bun.md', trash_file: '.trash/use-bun.md.1', index_lines_removed: 1 });
    api.restore.mockResolvedValue({ file: 'use-bun.md', frontmatter_raw: '', body: 'back', modified: 5 });
    renderPanel();
    const detail = await openFile('Use bun');
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ project_id: 'p1', file: 'use-bun.md' }));
    await waitFor(() => expect(notifyInfo).toHaveBeenCalled());
    const config = notifyInfo.mock.calls[0][0] as {
      title: string;
      btn: React.ReactElement<{ onClick: () => void; children: string }>;
    };
    expect(config.title).toBe('Deleted use-bun.md');
    expect(config.btn.props.children).toBe('Undo');
    await act(async () => config.btn.props.onClick());
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith({ project_id: 'p1', file: 'use-bun.md' }));
  });

  it('Review with AI creates a Claude conversation in the workspace with the brief and the selected files', async () => {
    api.assistants.mockResolvedValue([
      { id: 'bare:aion', enabled: true, source: 'generated', agent: { type: 'aionrs', source: 'internal' } },
      {
        id: 'bare:claude',
        enabled: true,
        source: 'generated',
        agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' },
      },
    ]);
    api.create.mockResolvedValue({ id: 'conv-9' });
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Deploy train for the AI review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review 1 file with AI' }));
    expect(await screen.findByText('conversation page')).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith({
      name: 'Memory review',
      assistant: { id: 'bare:claude', locale: 'en-US' },
      extra: { workspace: '/root/projects/alpha', custom_workspace: true },
    });
    const initial = JSON.parse(sessionStorage.getItem('acp_initial_message_conv-9') ?? '{}') as { input: string };
    expect(initial.input).toContain('Focus on these memory files: deploy.md.');
    expect(initial.input).toContain('Change nothing until the owner approves.');
  });

  it('says so when the project has no memory directory yet', async () => {
    api.list.mockResolvedValue({ dir_exists: false, index_lines: 0, items: [], lint: [] });
    renderPanel();
    expect(await screen.findByText('Claude has no memory for this project yet.')).toBeTruthy();
  });
});

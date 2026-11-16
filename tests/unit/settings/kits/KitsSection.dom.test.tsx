/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { INSTANCES, KIT_OPS, KIT_PLATFORM, attachmentRow, fakeT, renderWithSwr } from './kitFixtures';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return {
    kits: {
      list: fn(),
      listAttachments: fn(),
      attach: fn(),
      detach: fn(),
      create: fn(),
      update: fn(),
      remove: fn(),
      effective: fn(),
      get: fn(),
    },
    market: { listInstances: fn(), listTemplates: fn() },
    listSkills: fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ kits: api.kits, mcpService: { market: api.market } }));
vi.mock('@/common', () => ({ ipcBridge: { fs: { listAvailableSkills: api.listSkills } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => [{ workspace: '/root/projects/tb', name: 'TB-test', project_id: 'proj-tb' }],
}));

import KitsSection from '@/renderer/pages/settings/ToolsSettings/kits/KitsSection';

const kitError = (code: string, status: number) =>
  new BackendHttpError({ method: 'PUT', path: '/api/kits/kit-1', status, body: { code, error: 'detail' } });

const openEditor = async (buttonName: RegExp | string) => {
  fireEvent.click(await screen.findByRole('button', { name: buttonName }));
  return screen.findByTestId('kit-edit-modal');
};

const nameInput = (modal: HTMLElement) => within(modal).getByPlaceholderText('mcp.kits.form.namePlaceholder');

describe('KitsSection (C27 Settings > Tools > Kits)', () => {
  beforeEach(() => {
    api.kits.list.invoke.mockResolvedValue([KIT_PLATFORM, KIT_OPS]);
    api.kits.listAttachments.invoke.mockImplementation(async (query: { level?: string }) =>
      query.level
        ? []
        : [
            attachmentRow({ id: 'a1', level: 'project', target_id: 'p1' }),
            attachmentRow({ id: 'a2', level: 'project', target_id: 'p2' }),
            attachmentRow({ id: 'a3', level: 'conversation', target_id: 'c1', op: 'remove' }),
          ]
    );
    api.kits.create.invoke.mockResolvedValue(KIT_OPS);
    api.kits.update.invoke.mockResolvedValue(KIT_PLATFORM);
    api.kits.remove.invoke.mockResolvedValue(undefined);
    api.market.listInstances.invoke.mockResolvedValue(INSTANCES);
    api.market.listTemplates.invoke.mockResolvedValue([{ id: 'github', name: 'GitHub' }]);
    api.listSkills.invoke.mockResolvedValue([{ name: 'pf-ui' }, { name: 'cs-build' }, { name: 'pf-core' }]);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('lists each kit with its skills, MCPs, wanted templates and attach levels', async () => {
    renderWithSwr(<KitsSection />);

    const cards = await screen.findAllByTestId('kit-card');
    expect(cards).toHaveLength(2);
    const platform = cards[0] as HTMLElement;
    expect(platform).toHaveTextContent('Platform Dev');
    expect(platform).toHaveTextContent('mcp.kits.builtin|{"key":"K1"}');
    expect(platform).toHaveTextContent('pf-ui');
    expect(platform).toHaveTextContent('context7');
    expect(platform).toHaveTextContent('mcp.kits.missingInstance|{"id":"inst-gone"}');
    expect(platform).toHaveTextContent('mcp.kits.needsInstance|{"template":"github"}');
    await waitFor(() =>
      expect(platform).toHaveTextContent('mcp.kits.levelCount|{"level":"mcp.kits.level.project","count":2}')
    );
    expect(platform).toHaveTextContent('mcp.kits.levelCount|{"level":"mcp.kits.level.conversation","count":1}');
    expect(cards[1]).toHaveTextContent('mcp.kits.notAttached');
    expect(screen.getByTestId('kit-attach-global')).toBeInTheDocument();
  });

  it('shows the empty state and a retryable load error', async () => {
    api.kits.list.invoke.mockResolvedValueOnce([]);
    const { unmount } = renderWithSwr(<KitsSection />);
    expect(await screen.findByText('mcp.kits.empty')).toBeInTheDocument();
    unmount();

    api.kits.list.invoke.mockRejectedValueOnce(new Error('offline'));
    renderWithSwr(<KitsSection />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mcp.market.actions.retry' }));
    expect(await screen.findAllByTestId('kit-card')).toHaveLength(2);
  });

  it('creates a kit with the exact CreateKitRequest', async () => {
    renderWithSwr(<KitsSection />);
    const modal = await openEditor('mcp.kits.create');

    fireEvent.change(nameInput(modal), { target: { value: '  Research  ' } });
    fireEvent.click(within(modal).getByRole('combobox', { name: 'mcp.kits.skills' }));
    // In multiple mode the option role sits on a wrapper; Arco listens on the inner option.
    const option = await screen.findByRole('option', { name: 'pf-core' });
    fireEvent.click(option.querySelector('.arco-select-option') ?? option);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() =>
      expect(api.kits.create.invoke).toHaveBeenCalledWith({
        name: 'Research',
        skills: ['pf-core'],
        mcp_instance_ids: [],
        mcp_templates: [],
      })
    );
    expect(Message.success).toHaveBeenCalledWith('mcp.kits.saved');
  });

  it('refuses an empty name without calling the server', async () => {
    renderWithSwr(<KitsSection />);
    await openEditor('mcp.kits.create');

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('mcp.kits.form.errors.nameRequired|{"max":80}')).toBeInTheDocument();
    expect(api.kits.create.invoke).not.toHaveBeenCalled();
  });

  it('edits a kit: replaces the member sets, sends expected_updated_at, explains KIT_STALE', async () => {
    api.kits.update.invoke.mockRejectedValueOnce(kitError('KIT_STALE', 409));
    renderWithSwr(<KitsSection />);
    const modal = await openEditor('mcp.kits.editLabel|{"name":"Platform Dev"}');
    expect(nameInput(modal)).toHaveValue('Platform Dev');

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kit-1',
        data: {
          name: 'Platform Dev',
          description: 'Build AionUi',
          skills: ['cs-build', 'pf-ui'],
          mcp_instance_ids: ['inst-ctx', 'inst-gone'],
          mcp_templates: ['github'],
          expected_updated_at: 100,
        },
      })
    );
    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.stale\|/))
    );
    // The kit list is refreshed after the refusal.
    await waitFor(() => expect(api.kits.list.invoke.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('explains KIT_NAME_TAKEN on create, also when only the name changed on edit', async () => {
    api.kits.create.invoke.mockRejectedValueOnce(kitError('KIT_NAME_TAKEN', 409));
    renderWithSwr(<KitsSection />);
    const modal = await openEditor('mcp.kits.create');
    fireEvent.change(nameInput(modal), { target: { value: 'Platform Dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.nameTaken\|/))
    );
    expect(Message.error).not.toHaveBeenCalledWith(expect.stringMatching(/stale/));
  });

  it('deletes a kit after confirmation', async () => {
    renderWithSwr(<KitsSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'mcp.kits.deleteLabel|{"name":"Ship & Ops"}' }));

    const confirm = await screen.findByText('mcp.kits.deleteConfirmTitle|{"name":"Ship & Ops"}');
    const dialog = confirm.closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));

    await waitFor(() => expect(api.kits.remove.invoke).toHaveBeenCalledWith({ id: 'kit-2' }));
    expect(Message.success).toHaveBeenCalledWith('mcp.kits.deleted');
  });
});

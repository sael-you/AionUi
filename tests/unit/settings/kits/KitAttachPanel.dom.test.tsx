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
    servers: { list: fn() },
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ kits: api.kits, mcpService: { market: api.market } }));
vi.mock('@/common', () => ({ ipcBridge: { fs: { listAvailableSkills: api.listSkills }, servers: api.servers } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));

import KitAttachPanel from '@/renderer/pages/settings/ToolsSettings/kits/KitAttachPanel';

const chooseOption = async (comboboxName: string, optionName: string | RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
};

describe('KitAttachPanel (C27 attach flows)', () => {
  beforeEach(() => {
    api.kits.list.invoke.mockResolvedValue([KIT_PLATFORM, KIT_OPS]);
    api.kits.listAttachments.invoke.mockResolvedValue([]);
    api.kits.attach.invoke.mockResolvedValue(attachmentRow({}));
    api.kits.detach.invoke.mockResolvedValue(undefined);
    api.market.listInstances.invoke.mockResolvedValue(INSTANCES);
    api.market.listTemplates.invoke.mockResolvedValue([]);
    api.servers.list.invoke.mockResolvedValue([
      { id: 'srv-1', name: 'db-prod', enabled: true },
      { id: 'srv-2', name: 'old-box', enabled: false },
    ]);
    api.listSkills.invoke.mockResolvedValue([{ name: 'pf-ui' }, { name: 'cs-build' }]);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('lists the attachments of its level and target, with kind and op', async () => {
    api.kits.listAttachments.invoke.mockResolvedValue([
      attachmentRow({ id: 'a1' }),
      attachmentRow({ id: 'a2', item_kind: 'skill', item_ref: 'seo-audit', item_name: 'seo-audit', op: 'remove' }),
    ]);
    renderWithSwr(<KitAttachPanel level='project' targetId='proj-1' />);

    const rows = await screen.findAllByTestId('kit-attach-project-row');
    expect(api.kits.listAttachments.invoke).toHaveBeenCalledWith({ level: 'project', target_id: 'proj-1' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('mcp.kits.kind.kit');
    expect(rows[0]).toHaveTextContent('Platform Dev');
    expect(rows[0]).toHaveTextContent('mcp.kits.op.add');
    expect(rows[1]).toHaveTextContent('seo-audit');
    expect(rows[1]).toHaveTextContent('mcp.kits.op.remove');
  });

  it('shows the empty state when nothing is attached', async () => {
    renderWithSwr(<KitAttachPanel level='assistant' targetId='asst-1' />);
    expect(await screen.findByText('mcp.kits.attach.empty')).toBeInTheDocument();
  });

  it('attaches a kit at the project level with the exact request and refreshes the list', async () => {
    renderWithSwr(<KitAttachPanel level='project' targetId='proj-1' />);
    await screen.findByText('mcp.kits.attach.empty');

    await chooseOption('mcp.kits.attach.item', 'Platform Dev');
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));

    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'project',
        target_id: 'proj-1',
        item_kind: 'kit',
        item_ref: 'kit-1',
        op: 'add',
      })
    );
    await waitFor(() => expect(api.kits.listAttachments.invoke).toHaveBeenCalledTimes(2));
    expect(Message.success).toHaveBeenCalledWith('mcp.kits.attach.attached');
  });

  it('attaches a single skill as a Remove override at the conversation level', async () => {
    renderWithSwr(<KitAttachPanel level='conversation' targetId='conv-1' />);
    await screen.findByText('mcp.kits.attach.empty');

    await chooseOption('mcp.kits.attach.kind', 'mcp.kits.kind.skill');
    await chooseOption('mcp.kits.attach.item', 'pf-ui');
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'mcp.kits.attach.op' })).getByText('mcp.kits.op.remove')
    );
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));

    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'conversation',
        target_id: 'conv-1',
        item_kind: 'skill',
        item_ref: 'pf-ui',
        op: 'remove',
      })
    );
  });

  it('attaches a server (C36) at the conversation level, switched-off servers marked', async () => {
    renderWithSwr(<KitAttachPanel level='conversation' targetId='conv-1' />);
    await screen.findByText('mcp.kits.attach.empty');

    await chooseOption('mcp.kits.attach.kind', 'mcp.kits.kind.server');
    fireEvent.click(screen.getByRole('combobox', { name: 'mcp.kits.attach.item' }));
    expect(await screen.findByRole('option', { name: 'old-box · settings.servers.chips.off' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'db-prod' }));
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));

    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'conversation',
        target_id: 'conv-1',
        item_kind: 'server',
        item_ref: 'srv-1',
        op: 'add',
      })
    );
  });

  it('omits target_id globally and disables MCP instances the global rule refuses', async () => {
    renderWithSwr(<KitAttachPanel level='global' targetId='' />);
    await screen.findByText('mcp.kits.attach.empty');
    expect(api.kits.listAttachments.invoke).toHaveBeenCalledWith({ level: 'global', target_id: '' });

    await chooseOption('mcp.kits.attach.kind', 'mcp.kits.kind.mcp');
    fireEvent.click(screen.getByRole('combobox', { name: 'mcp.kits.attach.item' }));
    const blocked = await screen.findByRole('option', { name: /tb-sb-prod/ });
    expect(blocked.className).toContain('arco-select-option-disabled');
    expect(blocked).toHaveTextContent('mcp.kits.attach.blocked.write');

    fireEvent.click(await screen.findByRole('option', { name: 'context7' }));
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));

    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'global',
        item_kind: 'mcp',
        item_ref: 'inst-ctx',
        op: 'add',
      })
    );
  });

  it('detaches a row and shows a server refusal as an error', async () => {
    api.kits.listAttachments.invoke.mockResolvedValue([attachmentRow({ id: 'a1' })]);
    renderWithSwr(<KitAttachPanel level='project' targetId='proj-1' />);
    await screen.findByTestId('kit-attach-project-row');

    fireEvent.click(screen.getByRole('button', { name: /mcp\.kits\.attach\.detachLabel/ }));
    await waitFor(() => expect(api.kits.detach.invoke).toHaveBeenCalledWith({ id: 'a1' }));
    expect(Message.success).toHaveBeenCalledWith('mcp.kits.attach.detached');

    api.kits.attach.invoke.mockRejectedValueOnce(new Error('refused by rule'));
    await chooseOption('mcp.kits.attach.item', 'Ship & Ops');
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('refused by rule'));
  });

  it('explains KIT_GLOBAL_NOT_ALLOWED and KIT_ATTACHMENT_NOT_FOUND from the server', async () => {
    api.kits.listAttachments.invoke.mockResolvedValue([attachmentRow({ id: 'a1', level: 'global', target_id: '' })]);
    api.kits.attach.invoke.mockRejectedValueOnce(
      new BackendHttpError({
        method: 'POST',
        path: '/api/kits/attachments',
        status: 400,
        body: { code: 'KIT_GLOBAL_NOT_ALLOWED', error: 'kit carries a write instance' },
      })
    );
    api.kits.detach.invoke.mockRejectedValueOnce(
      new BackendHttpError({
        method: 'DELETE',
        path: '/api/kits/attachments/a1',
        status: 404,
        body: { code: 'KIT_ATTACHMENT_NOT_FOUND', error: '' },
      })
    );
    renderWithSwr(<KitAttachPanel level='global' targetId='' />);
    await screen.findByTestId('kit-attach-global-row');

    await chooseOption('mcp.kits.attach.item', 'Platform Dev');
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.attach.submit' }));
    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.globalNotAllowed\|/))
    );

    fireEvent.click(screen.getByRole('button', { name: /mcp\.kits\.attach\.detachLabel/ }));
    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.attachmentNotFound\|/))
    );
  });
});

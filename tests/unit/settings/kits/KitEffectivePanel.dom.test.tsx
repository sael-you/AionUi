/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EFFECTIVE, INSTANCES, KIT_PLATFORM, fakeT, renderWithSwr } from './kitFixtures';

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

import ConversationKitsButton from '@/renderer/pages/settings/ToolsSettings/kits/ConversationKitsButton';
import KitEffectivePanel from '@/renderer/pages/settings/ToolsSettings/kits/KitEffectivePanel';

describe('What this conversation gets (C27 effective set)', () => {
  beforeEach(() => {
    api.kits.effective.invoke.mockResolvedValue(EFFECTIVE);
    api.kits.list.invoke.mockResolvedValue([KIT_PLATFORM]);
    api.kits.listAttachments.invoke.mockResolvedValue([]);
    api.kits.attach.invoke.mockResolvedValue({});
    api.market.listInstances.invoke.mockResolvedValue(INSTANCES);
    api.market.listTemplates.invoke.mockResolvedValue([]);
    api.servers.list.invoke.mockResolvedValue([
      { id: 'srv-1', name: 'db-prod', enabled: true },
      { id: 'srv-2', name: 'old-box', enabled: false },
    ]);
    api.listSkills.invoke.mockResolvedValue([{ name: 'pf-ui' }]);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('lists skills and MCPs with where each comes from, included first', async () => {
    renderWithSwr(<KitEffectivePanel query={{ conversation_id: 'conv-1' }} />);

    const skills = await screen.findByTestId('kit-effective-skills');
    expect(api.kits.effective.invoke).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    const skillRows = within(skills).getAllByTestId('kit-effective-row');
    expect(skillRows[0]).toHaveTextContent('pf-ui');
    expect(skillRows[0]).toHaveTextContent('mcp.kits.effective.included');
    expect(skillRows[0]).toHaveTextContent(
      'mcp.kits.effective.fromKit|{"level":"mcp.kits.level.project","kit":"Platform Dev"}'
    );
    expect(skillRows[1]).toHaveTextContent('seo-audit');
    expect(skillRows[1]).toHaveTextContent('mcp.kits.effective.removed');
    expect(skillRows[1]).toHaveTextContent('mcp.kits.effective.fromItem|{"level":"mcp.kits.level.conversation"}');

    const mcpRows = within(screen.getByTestId('kit-effective-mcps')).getAllByTestId('kit-effective-row');
    expect(mcpRows[0]).toHaveTextContent('context7');
    expect(mcpRows[0]).toHaveTextContent('mcp.kits.effective.fromItem|{"level":"mcp.kits.level.global"}');
    expect(mcpRows[0]).toHaveTextContent('mcp.kits.effective.delivered');
    expect(mcpRows[1]).toHaveTextContent('tb-sb-prod');
    expect(mcpRows[1]).toHaveTextContent(
      'mcp.kits.effective.fromKit|{"level":"mcp.kits.level.assistant","kit":"Backend"}'
    );
    expect(mcpRows[1]).toHaveTextContent('mcp.kits.effective.notDeliveredReason|{"reason":"instance is dormant"}');
    // C28: a server also in the workspace .mcp.json is flagged; the other one is not.
    expect(within(mcpRows[1] as HTMLElement).getByTestId('kit-effective-shadowed')).toHaveTextContent(
      'mcp.kits.effective.shadowed'
    );
    expect(within(mcpRows[0] as HTMLElement).queryByTestId('kit-effective-shadowed')).toBeNull();
  });

  it('lists the servers a conversation gets by name (C36), and none on an older core', async () => {
    api.kits.effective.invoke.mockResolvedValue({
      ...EFFECTIVE,
      servers: [{ kind: 'server', item_ref: 'srv-1', included: true, provenance: { level: 'project', op: 'add' } }],
    });
    const view = renderWithSwr(<KitEffectivePanel query={{ conversation_id: 'conv-1' }} />);
    const section = await screen.findByTestId('kit-effective-servers');
    expect(await within(section).findByText('db-prod')).toBeInTheDocument();
    view.unmount();

    api.kits.effective.invoke.mockResolvedValue(EFFECTIVE);
    renderWithSwr(<KitEffectivePanel query={{ conversation_id: 'conv-2' }} />);
    await screen.findByTestId('kit-effective-mcps');
    expect(screen.queryByTestId('kit-effective-servers')).toBeNull();
  });

  it('shows the frozen skill snapshot and wanted templates without an instance', async () => {
    renderWithSwr(<KitEffectivePanel query={{ conversation_id: 'conv-1' }} />);

    const frozen = await screen.findByTestId('kit-effective-frozen');
    expect(frozen).toHaveTextContent('cs-build');
    expect(frozen).toHaveTextContent('pf-ui');
    expect(screen.getByTestId('kit-effective-missing')).toHaveTextContent(
      'mcp.kits.effective.missingItem|{"template":"github","kit":"Platform Dev"}'
    );
  });

  it('says when no kit decides anything, and omits the snapshot for a preview', async () => {
    api.kits.effective.invoke.mockResolvedValue({ skills: [], mcps: [], missing_templates: [] });
    renderWithSwr(<KitEffectivePanel query={{ project_id: 'proj-1', assistant_id: 'asst-1' }} />);

    expect(await screen.findByText('mcp.kits.effective.empty')).toBeInTheDocument();
    expect(api.kits.effective.invoke).toHaveBeenCalledWith({ project_id: 'proj-1', assistant_id: 'asst-1' });
    expect(screen.queryByTestId('kit-effective-frozen')).toBeNull();
    expect(screen.queryByTestId('kit-effective-missing')).toBeNull();
  });

  it('shows a load error with retry', async () => {
    api.kits.effective.invoke.mockRejectedValueOnce(new Error('backend down'));
    renderWithSwr(<KitEffectivePanel query={{ conversation_id: 'conv-1' }} />);

    expect(await screen.findByText('backend down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mcp.market.actions.retry' }));
    expect(await screen.findByTestId('kit-effective-panel')).toBeInTheDocument();
  });

  it('opens from the chat header, and a conversation attach refreshes the effective set', async () => {
    renderWithSwr(<ConversationKitsButton conversationId='conv-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.headerButton' }));
    expect(await screen.findByTestId('kit-effective-panel')).toBeInTheDocument();
    expect(api.kits.effective.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'mcp.kits.levelModal.attachTab' }));
    const form = await screen.findByTestId('kit-attach-conversation-form');
    fireEvent.click(within(form).getByRole('combobox', { name: 'mcp.kits.attach.item' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Platform Dev' }));
    fireEvent.click(within(form).getByRole('button', { name: 'mcp.kits.attach.submit' }));

    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'conversation',
        target_id: 'conv-1',
        item_kind: 'kit',
        item_ref: 'kit-1',
        op: 'add',
      })
    );
    await waitFor(() => expect(api.kits.effective.invoke).toHaveBeenCalledTimes(2));
  });
});

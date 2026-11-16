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
import type { KitResponse } from '@/common/config/storage';
import { INSTANCES, fakeT, renderWithSwr } from './kitFixtures';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return {
    kits: {
      list: fn(),
      projectKit: fn(),
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
    navigate: vi.fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ kits: api.kits, mcpService: { market: api.market } }));
vi.mock('@/common', () => ({ ipcBridge: { fs: { listAvailableSkills: api.listSkills } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => api.navigate }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));

import ProjectKitPanel from '@/renderer/pages/settings/ToolsSettings/kits/ProjectKitPanel';

const TB_KIT: KitResponse = {
  id: 'kit-tb',
  name: 'TB-test',
  description: '',
  project_id: 'proj-tb',
  skills: ['paddle-rules'],
  mcps: [{ instance_id: 'inst-ctx', instance_name: 'context7' }],
  mcp_templates: [],
  created_at: 1,
  updated_at: 50,
};

const notFound = () =>
  new BackendHttpError({
    method: 'GET',
    path: '/api/projects/proj-tb/kit',
    status: 404,
    body: { code: 'KIT_NOT_FOUND' },
  });

const pick = async (comboboxName: string, optionName: string | RegExp) => {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
};

describe('ProjectKitPanel (C28)', () => {
  beforeEach(() => {
    api.kits.projectKit.invoke.mockResolvedValue(TB_KIT);
    api.kits.create.invoke.mockResolvedValue(TB_KIT);
    api.kits.update.invoke.mockResolvedValue(TB_KIT);
    api.market.listInstances.invoke.mockResolvedValue(INSTANCES);
    api.market.listTemplates.invoke.mockResolvedValue([{ id: 'sentry', name: 'Sentry' }]);
    api.listSkills.invoke.mockResolvedValue([{ name: 'paddle-rules' }, { name: 'pf-ui' }, { name: 'security' }]);
    vi.spyOn(Message, 'success').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('offers one-click creation named after the project when it has no kit (404)', async () => {
    api.kits.projectKit.invoke.mockRejectedValueOnce(notFound());
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);

    expect(await screen.findByTestId('project-kit-empty')).toHaveTextContent(
      'mcp.kits.projectKit.none|{"name":"TB-test"}'
    );
    expect(api.kits.projectKit.invoke).toHaveBeenCalledWith({ project_id: 'proj-tb' });
    // §5: keys can be imported before the kit exists (the import creates it).
    expect(screen.getByRole('button', { name: 'mcp.kits.import.open' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.projectKit.create' }));
    await waitFor(() =>
      expect(api.kits.create.invoke).toHaveBeenCalledWith({
        name: 'TB-test',
        project_id: 'proj-tb',
        skills: [],
        mcp_instance_ids: [],
        mcp_templates: [],
      })
    );
    expect(await screen.findByTestId('project-kit-panel')).toBeInTheDocument();
    expect(Message.success).toHaveBeenCalledWith('mcp.kits.projectKit.created');
  });

  it('explains KIT_PROJECT_HAS_KIT when another tab created it first', async () => {
    api.kits.projectKit.invoke.mockRejectedValueOnce(notFound());
    api.kits.create.invoke.mockRejectedValueOnce(
      new BackendHttpError({ method: 'POST', path: '/api/kits', status: 409, body: { code: 'KIT_PROJECT_HAS_KIT' } })
    );
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);

    fireEvent.click(await screen.findByRole('button', { name: 'mcp.kits.projectKit.create' }));
    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.projectHasKit\|/))
    );
    // The kit queries are revalidated, so the existing kit replaces the create button.
    expect(await screen.findByTestId('project-kit-panel')).toBeInTheDocument();
  });

  it('adds a library skill as a partial update guarded by updated_at', async () => {
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);
    await screen.findByTestId('project-kit-panel');

    await pick('mcp.kits.projectKit.addSkill', 'pf-ui');

    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kit-tb',
        data: { skills: ['paddle-rules', 'pf-ui'], expected_updated_at: 50 },
      })
    );
  });

  it('removes a skill with its labelled button (keyboard path)', async () => {
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);
    const skills = await screen.findByTestId('project-kit-skills');

    fireEvent.click(
      within(skills).getByRole('button', { name: 'mcp.kits.projectKit.removeLabel|{"name":"paddle-rules"}' })
    );

    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kit-tb',
        data: { skills: [], expected_updated_at: 50 },
      })
    );
  });

  it('adds an MCP instance and a wanted template, only offering ones not in the kit', async () => {
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);
    await screen.findByTestId('project-kit-panel');

    fireEvent.click(screen.getByRole('combobox', { name: 'mcp.kits.projectKit.addMcp' }));
    expect(await screen.findByRole('option', { name: /tb-sb-prod/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^context7/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /tb-sb-prod/ }));
    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kit-tb',
        data: { mcp_instance_ids: ['inst-ctx', 'inst-sb'], expected_updated_at: 50 },
      })
    );

    await pick('mcp.kits.projectKit.addTemplate', 'Sentry');
    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kit-tb',
        data: { mcp_templates: ['sentry'], expected_updated_at: 50 },
      })
    );
  });

  it('shows KIT_STALE and links to the grouped skills view of this project', async () => {
    api.kits.update.invoke.mockRejectedValueOnce(
      new BackendHttpError({ method: 'PUT', path: '/api/kits/kit-tb', status: 409, body: { code: 'KIT_STALE' } })
    );
    renderWithSwr(<ProjectKitPanel projectId='proj-tb' projectName='TB-test' />);
    await screen.findByTestId('project-kit-panel');

    await pick('mcp.kits.projectKit.addSkill', 'security');
    await waitFor(() =>
      expect(Message.error).toHaveBeenCalledWith(expect.stringMatching(/^mcp\.kits\.errors\.stale\|/))
    );

    expect(screen.getByRole('button', { name: 'mcp.kits.import.open' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.projectKit.viewSkills' }));
    expect(api.navigate).toHaveBeenCalledWith('/settings/skills?project=proj-tb');
  });
});

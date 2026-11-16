/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitResponse } from '@/common/config/storage';
import { attachmentRow, fakeT, renderWithSwr } from './kitFixtures';

const api = vi.hoisted(() => {
  const fn = () => ({ invoke: vi.fn() });
  return { kits: { list: fn(), listAttachments: fn() }, navigate: vi.fn() };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ kits: api.kits, mcpService: { market: {} } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => api.navigate }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => [{ workspace: '/root/projects/tb', name: 'TB-test', project_id: 'proj-tb' }],
}));

import SkillsByKitPane from '@/renderer/pages/settings/SkillsSettings/SkillsByKitPane';

const kit = (over: Partial<KitResponse> & Pick<KitResponse, 'id' | 'name'>): KitResponse => ({
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});

const KITS = [
  kit({ id: 'k0', name: 'Global', builtin_key: 'K0', skills: ['cs-verify'] }),
  kit({ id: 'k1', name: 'Platform Dev', builtin_key: 'K1', skills: ['pf-ui', 'cs-verify'] }),
  kit({ id: 'kp', name: 'TB-test', project_id: 'proj-tb', skills: ['paddle-rules', 'pf-ui'] }),
];
const LIBRARY = ['copywriting', 'cs-verify', 'paddle-rules', 'pf-ui'];

const buttonsIn = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('button')
    .map((button) => button.textContent);

/** A filter chip, scoped to the chip group (group headings share the label). */
const chip = (label: string) =>
  within(screen.getByRole('radiogroup', { name: 'mcp.kits.skillGroups.filterLabel' })).getByText(label);

describe('Skills page, By kit (C28 grouped library)', () => {
  beforeEach(() => {
    api.kits.list.invoke.mockResolvedValue(KITS);
    api.kits.listAttachments.invoke.mockResolvedValue([
      attachmentRow({ id: 'g', level: 'global', target_id: '', item_ref: 'k0', item_name: 'Global' }),
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('groups the library: Global, shared kits and not in any kit; a skill can show in several', async () => {
    renderWithSwr(<SkillsByKitPane skillNames={LIBRARY} projectId={null} />);

    expect(await screen.findByTestId('skills-group-global')).toBeInTheDocument();
    expect(api.kits.listAttachments.invoke).toHaveBeenCalledWith({ level: 'global', target_id: '' });
    expect(buttonsIn('skills-group-global')).toEqual(['cs-verify']);
    expect(screen.getByTestId('skills-group-shared')).toHaveTextContent('Platform Dev');
    expect(screen.getByTestId('skills-group-shared')).not.toHaveTextContent('TB-test');
    expect(buttonsIn('skills-group-shared')).toEqual(['cs-verify', 'pf-ui']);
    expect(buttonsIn('skills-group-ungrouped')).toEqual(['copywriting']);
    expect(screen.queryByTestId('skills-group-project')).toBeNull();
    expect(screen.getByTestId('skills-group-global')).toHaveTextContent('mcp.kits.skillGroups.count|{"count":1}');
  });

  it('opened from a project: starts on that project kit, and the chips switch groups', async () => {
    renderWithSwr(<SkillsByKitPane skillNames={LIBRARY} projectId='proj-tb' />);

    const project = await screen.findByTestId('skills-group-project');
    expect(project).toHaveTextContent('mcp.kits.skillGroups.projectOf|{"name":"TB-test"}');
    expect(buttonsIn('skills-group-project')).toEqual(['paddle-rules', 'pf-ui']);
    expect(screen.queryByTestId('skills-group-global')).toBeNull();

    fireEvent.click(chip('mcp.kits.skillGroups.all'));
    expect(screen.getByTestId('skills-group-global')).toBeInTheDocument();
    expect(screen.getByTestId('skills-group-project')).toBeInTheDocument();

    fireEvent.click(chip('mcp.kits.skillGroups.ungrouped'));
    expect(screen.queryByTestId('skills-group-project')).toBeNull();
    expect(buttonsIn('skills-group-ungrouped')).toEqual(['copywriting']);
  });

  it('says when the project has no kit yet, and opens a skill from a group', async () => {
    api.kits.list.invoke.mockResolvedValue(KITS.filter((entry) => !entry.project_id));
    renderWithSwr(<SkillsByKitPane skillNames={LIBRARY} projectId='proj-tb' />);

    expect(await screen.findByText('mcp.kits.skillGroups.noProjectKit')).toBeInTheDocument();

    fireEvent.click(chip('mcp.kits.skillGroups.all'));
    fireEvent.click(screen.getByRole('button', { name: 'mcp.kits.skillGroups.openSkill|{"name":"copywriting"}' }));
    expect(api.navigate).toHaveBeenCalledWith('/settings/skills/detail/copywriting');
  });
});

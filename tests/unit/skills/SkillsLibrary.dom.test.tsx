/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skills page in the library layout (C33, TASK-119): scope rail (Global, projects
 * with something, empty projects folded), Active grouped by source, Library
 * grouped by category, the scope switch and the writes behind a card switch.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KitAttachmentResponse, KitEffectiveSetResponse, KitResponse } from '@/common/config/storage';
import { fakeT, renderWithSwr } from '../settings/kits/kitFixtures';

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
    assistants: fn(),
    navigate: vi.fn(),
    message: vi.fn(),
  };
});

vi.mock('@/common/adapter/ipcBridge', () => ({ kits: api.kits, mcpService: { market: api.market } }));
vi.mock('@/common', () => ({ ipcBridge: { assistants: { list: api.assistants }, fs: {} } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: fakeT, i18n: { language: 'en' } }) }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: api.message, error: api.message, warning: api.message } };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => api.navigate }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects', () => ({
  useStandardProjects: () => [
    { workspace: '/root/projects/tb', name: 'TB-test', project_id: 'p-tb' },
    { workspace: '/root/projects/store', name: 'store', project_id: 'p-store' },
    { workspace: '/root/projects/probe', name: 'skill-probe', project_id: 'p-probe' },
  ],
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: async (id: string) => (id === 'conv-tb' ? { id, project_id: 'p-tb' } : null),
}));
vi.mock('@/renderer/pages/settings/SkillsSettings/SkillFileBrowser', () => ({
  default: () => <div data-testid='skill-file-stub' />,
}));

import SkillsLibrary, { type SkillsLibraryProps } from '@/renderer/pages/settings/SkillsSettings/SkillsLibrary';

const kit = (over: Partial<KitResponse>): KitResponse => ({
  id: 'k',
  name: 'Kit',
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});

const K0 = kit({ id: 'k0', name: 'Global', builtin_key: 'K0', skills: ['memory'] });
const SEO = kit({ id: 'k6', name: 'SEO', builtin_key: 'K6', skills: ['seo-audit', 'schema'] });
const CRO = kit({ id: 'k7', name: 'CRO', builtin_key: 'K7', skills: ['schema'] });
const TB_KIT = kit({ id: 'kp', name: 'TB-test', project_id: 'p-tb', skills: ['tb-deploy'], updated_at: 9 });

const ATTACHMENTS: KitAttachmentResponse[] = [
  {
    id: 'g0',
    level: 'global',
    target_id: '',
    item_kind: 'kit',
    item_ref: 'k0',
    item_name: 'Global',
    op: 'add',
    created_at: 1,
    updated_at: 1,
  },
  {
    id: 'p6',
    level: 'project',
    target_id: 'p-tb',
    item_kind: 'kit',
    item_ref: 'k6',
    item_name: 'SEO',
    op: 'add',
    created_at: 1,
    updated_at: 1,
  },
];

const effectiveFor = (projectId?: string): KitEffectiveSetResponse => ({
  project_id: projectId,
  skills: projectId
    ? [
        {
          kind: 'skill',
          item_ref: 'tb-deploy',
          included: true,
          provenance: { level: 'project', op: 'add', kit_id: 'kp' },
        },
        {
          kind: 'skill',
          item_ref: 'seo-audit',
          included: true,
          provenance: { level: 'project', op: 'add', kit_id: 'k6' },
        },
        {
          kind: 'skill',
          item_ref: 'schema',
          included: true,
          provenance: { level: 'project', op: 'add', kit_id: 'k6' },
        },
        { kind: 'skill', item_ref: 'memory', included: true, provenance: { level: 'global', op: 'add', kit_id: 'k0' } },
      ]
    : [{ kind: 'skill', item_ref: 'memory', included: true, provenance: { level: 'global', op: 'add', kit_id: 'k0' } }],
  mcps: [],
  missing_templates: [],
});

const SKILLS: SkillsLibraryProps['skills'] = [
  { name: 'memory', source: 'builtin', description: 'Remembers things', location: '/b/memory' },
  { name: 'seo-audit', source: 'custom', description: 'Audit a site', location: '/u/seo-audit' },
  { name: 'schema', source: 'custom', description: 'Schema markup', location: '/u/schema' },
  { name: 'tb-deploy', source: 'custom', description: 'Deploy TB', location: '/u/tb-deploy' },
  { name: 'notes', source: 'custom', description: 'Notes', location: '/u/notes' },
  { name: 'tb-lint', source: 'custom', description: 'Lint', location: '/u/tb-lint' },
];

const renderLibrary = (over: Partial<SkillsLibraryProps> = {}) => {
  const props: SkillsLibraryProps = {
    skills: SKILLS,
    loading: false,
    query: '',
    onQuery: vi.fn(),
    initialProjectId: null,
    highlightName: null,
    onHighlightDone: vi.fn(),
    onDelete: vi.fn(),
    onBatchDelete: vi.fn(),
    isMobile: false,
    ...over,
  };
  return { props, ...renderWithSwr(<SkillsLibrary {...props} />) };
};

const sectionKeys = () =>
  screen.getAllByTestId('library-section').map((section) => section.getAttribute('data-section-key'));

const section = (key: string) =>
  screen.getAllByTestId('library-section').find((el) => el.getAttribute('data-section-key') === key) as HTMLElement;

const cardNames = (container: HTMLElement) =>
  within(container)
    .queryAllByTestId('library-card')
    .map((card) => card.getAttribute('data-card-id'));

describe('SkillsLibrary (C33)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.kits.list.invoke.mockResolvedValue([K0, SEO, CRO, TB_KIT]);
    api.kits.listAttachments.invoke.mockResolvedValue(ATTACHMENTS);
    api.kits.effective.invoke.mockImplementation(async (query: { project_id?: string }) =>
      effectiveFor(query.project_id)
    );
    api.kits.attach.invoke.mockResolvedValue({});
    api.kits.detach.invoke.mockResolvedValue(undefined);
    api.kits.update.invoke.mockResolvedValue(TB_KIT);
    api.assistants.invoke.mockResolvedValue([]);
  });

  it('rail: Global first, projects with something, empty projects folded into one line that expands', async () => {
    renderLibrary();
    const rail = await screen.findByTestId('library-rail');
    await waitFor(() =>
      expect(
        within(rail)
          .getAllByTestId('library-rail-scope')
          .map((el) => el.getAttribute('data-key'))
      ).toEqual(['global', 'project:p-tb'])
    );
    const fold = within(rail).getByTestId('library-rail-empty-toggle');
    expect(fold).toHaveTextContent('settings.library.emptyProjects|{"count":2}');
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(screen.getByTestId('library-rail-empty-list'))
        .getAllByTestId('library-rail-scope')
        .map((el) => el.getAttribute('data-key'))
    ).toEqual(['project:p-probe', 'project:p-store']);
  });

  it('defaults to the project of the conversation the settings were opened from', async () => {
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/conv-tb');
    renderLibrary();
    await waitFor(() => expect(api.kits.effective.invoke).toHaveBeenCalledWith({ project_id: 'p-tb' }));
    await waitFor(() => expect(sectionKeys()).toEqual(['projectKit', 'kit:k6', 'fromGlobal']));
  });

  it('Active in a project: this project kit, the shared kit, From Global — and a summary line', async () => {
    renderLibrary({ initialProjectId: 'p-tb' });
    await waitFor(() => expect(sectionKeys()).toEqual(['projectKit', 'kit:k6', 'fromGlobal']));
    expect(cardNames(section('projectKit'))).toEqual(['tb-deploy']);
    expect(cardNames(section('kit:k6'))).toEqual(['schema', 'seo-audit']);
    expect(cardNames(section('fromGlobal'))).toEqual(['memory']);
    expect(screen.getByTestId('library-summary')).toHaveTextContent('settings.library.summary.active|{"count":4}');
    expect(screen.getByTestId('library-summary')).toHaveTextContent('settings.library.summary.fromGlobal|{"count":1}');
    expect(screen.getByTestId('library-summary')).toHaveTextContent('settings.library.summary.kits|{"count":2}');
  });

  it('scope switch: picking Global in the rail shows what Global delivers', async () => {
    renderLibrary({ initialProjectId: 'p-tb' });
    await waitFor(() => expect(sectionKeys()).toContain('fromGlobal'));
    const globalItem = screen
      .getAllByTestId('library-rail-scope')
      .find((el) => el.getAttribute('data-key') === 'global') as HTMLElement;
    fireEvent.click(globalItem);
    await waitFor(() => expect(sectionKeys()).toEqual(['kit:k0']));
    expect(globalItem).toHaveAttribute('aria-current', 'true');
  });

  it('Library: categories by shared kit (a skill in two kits shows in both), Built-in, Other; search dedupes', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toEqual(['kit:k6', 'kit:k7', 'builtin', 'other']));
    expect(cardNames(section('kit:k6'))).toEqual(['schema', 'seo-audit']);
    expect(cardNames(section('kit:k7'))).toEqual(['schema']);
    expect(cardNames(section('builtin'))).toEqual(['memory']);
    expect(cardNames(section('other'))).toEqual(['notes', 'tb-deploy', 'tb-lint']);
    // Source chips stay off the owner's own skills; built-ins say where they come from.
    const memory = within(section('builtin')).getByTestId('library-card');
    expect(memory).toHaveTextContent('settings.skillsLibrary.source.official');
    expect(within(section('other')).getAllByTestId('library-card')[0]).not.toHaveTextContent(
      'settings.skillsLibrary.source.mine'
    );
    expect(screen.getByTestId('library-tab-library')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('library-panel')).toHaveAttribute('role', 'tabpanel');
  });

  it('search shows each match once', async () => {
    renderLibrary({ query: 'schema' });
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toEqual(['results']));
    expect(cardNames(section('results'))).toEqual(['schema']);
  });

  it('category filter narrows the Library to that category', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toContain('kit:k7'));
    const cro = screen.getAllByTestId('library-rail-category').find((el) => el.getAttribute('data-key') === 'kit:k7');
    fireEvent.click(cro as HTMLElement);
    expect(sectionKeys()).toEqual(['kit:k7']);
  });

  it('"Add whole category" attaches that shared kit to the scope', async () => {
    renderLibrary({ initialProjectId: 'p-tb' });
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toContain('kit:k7'));
    fireEvent.click(within(section('kit:k7')).getByTestId('library-category-add'));
    await waitFor(() =>
      expect(api.kits.attach.invoke).toHaveBeenCalledWith({
        level: 'project',
        target_id: 'p-tb',
        item_kind: 'kit',
        item_ref: 'k7',
        op: 'add',
      })
    );
    // SEO is already attached here: its header offers to detach instead.
    expect(within(section('kit:k6')).getByTestId('library-category-detach')).toBeInTheDocument();
  });

  it('a project scope suggests Other skills that name the project; "Add all" puts them in its kit', async () => {
    renderLibrary({ initialProjectId: 'p-tb' });
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()[0]).toBe('suggested'));
    expect(cardNames(section('suggested'))).toEqual(['tb-lint']);
    fireEvent.click(within(section('suggested')).getByTestId('library-suggested-add'));
    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kp',
        data: { skills: ['tb-deploy', 'tb-lint'], expected_updated_at: 9 },
      })
    );
  });

  it('turning a skill on in a project with a kit adds it to that kit', async () => {
    renderLibrary({ initialProjectId: 'p-tb' });
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toContain('other'));
    const notes = within(section('other'))
      .getAllByTestId('library-card')
      .find((card) => card.getAttribute('data-card-id') === 'notes') as HTMLElement;
    const toggle = within(notes).getByTestId('library-card-toggle');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleName('settings.library.onIn|{"scope":"TB-test"}');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.kits.update.invoke).toHaveBeenCalledWith({
        id: 'kp',
        data: { skills: ['tb-deploy', 'notes'], expected_updated_at: 9 },
      })
    );
  });

  it('a card opens the drawer with where the skill is used', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toContain('kit:k6'));
    const seo = within(section('kit:k6'))
      .getAllByTestId('library-card-open')
      .find((button) => button.textContent === 'seo-audit') as HTMLElement;
    fireEvent.click(seo);
    const drawer = await screen.findByTestId('skill-drawer');
    expect(within(drawer).getByTestId('skill-drawer-used-in')).toHaveTextContent('TB-test');
    expect(within(drawer).getByTestId('skill-file-stub')).toBeInTheDocument();
  });

  it('batch: select cards, then add them to the scope in one go', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByTestId('library-tab-library'));
    await waitFor(() => expect(sectionKeys()).toContain('other'));
    fireEvent.click(screen.getByTestId('library-batch-start'));
    const other = section('other');
    within(other)
      .getAllByTestId('library-card-open')
      .forEach((button) => fireEvent.click(button));
    expect(screen.getByTestId('library-batch-bar')).toHaveTextContent('settings.library.selected|{"count":3}');
    fireEvent.click(screen.getByTestId('library-batch-add'));
    await waitFor(() => expect(api.kits.attach.invoke).toHaveBeenCalledTimes(3));
    expect(api.kits.attach.invoke).toHaveBeenCalledWith({
      level: 'global',
      item_kind: 'skill',
      item_ref: 'notes',
      op: 'add',
    });
  });
});

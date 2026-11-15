/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The real sidebar list (WorkspaceGroupedHistory) inside a roving tree:
 * sections, project rows with counts and status, the project guide, the
 * name filter, the row slots for the Kanban builder, keyboard navigation.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';

const state = vi.hoisted(() => ({
  generating: new Set<string>(),
  waiting: new Set<string>(),
  seen: new Map<string, number>(),
}));

const mk = (id: string, name: string, workspace?: string): TChatConversation =>
  ({
    id,
    name,
    type: 'acp',
    created_at: 1,
    modified_at: 1,
    extra: workspace ? { workspace, custom_workspace: true } : {},
  }) as unknown as TChatConversation;

const A1 = mk('a1', 'Fix the login bug', '/p/alpha');
const A2 = mk('a2', 'Write release notes', '/p/alpha');
const LOOSE = mk('l1', 'Quick question');
const fixture = vi.hoisted(() => ({ empty: false }));
const sections: TimelineSection[] = [
  {
    timeline: 'Today',
    items: [
      {
        type: 'workspace',
        time: 3,
        workspaceGroup: { workspace: '/p/alpha', display_name: 'alpha', conversations: [A1, A2] },
      },
      {
        type: 'workspace',
        time: 2,
        workspaceGroup: { workspace: '/p/empty', display_name: 'empty', conversations: [] },
      },
      { type: 'conversation', time: 1, conversation: LOOSE },
    ],
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest: vi.fn(async () => undefined),
}));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [A1, A2, LOOSE],
    isConversationGenerating: (id: string) => state.generating.has(id),
    isConversationWaitingConfirmation: (id: string) => state.waiting.has(id),
    hasCompletionUnread: () => false,
    hasBackgroundActive: () => false,
    outcomeSeenAt: (id: string) => state.seen.get(id),
    clearCompletionUnread: () => {},
    isManualUnread: () => false,
    markManualUnread: () => {},
    clearManualUnread: () => {},
    setActiveConversation: () => {},
    groupedHistory: {
      pinnedConversations: [],
      timelineSections: fixture.empty ? [] : sections,
      descendantsByRoot: new Map(),
    },
  }),
}));
vi.mock('@/renderer/pages/cron', () => ({
  useCronJobsMap: () => ({ getJobStatus: () => 'none', markAsRead: () => {}, setActiveConversation: () => {} }),
  CronJobIndicator: () => null,
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
  useThemeAppearance: () => 'light',
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({ info: null }) }));
vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));
vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';
import type { WorkspaceGroupedHistoryProps } from '@/renderer/pages/conversation/GroupedHistory/types';

/** The list renders its own tree (role, roving tabindex). */
const Sidebar: React.FC<WorkspaceGroupedHistoryProps> = (props) => <WorkspaceGroupedHistory {...props} />;

const renderSidebar = (props: WorkspaceGroupedHistoryProps = {}) =>
  render(
    <MemoryRouter>
      <Sidebar {...props} />
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  state.generating.clear();
  state.waiting.clear();
  state.seen.clear();
  fixture.empty = false;
});

describe('sidebar list', () => {
  it('shows projects as the hierarchy anchors, with counts, and the loose conversations section', () => {
    renderSidebar();
    expect(screen.getByTestId('section-header-projects').getAttribute('aria-label')).toBe(
      'conversation.history.projectsSection (2)'
    );
    // C21: the count shows only while collapsed, and an empty project shows no "0".
    expect(screen.queryByTestId('project-count-/p/alpha')).toBeNull();
    expect(screen.queryByTestId('project-count-/p/empty')).toBeNull();
    // Non-empty projects open on first load, empty ones stay collapsed.
    expect(screen.getByTestId('project-row-/p/alpha').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('project-row-/p/empty').getAttribute('aria-expanded')).toBe('false');
    const alphaRows = within(screen.getByTestId('project-children-/p/alpha')).getAllByRole('treeitem');
    expect(alphaRows.map((row) => row.getAttribute('aria-level'))).toEqual(['3', '3']);
    expect(screen.getByTestId('section-header-conversations')).toBeInTheDocument();
  });

  it('rolls running and needs-you up to the project row', () => {
    state.generating.add('a1');
    state.waiting.add('a2');
    renderSidebar();
    // C24: one dot, the most urgent state (needs you over running).
    expect(screen.getByTestId('project-needs-you-/p/alpha').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('conversation-running-a1')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-waiting-confirmation-a2')).toBeInTheDocument();
  });

  it('draws no per-row colour bars (the group guide carries the colour)', () => {
    const { container } = renderSidebar();
    expect(container.querySelector('[data-project-accent]')).toBeNull();
    const group = screen.getByTestId('project-children-/p/alpha').closest('[data-project-color]');
    expect(group).not.toBeNull();
  });

  it('filters by project or conversation name', () => {
    const view = renderSidebar({ filterQuery: 'release' });
    expect(screen.getByText('Write release notes')).toBeInTheDocument();
    expect(screen.queryByText('Fix the login bug')).toBeNull();
    expect(screen.queryByTestId('project-row-/p/empty')).toBeNull();
    expect(screen.queryByText('Quick question')).toBeNull();

    view.rerender(
      <MemoryRouter>
        <Sidebar filterQuery='EMPTY' />
      </MemoryRouter>
    );
    // A matching project shows (open, even though empty projects start collapsed).
    expect(screen.getByTestId('project-row-/p/empty').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('project-row-/p/alpha')).toBeNull();

    view.rerender(
      <MemoryRouter>
        <Sidebar filterQuery='zzz' />
      </MemoryRouter>
    );
    expect(screen.getByText('conversation.sidebar.filter.noResults')).toBeInTheDocument();
  });

  it('puts the Kanban slots in place: project actions, conversation badge, lead conversation first', () => {
    renderSidebar({
      projectActions: ({ workspace }) => <span data-testid={`board-${workspace}`}>Board</span>,
      conversationBadge: (conversation) =>
        conversation.id === 'a2' ? <span data-testid='keeper-badge'>K</span> : null,
      isProjectLeadConversation: (conversation) => conversation.id === 'a2',
    });
    expect(within(screen.getByTestId('project-actions-/p/alpha')).getByTestId('board-/p/alpha')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-badge-a2')).toContainElement(screen.getByTestId('keeper-badge'));
    const rows = within(screen.getByTestId('project-children-/p/alpha')).getAllByRole('treeitem');
    expect(rows[0].id).toBe('c-a2');
  });

  it('navigates end to end with the keyboard', () => {
    renderSidebar();
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe('conversation.sidebar.treeLabel');
    const projectsHeader = screen.getByTestId('section-header-projects');
    projectsHeader.focus();
    fireEvent.keyDown(projectsHeader, { key: 'ArrowDown' });
    const alpha = screen.getByTestId('project-row-/p/alpha');
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(alpha, { key: 'ArrowRight' }); // already open → first conversation
    expect(document.activeElement?.id).toBe('c-a1');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // → parent project
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' }); // collapse
    expect(alpha.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('aionui_workspace_expansion')).toBe('[]');
    fireEvent.keyDown(alpha, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('project-row-/p/empty'));
    // Exactly one tab stop in the whole tree.
    expect(screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it('archives the whole project from its menu while a filter shows only one of its conversations', async () => {
    renderSidebar({ filterQuery: 'release' });
    expect(within(screen.getByTestId('project-children-/p/alpha')).getAllByRole('treeitem')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('project-menu-/p/alpha'));
    fireEvent.click(await screen.findByText('conversation.history.archiveProject'));
    // The confirmation counts the project's two conversations, not the one match.
    expect(await screen.findByText('conversation.history.archiveProjectConfirm:2')).toBeInTheDocument();
  });

  it('keeps the project running / needs-you status from conversations the filter hides', () => {
    state.generating.add('a1'); // "Fix the login bug" — does not match the filter
    state.waiting.add('a1');
    renderSidebar({ filterQuery: 'release' });
    expect(screen.queryByText('Fix the login bug')).toBeNull();
    expect(screen.getByTestId('project-needs-you-/p/alpha').getAttribute('data-count')).toBe('1');
  });

  it('lists what waits across projects in the Needs-you box, only while something waits (C21)', () => {
    renderSidebar();
    expect(screen.queryByTestId('sidebar-needs-you')).toBeNull();
  });

  it('keeps the Needs-you box out of the tree as a labelled region with a list of links', () => {
    state.waiting.add('a2');
    renderSidebar();
    const box = screen.getByRole('region', { name: /conversation.orchestration.needsYou.title/ });
    expect(box.closest('[role="tree"]')).toBeNull();
    const items = within(within(box).getByRole('list')).getAllByRole('listitem');
    expect(within(items[0]).getByRole('link')).toBeInTheDocument();
    expect(box.querySelector('[data-tree-item]')).toBeNull();
  });

  it('gives tree items their position among siblings (aria-posinset / aria-setsize)', () => {
    renderSidebar();
    const alpha = screen.getByTestId('project-row-/p/alpha');
    expect(alpha.getAttribute('aria-setsize')).toBe('2');
    expect(alpha.getAttribute('aria-posinset')).toBe('1');
    const rows = within(screen.getByTestId('project-children-/p/alpha')).getAllByRole('treeitem');
    expect(rows.map((row) => `${row.getAttribute('aria-posinset')}/${row.getAttribute('aria-setsize')}`)).toEqual([
      '1/2',
      '2/2',
    ]);
  });

  it('drops a failed conversation from Needs-you and its row once it was opened (FIXES 2)', () => {
    const extra = A2.extra;
    A2.extra = { ...extra, last_outcome: 'error', last_outcome_at: 10 } as typeof extra;
    try {
      const { rerender } = renderSidebar();
      expect(within(screen.getByTestId('sidebar-needs-you')).getByTestId('sidebar-needs-you-a2')).toBeInTheDocument();
      expect(screen.getByTestId('conversation-failed-a2')).toBeInTheDocument();
      // Opened: recorded locally first (the list refresh then carries last_outcome_seen_at).
      state.seen.set('a2', 20);
      rerender(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );
      expect(screen.queryByTestId('sidebar-needs-you')).toBeNull();
      expect(screen.queryByTestId('conversation-failed-a2')).toBeNull();
    } finally {
      A2.extra = extra;
    }
  });

  it('shows the Needs-you box with the waiting conversation, its project and the running count', () => {
    state.waiting.add('a2');
    state.generating.add('a1');
    renderSidebar();
    const box = screen.getByTestId('sidebar-needs-you');
    expect(within(box).getByTestId('sidebar-needs-you-a2')).toBeInTheDocument();
    expect(within(box).getByTestId('sidebar-needs-you-running').textContent).toContain(
      'conversation.orchestration.needsYou.running'
    );
  });

  it('keeps the Projects header and its "+" with a zero count when there are no projects', () => {
    fixture.empty = true;
    renderSidebar();
    expect(screen.getByTestId('section-header-projects').getAttribute('aria-label')).toBe(
      'conversation.history.projectsSection (0)'
    );
    expect(screen.getByTestId('projects-add')).toBeInTheDocument();
    expect(screen.getByText('conversation.history.noHistory')).toBeInTheDocument();
  });

  it('associates every section and project group with its tree item', () => {
    renderSidebar();
    for (const key of ['projects', 'conversations']) {
      const header = screen.getByTestId(`section-header-${key}`);
      const owned = header.getAttribute('aria-owns');
      expect(owned).toBeTruthy();
      expect(document.getElementById(owned!)?.getAttribute('role')).toBe('group');
    }
    const project = screen.getByTestId('project-row-/p/alpha');
    expect(document.getElementById(project.getAttribute('aria-owns')!)).toBe(
      screen.getByTestId('project-children-/p/alpha')
    );
  });

  it('flattens the tree in the icon rail: no headers, rows at level 1, no orphan groups', () => {
    const { container } = renderSidebar({ collapsed: true });
    expect(screen.queryByTestId('section-header-projects')).toBeNull();
    expect(screen.queryByTestId('project-row-/p/alpha')).toBeNull();
    const levels = screen.getAllByRole('treeitem').map((row) => row.getAttribute('aria-level'));
    expect(new Set(levels)).toEqual(new Set(['1']));
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});

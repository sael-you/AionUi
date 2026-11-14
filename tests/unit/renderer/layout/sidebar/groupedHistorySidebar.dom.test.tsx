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
    clearCompletionUnread: () => {},
    isManualUnread: () => false,
    markManualUnread: () => {},
    clearManualUnread: () => {},
    setActiveConversation: () => {},
    groupedHistory: { pinnedConversations: [], timelineSections: sections, descendantsByRoot: new Map() },
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
});

describe('sidebar list', () => {
  it('shows projects as the hierarchy anchors, with counts, and the loose conversations section', () => {
    renderSidebar();
    expect(screen.getByTestId('section-header-projects').getAttribute('aria-label')).toBe(
      'conversation.history.projectsSection (2)'
    );
    expect(screen.getByTestId('project-count-/p/alpha').textContent).toBe('2');
    expect(screen.getByTestId('project-count-/p/empty').textContent).toBe('0');
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
    expect(screen.getByTestId('project-running-/p/alpha')).toBeInTheDocument();
    expect(screen.getByTestId('project-needs-you-/p/alpha').textContent).toBe('1');
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
});

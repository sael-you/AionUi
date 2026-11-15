/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';

const conv = { id: 'c1', name: 'One', extra: { workspace: '/p/full', custom_workspace: true } } as TChatConversation;
const sections: TimelineSection[] = [
  {
    timeline: 'Today',
    items: [
      {
        type: 'workspace',
        time: 2,
        workspaceGroup: { workspace: '/p/full', display_name: 'full', conversations: [conv] },
      },
      {
        type: 'workspace',
        time: 1,
        workspaceGroup: { workspace: '/p/empty', display_name: 'empty', conversations: [] },
      },
    ],
  },
];

vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [conv],
    isConversationGenerating: () => false,
    isConversationWaitingConfirmation: () => false,
    hasCompletionUnread: () => false,
    clearCompletionUnread: () => {},
    isManualUnread: () => false,
    markManualUnread: () => {},
    clearManualUnread: () => {},
    setActiveConversation: () => {},
    groupedHistory: { pinnedConversations: [], timelineSections: sections, descendantsByRoot: new Map() },
  }),
}));

import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';
import { WORKSPACE_EXPANSION_STORAGE_KEY } from '@/renderer/pages/conversation/GroupedHistory/hooks/useWorkspaceExpansionState';

const stored = () => JSON.parse(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY) ?? '[]');

describe('sidebar collapse persistence', () => {
  beforeEach(() => localStorage.clear());

  it('opens only the non-empty projects on first load', () => {
    const { result } = renderHook(() => useConversations());
    expect(result.current.expandedWorkspaces).toEqual(['/p/full']);
    expect(stored()).toEqual(['/p/full']);
  });

  it('remembers each project’s collapse state across mounts', () => {
    const first = renderHook(() => useConversations());
    act(() => first.result.current.handleToggleWorkspace('/p/full')); // collapse
    act(() => first.result.current.handleToggleWorkspace('/p/empty')); // expand the empty one
    expect(stored()).toEqual(['/p/empty']);
    first.unmount();

    const second = renderHook(() => useConversations());
    expect(second.result.current.expandedWorkspaces).toEqual(['/p/empty']);
  });

  it('remembers collapsed sections', () => {
    const first = renderHook(() => useConversations());
    act(() => first.result.current.toggleSection('projects'));
    first.unmount();
    const second = renderHook(() => useConversations());
    expect(second.result.current.collapsedSections.has('projects')).toBe(true);
  });
});

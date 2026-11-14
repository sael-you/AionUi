/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { SidebarResponse } from '@/common/types/sidebar';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import {
  normalizeWorkspace,
  standardProjectsFromSidebar,
  workspaceFromUri,
} from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';

const t = (key: string): string => key;

const conversation = (id: string, extra: TChatConversation['extra'], modified_at = 100): TChatConversation =>
  ({ id, name: id, type: 'acp', created_at: modified_at, modified_at, extra }) as TChatConversation;

const projectGroups = (result: ReturnType<typeof buildGroupedHistory>) =>
  result.timelineSections.flatMap((s) =>
    s.items.filter((i) => i.type === 'workspace').map((i) => ({
      workspace: i.workspaceGroup!.workspace,
      count: i.workspaceGroup!.conversations.length,
    }))
  );

describe('standardProjectsFromSidebar', () => {
  it('keeps only project scopes, maps file:// URIs to paths and dedupes', () => {
    const response = {
      groups: [
        { scope: { type: 'pinned' }, items: [], has_more: false },
        { scope: { type: 'project', project_id: 'p1', name: 'airtable', workspace: 'file:///root/projects/airtable' }, items: [], has_more: false },
        { scope: { type: 'project', project_id: 'p2', name: 'my app', workspace: 'file:///root/projects/my%20app/' }, items: [], has_more: false },
        { scope: { type: 'project', project_id: 'p3', name: 'dup', workspace: 'file:///root/projects/airtable' }, items: [], has_more: false },
        { scope: { type: 'project', project_id: 'p4', name: 'no ws', workspace: null }, items: [], has_more: false },
        { scope: { type: 'chats' }, items: [], has_more: false },
      ],
      has_more_groups: false,
    } as unknown as SidebarResponse;

    expect(standardProjectsFromSidebar(response)).toEqual([
      { workspace: '/root/projects/airtable', name: 'airtable', project_id: 'p1' },
      { workspace: '/root/projects/my app', name: 'my app', project_id: 'p2' },
    ]);
    expect(standardProjectsFromSidebar(null)).toEqual([]);
  });

  it('rejects non-file, non-absolute workspaces', () => {
    expect(workspaceFromUri('https://example.com/x')).toBeNull();
    expect(workspaceFromUri('relative/path')).toBeNull();
    expect(workspaceFromUri('/root/projects/x/')).toBe('/root/projects/x');
    expect(workspaceFromUri('file://server/share/x')).toBeNull();
    expect(workspaceFromUri('file://localhost/root/projects/x')).toBe('/root/projects/x');
  });
});

describe('normalizeWorkspace', () => {
  it('treats Windows separators, drive URIs and trailing slashes as the same folder', () => {
    expect(normalizeWorkspace('C:\\Users\\me\\app\\')).toBe('C:/Users/me/app');
    expect(workspaceFromUri('file:///C:/Users/me/app')).toBe('C:/Users/me/app');
    expect(workspaceFromUri('C:\\Users\\me\\app')).toBe('C:/Users/me/app');
    expect(normalizeWorkspace('C:\\')).toBe('C:/');
    expect(normalizeWorkspace('/')).toBe('/');
  });
});

describe('buildGroupedHistory with standard projects', () => {
  it('shows a project folder even when it has no visible conversation', () => {
    const result = buildGroupedHistory([], t, [{ workspace: '/root/projects/airtable', name: 'airtable' }]);
    expect(projectGroups(result)).toEqual([{ workspace: '/root/projects/airtable', count: 0 }]);
  });

  it('does not duplicate a project that already has conversations (trailing slash ignored)', () => {
    const result = buildGroupedHistory(
      [conversation('c1', { backend: 'claude', workspace: '/root/projects/TB-test', custom_workspace: true })],
      t,
      [{ workspace: '/root/projects/TB-test/', name: 'TB-test' }]
    );
    expect(projectGroups(result)).toEqual([{ workspace: '/root/projects/TB-test', count: 1 }]);
  });

  it('keeps the folder of a project whose only conversations are pinned', () => {
    const result = buildGroupedHistory(
      [conversation('c1', { backend: 'claude', workspace: '/root/projects/clauterm', custom_workspace: true, pinned: true })],
      t,
      [{ workspace: '/root/projects/clauterm', name: 'clauterm' }]
    );
    expect(result.pinnedConversations.map((c) => c.id)).toEqual(['c1']);
    expect(projectGroups(result)).toEqual([{ workspace: '/root/projects/clauterm', count: 0 }]);
  });

  it('is unchanged when no standard projects are passed', () => {
    const result = buildGroupedHistory([conversation('c1', { backend: 'claude' })], t);
    expect(projectGroups(result)).toEqual([]);
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import {
  conversationMatchesQuery,
  filterConversations,
  filterProjectGroup,
  matchesSidebarQuery,
  normalizeSidebarQuery,
} from '@/renderer/pages/conversation/GroupedHistory/utils/sidebarFilter';

const conv = (id: string, name: string) => ({ id, name }) as TChatConversation;
const noChildren = () => undefined;

describe('sidebar name filter', () => {
  it('normalises the query (trim, case) and matches case-insensitively', () => {
    expect(normalizeSidebarQuery('  AioN ')).toBe('aion');
    expect(normalizeSidebarQuery(undefined)).toBe('');
    expect(matchesSidebarQuery('Fix AionUi sidebar', 'aionui')).toBe(true);
    expect(matchesSidebarQuery('Fix sidebar', 'aionui')).toBe(false);
    expect(matchesSidebarQuery(undefined, 'x')).toBe(false);
    expect(matchesSidebarQuery('anything', '')).toBe(true);
  });

  it('keeps a conversation whose sub-conversation matches', () => {
    const parent = conv('p', 'Release plan');
    expect(conversationMatchesQuery(parent, [conv('c', 'Changelog draft')], 'changelog')).toBe(true);
    expect(conversationMatchesQuery(parent, [conv('c', 'Changelog draft')], 'budget')).toBe(false);
  });

  it('filters a list, keeping it as is without a query', () => {
    const list = [conv('a', 'Alpha'), conv('b', 'Beta')];
    expect(filterConversations(list, '', noChildren)).toEqual(list);
    expect(filterConversations(list, 'bet', noChildren).map((c) => c.id)).toEqual(['b']);
  });

  it('keeps a whole project when its name matches, else only its matching conversations, else drops it', () => {
    const group = { displayName: 'aionui', conversations: [conv('a', 'Alpha'), conv('b', 'Beta')] };
    expect(filterProjectGroup(group, 'aion', noChildren)).toBe(group);
    expect(filterProjectGroup(group, 'alp', noChildren)?.conversations.map((c) => c.id)).toEqual(['a']);
    expect(filterProjectGroup(group, 'zzz', noChildren)).toBeNull();
  });
});

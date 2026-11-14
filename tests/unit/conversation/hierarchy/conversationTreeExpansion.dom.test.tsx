/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/common/config/storageKeys';
import {
  readExpandedConversationIds,
  useConversationTreeExpansion,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationTreeExpansion';

describe('useConversationTreeExpansion', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and tolerates corrupt storage', () => {
    expect(readExpandedConversationIds().size).toBe(0);
    localStorage.setItem(STORAGE_KEYS.CONVERSATION_TREE_EXPANSION, '{not json');
    expect(readExpandedConversationIds().size).toBe(0);
    localStorage.setItem(STORAGE_KEYS.CONVERSATION_TREE_EXPANSION, JSON.stringify(['a', 3, null]));
    expect([...readExpandedConversationIds()]).toEqual(['a']);
  });

  it('toggles, expands and persists to localStorage', () => {
    const { result, unmount } = renderHook(() => useConversationTreeExpansion());
    act(() => result.current.toggle('p1'));
    expect(result.current.isExpanded('p1')).toBe(true);
    act(() => result.current.expand(['p1', 'p2']));
    expect(result.current.isExpanded('p2')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CONVERSATION_TREE_EXPANSION) ?? '[]')).toEqual(['p1', 'p2']);
    act(() => result.current.toggle('p1'));
    expect(result.current.isExpanded('p1')).toBe(false);
    unmount();

    // A fresh mount restores the persisted state.
    const again = renderHook(() => useConversationTreeExpansion());
    expect(again.result.current.isExpanded('p2')).toBe(true);
    expect(again.result.current.isExpanded('p1')).toBe(false);
  });
});

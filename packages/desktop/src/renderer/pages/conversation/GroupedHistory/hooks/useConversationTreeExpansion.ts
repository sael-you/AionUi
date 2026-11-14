/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STORAGE_KEYS } from '@/common/config/storageKeys';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** Read the persisted set of expanded parent-conversation ids (tolerates corrupt storage). */
export const readExpandedConversationIds = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATION_TREE_EXPANSION);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
};

export const writeExpandedConversationIds = (ids: ReadonlySet<string>): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.CONVERSATION_TREE_EXPANSION, JSON.stringify([...ids]));
  } catch {
    // Persistence is best-effort.
  }
};

/**
 * Expand/collapse state of parent conversations in the sidebar tree, persisted
 * to localStorage (same approach as the workspace expansion state).
 */
export const useConversationTreeExpansion = () => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => readExpandedConversationIds());

  useEffect(() => {
    writeExpandedConversationIds(expandedIds);
  }, [expandedIds]);

  const isExpanded = useCallback((id: string) => expandedIds.has(id), [expandedIds]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Expand every id in `ids`; a no-op (same state identity) when all are already expanded. */
  const expand = useCallback((ids: readonly string[]) => {
    setExpandedIds((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  return useMemo(() => ({ expandedIds, isExpanded, toggle, expand }), [expandedIds, isExpanded, toggle, expand]);
};

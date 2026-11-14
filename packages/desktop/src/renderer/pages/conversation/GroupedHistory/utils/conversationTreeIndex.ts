/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

import { buildConversationTree, type ConversationTreeNode } from './conversationTree';

/**
 * Partition a flat conversation list into hierarchy roots and a per-root
 * descendant list. A conversation is a child only when its parent chain reaches
 * a loaded root. An orphan (parent not loaded) or a cycle member acts as its own
 * root, so it is never silently hidden. Input order is preserved for roots.
 */
export const partitionConversationHierarchy = (
  conversations: readonly TChatConversation[]
): { roots: TChatConversation[]; descendantsByRoot: Map<string, TChatConversation[]> } => {
  const byId = new Map(conversations.map((c) => [c.id, c]));

  const resolveRoot = (conversation: TChatConversation): string | null => {
    const seen = new Set<string>();
    let current: TChatConversation | undefined = conversation;
    while (current) {
      if (seen.has(current.id)) return null; // cycle: no reachable root
      seen.add(current.id);
      const parentId: string | undefined = current.parent_conversation_id;
      if (!parentId) return current.id;
      const parent = byId.get(parentId);
      if (!parent) return current.id; // parent not loaded: this orphan acts as a root
      current = parent;
    }
    return null;
  };

  const roots: TChatConversation[] = [];
  const descendantsByRoot = new Map<string, TChatConversation[]>();
  for (const conversation of conversations) {
    const rootId = resolveRoot(conversation);
    if (rootId === null || rootId === conversation.id) {
      roots.push(conversation);
      continue;
    }
    const list = descendantsByRoot.get(rootId);
    if (list) list.push(conversation);
    else descendantsByRoot.set(rootId, [conversation]);
  }
  return { roots, descendantsByRoot };
};

/** Build the tree node for every root that has descendants. */
export const buildTreesByRoot = (
  roots: readonly TChatConversation[],
  descendantsByRoot: ReadonlyMap<string, TChatConversation[]>
): Map<string, ConversationTreeNode> => {
  const trees = new Map<string, ConversationTreeNode>();
  for (const root of roots) {
    const descendants = descendantsByRoot.get(root.id);
    if (descendants && descendants.length > 0) trees.set(root.id, buildConversationTree(root, descendants));
  }
  return trees;
};

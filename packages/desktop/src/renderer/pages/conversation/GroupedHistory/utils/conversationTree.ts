/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import {
  emptyRunStateCounts,
  moreUrgent,
  type RunState,
  type RunStateCounts,
} from '@/renderer/pages/conversation/components/orchestration/runState';

/** Maximum nesting depth enforced by the backend (root = 0). */
export const MAX_CONVERSATION_DEPTH = 3;
/** Maximum direct children per parent enforced by the backend. */
export const MAX_CONVERSATION_FANOUT = 12;

export type ConversationTreeNode = {
  conversation: TChatConversation;
  /** Depth derived from the tree position (root = 0), not from the wire `depth`. */
  depth: number;
  children: ConversationTreeNode[];
};

export type ConversationTreeRollup = {
  /** Descendants only (the root itself is not counted). */
  total: number;
  /** Descendants per run state. */
  counts: RunStateCounts;
  /** Most urgent state among the descendants (`idle` when nothing happens). */
  worst: RunState;
};

/** The run state of one conversation (see `conversationRunState`). */
export type RunStateOf = (conversation: TChatConversation) => RunState;

const byCreatedAsc = (a: TChatConversation, b: TChatConversation): number =>
  (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id);

/**
 * Build a nested tree from a root and its FLAT descendant list.
 *
 * Tolerant by design: descendants whose parent is missing/unknown attach to the
 * root, duplicates and the root itself are ignored, and members of a parent
 * cycle (unreachable from the root) are re-attached to the root so the build
 * always terminates and never drops a conversation. Children are sorted by
 * `created_at` ascending.
 */
export const buildConversationTree = (
  root: TChatConversation,
  descendants: readonly TChatConversation[] = []
): ConversationTreeNode => {
  const byId = new Map<string, TChatConversation>();
  for (const conversation of descendants) {
    if (conversation.id !== root.id && !byId.has(conversation.id)) {
      byId.set(conversation.id, conversation);
    }
  }

  const childrenOf = new Map<string, TChatConversation[]>();
  const addChild = (parentId: string, child: TChatConversation) => {
    const list = childrenOf.get(parentId);
    if (list) list.push(child);
    else childrenOf.set(parentId, [child]);
  };
  for (const conversation of byId.values()) {
    const parentId = conversation.parent_conversation_id;
    const known = parentId && parentId !== conversation.id && (parentId === root.id || byId.has(parentId));
    addChild(known ? parentId : root.id, conversation);
  }

  const visited = new Set<string>([root.id]);
  const build = (conversation: TChatConversation, depth: number): ConversationTreeNode => {
    const children: ConversationTreeNode[] = [];
    for (const child of (childrenOf.get(conversation.id) ?? []).toSorted(byCreatedAsc)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      children.push(build(child, depth + 1));
    }
    return { conversation, depth, children };
  };

  const rootNode = build(root, 0);
  // Cycle members are only reachable through each other; hang the first one
  // (oldest) off the root and walk its cycle.
  for (const conversation of [...byId.values()].toSorted(byCreatedAsc)) {
    if (visited.has(conversation.id)) continue;
    visited.add(conversation.id);
    rootNode.children.push(build(conversation, 1));
  }
  return rootNode;
};

/** Visit every node of a tree depth-first (pre-order). */
export const walkConversationTree = (node: ConversationTreeNode, visit: (node: ConversationTreeNode) => void): void => {
  visit(node);
  for (const child of node.children) walkConversationTree(child, visit);
};

/** All conversation ids in the subtree below (and excluding) `node`. */
export const collectDescendantIds = (node: ConversationTreeNode): string[] => {
  const ids: string[] = [];
  for (const child of node.children) {
    walkConversationTree(child, (n) => ids.push(n.conversation.id));
  }
  return ids;
};

/** Aggregate status over the descendants of `node` (the node itself is excluded). */
export const computeConversationRollup = (
  node: ConversationTreeNode,
  stateOf: RunStateOf = () => 'idle'
): ConversationTreeRollup => {
  const counts = emptyRunStateCounts();
  let total = 0;
  let worst: RunState = 'idle';
  for (const child of node.children) {
    walkConversationTree(child, ({ conversation }) => {
      total += 1;
      const state = stateOf(conversation);
      counts[state] += 1;
      worst = moreUrgent(worst, state);
    });
  }
  return { total, counts, worst };
};

/** Deepest depth below `node`, relative to `node` (a leaf is 0). */
export const subtreeHeight = (node: ConversationTreeNode): number =>
  node.children.reduce((max, child) => Math.max(max, 1 + subtreeHeight(child)), 0);

/**
 * Ids of the ancestors of `targetId` inside the tree rooted at `root`
 * (including the root, excluding the target). Empty when the target is the
 * root or not in the tree. Used to auto-expand the branch of the active row.
 */
export const findAncestorIds = (root: ConversationTreeNode, targetId: string): string[] => {
  const path: string[] = [];
  const dfs = (node: ConversationTreeNode): boolean => {
    if (node.conversation.id === targetId) return true;
    path.push(node.conversation.id);
    for (const child of node.children) {
      if (dfs(child)) return true;
    }
    path.pop();
    return false;
  };
  return dfs(root) ? path : [];
};

/**
 * Eligible new parents for `conversation` ("Move under…"): never itself or its
 * own descendants, and the resulting subtree must stay within the depth limit.
 */
export const getEligibleParents = (
  candidates: readonly ConversationTreeNode[],
  movingNode: ConversationTreeNode
): ConversationTreeNode[] => {
  const excluded = new Set<string>([movingNode.conversation.id, ...collectDescendantIds(movingNode)]);
  const height = subtreeHeight(movingNode);
  const out: ConversationTreeNode[] = [];
  for (const candidate of candidates) {
    walkConversationTree(candidate, (n) => {
      if (excluded.has(n.conversation.id)) return;
      if (n.conversation.id === movingNode.conversation.parent_conversation_id) return;
      if (n.depth + 1 + height > MAX_CONVERSATION_DEPTH) return;
      if (n.children.length >= MAX_CONVERSATION_FANOUT) return;
      out.push(n);
    });
  }
  return out;
};

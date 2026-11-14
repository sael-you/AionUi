/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildConversationTree,
  collectDescendantIds,
  computeConversationRollup,
  findAncestorIds,
  getEligibleParents,
} from '@/renderer/pages/conversation/GroupedHistory/utils/conversationTree';
import {
  buildTreesByRoot,
  partitionConversationHierarchy,
} from '@/renderer/pages/conversation/GroupedHistory/utils/conversationTreeIndex';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

const conv = (id: string, parent?: string, created_at = 0, extra: Record<string, unknown> = {}): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at,
    modified_at: created_at,
    parent_conversation_id: parent,
    extra,
  }) as unknown as TChatConversation;

const ids = (nodes: { conversation: TChatConversation }[]) => nodes.map((n) => n.conversation.id);

describe('buildConversationTree', () => {
  it('nests children and sorts siblings by created_at ascending', () => {
    const root = conv('r');
    const tree = buildConversationTree(root, [conv('b', 'r', 20), conv('a', 'r', 10), conv('a1', 'a', 5)]);
    expect(ids(tree.children)).toEqual(['a', 'b']);
    expect(ids(tree.children[0].children)).toEqual(['a1']);
    expect(tree.children[0].children[0].depth).toBe(2);
  });

  it('attaches orphans (unknown parent) to the root', () => {
    const tree = buildConversationTree(conv('r'), [conv('x', 'missing', 1)]);
    expect(ids(tree.children)).toEqual(['x']);
  });

  it('terminates on cycles and keeps every node exactly once', () => {
    const tree = buildConversationTree(conv('r'), [conv('a', 'b', 1), conv('b', 'a', 2), conv('s', 's', 3)]);
    const all = [...collectDescendantIds(tree)].toSorted();
    expect(all).toEqual(['a', 'b', 's']);
  });

  it('ignores duplicates and the root itself', () => {
    const tree = buildConversationTree(conv('r'), [conv('a', 'r', 1), conv('a', 'r', 2), conv('r', 'r', 3)]);
    expect(collectDescendantIds(tree)).toEqual(['a']);
  });

  it('handles an empty/undefined descendant list', () => {
    expect(buildConversationTree(conv('r')).children).toEqual([]);
  });
});

describe('rollups and lookups', () => {
  const tree = buildConversationTree(conv('r'), [conv('a', 'r', 1), conv('b', 'a', 2), conv('c', 'r', 3)]);

  it('aggregates running, pending confirmations and errors over descendants only', () => {
    const rollup = computeConversationRollup(tree, {
      isRunning: (c) => c.id === 'b' || c.id === 'r',
      pendingConfirmations: (c) => (c.id === 'c' ? 2 : 0),
      hasError: (c) => c.id === 'a',
    });
    expect(rollup).toEqual({ total: 3, running: 1, pendingConfirmations: 2, hasError: true });
  });

  it('returns a zero rollup without predicates', () => {
    expect(computeConversationRollup(tree)).toEqual({ total: 3, running: 0, pendingConfirmations: 0, hasError: false });
  });

  it('finds ancestors of the active conversation', () => {
    expect(findAncestorIds(tree, 'b')).toEqual(['r', 'a']);
    expect(findAncestorIds(tree, 'r')).toEqual([]);
    expect(findAncestorIds(tree, 'nope')).toEqual([]);
  });

  it('excludes self, descendants, current parent and depth/fan-out violations from eligible parents', () => {
    const other = buildConversationTree(conv('o'), []);
    const moving = tree.children[0]; // a (has child b → height 1)
    const eligible = ids(getEligibleParents([tree, other], moving));
    expect(eligible).toContain('o');
    expect(eligible).toContain('c');
    expect(eligible).not.toContain('a');
    expect(eligible).not.toContain('b');
    expect(eligible).not.toContain('r'); // already its parent
  });

  it('rejects parents that would exceed the depth limit', () => {
    const deep = buildConversationTree(conv('r'), [conv('d1', 'r', 1), conv('d2', 'd1', 2), conv('d3', 'd2', 3)]);
    const mover = buildConversationTree(conv('m'), [conv('m1', 'm', 1)]); // height 1
    const eligible = ids(getEligibleParents([deep], mover));
    expect(eligible).toEqual(['r', 'd1']); // d2 would put m1 at depth 4
  });
});

describe('partitionConversationHierarchy / buildGroupedHistory', () => {
  const t = (key: string) => key;

  it('is the identity when nothing has a parent', () => {
    const list = [conv('a'), conv('b')];
    const { roots, descendantsByRoot } = partitionConversationHierarchy(list);
    expect(roots).toEqual(list);
    expect(descendantsByRoot.size).toBe(0);
  });

  it('groups multi-level descendants under their root and keeps orphans/cycles visible', () => {
    const { roots, descendantsByRoot } = partitionConversationHierarchy([
      conv('r'),
      conv('c1', 'r', 1),
      conv('c2', 'c1', 2),
      conv('orphan', 'gone', 3),
      conv('orphanKid', 'orphan', 4),
      conv('x', 'y', 5),
      conv('y', 'x', 6),
    ]);
    expect(roots.map((c) => c.id)).toEqual(['r', 'orphan', 'x', 'y']);
    expect(descendantsByRoot.get('r')?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(descendantsByRoot.get('orphan')?.map((c) => c.id)).toEqual(['orphanKid']);
    expect(buildTreesByRoot(roots, descendantsByRoot).get('r')?.children[0].children).toHaveLength(1);
  });

  it('never renders children as top-level rows, pins only roots, and still hides team conversations', () => {
    const result = buildGroupedHistory(
      [
        conv('r', undefined, 10, { pinned: true }),
        conv('kid', 'r', 20, { pinned: true }),
        conv('team', undefined, 30, { team_id: 't1' }),
        conv('plain', undefined, 40),
      ],
      t
    );
    expect(result.pinnedConversations.map((c) => c.id)).toEqual(['r']);
    const top = result.timelineSections.flatMap((s) => s.items.map((i) => i.conversation?.id));
    expect(top).toEqual(['plain']);
    expect(result.descendantsByRoot.get('r')?.map((c) => c.id)).toEqual(['kid']);
  });
});

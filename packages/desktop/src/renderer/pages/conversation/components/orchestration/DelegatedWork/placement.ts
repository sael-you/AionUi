/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageToolCall } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

import {
  conversationRows,
  descendantConversations,
  taskRows,
  type ConversationLiveState,
  type DelegatedRow,
} from './delegatedWork';

/** The structural view of one timeline item the placement needs. */
export type PlacementItem = {
  /** `user` starts a turn; `activity` may launch work. */
  kind: 'user' | 'activity' | 'other';
  created_at: number;
  /** Task progress-card calls inside an activity item. */
  taskCalls: readonly IMessageToolCall[];
};

export type PlacedCard = {
  /** Index of the timeline item the card follows. */
  afterIndex: number;
  id: string;
  rows: DelegatedRow[];
};

/**
 * One delegated-work card per turn that launched something, placed where the
 * turn launched it: after the activity item holding its first task, else after
 * the last activity that started before its first child conversation, else
 * after the turn's last item. Child conversations belong to the turn they were
 * created in (nested ones ride with their top-level child).
 */
export const placeDelegatedWork = (
  items: readonly PlacementItem[],
  options: {
    conversationId: string;
    conversations: readonly TChatConversation[];
    live: ConversationLiveState;
    labels: ReadonlyMap<string, string>;
  }
): PlacedCard[] => {
  const turns: Array<{ start: number; first: number; last: number }> = [];
  items.forEach((item, index) => {
    if (item.kind === 'user' || turns.length === 0) {
      turns.push({ start: item.created_at, first: index, last: index });
    } else {
      turns[turns.length - 1].last = index;
    }
  });

  // Direct children with their subtree, grouped by the turn they were created in.
  const descendants = descendantConversations(options.conversationId, options.conversations);
  const subtrees: Array<Array<{ conversation: TChatConversation; depth: number }>> = [];
  for (const entry of descendants) {
    if (entry.depth === 0) subtrees.push([entry]);
    else subtrees[subtrees.length - 1]?.push(entry);
  }
  const turnOf = (time: number): number => {
    let found = 0;
    turns.forEach((turn, index) => {
      if (turn.start <= time) found = index;
    });
    return found;
  };

  const cards: PlacedCard[] = [];
  turns.forEach((turn, turnIndex) => {
    const nextStart = turns[turnIndex + 1]?.start ?? Number.POSITIVE_INFINITY;
    const children = subtrees.filter((tree) => {
      const created = tree[0].conversation.created_at ?? 0;
      return turns.length > 0 && turnOf(created) === turnIndex && created < nextStart;
    });
    const calls: IMessageToolCall[] = [];
    let firstTaskIndex = -1;
    for (let index = turn.first; index <= turn.last; index += 1) {
      const item = items[index];
      if (item.kind !== 'activity' || item.taskCalls.length === 0) continue;
      if (firstTaskIndex === -1) firstTaskIndex = index;
      calls.push(...item.taskCalls);
    }
    if (children.length === 0 && calls.length === 0) return;

    let afterIndex = firstTaskIndex;
    if (afterIndex === -1) {
      const firstChild = Math.min(...children.map((tree) => tree[0].conversation.created_at ?? 0));
      for (let index = turn.first; index <= turn.last; index += 1) {
        if (items[index].kind === 'activity' && items[index].created_at <= firstChild) afterIndex = index;
      }
      if (afterIndex === -1) afterIndex = turn.last;
    }
    cards.push({
      afterIndex,
      id: `delegated-work-${options.conversationId}-${turnIndex}`,
      rows: [...conversationRows(children.flat(), options.live), ...taskRows(calls, options.labels)],
    });
  });
  return cards;
};

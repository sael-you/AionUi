/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { fromApiConversation, buildCreateConversationBody } from '@/common/adapter/apiModelMapper';
import { flattenSidebarConversations, fromApiSidebar } from '@/common/adapter/sidebarMapper';
import type { TChatConversation } from '@/common/config/storage';
import type { SidebarResponse } from '@/common/types/sidebar';

const wire = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: 1,
    modified_at: 1,
    extra: { workspace: '/w' },
    ...extra,
  }) as unknown as TChatConversation;

describe('fromApiConversation hierarchy fields', () => {
  it('maps parent_conversation_id/depth and defaults depth to 0', () => {
    const child = fromApiConversation(wire('c', { parent_conversation_id: 'p', depth: 2 }));
    expect(child.parent_conversation_id).toBe('p');
    expect(child.depth).toBe(2);
    const root = fromApiConversation(wire('r', { parent_conversation_id: null, depth: 0 }));
    expect(root.parent_conversation_id).toBeUndefined();
    expect(root.depth).toBe(0);
  });

  it('leaves legacy payloads without hierarchy fields untouched', () => {
    const legacy = fromApiConversation(wire('r'));
    expect('depth' in legacy).toBe(false);
    expect('parent_conversation_id' in legacy).toBe(false);
  });
});

describe('buildCreateConversationBody', () => {
  it('forwards parent_conversation_id only when set', () => {
    expect(buildCreateConversationBody({ extra: {}, parent_conversation_id: 'p' }).parent_conversation_id).toBe('p');
    expect('parent_conversation_id' in buildCreateConversationBody({ extra: {} })).toBe(false);
  });
});

describe('sidebar mapper with descendants', () => {
  const response = {
    has_more_groups: false,
    groups: [
      {
        scope: { type: 'chats' },
        has_more: false,
        items: [
          {
            type: 'conversation',
            conversation: wire('r', { pinned: true }),
            descendants: [
              wire('a', { parent_conversation_id: 'r', depth: 1 }),
              wire('b', { parent_conversation_id: 'a', depth: 2 }),
            ],
            descendant_count: 2,
            running_descendant_count: 1,
          },
          { type: 'conversation', conversation: wire('plain') },
        ],
      },
      {
        scope: { type: 'pinned' },
        has_more: false,
        // Same conversation also listed (and its descendant) in another group → must be de-duped.
        items: [
          {
            type: 'conversation',
            conversation: wire('r'),
            descendants: [wire('a', { parent_conversation_id: 'r', depth: 1 })],
          },
        ],
      },
    ],
  } as unknown as SidebarResponse;

  it('maps descendants through fromApiConversation and keeps the counts', () => {
    const mapped = fromApiSidebar(response);
    const item = mapped.groups[0].items[0];
    if (item.type !== 'conversation') throw new Error('expected conversation');
    expect(item.descendants?.map((d) => [d.id, d.parent_conversation_id, d.depth])).toEqual([
      ['a', 'r', 1],
      ['b', 'a', 2],
    ]);
    expect(item.descendants?.[0].extra).toMatchObject({ custom_workspace: true });
    expect(item.descendant_count).toBe(2);
    expect(item.running_descendant_count).toBe(1);
  });

  it('leaves items without descendants unchanged in shape', () => {
    const plain = fromApiSidebar(response).groups[0].items[1];
    expect('descendants' in plain).toBe(false);
  });

  it('flattens roots and descendants, de-duplicated, order preserved', () => {
    const flat = flattenSidebarConversations(fromApiSidebar(response));
    expect(flat.map((c) => c.id)).toEqual(['r', 'a', 'b', 'plain']);
  });
});

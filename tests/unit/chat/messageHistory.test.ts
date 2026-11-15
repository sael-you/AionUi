/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { getConversationInputHistory } from '@/renderer/utils/chat/messageHistory';

const userText = (id: string, content: string) =>
  ({
    id,
    msg_id: id,
    conversation_id: 'c1',
    type: 'text',
    position: 'right',
    content: { content },
  }) as unknown as TMessage;

describe('getConversationInputHistory', () => {
  it('recalls a spoken message (C26) as its transcript, never with the [[AION_VOICE]] block', () => {
    const history = getConversationInputHistory(
      [userText('m1', 'typed one'), userText('m2', 'spoken one\n\n[[AION_VOICE]]\nfor the agent\n[[/AION_VOICE]]')],
      'c1'
    );
    expect(history).toEqual(['spoken one', 'typed one']);
  });
});

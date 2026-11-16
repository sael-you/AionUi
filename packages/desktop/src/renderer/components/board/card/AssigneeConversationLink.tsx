/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A card assigned to a conversation (TASK-116, assignee_kind `conversation`) links
 * to it. The server leaves `assignee_name` empty, so the name comes from the
 * conversation itself (shared `conversation/<id>` cache), else a short id; a
 * conversation that no longer exists reads as plain text. Clicks do not reach the
 * card tile underneath (which opens the drawer).
 */

import { Button } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import type { BoardCardSummary } from '@/common/types/board';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

import { assigneeConversationName } from '../utils/boardFormat';

/** True when the card's assignee is a conversation with an id to open. */
export const hasAssigneeConversation = (card: Pick<BoardCardSummary, 'assignee_kind' | 'assignee_ref'>): boolean =>
  card.assignee_kind === 'conversation' && Boolean(card.assignee_ref);

export const AssigneeConversationLink: React.FC<{
  card: Pick<BoardCardSummary, 'assignee_kind' | 'assignee_ref' | 'assignee_name'>;
  size?: 'mini' | 'small';
}> = ({ card, size = 'mini' }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversationId = hasAssigneeConversation(card) ? (card.assignee_ref ?? '') : '';
  const { data: conversation } = useSWR(conversationId ? `conversation/${conversationId}` : null, () =>
    getConversationOrNull(conversationId)
  );
  if (!conversationId) return null;
  const name = assigneeConversationName({ ...card, assignee_name: card.assignee_name || conversation?.name }, t);
  if (conversation === null) {
    // Deleted (404): nothing to open.
    return (
      <span className='text-12px text-t-secondary truncate' data-testid='board-assignee-conversation-gone'>
        {name}
      </span>
    );
  }
  return (
    <Button
      type='text'
      size={size}
      className='!px-0 !h-auto max-w-full min-w-0 text-left'
      icon={<Communication theme='outline' size='12' fill='currentColor' aria-hidden />}
      aria-label={t('board.card.openAssigneeConversation', { name })}
      data-testid='board-assignee-conversation'
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void navigate(`/conversation/${encodeURIComponent(card.assignee_ref ?? '')}`);
      }}
    >
      <span className='truncate'>{name}</span>
    </Button>
  );
};

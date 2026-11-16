/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A card assigned to a conversation (TASK-116, assignee_kind `conversation`) links
 * to it: the conversation's name (or short id) opens the conversation. Clicks do
 * not reach the card tile underneath (which opens the drawer).
 */

import { Button } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { BoardCardSummary } from '@/common/types/board';

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
  if (!hasAssigneeConversation(card)) return null;
  const name = assigneeConversationName(card, t);
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

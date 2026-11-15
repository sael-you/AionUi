/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag, Tooltip } from '@arco-design/web-react';
import { ViewGridDetail } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** The Board Keeper conversation is marked by the server with `extra.board_keeper: true` (D40). */
export const isBoardKeeperConversation = (conversation: { extra?: unknown } | null | undefined): boolean =>
  Boolean((conversation?.extra as { board_keeper?: unknown } | undefined)?.board_keeper === true);

/**
 * "Board Keeper" badge for the project's keeper conversation: a labelled tag in
 * the conversation header, an icon with tooltip (and screen-reader text) in the
 * sidebar row.
 */
export const BoardKeeperBadge: React.FC<{
  conversation: { extra?: unknown } | null | undefined;
  compact?: boolean;
}> = ({ conversation, compact }) => {
  const { t } = useTranslation();
  if (!isBoardKeeperConversation(conversation)) return null;
  const label = t('board.keeper.badge');
  if (compact) {
    return (
      <Tooltip content={label} position='top'>
        <span className='flex-shrink-0 line-height-0 text-t-tertiary' data-testid='board-keeper-badge'>
          <ViewGridDetail theme='outline' size='12' fill='currentColor' aria-hidden />
          <span className='sr-only'>{label}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tag
      size='small'
      color='arcoblue'
      icon={<ViewGridDetail theme='outline' size='11' fill='currentColor' aria-hidden />}
      data-testid='board-keeper-badge'
    >
      {label}
    </Tag>
  );
};

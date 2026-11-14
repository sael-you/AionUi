/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Lock } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';

import { needsDecisionCount } from '../utils/boardModel';

/**
 * What kind of column this is, in words and icons (never colour alone): a gate
 * (lock + how many cards wait for the owner's decision) or a final column
 * (completed / dropped).
 */
export const ColumnMarks: React.FC<{ column: BoardColumn; cards: BoardCardSummary[] }> = ({ column, cards }) => {
  const { t } = useTranslation();
  if (column.kind === 'gate') {
    const waiting = needsDecisionCount(cards, column.key);
    return (
      <span className='flex items-center gap-4px' data-column-kind='gate'>
        <span className='flex items-center gap-2px text-12px text-t-secondary'>
          <Lock theme='outline' size='12' fill='currentColor' aria-hidden />
          {t('board.column.gate')}
        </span>
        {waiting > 0 && (
          <Tag size='small' color='orange' data-testid='board-needs-decision'>
            {t('board.column.needsDecision', { count: waiting })}
          </Tag>
        )}
      </span>
    );
  }
  if (column.kind === 'terminal') {
    const dropped = column.resolution === 'dropped';
    const Icon = dropped ? CloseOne : CheckOne;
    return (
      <span className='flex items-center gap-2px text-12px text-t-secondary' data-column-kind='terminal'>
        <Icon theme='outline' size='12' fill='currentColor' aria-hidden />
        {t(dropped ? 'board.column.terminalDropped' : 'board.column.terminalCompleted')}
      </span>
    );
  }
  return null;
};

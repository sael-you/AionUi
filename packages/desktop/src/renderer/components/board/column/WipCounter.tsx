/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import { Caution } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardColumn } from '@/common/types/board';

import { wipState } from '../utils/boardModel';

/**
 * Column card count with its WIP limit (`3/4`). A full or over-limit column adds
 * an icon and a word — the state is never conveyed by colour alone.
 */
export const WipCounter: React.FC<{ column: BoardColumn; count: number }> = ({ column, count }) => {
  const { t } = useTranslation();
  const state = wipState(column, count);
  if (state === 'none') {
    return (
      <span className='text-12px text-t-secondary tabular-nums' aria-label={t('board.cardCount', { count })}>
        {count}
      </span>
    );
  }
  const limit = column.wip_limit ?? 0;
  const label = t('board.wip.counterLabel', { count, limit });
  if (state === 'ok') {
    return (
      <span className='text-12px text-t-secondary tabular-nums' aria-label={label} data-wip-state={state}>
        {count}/{limit}
      </span>
    );
  }
  const word = t(state === 'full' ? 'board.wip.full' : 'board.wip.over');
  return (
    <Tag
      size='small'
      color={state === 'full' ? 'orange' : 'red'}
      icon={<Caution theme='outline' size='12' fill='currentColor' aria-hidden />}
      aria-label={`${label}, ${word}`}
      data-wip-state={state}
    >
      <span className='tabular-nums'>
        {count}/{limit}
      </span>{' '}
      {word}
    </Tag>
  );
};

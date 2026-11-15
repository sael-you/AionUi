/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary } from '@/common/types/board';
import { formatNumber } from '@/renderer/services/i18n/format';
import { formatRelativeTime } from '@/renderer/utils/chat/relativeTime';

import { formatBoardTime } from '../utils/boardFormat';
import { cardProgress } from '../utils/cardProgress';

/**
 * The Board Butler's progress on a card (C22): a slim bar with the percentage,
 * the one-line status note and the age of the last update. Renders nothing when
 * the card carries no progress. The fill follows the project colour (the board
 * and the Tasks tab set `--project-accent`); a stale update in an active column
 * (building, local test) switches the fill and the age to the warning colour.
 */
export const CardProgressBar: React.FC<{
  card: Pick<BoardCardSummary, 'column_key' | 'metadata'>;
  /** `tile`: compact, note on one truncated line. `drawer`: labelled, note wraps. */
  variant?: 'tile' | 'drawer';
  /** Injectable clock, for tests. */
  nowMs?: number;
}> = ({ card, variant = 'tile', nowMs }) => {
  const { t, i18n } = useTranslation();
  const progress = cardProgress(card, nowMs);
  if (!progress) return null;
  const { value, note, updatedAt, stale } = progress;
  const percent = formatNumber(value / 100, i18n.language, { style: 'percent', maximumFractionDigits: 0 });
  const drawer = variant === 'drawer';
  const age =
    updatedAt !== null
      ? t('board.progress.updated', { age: formatRelativeTime(updatedAt, i18n.language, nowMs) })
      : null;

  return (
    <div
      className={classNames('flex flex-col min-w-0', drawer ? 'gap-6px' : 'gap-4px')}
      data-board-progress={value}
      data-stale={stale || undefined}
    >
      {drawer && <span className='text-12px text-t-secondary'>{t('board.progress.label')}</span>}
      <div className='flex items-center gap-6px min-w-0'>
        <div
          role='progressbar'
          aria-label={t('board.progress.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={percent}
          className={classNames('flex-1 min-w-0 overflow-hidden bg-fill-3', drawer ? 'h-6px rd-3px' : 'h-4px rd-2px')}
        >
          <div
            className={classNames('h-full', drawer ? 'rd-3px' : 'rd-2px')}
            style={{
              width: `${value}%`,
              backgroundColor: stale ? 'var(--warning)' : 'var(--project-accent, var(--primary))',
            }}
          />
        </div>
        <span
          className={classNames('shrink-0 tabular-nums text-t-secondary', drawer ? 'text-13px' : 'text-11px')}
          aria-hidden
        >
          {percent}
        </span>
      </div>
      {(note || age) && (
        <div
          className={classNames(
            'flex min-w-0 gap-6px text-t-secondary',
            drawer ? 'flex-col text-13px' : 'items-center text-11px'
          )}
        >
          {note && (
            <span
              className={classNames('min-w-0', drawer ? 'break-words text-t-primary' : 'truncate flex-1')}
              title={note}
            >
              {note}
            </span>
          )}
          {age && (
            <span
              className={classNames(
                'shrink-0 inline-flex items-center gap-4px',
                stale && 'text-warning font-medium',
                !note && !drawer && 'ms-auto'
              )}
              title={updatedAt !== null ? formatBoardTime(updatedAt, i18n.language) : undefined}
            >
              {stale && <Attention theme='outline' size={drawer ? 13 : 11} fill='currentColor' aria-hidden />}
              {age}
              {stale && <span className='sr-only'> {t('board.progress.stale')}</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

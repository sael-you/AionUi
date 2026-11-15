/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag } from '@arco-design/web-react';
import { Inbox, Lock, Time } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardPriority } from '@/common/types/board';

import { assigneeLabel } from '../utils/boardFormat';
import { cardRef } from '../utils/boardModel';

const PRIORITY_COLOR: Record<BoardPriority, string> = {
  low: 'gray',
  medium: 'arcoblue',
  high: 'orange',
  urgent: 'red',
};

/** Labels shown on the tile before collapsing the rest into `+N`. */
const MAX_TILE_LABELS = 3;

export type BoardCardTileProps = {
  card: BoardCardSummary;
  onOpen: (cardId: string) => void;
  /** Drag handle (board page, wide layouts) rendered before the reference. */
  dragHandle?: React.ReactNode;
  /** Card actions (Move to…) rendered at the end of the first row. */
  actions?: React.ReactNode;
  /** Presentation inside the drag overlay: no interactive children. */
  overlay?: boolean;
  /** The source tile while its card is being dragged. */
  dragging?: boolean;
};

/**
 * One card on the board. The whole tile opens the drawer on click; the title is
 * the keyboard target (an Arco button named "Open TASK-N: title"), so the drag
 * handle and the actions menu stay separate controls instead of being nested.
 */
export const BoardCardTile: React.FC<BoardCardTileProps> = ({
  card,
  onOpen,
  dragHandle,
  actions,
  overlay,
  dragging,
}) => {
  const { t } = useTranslation();
  const ref = cardRef(card.number);
  const labels = card.labels.slice(0, MAX_TILE_LABELS);
  const hiddenLabels = card.labels.length - labels.length;
  const open = () => onOpen(card.id);

  return (
    <div
      data-board-card={card.id}
      className={classNames(
        'rd-8px border border-solid border-[color:var(--border-base)] bg-base p-8px flex flex-col gap-6px cursor-pointer min-w-0',
        'hover:border-[color:var(--border-light)]',
        card.archived_at && 'opacity-60',
        dragging && 'opacity-40',
        overlay && 'shadow-lg cursor-grabbing'
      )}
      onClick={overlay ? undefined : open}
    >
      <div className='flex items-center gap-6px min-w-0'>
        {dragHandle}
        <span className='text-12px text-t-secondary tabular-nums shrink-0'>{ref}</span>
        <Tag size='small' className='shrink-0'>
          {t(`board.type.${card.type}`)}
        </Tag>
        <Tag size='small' color={PRIORITY_COLOR[card.priority]} className='shrink-0'>
          {t(`board.priority.${card.priority}`)}
        </Tag>
        {actions && (
          <span className='ms-auto shrink-0 flex items-center' onClick={(event) => event.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {overlay ? (
        <span className='text-13px leading-18px text-t-primary font-medium break-words line-clamp-3'>{card.title}</span>
      ) : (
        <Button
          type='text'
          long
          data-board-card-open={card.id}
          aria-label={t('board.card.open', { ref, title: card.title })}
          className='!h-auto !p-0 !bg-transparent !text-start !justify-start !whitespace-normal !text-13px !leading-18px !text-t-primary !font-medium'
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          <span className='break-words line-clamp-3'>{card.title}</span>
        </Button>
      )}
      {(labels.length > 0 ||
        card.blocked ||
        card.needs_decision ||
        card.open_dependency_count > 0 ||
        card.archived_at) && (
        <div className='flex flex-wrap items-center gap-4px'>
          {card.needs_decision && (
            <Tag size='small' color='orange' icon={<Lock theme='outline' size='11' fill='currentColor' aria-hidden />}>
              {t('board.card.needsDecision')}
            </Tag>
          )}
          {card.blocked && (
            <Tag
              size='small'
              color='red'
              icon={<Lock theme='outline' size='11' fill='currentColor' aria-hidden />}
              title={card.blocked_reason ?? undefined}
            >
              {t('board.card.blocked')}
            </Tag>
          )}
          {card.open_dependency_count > 0 && (
            <Tag
              size='small'
              color='orangered'
              icon={<Time theme='outline' size='11' fill='currentColor' aria-hidden />}
            >
              {t('board.card.waitingOn', { count: card.open_dependency_count })}
            </Tag>
          )}
          {card.archived_at && (
            <Tag size='small' icon={<Inbox theme='outline' size='11' fill='currentColor' aria-hidden />}>
              {t('board.card.archived')}
            </Tag>
          )}
          {labels.map((label) => (
            <Tag key={label} size='small' color='gray' className='max-w-140px'>
              <span className='truncate inline-block max-w-120px align-bottom'>{label}</span>
            </Tag>
          ))}
          {hiddenLabels > 0 && <span className='text-11px text-t-secondary'>+{hiddenLabels}</span>}
        </div>
      )}
      <div className='text-12px text-t-secondary truncate'>{assigneeLabel(card, t)}</div>
    </div>
  );
};

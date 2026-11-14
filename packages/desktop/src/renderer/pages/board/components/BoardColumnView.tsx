/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';
import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import { QuickAddCard } from '@/renderer/components/board/QuickAddCard';
import { WipCounter } from '@/renderer/components/board/WipCounter';
import { columnName } from '@/renderer/components/board/utils/boardFormat';
import type { DropSlot } from '@/renderer/components/board/utils/boardModel';

import { COLUMN_DND_PREFIX } from '../utils/boardKeyboard';
import { DraggableCard, DropIndicator, type ColumnDndData } from './DraggableCard';

/** Columns longer than this render through a virtual list (SPEC §8). */
export const VIRTUALIZE_THRESHOLD = 100;

export const BoardColumnView: React.FC<{
  board: BoardController;
  column: BoardColumn;
  /** Cards shown (filters applied), in board order. */
  cards: BoardCardSummary[];
  /** Active cards in the column regardless of filters (the WIP count). */
  count: number;
  dragEnabled: boolean;
  activeCardId: string | null;
  dropSlot: DropSlot | null;
  onOpenCard: (cardId: string) => void;
}> = ({ board, column, cards, count, dragEnabled, activeCardId, dropSlot, onOpenCard }) => {
  const { t } = useTranslation();
  const name = columnName(column, t);
  const data: ColumnDndData = { type: 'column', columnKey: column.key };
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_DND_PREFIX}${column.key}`, data });
  const slotHere = dropSlot?.columnKey === column.key ? dropSlot : null;

  const renderCard = (card: BoardCardSummary) => (
    <DraggableCard
      key={card.id}
      board={board}
      card={card}
      dragEnabled={dragEnabled}
      dragging={card.id === activeCardId}
      indicatorBefore={slotHere?.beforeId === card.id}
      onOpen={onOpenCard}
    />
  );

  const virtualized = cards.length > VIRTUALIZE_THRESHOLD;

  return (
    <section
      aria-label={t('board.column.region', { column: name, count })}
      data-board-column={column.key}
      className={classNames(
        'w-280px shrink-0 flex flex-col max-h-full min-h-0 rd-8px bg-2 border border-solid',
        slotHere || isOver ? 'border-primary' : 'border-transparent'
      )}
    >
      <div className='flex items-center gap-8px px-12px pt-10px pb-6px'>
        <h2 className='m-0 text-14px font-medium text-t-primary truncate flex-1'>{name}</h2>
        <WipCounter column={column} count={count} />
      </div>
      <div
        ref={setNodeRef}
        className='flex-1 min-h-48px flex flex-col gap-8px px-8px pb-8px overflow-y-auto'
        data-virtualized={virtualized ? 'true' : undefined}
      >
        {cards.length === 0 && !slotHere && (
          <p className='m-0 text-12px text-t-secondary text-center py-12px'>{t('board.states.emptyColumn')}</p>
        )}
        {virtualized ? (
          <Virtuoso
            className='flex-1 min-h-200px'
            data={cards}
            computeItemKey={(_index, card) => card.id}
            itemContent={(_index, card) => <div className='pb-8px'>{renderCard(card)}</div>}
          />
        ) : (
          cards.map(renderCard)
        )}
        {slotHere && slotHere.beforeId === null && <DropIndicator />}
      </div>
      <div className='px-8px pb-8px'>
        <QuickAddCard board={board} columnKey={column.key} columnLabel={name} />
      </div>
    </section>
  );
};

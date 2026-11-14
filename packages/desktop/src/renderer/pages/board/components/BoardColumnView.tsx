/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';
import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import { QuickAddCard } from '@/renderer/components/board/column/QuickAddCard';
import { CardList } from '@/renderer/components/board/column/CardList';
import { ColumnMarks } from '@/renderer/components/board/column/ColumnMarks';
import { WipCounter } from '@/renderer/components/board/column/WipCounter';
import { columnName } from '@/renderer/components/board/utils/boardFormat';
import { isManualMoveTarget, moveLock, type DropSlot } from '@/renderer/components/board/utils/boardModel';

import { COLUMN_DND_PREFIX } from '../utils/boardKeyboard';
import { DraggableCard, DropIndicator, type ColumnDndData } from './DraggableCard';

export const BoardColumnView: React.FC<{
  board: BoardController;
  column: BoardColumn;
  /** Cards shown (filters applied), in board order. */
  cards: BoardCardSummary[];
  /** Active cards in the column regardless of filters (the WIP count). */
  count: number;
  /** Every card of the board (gate "needs your decision" count). */
  allCards: BoardCardSummary[];
  dragEnabled: boolean;
  activeCardId: string | null;
  dropSlot: DropSlot | null;
  onOpenCard: (cardId: string) => void;
}> = ({ board, column, cards, count, allCards, dragEnabled, activeCardId, dropSlot, onOpenCard }) => {
  const { t } = useTranslation();
  const name = columnName(column, t);
  const data: ColumnDndData = { type: 'column', columnKey: column.key };
  // Deploying is never a manual destination: neither the column nor its cards accept a drop.
  const dropEnabled = isManualMoveTarget(column);
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_DND_PREFIX}${column.key}`,
    data,
    disabled: !dropEnabled,
  });
  const slotHere = dropSlot?.columnKey === column.key ? dropSlot : null;

  const renderCard = (card: BoardCardSummary) => (
    <DraggableCard
      key={card.id}
      board={board}
      card={card}
      dragEnabled={dragEnabled && !moveLock(card, column)}
      dragging={card.id === activeCardId}
      dropEnabled={dropEnabled}
      indicatorBefore={slotHere?.beforeId === card.id}
      onOpen={onOpenCard}
    />
  );

  return (
    <section
      aria-label={t('board.column.region', { column: name, count })}
      data-board-column={column.key}
      className={classNames(
        'w-280px shrink-0 flex flex-col max-h-full min-h-0 rd-8px bg-2 border border-solid',
        slotHere || isOver ? 'border-primary' : 'border-transparent'
      )}
    >
      <div className='flex flex-col gap-2px px-12px pt-10px pb-6px'>
        <div className='flex items-center gap-8px'>
          <h2 className='m-0 text-14px font-medium text-t-primary truncate flex-1'>{name}</h2>
          <WipCounter column={column} count={count} />
        </div>
        <ColumnMarks column={column} cards={allCards} />
      </div>
      <div ref={setNodeRef} className='flex-1 min-h-48px flex flex-col gap-8px px-8px pb-8px overflow-y-auto'>
        {cards.length === 0 && !slotHere && (
          <p className='m-0 text-12px text-t-secondary text-center py-12px'>{t('board.states.emptyColumn')}</p>
        )}
        <CardList cards={cards} renderCard={renderCard} />
        {slotHere && slotHere.beforeId === null && <DropIndicator />}
      </div>
      <div className='px-8px pb-8px'>
        <QuickAddCard board={board} columnKey={column.key} columnLabel={name} />
      </div>
    </section>
  );
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Drag } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary } from '@/common/types/board';
import { BoardCardTile } from '@/renderer/components/board/card/BoardCardTile';
import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import { MoveToMenu } from '@/renderer/components/board/card/MoveToMenu';
import { cardRef } from '@/renderer/components/board/utils/boardModel';

import { CARD_DND_PREFIX } from '../utils/boardKeyboard';

export type CardDndData = { type: 'card'; cardId: string; columnKey: string };
export type ColumnDndData = { type: 'column'; columnKey: string };

/** Insertion marker shown where the dragged card will land. */
export const DropIndicator: React.FC = () => (
  <div aria-hidden className='h-2px rd-full bg-primary my-[-1px]' data-testid='board-drop-indicator' />
);

/**
 * A board card that can be dragged by its handle (mouse, touch after a 250 ms
 * press, or keyboard: Space/Enter on the handle) and that is also a drop target
 * ("insert before / after this card").
 */
export const DraggableCard: React.FC<{
  board: BoardController;
  card: BoardCardSummary;
  dragEnabled: boolean;
  dragging: boolean;
  indicatorBefore: boolean;
  onOpen: (cardId: string) => void;
}> = ({ board, card, dragEnabled, dragging, indicatorBefore, onOpen }) => {
  const { t } = useTranslation();
  const id = `${CARD_DND_PREFIX}${card.id}`;
  const data: CardDndData = { type: 'card', cardId: card.id, columnKey: card.column_key };
  const disabled = !dragEnabled || Boolean(card.archived_at);
  const draggable = useDraggable({
    id,
    data,
    disabled,
    attributes: { roleDescription: t('board.dnd.roleDescription') },
  });
  const droppable = useDroppable({ id, data });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    // The setters are stable for a given id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draggable.setNodeRef, droppable.setNodeRef]
  );

  const handle = disabled ? null : (
    <Button
      ref={draggable.setActivatorNodeRef}
      type='text'
      size='mini'
      {...draggable.attributes}
      {...draggable.listeners}
      aria-label={t('board.card.dragHandle', { ref: cardRef(card.number) })}
      data-board-handle={card.id}
      icon={<Drag theme='outline' size='12' fill='currentColor' aria-hidden />}
      className='!flex !items-center !justify-center !p-0 !size-18px !min-w-0 !rd-4px !text-t-secondary hover:!text-t-primary cursor-grab touch-none shrink-0'
      onClick={(event) => event.stopPropagation()}
    />
  );

  return (
    <div ref={setNodeRef} className='flex flex-col gap-4px' data-board-card-slot={card.id}>
      {indicatorBefore && <DropIndicator />}
      <BoardCardTile
        card={card}
        onOpen={onOpen}
        dragHandle={handle}
        dragging={dragging}
        actions={<MoveToMenu board={board} card={card} />}
      />
    </div>
  );
};

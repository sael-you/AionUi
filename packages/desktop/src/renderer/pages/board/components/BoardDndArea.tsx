/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wide board: columns side by side with drag and drop between them.
 *
 * Sensors (SPEC §8): mouse after 5 px, touch after a 250 ms press (5 px
 * tolerance), keyboard on the card's handle. Keyboard moves are logical
 * ({@link nextSlot}): the getter picks the next slot, and the collision
 * detection reports exactly that slot as "over", so keyboard drags work the same
 * with any geometry (and in right-to-left layouts, where ←/→ are mirrored).
 * Announcements and instructions are translated; focus returns to the moved
 * card's handle after a keyboard drop.
 */

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Over,
} from '@dnd-kit/core';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';
import { BoardCardTile } from '@/renderer/components/board/card/BoardCardTile';
import { useBoardRef } from '@/renderer/components/board/hooks/boardContext';
import { columnNameByKey } from '@/renderer/components/board/utils/boardFormat';
import {
  activeCardCount,
  anchorForSlot,
  cardRef,
  groupColumnsByCategory,
  isManualMoveTarget,
  type DropSlot,
} from '@/renderer/components/board/utils/boardModel';
import { directionForLanguage } from '@/renderer/services/i18n/direction';

import {
  CARD_DND_PREFIX,
  initialSlot,
  keyboardMove,
  nextSlot,
  sameSlot,
  slotDroppableId,
  slotPosition,
  type KeyboardLayout,
} from '../utils/boardKeyboard';
import { BoardColumnView } from './BoardColumnView';
import type { CardDndData, ColumnDndData } from './DraggableCard';

type DndData = CardDndData | ColumnDndData;

const cardIdOf = (active: Active | null): string | null =>
  active && String(active.id).startsWith(CARD_DND_PREFIX) ? String(active.id).slice(CARD_DND_PREFIX.length) : null;

const focusHandle = (cardId: string): void => {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-board-handle="${CSS.escape(cardId)}"]`)?.focus();
  });
};

export const BoardDndArea: React.FC<{
  /** All cards of the board (stable between hints that do not change cards). */
  cards: BoardCardSummary[];
  readOnly: boolean;
  columns: BoardColumn[];
  /** Visible (filtered) cards per column, in board order. */
  groups: Record<string, BoardCardSummary[]>;
  dragEnabled: boolean;
  reducedMotion: boolean;
  onOpenCard: (cardId: string) => void;
}> = React.memo(({ cards, readOnly, columns, groups, dragEnabled, reducedMotion, onOpenCard }) => {
  const boardRef = useBoardRef();
  const { t, i18n } = useTranslation();
  const direction = directionForLanguage(i18n.language);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropSlot, setDropSlotState] = useState<DropSlot | null>(null);

  const slotRef = useRef<DropSlot | null>(null);
  /** Slot of the last drop, read by the "dropped" announcement after the state reset. */
  const droppedSlotRef = useRef<DropSlot | null>(null);
  /** False until the slot first changes after pick-up, so the initial "over" is not announced over "picked up". */
  const movedRef = useRef(false);
  const keyboardRef = useRef(false);
  const layoutRef = useRef<KeyboardLayout>({ columns: [], cards: {} });
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const setDropSlot = useCallback((slot: DropSlot | null) => {
    if (sameSlot(slot, slotRef.current)) return;
    if (slotRef.current && slot) movedRef.current = true;
    slotRef.current = slot;
    setDropSlotState(slot);
  }, []);

  /** Visible order with the moving card taken out — the positions a drop can target. */
  const buildLayout = useCallback(
    (movingId: string | null): KeyboardLayout => ({
      // Keyboard moves skip columns that are not manual destinations (Deploying).
      columns: columns.filter(isManualMoveTarget).map((column) => column.key),
      cards: Object.fromEntries(
        columns.map((column) => [
          column.key,
          (groups[column.key] ?? []).map((card) => card.id).filter((id) => id !== movingId),
        ])
      ),
    }),
    [columns, groups]
  );

  const coordinateGetter = useCallback<KeyboardCoordinateGetter>(
    (event, { context, currentCoordinates }) => {
      const move = keyboardMove(event.code, directionRef.current);
      if (!move || !slotRef.current) return undefined;
      event.preventDefault();
      const next = nextSlot(layoutRef.current, slotRef.current, move);
      setDropSlot(next);
      const rect = context.droppableRects.get(slotDroppableId(next));
      if (rect) return { x: rect.left, y: rect.top };
      // Unmeasured target (virtualised row): still dispatch a move so "over" updates.
      const step = move === 'up' || move === 'previousColumn' ? -1 : 1;
      return move === 'up' || move === 'down'
        ? { x: currentCoordinates.x, y: currentCoordinates.y + step }
        : { x: currentCoordinates.x + step, y: currentCoordinates.y };
      // setDropSlot is stable; everything else is read through refs.
    },
    [setDropSlot]
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter, scrollBehavior: reducedMotion ? 'auto' : 'smooth' })
  );

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    if (keyboardRef.current && slotRef.current) {
      const id = slotDroppableId(slotRef.current);
      return args.droppableContainers.some((container) => container.id === id) ? [{ id }] : [];
    }
    const within = pointerWithin(args);
    const card = within.find((collision) => String(collision.id).startsWith(CARD_DND_PREFIX));
    if (card) return [card];
    if (within.length > 0) return [within[0]];
    return closestCenter(args);
  }, []);

  /** Pointer drags: the slot under the pointer (before or after the hovered card). */
  const slotFromPointer = (event: DragMoveEvent): DropSlot | null => {
    const over: Over | null = event.over;
    if (!over) return slotRef.current;
    const data = over.data.current as DndData | undefined;
    if (!data) return slotRef.current;
    if (!layoutRef.current.columns.includes(data.columnKey)) return slotRef.current;
    if (data.type === 'column') return { columnKey: data.columnKey, beforeId: null };
    const movingId = cardIdOf(event.active);
    if (data.cardId === movingId) return slotRef.current;
    const ids = layoutRef.current.cards[data.columnKey] ?? [];
    const translated = event.active.rect.current.translated;
    const below = translated ? translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2 : false;
    if (!below) return { columnKey: data.columnKey, beforeId: data.cardId };
    return { columnKey: data.columnKey, beforeId: ids[ids.indexOf(data.cardId) + 1] ?? null };
  };

  const reset = () => {
    keyboardRef.current = false;
    setActiveId(null);
    setDropSlot(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const movingId = cardIdOf(event.active);
    const card = cards.find((candidate) => candidate.id === movingId);
    if (!movingId || !card) return;
    layoutRef.current = buildLayout(movingId);
    keyboardRef.current = event.activatorEvent instanceof KeyboardEvent;
    movedRef.current = false;
    setActiveId(movingId);
    const columnIds = (groups[card.column_key] ?? []).map((candidate) => candidate.id);
    setDropSlot(initialSlot(card.column_key, columnIds, movingId));
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (keyboardRef.current) return;
    setDropSlot(slotFromPointer(event));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const movingId = cardIdOf(event.active);
    const slot = slotRef.current;
    const viaKeyboard = keyboardRef.current;
    const layout = layoutRef.current;
    droppedSlotRef.current = slot;
    reset();
    if (!movingId || !slot || !layout.columns.includes(slot.columnKey)) return;
    void boardRef.current
      ?.moveCard(movingId, slot.columnKey, anchorForSlot(slot, layout.cards[slot.columnKey] ?? []))
      .then(() => {
        if (viaKeyboard) focusHandle(movingId);
      });
  };

  const handleDragCancel = () => {
    const movingId = activeId;
    const viaKeyboard = keyboardRef.current;
    reset();
    if (movingId && viaKeyboard) focusHandle(movingId);
  };

  const describe = useCallback(
    (active: Active, slot: DropSlot | null, key: 'board.dnd.over' | 'board.dnd.dropped') => {
      const card = cards.find((candidate) => candidate.id === cardIdOf(active));
      if (!card || !slot) return undefined;
      const { position, count } = slotPosition(layoutRef.current, slot);
      return t(key, {
        ref: cardRef(card.number),
        column: columnNameByKey(columns, slot.columnKey, t),
        position,
        count,
      });
    },
    [cards, columns, t]
  );

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const card = cards.find((candidate) => candidate.id === cardIdOf(active));
        return card
          ? t('board.dnd.pickedUp', { ref: cardRef(card.number), column: columnNameByKey(columns, card.column_key, t) })
          : undefined;
      },
      onDragOver: ({ active }) => (movedRef.current ? describe(active, slotRef.current, 'board.dnd.over') : undefined),
      onDragEnd: ({ active }) => describe(active, droppedSlotRef.current, 'board.dnd.dropped'),
      onDragCancel: ({ active }) => {
        const card = cards.find((candidate) => candidate.id === cardIdOf(active));
        return card
          ? t('board.dnd.cancelled', {
              ref: cardRef(card.number),
              column: columnNameByKey(columns, card.column_key, t),
            })
          : undefined;
      },
    }),
    [cards, columns, describe, t]
  );

  const activeCard = activeId ? cards.find((card) => card.id === activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('board.dnd.instructions') },
        restoreFocus: false,
      }}
    >
      <div
        className='flex-1 min-h-0 flex gap-12px overflow-x-auto overflow-y-hidden px-16px pb-16px'
        data-board-columns
      >
        {groupColumnsByCategory(columns).map((group, index) => {
          const label = t(`board.categories.${group.category}`);
          return (
            <div
              key={`${group.category}-${index}`}
              role='group'
              aria-label={t('board.column.group', { category: label })}
              className='flex flex-col gap-6px min-h-0 shrink-0'
              data-board-category={group.category}
            >
              <span className='text-12px font-medium text-t-secondary ps-4px' aria-hidden>
                {label}
              </span>
              <div className='flex gap-12px flex-1 min-h-0'>
                {group.columns.map((column) => (
                  <BoardColumnView
                    key={column.key}
                    readOnly={readOnly}
                    column={column}
                    cards={groups[column.key] ?? []}
                    count={activeCardCount(cards, column.key)}
                    allCards={cards}
                    dragEnabled={dragEnabled}
                    activeCardId={activeId}
                    dropSlot={dropSlot}
                    onOpenCard={onOpenCard}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeCard ? <BoardCardTile card={activeCard} onOpen={() => {}} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
});

BoardDndArea.displayName = 'BoardDndArea';

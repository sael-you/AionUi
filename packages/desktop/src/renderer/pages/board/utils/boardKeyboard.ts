/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-container keyboard navigation for the board's drag and drop.
 *
 * dnd-kit's stock keyboard getter moves by geometry inside one list; the board
 * needs "next/previous position in this column" and "same position in the
 * neighbouring column", with left/right mirrored in right-to-left layouts
 * (fa-IR). The navigation is logical — computed from the visible card order,
 * not from rectangles — so it behaves the same in every layout and is testable
 * without one.
 */

import type { DropSlot } from '@/renderer/components/board/utils/boardModel';

/** Visible order the user navigates: columns left→right in reading order, cards top→bottom (active card excluded). */
export type KeyboardLayout = {
  columns: string[];
  cards: Record<string, string[]>;
};

export type KeyboardMove = 'up' | 'down' | 'previousColumn' | 'nextColumn';

export type LayoutDirection = 'ltr' | 'rtl';

/** Arrow key → logical move. In RTL the next column sits to the left. */
export const keyboardMove = (code: string, direction: LayoutDirection): KeyboardMove | null => {
  switch (code) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowRight':
      return direction === 'rtl' ? 'previousColumn' : 'nextColumn';
    case 'ArrowLeft':
      return direction === 'rtl' ? 'nextColumn' : 'previousColumn';
    default:
      return null;
  }
};

/** Where the picked-up card currently sits: before the next visible card of its column, or at the end. */
export const initialSlot = (columnKey: string, columnIdsWithActive: string[], activeId: string): DropSlot => {
  const index = columnIdsWithActive.indexOf(activeId);
  return { columnKey, beforeId: index >= 0 ? (columnIdsWithActive[index + 1] ?? null) : null };
};

/** Insertion index of a slot inside its column (0 … length). */
const slotIndex = (ids: string[], slot: DropSlot): number => {
  if (slot.beforeId === null) return ids.length;
  const index = ids.indexOf(slot.beforeId);
  return index < 0 ? ids.length : index;
};

const slotAt = (columnKey: string, ids: string[], index: number): DropSlot => ({
  columnKey,
  beforeId: index < ids.length ? ids[Math.max(0, index)] : null,
});

/** The slot one keyboard step away. Edges stay put (no wrap-around). */
export const nextSlot = (layout: KeyboardLayout, slot: DropSlot, move: KeyboardMove): DropSlot => {
  const ids = layout.cards[slot.columnKey] ?? [];
  const index = slotIndex(ids, slot);
  if (move === 'up') return index > 0 ? slotAt(slot.columnKey, ids, index - 1) : slot;
  if (move === 'down') return index < ids.length ? slotAt(slot.columnKey, ids, index + 1) : slot;
  const columnIndex = layout.columns.indexOf(slot.columnKey);
  const targetIndex = move === 'nextColumn' ? columnIndex + 1 : columnIndex - 1;
  if (columnIndex < 0 || targetIndex < 0 || targetIndex >= layout.columns.length) return slot;
  const targetKey = layout.columns[targetIndex];
  const targetIds = layout.cards[targetKey] ?? [];
  return slotAt(targetKey, targetIds, Math.min(index, targetIds.length));
};

/** 1-based position of a slot and the column length after the drop (for announcements). */
export const slotPosition = (layout: KeyboardLayout, slot: DropSlot): { position: number; count: number } => {
  const ids = layout.cards[slot.columnKey] ?? [];
  return { position: slotIndex(ids, slot) + 1, count: ids.length + 1 };
};

export const CARD_DND_PREFIX = 'card:';
export const COLUMN_DND_PREFIX = 'column:';

/** The droppable a slot points at: the card it goes before, or the column itself for "at the end". */
export const slotDroppableId = (slot: DropSlot): string =>
  slot.beforeId ? `${CARD_DND_PREFIX}${slot.beforeId}` : `${COLUMN_DND_PREFIX}${slot.columnKey}`;

export const sameSlot = (a: DropSlot | null, b: DropSlot | null): boolean =>
  a === b || (a !== null && b !== null && a.columnKey === b.columnKey && a.beforeId === b.beforeId);

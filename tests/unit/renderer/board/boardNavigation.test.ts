/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTERS,
  filterOptions,
  isFiltering,
  matchesFilters,
  UNASSIGNED,
} from '@/renderer/pages/board/utils/boardFilters';
import {
  initialSlot,
  keyboardMove,
  nextSlot,
  sameSlot,
  slotDroppableId,
  slotPosition,
  type KeyboardLayout,
} from '@/renderer/pages/board/utils/boardKeyboard';
import type { DropSlot } from '@/renderer/components/board/utils/boardModel';

import { makeCard } from './boardTestUtils';

const layout: KeyboardLayout = {
  columns: ['backlog', 'todo', 'done'],
  cards: { backlog: ['a', 'b', 'c'], todo: ['x'], done: [] },
};

describe('keyboard moves', () => {
  it('maps arrows to logical moves, mirrored in right-to-left layouts', () => {
    expect(keyboardMove('ArrowRight', 'ltr')).toBe('nextColumn');
    expect(keyboardMove('ArrowLeft', 'ltr')).toBe('previousColumn');
    expect(keyboardMove('ArrowRight', 'rtl')).toBe('previousColumn');
    expect(keyboardMove('ArrowLeft', 'rtl')).toBe('nextColumn');
    expect(keyboardMove('ArrowUp', 'rtl')).toBe('up');
    expect(keyboardMove('KeyA', 'ltr')).toBeNull();
  });

  it('starts where the picked-up card sits', () => {
    expect(initialSlot('backlog', ['a', 'b', 'c'], 'b')).toEqual({ columnKey: 'backlog', beforeId: 'c' });
    expect(initialSlot('backlog', ['a', 'b', 'c'], 'c')).toEqual({ columnKey: 'backlog', beforeId: null });
  });

  it('steps up and down through the column and stops at the edges', () => {
    const top: DropSlot = { columnKey: 'backlog', beforeId: 'a' };
    expect(nextSlot(layout, top, 'up')).toEqual(top);
    expect(nextSlot(layout, top, 'down')).toEqual({ columnKey: 'backlog', beforeId: 'b' });
    const end: DropSlot = { columnKey: 'backlog', beforeId: null };
    expect(nextSlot(layout, end, 'down')).toEqual(end);
    expect(nextSlot(layout, end, 'up')).toEqual({ columnKey: 'backlog', beforeId: 'c' });
  });

  it('keeps the position when crossing columns, clamped to the target length', () => {
    expect(nextSlot(layout, { columnKey: 'backlog', beforeId: 'a' }, 'nextColumn')).toEqual({
      columnKey: 'todo',
      beforeId: 'x',
    });
    expect(nextSlot(layout, { columnKey: 'backlog', beforeId: 'c' }, 'nextColumn')).toEqual({
      columnKey: 'todo',
      beforeId: null,
    });
    expect(nextSlot(layout, { columnKey: 'todo', beforeId: null }, 'nextColumn')).toEqual({
      columnKey: 'done',
      beforeId: null,
    });
    expect(nextSlot(layout, { columnKey: 'done', beforeId: null }, 'nextColumn')).toEqual({
      columnKey: 'done',
      beforeId: null,
    });
    expect(nextSlot(layout, { columnKey: 'backlog', beforeId: 'a' }, 'previousColumn')).toEqual({
      columnKey: 'backlog',
      beforeId: 'a',
    });
  });

  it('reports the 1-based position, the droppable id and slot equality', () => {
    expect(slotPosition(layout, { columnKey: 'backlog', beforeId: 'b' })).toEqual({ position: 2, count: 4 });
    expect(slotPosition(layout, { columnKey: 'done', beforeId: null })).toEqual({ position: 1, count: 1 });
    expect(slotDroppableId({ columnKey: 'todo', beforeId: 'x' })).toBe('card:x');
    expect(slotDroppableId({ columnKey: 'todo', beforeId: null })).toBe('column:todo');
    expect(sameSlot({ columnKey: 'a', beforeId: null }, { columnKey: 'a', beforeId: null })).toBe(true);
    expect(sameSlot({ columnKey: 'a', beforeId: null }, null)).toBe(false);
  });
});

describe('board filters', () => {
  const cards = [
    makeCard(1, 'todo', 1, { title: 'Fix login', labels: ['auth'], type: 'bug', priority: 'high' }),
    makeCard(2, 'todo', 2, { title: 'Dark mode', skills: ['css'], assignee_kind: 'team', assignee_ref: 't1' }),
    makeCard(3, 'done', 1, { title: 'Docs', open_dependency_count: 1, creator_kind: 'agent', creator_ref: 'x' }),
    makeCard(12, 'done', 2, { title: 'Ship', blocked: true, creator_kind: 'agent', creator_ref: 'x' }),
  ];
  const run = (over: Partial<typeof EMPTY_FILTERS>, userId: string | null = 'u1') =>
    cards.filter((card) => matchesFilters(card, { ...EMPTY_FILTERS, ...over }, userId)).map((card) => card.number);

  it('matches everything without filters', () => {
    expect(isFiltering(EMPTY_FILTERS)).toBe(false);
    expect(run({})).toEqual([1, 2, 3, 12]);
  });

  it('searches titles, TASK numbers and labels', () => {
    expect(run({ search: 'login' })).toEqual([1]);
    expect(run({ search: 'TASK-12' })).toEqual([12]);
    expect(run({ search: '#2' })).toEqual([2]);
    expect(run({ search: 'AUTH' })).toEqual([1]);
    expect(isFiltering({ ...EMPTY_FILTERS, search: ' x ' })).toBe(true);
  });

  it('filters by type, priority, assignee, label and skill', () => {
    expect(run({ types: ['bug'] })).toEqual([1]);
    expect(run({ priorities: ['high'] })).toEqual([1]);
    expect(run({ assignees: ['team:t1'] })).toEqual([2]);
    expect(run({ assignees: [UNASSIGNED] })).toEqual([1, 3, 12]);
    expect(run({ labels: ['auth'] })).toEqual([1]);
    expect(run({ skills: ['css'] })).toEqual([2]);
  });

  it('treats open dependencies as blocked and "mine" as created by / assigned to the user', () => {
    expect(run({ blockedOnly: true })).toEqual([3, 12]);
    expect(run({ mine: true })).toEqual([1, 2]);
    expect(run({ mine: true }, 'someone-else')).toEqual([]);
    expect(run({ mine: true }, null)).toEqual([1, 2]);
  });

  it('lists the label, skill and assignee options present on the board', () => {
    const options = filterOptions(cards);
    expect(options.labels).toEqual(['auth']);
    expect(options.skills).toEqual(['css']);
    expect(options.assignees.map((option) => option.value)).toEqual([UNASSIGNED, 'team:t1']);
  });
});

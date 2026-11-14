/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { BoardChangedEvent } from '@/common/types/board';
import {
  boardErrorKey,
  describeMissing,
  exitRuleMissing,
  isBoardUnavailableError,
} from '@/renderer/components/board/utils/boardErrors';
import { actorName, columnName, departmentName, describeEvent } from '@/renderer/components/board/utils/boardFormat';
import {
  anchorForSlot,
  applyBoardChange,
  applyOptimisticMove,
  endAnchor,
  groupCardsByColumn,
  groupColumnsByCategory,
  moveLock,
  needsDecisionCount,
  isNoopMove,
  optimisticPosition,
  POSITION_STEP,
  restoreCard,
  sanitizeTagList,
  upsertCard,
  visibleColumns,
  wipState,
  wouldExceedWip,
} from '@/renderer/components/board/utils/boardModel';

import { makeCard, makeColumn, makeEvent, makeSnapshot, flowColumns, studioColumns } from '../boardTestUtils';

/** `t` stub that echoes the key and its options, so assertions see what was asked for. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key}${JSON.stringify(options)}` : key) as unknown as TFunction;

const coded = (status: number, code: string) =>
  new BackendHttpError({ method: 'GET', path: '/x', status, body: { success: false, error: code, code } });

describe('board ordering and grouping', () => {
  it('orders cards by position, then id, and gives every visible column a list', () => {
    const cards = [
      makeCard(2, 'triage', 2048),
      makeCard(1, 'triage', 1024),
      makeCard(3, 'triage', 1024, { id: 'card-0' }),
    ];
    const groups = groupCardsByColumn(flowColumns(), cards);
    expect(groups.triage.map((card) => card.id)).toEqual(['card-0', 'card-1', 'card-2']);
    expect(groups.done).toEqual([]);
  });

  it('hides archived columns and sorts by position', () => {
    const columns = [makeColumn('b', 2), makeColumn('a', 1), makeColumn('x', 0, { archived: true })];
    expect(visibleColumns(columns).map((column) => column.key)).toEqual(['a', 'b']);
  });
});

describe('WIP', () => {
  const column = makeColumn('building', 2, { wip_limit: 2 });

  it('reports none / ok / full / over against the limit', () => {
    expect(wipState(makeColumn('triage', 1), 9)).toBe('none');
    expect(wipState(column, 1)).toBe('ok');
    expect(wipState(column, 2)).toBe('full');
    expect(wipState(column, 3)).toBe('over');
  });

  it('never counts the moving card twice and ignores archived cards', () => {
    const cards = [
      makeCard(1, 'building', 1),
      makeCard(2, 'building', 2, { archived_at: 5 }),
      makeCard(3, 'triage', 1),
    ];
    expect(wouldExceedWip(column, cards, 'card-3')).toBe(false);
    const full = [...cards, makeCard(4, 'building', 3)];
    expect(wouldExceedWip(column, full, 'card-3')).toBe(true);
    expect(wouldExceedWip(column, full, 'card-1')).toBe(false);
  });
});

describe('placement anchors', () => {
  const cards = [makeCard(1, 'triage', 1024), makeCard(2, 'triage', 2048), makeCard(3, 'triage', 3072)];

  it('anchors before the slot card, or after the last visible card at the end', () => {
    expect(anchorForSlot({ columnKey: 'triage', beforeId: 'card-2' }, ['card-1', 'card-2'])).toEqual({
      before_id: 'card-2',
    });
    expect(anchorForSlot({ columnKey: 'triage', beforeId: null }, ['card-1', 'card-2'])).toEqual({
      after_id: 'card-2',
    });
    expect(anchorForSlot({ columnKey: 'done', beforeId: null }, [])).toEqual({});
  });

  it('computes the end anchor without the moving card', () => {
    expect(endAnchor(cards, 'triage', 'card-3')).toEqual({ after_id: 'card-2' });
    expect(endAnchor(cards, 'done', 'card-1')).toEqual({});
  });

  it('places optimistically at the midpoint, head − step or tail + step', () => {
    expect(optimisticPosition(cards, 'card-9', 'triage', { before_id: 'card-2' })).toBe(1536);
    expect(optimisticPosition(cards, 'card-9', 'triage', { before_id: 'card-1' })).toBe(1024 - POSITION_STEP);
    expect(optimisticPosition(cards, 'card-9', 'triage', { after_id: 'card-1' })).toBe(1536);
    expect(optimisticPosition(cards, 'card-9', 'triage', {})).toBe(3072 + POSITION_STEP);
    expect(optimisticPosition(cards, 'card-9', 'done', {})).toBe(POSITION_STEP);
  });

  it('detects a move that leaves the card where it is', () => {
    expect(isNoopMove(cards, cards[0], 'triage', { before_id: 'card-2' })).toBe(true);
    expect(isNoopMove(cards, cards[1], 'triage', { after_id: 'card-1' })).toBe(true);
    expect(isNoopMove(cards, cards[2], 'triage', {})).toBe(true);
    expect(isNoopMove(cards, cards[0], 'triage', { after_id: 'card-2' })).toBe(false);
    expect(isNoopMove(cards, cards[0], 'done', {})).toBe(false);
  });
});

describe('optimistic move and rollback', () => {
  it('moves the card locally and restores only that card on rollback', () => {
    const before = makeSnapshot({ cards: [makeCard(1, 'ideas', 1024), makeCard(2, 'triage', 1024)] });
    const moved = applyOptimisticMove(before, 'card-1', 'triage', { before_id: 'card-2' });
    expect(moved.cards.find((card) => card.id === 'card-1')).toMatchObject({ column_key: 'triage', position: 0 });

    // A live change to another card lands while the request is in flight.
    const withOther = upsertCard(moved, makeCard(2, 'done', 50), false);
    const rolledBack = restoreCard(withOther, before.cards[0]);
    expect(rolledBack.cards.find((card) => card.id === 'card-1')).toMatchObject({ column_key: 'ideas' });
    expect(rolledBack.cards.find((card) => card.id === 'card-2')).toMatchObject({ column_key: 'done' });
  });

  it('drops archived cards from a view without archived cards', () => {
    const snapshot = makeSnapshot({ cards: [makeCard(1, 'triage', 1)] });
    expect(upsertCard(snapshot, makeCard(1, 'triage', 1, { archived_at: 9 }), false).cards).toEqual([]);
    expect(upsertCard(snapshot, makeCard(1, 'triage', 1, { archived_at: 9 }), true).cards).toHaveLength(1);
  });
});

describe('applyBoardChange (live hints)', () => {
  const snapshot = makeSnapshot({ cards: [makeCard(1, 'triage', 1)], last_seq: 10 });
  const change = (seq: number, over: Partial<BoardChangedEvent> = {}): BoardChangedEvent => ({
    user_id: 'u1',
    project_id: 'p1',
    seq,
    event: makeEvent(seq, 'card_moved'),
    ...over,
  });

  it('upserts the after-state carried by the next hint and advances the checkpoint', () => {
    const result = applyBoardChange(snapshot, change(11, { card: makeCard(1, 'done', 5) }), false);
    expect(result.reload).toBe(false);
    expect(result.next.last_seq).toBe(11);
    expect(result.next.cards[0].column_key).toBe('done');
  });

  it('ignores hints already reflected in the snapshot', () => {
    const result = applyBoardChange(snapshot, change(10, { card: makeCard(1, 'done', 5) }), false);
    expect(result).toEqual({ next: snapshot, reload: false });
  });

  it('reloads when a hint was missed (seq gap)', () => {
    expect(applyBoardChange(snapshot, change(13, { card: makeCard(1, 'done', 5) }), false).reload).toBe(true);
  });

  it('advances on card-neutral kinds and reloads on settings/columns changes', () => {
    const comment = applyBoardChange(snapshot, change(11, { event: makeEvent(11, 'commented') }), false);
    expect(comment).toMatchObject({ reload: false, next: { last_seq: 11 } });
    const columns = applyBoardChange(
      snapshot,
      change(11, { event: makeEvent(11, 'columns_updated', { card_id: null }) }),
      false
    );
    expect(columns.reload).toBe(true);
  });

  it('ignores hints of another project', () => {
    expect(applyBoardChange(snapshot, change(11, { project_id: 'other' }), false)).toEqual({
      next: snapshot,
      reload: false,
    });
  });
});

describe('tag lists', () => {
  it('trims, de-duplicates and caps labels to the server limits', () => {
    const many = Array.from({ length: 30 }, (_, index) => `l${index}`);
    expect(sanitizeTagList([' a ', 'a', '', 'x'.repeat(50)])).toEqual(['a', 'x'.repeat(40)]);
    expect(sanitizeTagList(many)).toHaveLength(20);
  });
});

describe('board error codes → i18n keys', () => {
  it.each([
    ['board_wip_limit', 'board.errors.wipLimitGeneric'],
    ['board_version_conflict', 'board.errors.versionConflict'],
    ['board_archived', 'board.errors.archived'],
    ['board_dependency_cycle', 'board.errors.dependencyCycle'],
    ['board_invalid', 'board.errors.invalid'],
    ['board_rate_limited', 'board.errors.rateLimited'],
    ['board_gate_use_decision', 'board.errors.gateUseDecision'],
    ['board_exit_rule', 'board.errors.exitRule'],
    ['board_system_forbidden', 'board.errors.forbidden'],
    ['board_assignment_in_progress', 'board.errors.busy'],
  ])('%s → %s', (code, key) => {
    expect(boardErrorKey(coded(409, code))).toBe(key);
  });

  it('maps network failures, bare 404s and unknown codes', () => {
    expect(boardErrorKey(new TypeError('Failed to fetch'))).toBe('board.errors.network');
    expect(boardErrorKey(coded(404, ''))).toBe('board.errors.notFound');
    expect(boardErrorKey(coded(500, 'something_else'))).toBe('board.errors.generic');
    expect(boardErrorKey(new Error('boom'))).toBe('board.errors.generic');
  });

  it('treats board_no_project and 404 as "no board here", other failures as errors', () => {
    expect(isBoardUnavailableError(coded(409, 'board_no_project'))).toBe(true);
    expect(isBoardUnavailableError(coded(404, 'board_not_found'))).toBe(true);
    expect(isBoardUnavailableError(coded(500, ''))).toBe(false);
    expect(isBoardUnavailableError(new TypeError('offline'))).toBe(false);
  });
});

describe('display helpers', () => {
  it('uses the custom column name, else the translated default for the key', () => {
    expect(columnName(makeColumn('triage', 0, { name: 'Next up' }), t)).toBe('Next up');
    expect(columnName(makeColumn('triage', 0), t)).toBe('board.columns.triage{"defaultValue":"triage"}');
  });

  it('names actors: the owner, the supervisor and agents by assistant id', () => {
    expect(actorName('user', 'u1', t)).toBe('board.actor.you');
    expect(actorName('system', 'supervisor', t)).toBe('board.actor.system');
    expect(actorName('agent', 'assistant:coder@claude', t)).toBe('board.actor.agent{"name":"coder"}');
    expect(actorName('agent', 'weird', t)).toBe('board.actor.agentUnknown');
  });

  it('describes moves with column names and unknown kinds generically', () => {
    const columns = flowColumns({ triage: { name: 'Next' } });
    const moved = describeEvent(makeEvent(1, 'card_moved', { payload: { from: 'triage', to: 'gone' } }), columns, t);
    expect(moved).toContain('"from":"Next"');
    expect(moved).toContain('"to":"gone"');
    expect(describeEvent(makeEvent(2, 'something_new'), columns, t)).toContain('board.activity.other');
  });
});

describe('studio flow helpers', () => {
  it('groups the studio columns by category in flow order', () => {
    const groups = groupColumnsByCategory(visibleColumns(studioColumns()));
    expect(groups.map((group) => [group.category, group.columns.length])).toEqual([
      ['backlog', 2],
      ['todo', 4],
      ['in_progress', 5],
      ['done', 4],
    ]);
  });

  it('counts only active cards waiting for a decision', () => {
    const cards = [
      makeCard(1, 'decision', 1, { needs_decision: true }),
      makeCard(2, 'decision', 2),
      makeCard(3, 'decision', 3, { needs_decision: true, archived_at: 5 }),
    ];
    expect(needsDecisionCount(cards, 'decision')).toBe(1);
  });

  it('locks a waiting gate card and every Deploying card, nothing else', () => {
    const [decision, deploying, building] = ['decision', 'deploying', 'building'].map((key) => makeColumn(key, 0));
    expect(moveLock(makeCard(1, 'decision', 1, { needs_decision: true }), decision)).toBe('decision');
    expect(moveLock(makeCard(1, 'decision', 1), decision)).toBeNull();
    expect(moveLock(makeCard(1, 'deploying', 1), deploying)).toBe('automation');
    expect(moveLock(makeCard(1, 'building', 1, { needs_decision: true }), building)).toBeNull();
    expect(moveLock(makeCard(1, 'x', 1), undefined)).toBeNull();
  });

  it('reads and words the missing exit-rule items', () => {
    const error = new BackendHttpError({
      method: 'POST',
      path: '/x',
      status: 409,
      body: { code: 'board_exit_rule', details: { missing: ['review:qa', 'open_questions', 'min_confidence', 7] } },
    });
    expect(exitRuleMissing(error)).toEqual(['review:qa', 'open_questions', 'min_confidence']);
    expect(exitRuleMissing(new Error('x'))).toEqual([]);
    const name = (key: string) => departmentName(key, t);
    expect(describeMissing('review:qa', t, name)).toBe(
      'board.errors.missing.review{"department":"board.departments.qa"}'
    );
    expect(describeMissing('question:q1', t, name)).toBe('board.errors.missing.openQuestions');
    expect(describeMissing('custom', t, name)).toBe('custom');
  });

  it('names known departments and keeps custom ones as written', () => {
    expect(departmentName('technical', t)).toBe('board.departments.technical');
    expect(departmentName('owner', t)).toBe('board.departments.owner');
    expect(departmentName('Legal', t)).toBe('Legal');
  });

  it('describes gate, review and question events', () => {
    const columns = studioColumns();
    expect(
      describeEvent(makeEvent(1, 'gate_approved', { payload: { from: 'decision', to: 'planned' } }), columns, t)
    ).toBe(
      'board.activity.gate_approved{"actor":"board.actor.you","from":"board.columns.decision{\\"defaultValue\\":\\"decision\\"}","to":"board.columns.planned{\\"defaultValue\\":\\"planned\\"}"}'
    );
    expect(
      describeEvent(makeEvent(2, 'review_updated', { payload: { department: 'qa', verdict: 'reject' } }), columns, t)
    ).toContain('"department":"board.departments.qa"');
    expect(
      describeEvent(makeEvent(3, 'question_added', { payload: { to_department: 'owner' } }), columns, t)
    ).toContain('"to":"board.departments.owner"');
  });
});

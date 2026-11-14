/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure board model: ordering, grouping, WIP, placement anchors, optimistic moves
 * and how a live `board.changed` hint is folded into the cached snapshot. No React,
 * no IO — everything here is covered by node unit tests.
 */

import {
  BOARD_LIMITS,
  DEPLOYING_COLUMN,
  type BoardCardSummary,
  type BoardChangedEvent,
  type BoardColumn,
  type BoardSnapshot,
  type MoveBoardCardRequest,
} from '@/common/types/board';

/** Gap between neighbours the server uses for new and rebalanced positions (SPEC §3 Ordering). */
export const POSITION_STEP = 1024;

/** `TASK-N` — the card's stable reference, shared with agents and chat notices. */
export const cardRef = (number: number): string => `TASK-${number}`;

/** Trim, de-duplicate and cap a labels/skills list to the server limits (R9). */
export const sanitizeTagList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim().slice(0, BOARD_LIMITS.listItemLength);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length === BOARD_LIMITS.listItems) break;
  }
  return result;
};

/** Board order: `(position, id)` ascending — the server's tie-break. */
export const compareCards = (a: BoardCardSummary, b: BoardCardSummary): number =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Active (non-archived) columns in display order. */
export const visibleColumns = (columns: BoardColumn[]): BoardColumn[] =>
  columns.filter((column) => !column.archived).toSorted((a, b) => a.position - b.position);

/** Visible columns grouped by category, in board order (a category appears once, at its first column). */
export const groupColumnsByCategory = (
  columns: BoardColumn[]
): Array<{ category: BoardColumn['category']; columns: BoardColumn[] }> => {
  const groups: Array<{ category: BoardColumn['category']; columns: BoardColumn[] }> = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.category === column.category) last.columns.push(column);
    else groups.push({ category: column.category, columns: [column] });
  }
  return groups;
};

/** Cards in a gate column that wait for the owner's decision. */
export const needsDecisionCount = (cards: BoardCardSummary[], columnKey: string): number =>
  cards.reduce((n, card) => (card.column_key === columnKey && card.needs_decision && !card.archived_at ? n + 1 : n), 0);

/**
 * Why a card cannot be moved by drag / "Move to…": it waits for the owner's
 * decision in a gate (R3), or it sits in Deploying, which only the deploy
 * automation moves. Both are released from the drawer (decision or override).
 */
export const moveLock = (card: BoardCardSummary, column: BoardColumn | undefined): 'decision' | 'automation' | null => {
  if (!column) return null;
  if (column.key === DEPLOYING_COLUMN) return 'automation';
  if (column.kind === 'gate' && card.needs_decision) return 'decision';
  return null;
};

/** Cards grouped by column key, each list in board order. Every visible column gets an entry. */
export const groupCardsByColumn = (
  columns: BoardColumn[],
  cards: BoardCardSummary[]
): Record<string, BoardCardSummary[]> => {
  const groups: Record<string, BoardCardSummary[]> = {};
  for (const column of columns) groups[column.key] = [];
  for (const card of cards) {
    (groups[card.column_key] ??= []).push(card);
  }
  for (const key of Object.keys(groups)) groups[key] = groups[key].toSorted(compareCards);
  return groups;
};

/** Cards that count against a column's WIP limit (archived cards never do). */
export const activeCardCount = (cards: BoardCardSummary[], columnKey: string): number =>
  cards.reduce((n, card) => (card.column_key === columnKey && !card.archived_at ? n + 1 : n), 0);

export type WipState = 'none' | 'ok' | 'full' | 'over';

export const wipState = (column: BoardColumn, count: number): WipState => {
  if (column.wip_limit === null || column.wip_limit === undefined) return 'none';
  if (count > column.wip_limit) return 'over';
  if (count === column.wip_limit) return 'full';
  return 'ok';
};

/**
 * Whether moving one more card into `column` hits the WIP limit. A card already in
 * the column never counts twice (a reorder inside a full column is fine).
 */
export const wouldExceedWip = (column: BoardColumn, cards: BoardCardSummary[], movingCardId: string): boolean => {
  if (column.wip_limit === null || column.wip_limit === undefined) return false;
  const others = cards.filter(
    (card) => card.column_key === column.key && !card.archived_at && card.id !== movingCardId
  );
  return others.length >= column.wip_limit;
};

/** Where a card lands: before `beforeId`, or at the end of the column when `beforeId` is null. */
export type DropSlot = { columnKey: string; beforeId: string | null };

export type MoveAnchor = Pick<MoveBoardCardRequest, 'before_id' | 'after_id'>;

/**
 * Translate a drop slot into the move request's anchor. `visibleIds` is the
 * target column as the user sees it (filters applied, moving card excluded):
 * dropping at the end anchors after the last visible card, so hidden cards keep
 * their place relative to what the user saw.
 */
export const anchorForSlot = (slot: DropSlot, visibleIds: string[]): MoveAnchor => {
  if (slot.beforeId) return { before_id: slot.beforeId };
  const last = visibleIds[visibleIds.length - 1];
  return last ? { after_id: last } : {};
};

/** Anchor for "move to the end of a column" (Move to… menu, drawer column select). */
export const endAnchor = (cards: BoardCardSummary[], columnKey: string, movingCardId: string): MoveAnchor => {
  const ordered = cards
    .filter((card) => card.column_key === columnKey && card.id !== movingCardId && !card.archived_at)
    .toSorted(compareCards);
  const last = ordered[ordered.length - 1];
  return last ? { after_id: last.id } : {};
};

/**
 * Local position for an optimistic move — the integer/fractional midpoint of the
 * neighbours, head/tail ± {@link POSITION_STEP}. Only used for display until the
 * server answers with the real (possibly renumbered) position.
 */
export const optimisticPosition = (
  cards: BoardCardSummary[],
  movingCardId: string,
  toColumn: string,
  anchor: MoveAnchor
): number => {
  const ordered = cards
    .filter((card) => card.column_key === toColumn && card.id !== movingCardId)
    .toSorted(compareCards);
  if (ordered.length === 0) return POSITION_STEP;
  if (anchor.before_id) {
    const index = ordered.findIndex((card) => card.id === anchor.before_id);
    if (index === 0) return ordered[0].position - POSITION_STEP;
    if (index > 0) return (ordered[index - 1].position + ordered[index].position) / 2;
  }
  if (anchor.after_id) {
    const index = ordered.findIndex((card) => card.id === anchor.after_id);
    if (index >= 0 && index < ordered.length - 1) return (ordered[index].position + ordered[index + 1].position) / 2;
  }
  return ordered[ordered.length - 1].position + POSITION_STEP;
};

/** True when the anchor leaves the card exactly where it already is. */
export const isNoopMove = (
  cards: BoardCardSummary[],
  card: BoardCardSummary,
  toColumn: string,
  anchor: MoveAnchor
): boolean => {
  if (card.column_key !== toColumn) return false;
  const ordered = cards.filter((other) => other.column_key === toColumn && !other.archived_at).toSorted(compareCards);
  const index = ordered.findIndex((other) => other.id === card.id);
  if (index < 0) return false;
  if (anchor.before_id) return ordered[index + 1]?.id === anchor.before_id || anchor.before_id === card.id;
  if (anchor.after_id) return ordered[index - 1]?.id === anchor.after_id || anchor.after_id === card.id;
  return index === ordered.length - 1;
};

/** Replace (or insert) one card. Archived cards are dropped unless the view includes them. */
export const upsertCard = (
  snapshot: BoardSnapshot,
  card: BoardCardSummary,
  includeArchived: boolean
): BoardSnapshot => {
  const rest = snapshot.cards.filter((existing) => existing.id !== card.id);
  const keep = includeArchived || !card.archived_at;
  return { ...snapshot, cards: keep ? [...rest, card] : rest };
};

/** Apply a move locally (optimistic UI). */
export const applyOptimisticMove = (
  snapshot: BoardSnapshot,
  cardId: string,
  toColumn: string,
  anchor: MoveAnchor
): BoardSnapshot => {
  const card = snapshot.cards.find((existing) => existing.id === cardId);
  if (!card) return snapshot;
  const position = optimisticPosition(snapshot.cards, cardId, toColumn, anchor);
  return {
    ...snapshot,
    cards: snapshot.cards.map((existing) =>
      existing.id === cardId ? { ...existing, column_key: toColumn, position } : existing
    ),
  };
};

/** Put one card back to a previous state (rollback), leaving every other change intact. */
export const restoreCard = (snapshot: BoardSnapshot, previous: BoardCardSummary): BoardSnapshot => ({
  ...snapshot,
  cards: snapshot.cards.some((card) => card.id === previous.id)
    ? snapshot.cards.map((card) => (card.id === previous.id ? previous : card))
    : [...snapshot.cards, previous],
});

/**
 * Event kinds that never change a card summary, settings or columns. A hint of
 * one of these without a `card` only advances the checkpoint.
 */
const SUMMARY_NEUTRAL_KINDS: ReadonlySet<string> = new Set([
  'commented',
  'link_added',
  'link_removed',
  'link_parent_fallback',
  'packet_send_failed',
  'deploy_job_finished',
  'review_updated',
  'question_added',
  'question_answered',
]);

export type BoardChangeResult = { next: BoardSnapshot; reload: boolean };

/**
 * Fold a `board.changed` hint into the snapshot (R8: hints, not the source of truth).
 *
 * - already seen (`seq <= last_seq`) → unchanged;
 * - a gap in `seq` (a hint was missed) → reload;
 * - the hint carries the card's after-state → upsert it;
 * - a card-neutral kind → advance the checkpoint;
 * - anything else (settings, columns, a card hint without its card) → reload.
 */
export const applyBoardChange = (
  snapshot: BoardSnapshot,
  change: BoardChangedEvent,
  includeArchived: boolean
): BoardChangeResult => {
  if (change.project_id !== snapshot.settings.project_id) return { next: snapshot, reload: false };
  if (change.seq <= snapshot.last_seq) return { next: snapshot, reload: false };
  if (change.seq > snapshot.last_seq + 1) return { next: snapshot, reload: true };
  if (change.card) {
    return { next: { ...upsertCard(snapshot, change.card, includeArchived), last_seq: change.seq }, reload: false };
  }
  if (SUMMARY_NEUTRAL_KINDS.has(change.event.kind)) {
    return { next: { ...snapshot, last_seq: change.seq }, reload: false };
  }
  return { next: snapshot, reload: true };
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Display helpers shared by the Tasks tab, the board page and the card drawer. */

import type { TFunction } from 'i18next';

import type { BoardActorKind, BoardCardSummary, BoardColumn, BoardEvent } from '@/common/types/board';
import { formatDateTime } from '@/renderer/services/i18n/format';

import { cardRef } from './boardModel';

/** Column title: the user's name, else the translated default for the column key, else the key itself. */
export const columnName = (column: Pick<BoardColumn, 'key' | 'name'> | undefined, t: TFunction): string => {
  if (!column) return '';
  if (column.name && column.name.trim()) return column.name;
  return t(`board.columns.${column.key}`, { defaultValue: column.key });
};

/** Name of a column by key, tolerant of keys that are no longer on the board. */
export const columnNameByKey = (columns: BoardColumn[], key: string, t: TFunction): string =>
  columnName(
    columns.find((column) => column.key === key),
    t
  ) || key;

/**
 * Who did something. `user` is always the owner ("You"); an agent's ref is
 * `assistant:<id>@<backend>` (SPEC §2) and shows its assistant id.
 */
export const actorName = (kind: BoardActorKind, ref: string, t: TFunction): string => {
  if (kind === 'user') return t('board.actor.you');
  if (kind === 'system') return t('board.actor.system');
  const match = /^assistant:([^@]+)/.exec(ref);
  return match ? t('board.actor.agent', { name: match[1] }) : t('board.actor.agentUnknown');
};

/** Assignee line for a card. */
export const assigneeLabel = (card: BoardCardSummary, t: TFunction): string => {
  if (!card.assignee_kind || !card.assignee_ref) return t('board.card.unassigned');
  if (card.assignee_kind === 'user') return t('board.actor.you');
  const name = card.assignee_name || card.assignee_ref;
  return card.assignee_kind === 'team' ? t('board.actor.team', { name }) : name;
};

export const formatBoardTime = (ms: number, language: string): string =>
  formatDateTime(ms, language, { dateStyle: 'medium', timeStyle: 'short' });

const payloadString = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

const payloadNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  return typeof value === 'number' ? value : null;
};

/** Reference of the other card named by a dependency event (`TASK-N` when the number is known). */
const otherCardRef = (payload: Record<string, unknown>): string => {
  const number = payloadNumber(payload, 'depends_on_number') ?? payloadNumber(payload, 'number');
  return number !== null ? cardRef(number) : payloadString(payload, 'depends_on_card_id');
};

/** One Activity line for a card event. Unknown kinds still read as a sentence. */
export const describeEvent = (event: BoardEvent, columns: BoardColumn[], t: TFunction): string => {
  const actor = actorName(event.actor_kind, event.actor_ref, t);
  const payload = event.payload ?? {};
  switch (event.kind) {
    case 'card_created':
    case 'card_updated':
    case 'card_archived':
    case 'card_restored':
    case 'commented':
    case 'link_added':
    case 'link_removed':
      return t(`board.activity.${event.kind}`, { actor });
    case 'card_moved':
      return t('board.activity.card_moved', {
        actor,
        from: columnNameByKey(columns, payloadString(payload, 'from'), t),
        to: columnNameByKey(columns, payloadString(payload, 'to'), t),
      });
    case 'dep_added':
    case 'dep_removed':
    case 'blocker_dropped':
      return t(`board.activity.${event.kind}`, { actor, ref: otherCardRef(payload) });
    case 'card_renumbered': {
      const from = payloadNumber(payload, 'old');
      const to = payloadNumber(payload, 'new');
      return t('board.activity.card_renumbered', {
        from: from !== null ? cardRef(from) : '',
        to: to !== null ? cardRef(to) : '',
      });
    }
    default:
      return t('board.activity.other', { actor, kind: event.kind });
  }
};

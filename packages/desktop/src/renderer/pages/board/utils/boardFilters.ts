/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Board page filters (SPEC §8 filter bar). Pure — the page keeps the state. */

import type { BoardCardSummary, BoardCardType, BoardPriority } from '@/common/types/board';

/** Assignee filter value for cards without an assignee. */
export const UNASSIGNED = '__unassigned__';

export type BoardFilters = {
  search: string;
  types: BoardCardType[];
  priorities: BoardPriority[];
  /** `UNASSIGNED` or `<assignee_kind>:<assignee_ref>`. */
  assignees: string[];
  labels: string[];
  skills: string[];
  /** Manually blocked or waiting on an open dependency (R5). */
  blockedOnly: boolean;
  /** Created by or assigned to the current user. */
  mine: boolean;
};

export const EMPTY_FILTERS: BoardFilters = {
  search: '',
  types: [],
  priorities: [],
  assignees: [],
  labels: [],
  skills: [],
  blockedOnly: false,
  mine: false,
};

export const isFiltering = (filters: BoardFilters): boolean =>
  filters.search.trim() !== '' ||
  filters.types.length > 0 ||
  filters.priorities.length > 0 ||
  filters.assignees.length > 0 ||
  filters.labels.length > 0 ||
  filters.skills.length > 0 ||
  filters.blockedOnly ||
  filters.mine;

export const assigneeValue = (card: BoardCardSummary): string =>
  card.assignee_kind && card.assignee_ref ? `${card.assignee_kind}:${card.assignee_ref}` : UNASSIGNED;

export const isBlocked = (card: BoardCardSummary): boolean => card.blocked || card.open_dependency_count > 0;

/**
 * "Mine": the current user created it or it is assigned to them. Without a known
 * user id (local mode) every user-created / user-assigned card is the owner's.
 */
export const isMine = (card: BoardCardSummary, userId: string | null): boolean => {
  const assigned = card.assignee_kind === 'user' && (!userId || card.assignee_ref === userId);
  const created = card.creator_kind === 'user' && (!userId || card.creator_ref === userId);
  return assigned || created;
};

const matchesSearch = (card: BoardCardSummary, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (card.title.toLowerCase().includes(needle)) return true;
  const ref = `task-${card.number}`;
  if (ref === needle || ref.startsWith(needle) || String(card.number) === needle.replace(/^#/, '')) return true;
  return card.labels.some((label) => label.toLowerCase().includes(needle));
};

const anyOf = <T>(selected: T[], value: T): boolean => selected.length === 0 || selected.includes(value);
const overlaps = (selected: string[], values: string[]): boolean =>
  selected.length === 0 || values.some((value) => selected.includes(value));

export const matchesFilters = (card: BoardCardSummary, filters: BoardFilters, userId: string | null): boolean =>
  matchesSearch(card, filters.search) &&
  anyOf(filters.types, card.type) &&
  anyOf(filters.priorities, card.priority) &&
  anyOf(filters.assignees, assigneeValue(card)) &&
  overlaps(filters.labels, card.labels) &&
  overlaps(filters.skills, card.skills) &&
  (!filters.blockedOnly || isBlocked(card)) &&
  (!filters.mine || isMine(card, userId));

export type AssigneeOption = { value: string; card: BoardCardSummary | null };

/** Values present on the board, for the filter selects. */
export const filterOptions = (
  cards: BoardCardSummary[]
): { labels: string[]; skills: string[]; assignees: AssigneeOption[] } => {
  const labels = new Set<string>();
  const skills = new Set<string>();
  const assignees = new Map<string, BoardCardSummary | null>([[UNASSIGNED, null]]);
  for (const card of cards) {
    card.labels.forEach((label) => labels.add(label));
    card.skills.forEach((skill) => skills.add(skill));
    const value = assigneeValue(card);
    if (value !== UNASSIGNED && !assignees.has(value)) assignees.set(value, card);
  }
  return {
    labels: [...labels].toSorted(),
    skills: [...skills].toSorted(),
    assignees: [...assignees.entries()].map(([value, card]) => ({ value, card })),
  };
};

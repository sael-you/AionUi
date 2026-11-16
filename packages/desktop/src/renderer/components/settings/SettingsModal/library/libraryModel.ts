/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared "library" layout (C33, TASK-119): the pure parts used by both the
 * Skills and the Tools page — rail scopes (Global first, projects with
 * something by count, empty projects folded), category counts, the grid
 * column count and the category tone.
 */

/** Rail key of the Global scope; a project is `project:<id>`. */
export const GLOBAL_SCOPE_KEY = 'global';

export const projectScopeKey = (projectId: string): string => `project:${projectId}`;

/** The project id of a rail key, `null` for Global. */
export const projectIdOfScope = (key: string): string | null =>
  key.startsWith('project:') ? key.slice('project:'.length) || null : null;

export type RailScope = {
  key: string;
  label: string;
  /** What this scope delivers (Global) or holds of its own (a project). */
  count: number;
  /** The project's workspace, for its sidebar colour. */
  workspace?: string;
};

export type RailScopes = {
  /** Global, then every project with at least one item, most items first. */
  shown: RailScope[];
  /** Projects with nothing of their own, folded into "N empty". */
  empty: RailScope[];
};

/**
 * Split the scopes for the rail. The selected scope always stays visible, even
 * when it is empty, so the owner sees where they are.
 */
export const splitRailScopes = (
  global: RailScope,
  projects: readonly RailScope[],
  selectedKey: string | null
): RailScopes => {
  const byCount = (a: RailScope, b: RailScope) => b.count - a.count || a.label.localeCompare(b.label);
  const shown = projects.filter((p) => p.count > 0 || p.key === selectedKey).toSorted(byCount);
  const empty = projects.filter((p) => p.count === 0 && p.key !== selectedKey).toSorted(byCount);
  return { shown: [global, ...shown], empty };
};

export type RailCategory = { key: string; label: string; count: number };

/** Key of the "All" category entry. */
export const ALL_CATEGORY_KEY = 'all';

/** Columns of the card grid for a width (3 ≥ 1280 px, 2 ≥ 768 px, else 1), as the CSS grid uses. */
export const gridColumnsFor = (viewportWidth: number): number => {
  if (viewportWidth >= 1280) return 3;
  if (viewportWidth >= 768) return 2;
  return 1;
};

/** Index the arrow keys move to inside a grid of `total` cards with `columns` columns (null = stay). */
export const gridMove = (index: number, key: string, columns: number, total: number): number | null => {
  const step: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns,
  };
  if (key === 'Home') return total > 0 ? 0 : null;
  if (key === 'End') return total > 0 ? total - 1 : null;
  const delta = step[key];
  if (delta === undefined) return null;
  const next = index + delta;
  return next >= 0 && next < total ? next : null;
};

/**
 * Arco palette names used as category tones: one stable tone per category, so
 * a category has the same colour on both pages and in light and dark.
 */
export const CATEGORY_TONES = [
  'arcoblue',
  'green',
  'orangered',
  'purple',
  'cyan',
  'magenta',
  'gold',
  'lime',
  'pinkpurple',
  'blue',
] as const;
export type CategoryTone = (typeof CATEGORY_TONES)[number];

/** A stable tone for a category key (same key → same tone). */
export const categoryTone = (key: string): CategoryTone => {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CATEGORY_TONES[hash % CATEGORY_TONES.length];
};

/** Case-insensitive match of a query against any of the fields. */
export const matchesQuery = (query: string, ...fields: Array<string | undefined | null>): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => field?.toLowerCase().includes(q));
};

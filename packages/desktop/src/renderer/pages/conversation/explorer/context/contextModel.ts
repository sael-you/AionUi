/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the Context panel (C41): which colour a category gets, how the
 * stacked bar is cut, how the item lists are grouped. No React, no I/O.
 */

import type {
  ContextAutoCompactMode,
  ContextCategory,
  ContextItems,
  ConversationContextReport,
} from '@/common/types/conversationContext';

/** Not part of what the agent has loaded: drawn as the bar's empty track. */
export const FREE_SPACE_ID = 'free_space';

/**
 * Category colours: Arco's theme palette variables, which already carry a light
 * and a dark value each, so the bar and the dots follow the theme. Categories
 * the panel does not know yet share the neutral fill.
 */
const CATEGORY_COLORS: Record<string, string> = {
  messages: 'rgb(var(--arcoblue-6))',
  mcp_tools: 'rgb(var(--orangered-6))',
  system_tools: 'rgb(var(--green-6))',
  memory_files: 'rgb(var(--gold-6))',
  system_prompt: 'rgb(var(--purple-6))',
  skills: 'rgb(var(--cyan-6))',
  custom_agents: 'rgb(var(--magenta-6))',
  mcp_instructions: 'rgb(var(--pinkpurple-6))',
  autocompact_buffer: 'var(--color-text-3)',
  compact_buffer: 'var(--color-text-3)',
};

const NEUTRAL_COLOR = 'var(--color-fill-4)';

export const categoryColor = (category: Pick<ContextCategory, 'id' | 'deferred'>): string => {
  if (category.deferred || category.id === FREE_SPACE_ID) return NEUTRAL_COLOR;
  return CATEGORY_COLORS[category.id] ?? NEUTRAL_COLOR;
};

/** Window size, or 0 when the agent reports none. */
export const windowSize = (report: Pick<ConversationContextReport, 'size'>): number =>
  typeof report.size === 'number' && report.size > 0 ? report.size : 0;

/** Share of the window in use (0..100), or null without a window size. */
export const usedPercent = (report: Pick<ConversationContextReport, 'used' | 'size' | 'percent'>): number | null => {
  const size = windowSize(report);
  if (size <= 0) return null;
  if (typeof report.percent === 'number' && Number.isFinite(report.percent)) return clampPercent(report.percent);
  return clampPercent((report.used / size) * 100);
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/** A category's share of the window (0..100), or null when it has none to show. */
export const categoryPercent = (category: ContextCategory, size: number): number | null => {
  if (category.deferred || size <= 0) return null;
  return clampPercent((category.tokens / size) * 100);
};

export type BarSegment = { id: string; color: string; widthPercent: number };

/**
 * Segments of the stacked bar: every loaded category in report order, as a
 * share of the window. Without a window size the bar shows the mix of what is
 * used. Deferred categories and free space are never drawn.
 */
export const barSegments = (report: ConversationContextReport): BarSegment[] => {
  const loaded = report.categories.filter((c) => !c.deferred && c.id !== FREE_SPACE_ID && c.tokens > 0);
  const size = windowSize(report);
  const denominator = size > 0 ? size : loaded.reduce((sum, c) => sum + c.tokens, 0);
  if (denominator <= 0) return [];
  return loaded.map((c) => ({
    id: c.id,
    color: categoryColor(c),
    widthPercent: clampPercent((c.tokens / denominator) * 100),
  }));
};

/** One line of an expandable list: what it is called and what it costs. */
export type ListRow = { key: string; name: string; tokens: number };
/** A named block of rows (an MCP server); `name` null = rows without one. */
export type ListGroup = { name: string | null; tokens: number; rows: ListRow[] };
export type ListKey = keyof ContextItems;
export type ContextList = { key: ListKey; count: number; groups: ListGroup[] };

/** The category whose label a list row reuses. */
export const LIST_CATEGORY: Record<ListKey, string> = {
  mcp_tools: 'mcp_tools',
  memory_files: 'memory_files',
  agents: 'custom_agents',
  skills: 'skills',
};

const LIST_ORDER: readonly ListKey[] = ['mcp_tools', 'memory_files', 'agents', 'skills'];

const flat = (rows: ListRow[]): ListGroup[] =>
  rows.length > 0 ? [{ name: null, tokens: rows.reduce((sum, r) => sum + r.tokens, 0), rows }] : [];

/**
 * The expandable lists of a report, empty ones dropped: MCP tools grouped per
 * server (report order kept), the others as one flat block.
 */
export const contextLists = (items: Partial<ContextItems> | null | undefined): ContextList[] => {
  const lists: ContextList[] = [];
  for (const key of LIST_ORDER) {
    let groups: ListGroup[];
    if (key === 'mcp_tools') {
      const byServer = new Map<string, ListGroup>();
      (items?.mcp_tools ?? []).forEach((tool, i) => {
        const id = tool.server ?? '';
        const group = byServer.get(id) ?? { name: tool.server ?? null, tokens: 0, rows: [] };
        group.tokens += tool.tokens;
        group.rows.push({ key: `${id}/${tool.name}/${i}`, name: tool.name, tokens: tool.tokens });
        byServer.set(id, group);
      });
      groups = [...byServer.values()];
    } else if (key === 'memory_files') {
      groups = flat(
        (items?.memory_files ?? []).map((f, i) => ({ key: `${f.path}/${i}`, name: f.path, tokens: f.tokens }))
      );
    } else {
      groups = flat((items?.[key] ?? []).map((a, i) => ({ key: `${a.name}/${i}`, name: a.name, tokens: a.tokens })));
    }
    const count = groups.reduce((sum, g) => sum + g.rows.length, 0);
    if (count > 0) lists.push({ key, count, groups });
  }
  return lists;
};

/** The choices of the "Auto-compact at" select, in display order. */
export const AUTO_COMPACT_MODES: readonly ContextAutoCompactMode[] = ['auto', '50', '60', '70', '80', 'off'];

/** True when the report carries nothing to show yet (before the first turn). */
export const isEmptyReport = (report: ConversationContextReport | null | undefined): boolean =>
  !report || (!(report.used > 0) && report.categories.every((c) => !(c.tokens > 0)));

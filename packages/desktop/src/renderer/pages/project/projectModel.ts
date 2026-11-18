/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the project page (C42): number formats, the chart geometry
 * and the grouping of a project's effective kit. Unit-tested.
 */

import type { KitEffectiveItem, KitEffectiveSetResponse, KitItemKind } from '@/common/config/storage';
import type { UsageDay, UsageTotals } from '@/common/types/platform/projectPage';

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `1.4 GB` style (binary units, one decimal under 10 of a unit). */
export const formatBytes = (bytes: number): string => {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
};

/** `12.3K`, `4.5M` in the reader's language. */
export const formatTokens = (value: number, language: string): string => {
  try {
    return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(value);
  }
};

/** Micro-USD → `$1.23` (more digits under a dollar cent). */
export const formatCost = (microUsd: number, language: string): string => {
  const usd = microUsd / 1_000_000;
  const digits = usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2;
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(usd);
  } catch {
    return `$${usd.toFixed(digits)}`;
  }
};

/** Share of a whole in percent, 0..100; 0 when the whole is unknown. */
export const percentOf = (part: number, whole: number | undefined): number =>
  whole && whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

/** A UTC calendar day (`YYYY-MM-DD`) as a short local label, e.g. "Nov 18". */
export const formatDay = (day: string, language: string, long = false): string => {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  try {
    return new Intl.DateTimeFormat(language, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(long ? { weekday: 'short' as const, year: 'numeric' as const } : {}),
    }).format(date);
  } catch {
    return day;
  }
};

const AGO_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "2 minutes ago" for a past time; null under a minute (the caller says "just now"). */
export const formatAgo = (then: number, now: number, language: string): string | null => {
  const elapsed = Math.max(0, now - then);
  for (const [unit, ms] of AGO_STEPS) {
    if (elapsed >= ms) {
      try {
        return new Intl.RelativeTimeFormat(language, { numeric: 'always' }).format(-Math.floor(elapsed / ms), unit);
      } catch {
        return null;
      }
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** The stacked series, bottom to top. The order is fixed: a colour belongs to its series. */
export const USAGE_SERIES = ['input', 'output', 'cache_read', 'cache_write'] as const;
export type UsageSeries = (typeof USAGE_SERIES)[number];

export const tokensOf = (totals: Pick<UsageTotals, UsageSeries>): number =>
  totals.input + totals.output + totals.cache_read + totals.cache_write;

/** A round axis maximum at or above `max` (1, 2, 2.5 or 5 × a power of ten) and its tick step. */
export const niceScale = (max: number, ticks = 4): { max: number; step: number } => {
  if (!(max > 0)) return { max: ticks, step: 1 };
  const rough = max / ticks;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= rough) ?? 10) * power;
  return { max: Math.ceil(max / step) * step, step };
};

export type ChartSegment = { series: UsageSeries; value: number; y: number; height: number };
export type ChartBar = { day: string; x: number; width: number; total: number; segments: ChartSegment[] };
export type ChartLayout = {
  bars: ChartBar[];
  /** Axis values, bottom (0) to top. */
  ticks: Array<{ value: number; y: number }>;
  /** Indexes of the bars that get an x label (the rest would collide). */
  labelled: number[];
  plot: { left: number; top: number; width: number; height: number };
};

/** Gap in the surface colour between touching marks (segments of a stack, neighbouring bars). */
export const MARK_GAP = 2;
const MAX_BAR_WIDTH = 24;

/** Stacked daily bars in a `width × height` box; pure geometry for the SVG. */
export const layoutUsageChart = (
  days: UsageDay[],
  size: { width: number; height: number },
  margin = { left: 44, right: 8, top: 8, bottom: 22 }
): ChartLayout => {
  const plot = {
    left: margin.left,
    top: margin.top,
    width: Math.max(0, size.width - margin.left - margin.right),
    height: Math.max(0, size.height - margin.top - margin.bottom),
  };
  const scale = niceScale(Math.max(0, ...days.map(tokensOf)));
  const yOf = (value: number): number => plot.top + plot.height - (value / scale.max) * plot.height;
  const ticks: ChartLayout['ticks'] = [];
  for (let value = 0; value <= scale.max + scale.step / 2; value += scale.step) ticks.push({ value, y: yOf(value) });

  const slot = days.length > 0 ? plot.width / days.length : 0;
  const width = Math.max(1, Math.min(MAX_BAR_WIDTH, slot - MARK_GAP));
  const bars = days.map((day, index): ChartBar => {
    const segments: ChartSegment[] = [];
    let below = 0;
    for (const series of USAGE_SERIES) {
      const value = day[series];
      if (value <= 0) continue;
      const bottom = yOf(below);
      const top = yOf(below + value);
      // The gap is taken from the segment's own base, so a stack never grows past its total.
      const gap = segments.length > 0 ? Math.min(MARK_GAP, Math.max(0, bottom - top - 1)) : 0;
      segments.push({ series, value, y: top, height: Math.max(1, bottom - top - gap) });
      below += value;
    }
    return { day: day.day, x: plot.left + slot * index + (slot - width) / 2, width, total: below, segments };
  });

  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plot.width / 56))));
  const labelled = days.map((_, index) => index).filter((index) => (days.length - 1 - index) % every === 0);
  return { bars, ticks, labelled, plot };
};

// ---------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------

export const KIT_KINDS = ['skill', 'mcp', 'rule', 'server'] as const;
export type KitKind = (typeof KIT_KINDS)[number];

export type KitSourceGroup = {
  /** `project`, `global`, `kit:<id>` or another level name. */
  key: string;
  source: 'project' | 'global' | 'kit' | 'other';
  /** The kit's name for `source: 'kit'`. */
  kitName?: string;
  items: KitEffectiveItem[];
};

const sourceOf = (item: KitEffectiveItem): Omit<KitSourceGroup, 'items'> => {
  const { level, kit_id: kitId, kit_name: kitName } = item.provenance;
  if (kitId || kitName) return { key: `kit:${kitId ?? kitName}`, source: 'kit', kitName: kitName ?? kitId };
  if (level === 'project') return { key: 'project', source: 'project' };
  if (level === 'global') return { key: 'global', source: 'global' };
  return { key: level, source: 'other' };
};

const SOURCE_ORDER: Record<KitSourceGroup['source'], number> = { project: 0, kit: 1, global: 2, other: 3 };
const kindOrder = (kind: KitItemKind): number => KIT_KINDS.indexOf(kind as KitKind);

/** What the project's conversations get, grouped by where it comes from: this project, kits, Global. */
export const groupKitBySource = (effective: KitEffectiveSetResponse): KitSourceGroup[] => {
  const groups = new Map<string, KitSourceGroup>();
  const all = [...effective.skills, ...effective.mcps, ...(effective.rules ?? []), ...(effective.servers ?? [])];
  for (const item of all) {
    if (!item.included) continue;
    const source = sourceOf(item);
    const group = groups.get(source.key) ?? { ...source, items: [] };
    group.items.push(item);
    groups.set(source.key, group);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.item_ref.localeCompare(b.item_ref));
  }
  return [...groups.values()].toSorted(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.kitName ?? '').localeCompare(b.kitName ?? '')
  );
};

const includedCount = (items: KitEffectiveItem[] | undefined): number =>
  (items ?? []).filter((item) => item.included).length;

/** Included items per kind (the Kit tab's counts; the overview has core's own). */
export const kitCounts = (effective: KitEffectiveSetResponse): Record<KitKind, number> => {
  return {
    skill: includedCount(effective.skills),
    mcp: includedCount(effective.mcps),
    rule: includedCount(effective.rules),
    server: includedCount(effective.servers),
  };
};

/** Where "Manage" goes for a kind, with the project as the page's scope. */
export const managePath = (kind: KitKind, projectId: string): string => {
  const page = { skill: 'skills', mcp: 'tools', rule: 'rules', server: 'servers' }[kind];
  return `/settings/${page}?project=${encodeURIComponent(projectId)}`;
};

export const PROJECT_TABS = ['overview', 'kit', 'storage', 'usage'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export const projectTabOf = (value: string | null): ProjectTab =>
  PROJECT_TABS.includes(value as ProjectTab) ? (value as ProjectTab) : 'overview';

export const projectPagePath = (projectId: string, tab?: ProjectTab): string =>
  `/project/${encodeURIComponent(projectId)}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`;

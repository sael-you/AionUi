/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { KitEffectiveItem, KitEffectiveSetResponse } from '@/common/config/storage';
import type { UsageDay } from '@/common/types/platform/projectPage';
import {
  MARK_GAP,
  formatAgo,
  formatBytes,
  formatCost,
  formatDay,
  formatTokens,
  groupKitBySource,
  kitCounts,
  layoutUsageChart,
  managePath,
  niceScale,
  percentOf,
  projectPagePath,
  projectTabOf,
  tokensOf,
} from '@/renderer/pages/project/projectModel';

const day = (date: string, input = 0, output = 0, cacheRead = 0, cacheWrite = 0): UsageDay => ({
  day: date,
  input,
  output,
  cache_read: cacheRead,
  cache_write: cacheWrite,
  thought: 0,
  turns: 1,
});

const item = (
  kind: KitEffectiveItem['kind'],
  ref: string,
  provenance: KitEffectiveItem['provenance'],
  included = true
): KitEffectiveItem => ({ kind, item_ref: ref, included, provenance });

describe('projectModel (C42)', () => {
  it('formats sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(1.4 * 1024 ** 3)).toBe('1.4 GB');
  });

  it('formats tokens compactly and cost from micro-USD', () => {
    expect(formatTokens(950, 'en-US')).toBe('950');
    expect(formatTokens(12_300, 'en-US')).toBe('12.3K');
    expect(formatTokens(4_500_000, 'en-US')).toBe('4.5M');
    expect(formatCost(1_230_000, 'en-US')).toBe('$1.23');
    expect(formatCost(4_200, 'en-US')).toBe('$0.0042');
    expect(formatCost(0, 'en-US')).toBe('$0.00');
  });

  it('percentOf is bounded and safe without a whole', () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(5, undefined)).toBe(0);
  });

  it('reads a UTC day without shifting it into the local zone', () => {
    expect(formatDay('2026-11-18', 'en-US')).toBe('Nov 18');
    expect(formatDay('2026-01-01', 'en-US')).toBe('Jan 1');
    expect(formatDay('not-a-day', 'en-US')).toBe('not-a-day');
  });

  it('says how long ago a scan ran; null under a minute', () => {
    const now = 1_000_000_000_000;
    expect(formatAgo(now - 30_000, now, 'en-US')).toBeNull();
    expect(formatAgo(now - 2 * 60_000, now, 'en-US')).toBe('2 minutes ago');
    expect(formatAgo(now - 3 * 3_600_000, now, 'en-US')).toBe('3 hours ago');
    expect(formatAgo(now - 2 * 86_400_000, now, 'en-US')).toBe('2 days ago');
  });

  it('tokensOf sums the four stacked series (thought is already in output)', () => {
    expect(tokensOf({ input: 1, output: 2, cache_read: 3, cache_write: 4 })).toBe(10);
  });

  it('niceScale picks a round maximum at or above the data', () => {
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect(niceScale(87)).toEqual({ max: 100, step: 25 });
    expect(niceScale(1000)).toEqual({ max: 1000, step: 250 });
    expect(niceScale(12_400).max).toBeGreaterThanOrEqual(12_400);
  });

  it('lays out stacked bars: series order, a gap between segments, never above the total', () => {
    const days = [day('2026-11-16', 100, 50, 25, 25), day('2026-11-17'), day('2026-11-18', 200)];
    const layout = layoutUsageChart(days, { width: 400, height: 200 });
    expect(layout.bars).toHaveLength(3);
    const [first, empty, last] = layout.bars;
    expect(first.segments.map((segment) => segment.series)).toEqual(['input', 'output', 'cache_read', 'cache_write']);
    expect(empty.segments).toEqual([]);
    expect(last.segments).toHaveLength(1);

    const bottom = layout.plot.top + layout.plot.height;
    // The first segment sits on the baseline; each next one leaves the mark gap below it.
    expect(first.segments[0].y + first.segments[0].height).toBeCloseTo(bottom);
    for (let index = 1; index < first.segments.length; index += 1) {
      const below = first.segments[index - 1];
      const here = first.segments[index];
      expect(below.y - (here.y + here.height)).toBeCloseTo(MARK_GAP);
    }
    // 200 of a 200 scale reaches the top of the plot, not beyond it.
    expect(last.segments[0].y).toBeCloseTo(layout.plot.top);
    expect(layout.ticks[0]).toEqual({ value: 0, y: bottom });
    // Bars stay inside the plot and never touch.
    expect(first.x).toBeGreaterThanOrEqual(layout.plot.left);
    expect(empty.x - (first.x + first.width)).toBeGreaterThanOrEqual(MARK_GAP);
  });

  it('labels only as many days as fit, always including the last', () => {
    const days = Array.from({ length: 90 }, (_, index) => day(`d${index}`, 1));
    const layout = layoutUsageChart(days, { width: 390, height: 200 });
    expect(layout.labelled.at(-1)).toBe(89);
    expect(layout.labelled.length).toBeLessThanOrEqual(6);
    expect(layout.bars.every((bar) => bar.width >= 1)).toBe(true);
  });

  it('groups the effective kit by source: this project, kits, Global; removed items left out', () => {
    const effective: KitEffectiveSetResponse = {
      skills: [
        item('skill', 'pf-ui', { level: 'global', op: 'add' }),
        item('skill', 'cs-build', { level: 'project', op: 'add' }),
        item('skill', 'old', { level: 'project', op: 'remove' }, false),
        item('skill', 'kit-skill', { level: 'project', op: 'add', kit_id: 'k1', kit_name: 'Platform Dev' }),
      ],
      mcps: [item('mcp', 'inst-1', { level: 'project', op: 'add' })],
      rules: [item('rule', 'r1', { level: 'global', op: 'add' })],
      servers: [item('server', 's1', { level: 'project', op: 'add' })],
      missing_templates: [],
    };
    const groups = groupKitBySource(effective);
    expect(groups.map((group) => group.key)).toEqual(['project', 'kit:k1', 'global']);
    expect(groups[0].items.map((entry) => `${entry.kind}:${entry.item_ref}`)).toEqual([
      'skill:cs-build',
      'mcp:inst-1',
      'server:s1',
    ]);
    expect(groups[1]).toMatchObject({ source: 'kit', kitName: 'Platform Dev' });
    expect(groups[2].items.map((entry) => entry.item_ref)).toEqual(['pf-ui', 'r1']);
    expect(kitCounts(effective)).toEqual({ skill: 3, mcp: 1, rule: 1, server: 1 });
  });

  it('an older core without rules or servers still groups', () => {
    const effective: KitEffectiveSetResponse = { skills: [], mcps: [], missing_templates: [] };
    expect(groupKitBySource(effective)).toEqual([]);
    expect(kitCounts(effective)).toEqual({ skill: 0, mcp: 0, rule: 0, server: 0 });
  });

  it('builds the links: manage pages scoped to the project, tabs in the query', () => {
    expect(managePath('skill', 'p 1')).toBe('/settings/skills?project=p%201');
    expect(managePath('mcp', 'p1')).toBe('/settings/tools?project=p1');
    expect(managePath('rule', 'p1')).toBe('/settings/rules?project=p1');
    expect(managePath('server', 'p1')).toBe('/settings/servers?project=p1');
    expect(projectPagePath('p/1')).toBe('/project/p%2F1');
    expect(projectPagePath('p1', 'usage')).toBe('/project/p1?tab=usage');
    expect(projectTabOf('storage')).toBe('storage');
    expect(projectTabOf('nope')).toBe('overview');
    expect(projectTabOf(null)).toBe('overview');
  });
});

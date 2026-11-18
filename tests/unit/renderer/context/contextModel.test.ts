/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { ContextCategory, ConversationContextReport } from '@/common/types/conversationContext';
import {
  barSegments,
  categoryColor,
  categoryPercent,
  contextLists,
  isEmptyReport,
  usedPercent,
} from '@/renderer/pages/conversation/explorer/context/contextModel';

const cat = (id: string, tokens: number, over: Partial<ContextCategory> = {}): ContextCategory => ({
  id,
  label_key: `conversation.context.category.${id}`,
  name: id,
  tokens,
  deferred: false,
  estimated: false,
  ...over,
});

const report = (over: Partial<ConversationContextReport> = {}): ConversationContextReport => ({
  used: 600_000,
  size: 1_000_000,
  percent: 60,
  model: null,
  auto_compact: { supported: true, mode: 'auto', threshold_tokens: 960_000, until_tokens: 360_000 },
  categories: [
    cat('messages', 500_000),
    cat('mcp_tools', 100_000),
    cat('free_space', 400_000),
    cat('mcp_tools_deferred', 584_000, { deferred: true }),
  ],
  items: { mcp_tools: [], memory_files: [], agents: [], skills: [] },
  cost: null,
  source: 'cli',
  updated_at: 1,
  ...over,
});

describe('contextModel', () => {
  it('cuts the bar by window share and never draws free space or deferred tools', () => {
    expect(barSegments(report()).map((s) => [s.id, s.widthPercent])).toEqual([
      ['messages', 50],
      ['mcp_tools', 10],
    ]);
  });

  it('shows the mix of what is used when the agent reports no window size', () => {
    const segments = barSegments(
      report({ size: null, percent: null, categories: [cat('messages', 300), cat('skills', 100)] })
    );
    expect(segments.map((s) => s.widthPercent)).toEqual([75, 25]);
    expect(usedPercent(report({ size: null, percent: null }))).toBeNull();
  });

  it('takes the backend percentage, and derives it only when it is missing', () => {
    expect(usedPercent(report({ percent: 61.5 }))).toBe(61.5);
    expect(usedPercent(report({ percent: null }))).toBe(60);
  });

  it('gives a deferred category no share and the neutral colour', () => {
    const deferred = cat('mcp_tools_deferred', 584_000, { deferred: true });
    expect(categoryPercent(deferred, 1_000_000)).toBeNull();
    expect(categoryColor(deferred)).toBe(categoryColor(cat('free_space', 1)));
    expect(categoryColor(cat('messages', 1))).not.toBe(categoryColor(cat('mcp_tools', 1)));
    expect(categoryPercent(cat('messages', 500_000), 1_000_000)).toBe(50);
  });

  it('groups MCP tools per server and drops empty lists', () => {
    const lists = contextLists({
      mcp_tools: [
        { name: 'query', server: 'db', tokens: 300, loaded: true },
        { name: 'open', server: 'browser', tokens: 200, loaded: null },
        { name: 'exec', server: 'db', tokens: 100, loaded: false },
      ],
      memory_files: [{ path: '/p/AGENTS.md', kind: 'project', tokens: 900 }],
      agents: [],
      skills: [{ name: 'board', source: 'aionui', tokens: 50 }],
    });
    expect(lists.map((l) => [l.key, l.count])).toEqual([
      ['mcp_tools', 3],
      ['memory_files', 1],
      ['skills', 1],
    ]);
    expect(lists[0].groups.map((g) => [g.name, g.tokens, g.rows.map((r) => r.name)])).toEqual([
      ['db', 400, ['query', 'exec']],
      ['browser', 200, ['open']],
    ]);
    expect(lists[1].groups[0].rows[0].name).toBe('/p/AGENTS.md');
  });

  it('treats a missing report and an all-zero report as "no usage yet"', () => {
    expect(isEmptyReport(null)).toBe(true);
    expect(isEmptyReport(report({ used: 0, categories: [cat('messages', 0)] }))).toBe(true);
    expect(isEmptyReport(report())).toBe(false);
  });
});

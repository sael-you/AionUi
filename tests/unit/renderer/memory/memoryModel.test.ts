/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { MemoryItem } from '@/common/types/memory';
import {
  EMPTY_MEMORY_FILTERS,
  fileForLink,
  filterMemories,
  groupMemories,
  lintByFile,
  missingFileIssues,
  pickClaudeAssistant,
  reviewBrief,
} from '@/renderer/pages/memory/memoryModel';

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600 * 1000;

const item = (over: Partial<MemoryItem> & { file: string }): MemoryItem => ({
  name: over.file.replace(/\.md$/, ''),
  description: null,
  type: 'feedback',
  modified: NOW - DAY,
  frontmatter_modified: null,
  size: 100,
  links: [],
  in_index: true,
  broken_links: [],
  stale: false,
  ...over,
});

const ITEMS: MemoryItem[] = [
  item({ file: 'use-bun.md', name: 'Use bun', type: 'feedback', modified: NOW - 3 * DAY }),
  item({ file: 'use_bun_2.md', name: 'use-bun', type: 'feedback', modified: NOW - 2 * DAY }),
  item({ file: 'deploy.md', name: 'Deploy train', type: 'project', modified: NOW - 31 * DAY, stale: true }),
  item({ file: 'owner.md', name: 'Owner', type: 'user', modified: NOW - 40 * DAY, in_index: false }),
  item({ file: 'dash.md', name: 'Dashboard', type: 'reference', links: ['nope'], broken_links: ['nope'] }),
  item({ file: 'raw.md', name: null, type: 'weird', description: 'malformed frontmatter' }),
];

/** Server lint as core computes it on this list (core is the source of truth). */
const LINT = [
  { kind: 'duplicate', file: 'use-bun.md', detail: 'same name as use_bun_2.md' },
  { kind: 'duplicate', file: 'use_bun_2.md', detail: 'same name as use-bun.md' },
  { kind: 'missing_file', file: 'gone.md', detail: 'MEMORY.md line 4' },
  { kind: 'from_a_newer_server', file: 'raw.md', detail: 'unknown kind' },
];

describe('memory lint', () => {
  it('takes not-in-index, broken links and stale from the items and duplicates from the server lint', () => {
    const flags = lintByFile({ items: ITEMS, lint: LINT });
    expect([...(flags.get('use-bun.md') ?? [])]).toEqual(['duplicate']);
    expect([...(flags.get('use_bun_2.md') ?? [])]).toEqual(['duplicate']);
    expect([...(flags.get('deploy.md') ?? [])]).toEqual(['stale']);
    // Old, but the server did not flag it stale (a user memory never is).
    expect([...(flags.get('owner.md') ?? [])]).toEqual(['not_in_index']);
    expect([...(flags.get('dash.md') ?? [])]).toEqual(['broken_link']);
    // An unknown kind is ignored, never shown as a raw i18n key.
    expect(flags.has('raw.md')).toBe(false);
  });

  it('keeps index lines that point to missing files apart', () => {
    const list = { items: ITEMS, lint: LINT };
    expect(lintByFile(list).has('gone.md')).toBe(false);
    expect(missingFileIssues(list).map((i) => i.file)).toEqual(['gone.md']);
  });
});

describe('memory list', () => {
  const flags = lintByFile({ items: ITEMS, lint: LINT });

  it('groups by type in display order with an "other" bucket', () => {
    const groups = groupMemories(filterMemories(ITEMS, EMPTY_MEMORY_FILTERS, flags));
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['user', 1],
      ['feedback', 2],
      ['project', 1],
      ['reference', 1],
      ['other', 1],
    ]);
  });

  it('sorts newest first and filters by type, stale and issues', () => {
    expect(filterMemories(ITEMS, { ...EMPTY_MEMORY_FILTERS, type: 'feedback' }, flags).map((i) => i.file)).toEqual([
      'use_bun_2.md',
      'use-bun.md',
    ]);
    expect(filterMemories(ITEMS, { ...EMPTY_MEMORY_FILTERS, staleOnly: true }, flags).map((i) => i.file)).toEqual([
      'deploy.md',
    ]);
    expect(
      filterMemories(ITEMS, { ...EMPTY_MEMORY_FILTERS, issuesOnly: true }, flags)
        .map((i) => i.file)
        .toSorted()
    ).toEqual(['dash.md', 'deploy.md', 'owner.md', 'use-bun.md', 'use_bun_2.md']);
  });

  it('searches name, description and file, and bodies once loaded', () => {
    const search = (query: string, bodies?: Map<string, string>) =>
      filterMemories(ITEMS, { ...EMPTY_MEMORY_FILTERS, query }, flags, bodies).map((i) => i.file);
    expect(search('DEPLOY')).toEqual(['deploy.md']);
    expect(search('malformed')).toEqual(['raw.md']);
    expect(search('owner.md')).toEqual(['owner.md']);
    expect(search('timingSafeEqual')).toEqual([]);
    expect(search('timingSafeEqual', new Map([['dash.md', 'uses timingSafeEqual']]))).toEqual(['dash.md']);
  });

  it('resolves [[links]] to existing files only', () => {
    expect(fileForLink('deploy', ITEMS)).toBe('deploy.md');
    expect(fileForLink('nope', ITEMS)).toBeNull();
  });
});

describe('Review with AI', () => {
  it('the brief asks for an audit table, names the selected files and changes nothing', () => {
    const brief = reviewBrief(['deploy.md', 'use-bun.md']);
    expect(brief).toContain('wrong, outdated, contradictory or duplicated rules');
    expect(brief).toContain('deploy.md, use-bun.md');
    expect(brief).toContain('file, problem, proposed fix');
    expect(brief).toContain('Change nothing until the owner approves.');
    expect(reviewBrief([])).toContain('Review all memory files');
  });

  it('runs on the enabled Claude Code assistant, the generated one first', () => {
    const a = (id: string, over: Partial<Assistant>) =>
      ({ id, enabled: true, source: 'builtin', ...over }) as Assistant;
    const list = [
      a('aion', { agent: { type: 'aionrs', source: 'internal' } as Assistant['agent'] }),
      a('preset-claude', { agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' } as Assistant['agent'] }),
      a('bare:claude', {
        source: 'generated' as Assistant['source'],
        agent: { type: 'acp', source: 'builtin', acp_backend: 'claude' } as Assistant['agent'],
      }),
    ];
    expect(pickClaudeAssistant(list)?.id).toBe('bare:claude');
    expect(pickClaudeAssistant([list[1]])?.id).toBe('preset-claude');
    expect(pickClaudeAssistant([{ ...list[2], enabled: false }])).toBeNull();
  });
});

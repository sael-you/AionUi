/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the memory review (C29 §3): grouping by type, lint flags per
 * file, filters, search, sort, and the "Review with AI" request.
 */

import type { MemoryItem, MemoryLintIssue, MemoryLintKind, MemoryListResponse } from '@/common/types/memory';
import type { Assistant } from '@/common/types/agent/assistantTypes';

/** Known types in display order; anything else is grouped under `other`. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type MemoryGroupKey = (typeof MEMORY_TYPES)[number] | 'other';

/** A `project` memory untouched this long may be stale (C29 §2 lint). */
export const STALE_AFTER_MS = 30 * 24 * 3600 * 1000;

export const groupKeyOf = (item: Pick<MemoryItem, 'type'>): MemoryGroupKey =>
  (MEMORY_TYPES as readonly string[]).includes(item.type ?? '') ? (item.type as MemoryGroupKey) : 'other';

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Lint flags per file: the ones derivable from the list itself, plus the
 * server's issues (which also cover index lines pointing to missing files).
 */
export function lintByFile(
  list: Pick<MemoryListResponse, 'items' | 'lint'>,
  now: number
): Map<string, Set<MemoryLintKind>> {
  const flags = new Map<string, Set<MemoryLintKind>>();
  const add = (file: string, kind: MemoryLintKind) => {
    const set = flags.get(file) ?? new Set<MemoryLintKind>();
    set.add(kind);
    flags.set(file, set);
  };
  const byName = new Map<string, string[]>();
  for (const item of list.items) {
    if (!item.in_index) add(item.file, 'not_in_index');
    if (item.broken_links.length > 0) add(item.file, 'broken_link');
    if (item.type === 'project' && now - item.modified > STALE_AFTER_MS) add(item.file, 'stale');
    const key = item.name ? normalizeName(item.name) : '';
    if (key) byName.set(key, [...(byName.get(key) ?? []), item.file]);
  }
  for (const files of byName.values()) {
    if (files.length > 1) files.forEach((file) => add(file, 'duplicate'));
  }
  for (const issue of list.lint ?? []) {
    if (issue.file && list.items.some((item) => item.file === issue.file)) add(issue.file, issue.kind);
  }
  return flags;
}

/** Server issues about files that do not exist (index lines pointing nowhere). */
export const missingFileIssues = (list: Pick<MemoryListResponse, 'items' | 'lint'>): MemoryLintIssue[] =>
  (list.lint ?? []).filter((issue) => issue.kind === 'missing_file');

export type MemoryFilters = {
  query: string;
  type: MemoryGroupKey | 'all';
  staleOnly: boolean;
  issuesOnly: boolean;
};

export const EMPTY_MEMORY_FILTERS: MemoryFilters = { query: '', type: 'all', staleOnly: false, issuesOnly: false };

/**
 * Items matching the filters, newest first. The query matches name, description
 * and file name, and the body when it was loaded (`bodies`, on demand).
 */
export function filterMemories(
  items: MemoryItem[],
  filters: MemoryFilters,
  flags: Map<string, Set<MemoryLintKind>>,
  bodies: ReadonlyMap<string, string> = new Map()
): MemoryItem[] {
  const query = filters.query.trim().toLowerCase();
  return items
    .filter((item) => filters.type === 'all' || groupKeyOf(item) === filters.type)
    .filter((item) => !filters.staleOnly || flags.get(item.file)?.has('stale'))
    .filter((item) => !filters.issuesOnly || (flags.get(item.file)?.size ?? 0) > 0)
    .filter(
      (item) =>
        !query ||
        [item.name, item.description, item.file, bodies.get(item.file)].some((text) =>
          text?.toLowerCase().includes(query)
        )
    )
    .toSorted((a, b) => b.modified - a.modified || a.file.localeCompare(b.file));
}

/** Groups in display order with their (already filtered) items; empty groups are left out. */
export function groupMemories(items: MemoryItem[]): Array<{ key: MemoryGroupKey; items: MemoryItem[] }> {
  const keys: MemoryGroupKey[] = [...MEMORY_TYPES, 'other'];
  return keys
    .map((key) => ({ key, items: items.filter((item) => groupKeyOf(item) === key) }))
    .filter((group) => group.items.length > 0);
}

/** The memory file a `[[slug]]` link names (`slug.md`), if it exists. */
export const fileForLink = (slug: string, items: MemoryItem[]): string | null =>
  items.find((item) => item.file === `${slug}.md` || item.file === slug)?.file ?? null;

/** The fixed brief of "Review with AI" (C29 §3); selected files are named. */
export function reviewBrief(files: string[]): string {
  const scope =
    files.length > 0
      ? `Focus on these memory files: ${files.join(', ')}.`
      : 'Review all memory files and the MEMORY.md index.';
  return [
    "Audit this project's Claude memory (your auto-memory directory for this workspace) for wrong, outdated, " +
      'contradictory or duplicated rules that hurt development.',
    scope,
    'Report a table with the columns: file, problem, proposed fix.',
    'Change nothing until the owner approves.',
  ].join('\n');
}

/** The Claude Code assistant the review runs on: the generated (bare) one first. */
export function pickClaudeAssistant(assistants: Assistant[]): Assistant | null {
  const claude = assistants.filter((a) => a.enabled && a.agent?.acp_backend === 'claude');
  return claude.find((a) => a.source === 'generated') ?? claude[0] ?? null;
}

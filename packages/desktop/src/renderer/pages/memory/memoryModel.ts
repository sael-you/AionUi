/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the memory review (C29 §3): grouping by type, lint flags per
 * file, filters, search, sort, and the "Review with AI" request.
 */

import type { MemoryItem, MemoryLint, MemoryLintKind, MemoryListResponse } from '@/common/types/memory';
import type { Assistant } from '@/common/types/agent/assistantTypes';

/** Known types in display order; anything else is grouped under `other`. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type MemoryGroupKey = (typeof MEMORY_TYPES)[number] | 'other';

const LINT_KINDS: readonly MemoryLintKind[] = ['duplicate', 'not_in_index', 'missing_file', 'broken_link', 'stale'];
const isLintKind = (kind: string): kind is MemoryLintKind => (LINT_KINDS as readonly string[]).includes(kind);

export const groupKeyOf = (item: Pick<MemoryItem, 'type'>): MemoryGroupKey =>
  (MEMORY_TYPES as readonly string[]).includes(item.type ?? '') ? (item.type as MemoryGroupKey) : 'other';

/**
 * Lint flags per file, all computed by the server: the item fields
 * (`in_index`, `broken_links`, `stale`) and the list's `lint` findings
 * (duplicates among them). Unknown kinds from a newer server are ignored.
 */
export function lintByFile(list: Pick<MemoryListResponse, 'items' | 'lint'>): Map<string, Set<MemoryLintKind>> {
  const flags = new Map<string, Set<MemoryLintKind>>();
  const add = (file: string, kind: MemoryLintKind) => {
    const set = flags.get(file) ?? new Set<MemoryLintKind>();
    set.add(kind);
    flags.set(file, set);
  };
  for (const item of list.items) {
    if (!item.in_index) add(item.file, 'not_in_index');
    if (item.broken_links.length > 0) add(item.file, 'broken_link');
    if (item.stale) add(item.file, 'stale');
  }
  for (const issue of list.lint) {
    if (issue.file && isLintKind(issue.kind) && list.items.some((item) => item.file === issue.file)) {
      add(issue.file, issue.kind);
    }
  }
  return flags;
}

/** Server issues about files that do not exist (index lines pointing nowhere). */
export const missingFileIssues = (list: Pick<MemoryListResponse, 'lint'>): MemoryLint[] =>
  list.lint.filter((issue) => issue.kind === 'missing_file');

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

/**
 * The fixed brief of "Review with AI" (C29 §3; reworked for the owner,
 * 2026-11-17): check every memory against the workspace as it is now, against
 * the project rules and against the other memories, rank what was found by
 * the harm it does, and change nothing before the owner picks the rows.
 * Selected files narrow the report, never what is read. Written in English:
 * it is a prompt for the agent, not UI text.
 */
export function reviewBrief(files: string[]): string {
  const scope =
    files.length > 0
      ? `Focus on these memory files: ${files.join(', ')}. Still read the others and MEMORY.md, to find conflicts and duplicates with them, but report only what concerns the focused files.`
      : 'Review all memory files and the MEMORY.md index.';
  return [
    "Audit this project's Claude memory (your auto-memory directory for this workspace). The goal: no memory that makes an agent do wrong work.",
    scope,
    '',
    'Steps:',
    '1. Read every memory file and MEMORY.md.',
    '2. Check each memory against reality: the code, the git log and history, and the docs of this workspace. Flag memories about things that no longer exist, behaviour that changed, old paths, commands or versions, and dates that have passed.',
    '3. Check for conflicts with the project rules (AGENTS.md, CLAUDE.md, GEMINI.md, the global rules, and the AionUi rules if present) and between memories.',
    '4. Find duplicates and overlaps, and propose one merged text for each group.',
    '5. Rank the findings by impact (how likely the memory causes wrong work), most harmful first.',
    '6. Report one table with the columns: file · problem · evidence (file:line or commit) · impact (high / med / low) · proposed fix (the exact new text, a merge, or delete). Then a short "Safe to apply now" list.',
    '7. Wait for the owner to say which rows to apply. Then apply only those with normal file edits (edit or delete the memory files, keep MEMORY.md in sync) and list what changed.',
    '',
    'Use plain language. Never quote secrets (tokens, keys, passwords): name them only.',
    'Change nothing until the owner approves.',
  ].join('\n');
}

/** The Claude Code assistant the review runs on: the generated (bare) one first. */
export function pickClaudeAssistant(assistants: Assistant[]): Assistant | null {
  const claude = assistants.filter((a) => a.enabled && a.agent?.acp_backend === 'claude');
  return claude.find((a) => a.source === 'generated') ?? claude[0] ?? null;
}

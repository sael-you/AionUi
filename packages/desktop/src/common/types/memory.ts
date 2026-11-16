/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project memory review (C29 §2): Claude Code's auto-memory files of a project,
 * read where they live (`~/.claude/projects/<slug>/memory/`). Mirrors the
 * AionCore `aionui-api-types` `memory` module field by field.
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

/** One memory file (no body). Frontmatter fields are null when missing or malformed. */
export type MemoryItem = {
  file: string;
  name: string | null;
  description: string | null;
  /** `metadata.type`; any other value is passed through as written. */
  type: string | null;
  /** Last modification, unix ms. */
  modified: number;
  /** Bytes. */
  size: number;
  /** `[[slug]]` links in the body. */
  links: string[];
  /** Listed in `MEMORY.md`. */
  in_index: boolean;
  /** Links that name no existing memory. */
  broken_links: string[];
};

export type MemoryLintKind = 'duplicate' | 'not_in_index' | 'missing_file' | 'broken_link' | 'stale';

export type MemoryLintIssue = {
  kind: MemoryLintKind;
  /** The memory file, or the missing file an index line points to. */
  file: string | null;
  detail: string;
};

/** `GET /api/projects/{project_id}/memory`. */
export type MemoryListResponse = {
  dir_exists: boolean;
  /** Lines of the `MEMORY.md` index. */
  index_lines: number;
  items: MemoryItem[];
  /** Server lint (index lines pointing to missing files and the rest), when sent. */
  lint?: MemoryLintIssue[];
};

/** `GET /api/projects/{project_id}/memory/{file}`. */
export type MemoryFileResponse = {
  file: string;
  /** Frontmatter as written (without the `---` fences); shown raw when malformed. */
  frontmatter_raw: string;
  body: string;
  modified: number;
};

/** `PUT /api/projects/{project_id}/memory/{file}`; 409 when `expected_modified` is stale. */
export type UpdateMemoryFileRequest = {
  body: string;
  frontmatter_raw: string;
  expected_modified: number;
};

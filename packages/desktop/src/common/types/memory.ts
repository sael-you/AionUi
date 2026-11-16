/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project memory review (C29 §2): Claude Code's auto-memory files of a project,
 * read where they live (`~/.claude/projects/<slug>/memory/`). Mirrors AionCore
 * `aionui-api-types/src/memory.rs` field by field (core wip/memory-ui acf4f126).
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

/** One memory file (no body). Frontmatter fields are null when missing or malformed. */
export type MemoryItem = {
  file: string;
  name: string | null;
  description: string | null;
  /** `metadata.type` as written (`user` | `feedback` | `project` | `reference` expected). */
  type: string | null;
  /** File modification time, unix ms (the `expected_modified` of a PUT). */
  modified: number;
  /** `metadata.modified` as written in the frontmatter (ISO 8601), if any. */
  frontmatter_modified: string | null;
  /** Bytes. */
  size: number;
  /** `[[slug]]` links in the body, in order, deduplicated. */
  links: string[];
  /** `MEMORY.md` has a line pointing to this file. */
  in_index: boolean;
  /** Links whose slug matches no memory. */
  broken_links: string[];
  /** A `project` memory not modified for more than 30 days. */
  stale: boolean;
};

export type MemoryLintKind = 'duplicate' | 'not_in_index' | 'missing_file' | 'broken_link' | 'stale';

/** A lint finding computed on the list (core `MemoryLint`). */
export type MemoryLint = {
  /** One of {@link MemoryLintKind}; a plain string on the wire. */
  kind: string;
  /** The memory file concerned; for `missing_file` the file the index names. */
  file: string | null;
  /** Human-readable detail (English). */
  detail: string;
};

/** `GET /api/projects/{project_id}/memory`. */
export type MemoryListResponse = {
  dir_exists: boolean;
  /** Lines of `MEMORY.md` (0 when it is missing). */
  index_lines: number;
  /** Sorted by `modified`, newest first. */
  items: MemoryItem[];
  lint: MemoryLint[];
};

/** `GET /api/projects/{project_id}/memory/{file}`. */
export type MemoryFileResponse = {
  file: string;
  /** Frontmatter as written (without the `---` fences); shown raw when malformed. */
  frontmatter_raw: string;
  body: string;
  modified: number;
};

/** `PUT /api/projects/{project_id}/memory/{file}`; 409 `MEMORY_CHANGED` when `expected_modified` is stale. */
export type UpdateMemoryFileRequest = {
  body: string;
  frontmatter_raw: string;
  expected_modified: number;
};

/** `DELETE /api/projects/{project_id}/memory/{file}`. */
export type MemoryDeleteResponse = {
  file: string;
  /** The trash copy (`.trash/<file>.<unix ms>`) `restore` brings back. */
  trash_file: string;
  /** `MEMORY.md` lines removed (lines linking to this file). */
  index_lines_removed: number;
};

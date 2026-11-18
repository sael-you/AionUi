/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project page (C42, TASK-169): usage, disk usage and the overview tiles of one
 * project. Mirrors AionCore `aionui-api-types::project_page` (snake_case).
 *
 * Token counters are per-turn sums. `cost_micro_usd` is micro-USD (1 USD =
 * 1_000_000), absent when no backend of the bucket reported a cost. Days are UTC
 * calendar days (`YYYY-MM-DD`); a response holds every day of the range, oldest
 * first, zero-filled. Times are epoch milliseconds.
 *
 * Errors: `project_not_found` 404, `usage_invalid_days` 400.
 */

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRangeDays = (typeof USAGE_RANGES)[number];

/** Token and cost sums of one bucket. */
export type UsageTotals = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /** Reasoning tokens (already counted in `output` by the backends that report them). */
  thought: number;
  cost_micro_usd?: number;
  /** Usage reports recorded (about one per turn). */
  turns: number;
};

export type UsageDay = UsageTotals & { day: string };

export type UsageByConversation = UsageTotals & {
  conversation_id: string;
  /** Empty when the conversation no longer exists. */
  name: string;
  last_at: number;
};

export type UsageByModel = UsageTotals & {
  /** Model id as the backend reported it; empty when unknown. */
  model: string;
  /** Backend label (`claude`, `codex`, `gemini`, ...); empty when unknown. */
  backend: string;
};

/** `GET /api/projects/{id}/usage?days=7|30|90`. */
export type ProjectUsageResponse = {
  /** First recorded turn of this project (older history is not back-filled); absent = nothing recorded yet. */
  since?: number;
  range_days: number;
  totals: UsageTotals;
  days: UsageDay[];
  /** Top 10 by `input + output`, largest first. */
  by_conversation: UsageByConversation[];
  /** Largest first. */
  by_model: UsageByModel[];
};

export type StorageDisk = { total_bytes: number; free_bytes: number };

export type StorageChild = {
  name: string;
  /** For a `dir`: everything below it (symlinks not followed). */
  bytes: number;
  /** `dir` | `file` | `symlink` | `other`. */
  kind: string;
};

/** `path` is relative to the root, `/`-separated. */
export type StorageFile = { path: string; bytes: number };

export type StorageRoot = {
  /** `workspace` | `attached` | `memory`. */
  label: string;
  /** Absolute path. */
  path: string;
  /** `false` = the directory does not exist (bytes 0, no children). */
  exists: boolean;
  /** Apparent size of the files found (not disk blocks). */
  bytes: number;
  entries: number;
  /** The walk stopped at 200 000 entries or 5 s: `bytes` is a lower bound. */
  truncated: boolean;
  /** Top-level entries, largest first, at most 20. */
  children: StorageChild[];
  /** Largest first, at most 10. */
  largest_files: StorageFile[];
};

/**
 * `GET /api/projects/{id}/storage` (cached up to 10 minutes; the first call scans)
 * and `POST /api/projects/{id}/storage/rescan` (scans now, returns the new result).
 */
export type ProjectStorageResponse = {
  scanned_at: number;
  /** Sum of `roots[].bytes`. */
  total_bytes: number;
  /** The file system holding the workspace; absent when it cannot be read. */
  disk?: StorageDisk;
  roots: StorageRoot[];
};

/** `GET /api/projects/{id}/overview`: the tiles in one call. Never scans the disk. */
export type ProjectOverviewResponse = {
  project_id: string;
  name: string;
  /** `active` = not archived. */
  conversations: { active: number; total: number };
  /** Board cards outside a `done` column (0 when the project has no board). */
  open_cards: number;
  /** The `included` decisions of `GET /api/kits/effective?project_id=`. */
  kit: { skills: number; mcps: number; rules: number; servers: number };
  /** Files in the project's Claude memory dir; absent when it has no workspace. */
  memory_files?: number;
  /** Today (UTC). */
  tokens_today: UsageTotals;
  /** From the cached scan; absent until one ran. */
  storage?: { total_bytes: number; scanned_at: number; disk?: StorageDisk };
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rules (C37, TASK-131): owner-written rule documents that are always applied
 * to the conversations they reach through the kit levels (`item_kind = 'rule'`).
 * Mirrors AionCore `aionui-api-types::rule` (snake_case). Request types are
 * `deny_unknown_fields`: send exactly these fields.
 *
 * A change applies from a conversation's next session start.
 */

/** Largest rule body (bytes, UTF-8). */
export const RULE_BODY_MAX_BYTES = 8 * 1024;
/** Largest total of the rule bodies in effect for one scope (bytes). */
export const RULES_EFFECTIVE_MAX_BYTES = 24 * 1024;

export type RuleResponse = {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  /** `owner` | `import`. */
  origin: string;
  /** The file an imported rule came from. */
  source_path?: string;
  created_at: number;
  updated_at: number;
};

/** `POST /api/rules`. */
export type CreateRuleRequest = { name: string; description?: string; body: string; enabled?: boolean };

/** `PUT /api/rules/{id}`: absent fields keep their value; a stale `expected_updated_at` → 409 RULE_STALE. */
export type UpdateRuleRequest = {
  name?: string;
  description?: string;
  body?: string;
  enabled?: boolean;
  expected_updated_at?: number;
};

/** `GET /api/rules/effective`: a conversation, or a project/assistant preview. */
export type RuleEffectiveQuery = { conversation_id?: string; project_id?: string; assistant_id?: string };

export type RuleEffectiveItem = {
  id: string;
  name: string;
  /** `global` | `project` | `assistant` | `conversation`. */
  level: string;
  bytes: number;
  /** `false` = left out of the block because the 24 KB cap was reached. */
  delivered: boolean;
};

export type RuleEffectiveResponse = {
  rules: RuleEffectiveItem[];
  /** The exact text prepended to the session's preset context; empty when no rule applies. */
  block: string;
  bytes: number;
  max_bytes: number;
};

export type RuleImportScope = 'global' | 'project';

/** `GET /api/rules/import/preview` (needs the browser session). Nothing is written. */
export type RuleImportQuery = { scope: RuleImportScope; project_id?: string };

export type RuleImportProposal = {
  name: string;
  description: string;
  body: string;
  bytes: number;
  /** A live rule already has this name (the import would fail). */
  name_taken: boolean;
};

/**
 * `new` | `imported` | `managed` | `pointer` (only refers to another file) | `missing` |
 * `refused` (a symlink leaving the project, not a regular file, or over 512 KB; no rules).
 */
export type RuleImportFileStatus = 'new' | 'imported' | 'managed' | 'pointer' | 'missing' | 'refused';

export type RuleImportFile = {
  path: string;
  status: RuleImportFileStatus | string;
  bytes: number;
  rules: RuleImportProposal[];
};

export type RuleImportPreviewResponse = {
  scope: RuleImportScope;
  project_id?: string;
  files: RuleImportFile[];
};

/** `POST /api/rules/import`: the `new` files of a scope become rules attached there. Files are not touched. */
export type RuleImportRequest = { scope: RuleImportScope; project_id?: string; confirm: boolean };

export type RuleSourceResponse = {
  id: string;
  scope: RuleImportScope | string;
  project_id?: string;
  path: string;
  /** `imported` | `managed`. */
  status: string;
  imported_at: number;
  managed_at?: number;
};

export type RuleImportResponse = { sources: RuleSourceResponse[]; rules: RuleResponse[] };

/**
 * `POST /api/rules/files/manage`: hand the imported files of a scope over to
 * AionUi. Global: the file is generated from the Global rules (and again after
 * every change). Project: each imported repo file becomes a one-line pointer.
 * AionUi never commits or pushes these files.
 */
export type RuleManageFilesRequest = { scope: RuleImportScope; project_id?: string; confirm: boolean };
export type RuleManageFilesResponse = { written: RuleSourceResponse[] };

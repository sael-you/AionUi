/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire types of the conversation Context panel (C41). They mirror AionCore's
 * `GET /api/conversations/{id}/context`, `PUT …/auto-compact` and
 * `POST …/compact` field by field (`aionui-api-types`, TASK-158 K1).
 */

/** `auto` = the agent's own default, a number = percent of the window, `off` = never. */
export type ContextAutoCompactMode = 'auto' | '50' | '60' | '70' | '80' | 'off';

export type ContextAutoCompact = {
  /** False when this agent has no configurable auto-compact: the setting is hidden. */
  supported: boolean;
  mode: ContextAutoCompactMode;
  /** Tokens in context at which the agent compacts on its own. */
  threshold_tokens: number | null;
  /** Tokens left before that happens. */
  until_tokens: number | null;
};

export type ContextCategory = {
  /** The agent's own category id; `other` for one AionCore does not know. */
  id: string;
  /** `conversation.context.category.<id>`. */
  label_key: string;
  /** English fallback when `label_key` has no translation. */
  name: string;
  tokens: number;
  /** Loaded on demand: listed, but not part of what is in the window now. */
  deferred: boolean;
  /** Counted by AionUi (the agent does not report it). */
  estimated: boolean;
};

export type ContextMcpTool = { name: string; server: string | null; tokens: number; loaded: boolean | null };
export type ContextMemoryFile = { path: string; kind: string | null; tokens: number };
export type ContextNamedItem = { name: string; source: string | null; tokens: number };

export type ContextItems = {
  mcp_tools: ContextMcpTool[];
  memory_files: ContextMemoryFile[];
  agents: ContextNamedItem[];
  skills: ContextNamedItem[];
};

export type ConversationContextReport = {
  used: number;
  /** Context window size; null when the agent does not report one. */
  size: number | null;
  /** 0..100; null when the size is unknown. */
  percent: number | null;
  model: string | null;
  auto_compact: ContextAutoCompact;
  categories: ContextCategory[];
  items: ContextItems;
  cost: { amount: number; currency: string } | null;
  /** `cli` = the agent's own report; `estimated` = totals plus what AionCore injected. */
  source: 'cli' | 'estimated';
  /** Unix milliseconds. */
  updated_at: number;
};

/** `POST /compact` answers 202: the compact runs as a turn; numbers follow over WS. */
export type ConversationCompactResult = { msg_id: string };

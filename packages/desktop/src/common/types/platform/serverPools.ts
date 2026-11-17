/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server access pools (C36, TASK-130): SSH servers the owner registers once and
 * assigns through the kit attach levels (`item_kind = 'server'`). Mirrors
 * AionCore `aionui-api-types::server_pool` (snake_case). Request types are
 * `deny_unknown_fields` on the server: send exactly these fields.
 *
 * The private key is write-only: no response carries it, only `has_key`.
 */

export type ServerEnvironment = 'production' | 'staging' | 'sandbox' | 'local';
export type ServerTier = 'read' | 'write';

export const SERVER_ENVIRONMENTS: readonly ServerEnvironment[] = ['production', 'staging', 'sandbox', 'local'];
export const SERVER_TIERS: readonly ServerTier[] = ['read', 'write'];
/** What agents call a server: `[a-z0-9][a-z0-9-]*`. */
export const SERVER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `GET /api/servers`, `GET /api/servers/{id}` and every write. */
export type ServerResponse = {
  id: string;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  /** known_hosts key part(s) (`<type> <base64>`, one per line); empty until set. */
  host_key: string;
  labels: string[];
  environment: ServerEnvironment | string;
  /** Guidance for agents only (`tier_note`): AionUi cannot tell a read from a write in a shell. */
  tier: ServerTier | string;
  notes: string;
  enabled: boolean;
  /** A private key is stored (never returned). */
  has_key: boolean;
  /** `production` + `write`: crucial commands ask the owner first. */
  crucial_commands_ask: boolean;
  tier_note: string;
  created_at: number;
  updated_at: number;
};

/** `POST /api/servers`. Stored keys only (no agent forwarding). */
export type CreateServerRequest = {
  name: string;
  host: string;
  port?: number;
  ssh_user: string;
  /** OpenSSH private key (no passphrase). Write-only. */
  private_key: string;
  host_key?: string;
  labels?: string[];
  environment?: string;
  tier?: string;
  notes?: string;
  enabled?: boolean;
};

/**
 * `PUT /api/servers/{id}`: absent fields keep their value. A new destination
 * (host, port, user) without `host_key` clears the stored host key, so the old
 * host's key is never trusted for a new destination.
 */
export type UpdateServerRequest = Partial<CreateServerRequest>;

/** One audited `run_command` call. */
export type ServerAuditResponse = {
  id: string;
  conversation_id: string;
  server_id: string;
  server_name: string;
  /** `standard` | `crucial` (the MCP server the agent called). */
  channel: string;
  /** `ran` | `failed` | `needs_approval` | `refused`. */
  decision: string;
  reason: string;
  /** Secrets redacted, truncated. */
  command: string;
  exit_code?: number;
  duration_ms?: number;
  created_at: number;
};

export type ServerAuditQuery = { server_id?: string; limit?: number };

export type ServerTestErrorCode =
  | 'auth_failed'
  | 'host_key_mismatch'
  | 'host_key_unknown'
  | 'unreachable'
  | 'timeout'
  | 'failed';

/** `POST /api/servers/{id}/test` (no body). */
export type ServerTestResponse = {
  ok: boolean;
  latency_ms?: number;
  error_code?: ServerTestErrorCode;
  message?: string;
  /** The key the host presented (to compare or adopt after a mismatch). */
  seen_host_key?: string;
};

/** `POST /api/servers/scan-host-key`. */
export type ScanHostKeyRequest = { host: string; port?: number };
export type ScanHostKeyResponse = { host_key: string };

/** `POST /api/servers/classify`: why a command on the crucial channel asks the owner. */
export type ClassifyServerCommandRequest = { server: string; command: string };
export type ClassifyServerCommandResponse = {
  crucial: boolean;
  reason?: string;
  server_id?: string;
  environment?: string;
  tier?: string;
};

/** The two built-in MCP servers agents use; only the crucial one asks the owner. */
export const SERVERS_MCP_NAME = 'aionui-servers';
export const SERVERS_CRUCIAL_MCP_NAME = 'aionui-servers-crucial';
export const SERVERS_RUN_TOOL = 'run_command';

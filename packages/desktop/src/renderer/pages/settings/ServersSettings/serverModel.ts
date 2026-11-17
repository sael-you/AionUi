/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the Servers page (C36, TASK-130): what a scope gets, the
 * form rules, host-key fingerprints and error messages. No React, no I/O
 * (except Web Crypto for fingerprints), so every rule is unit-tested.
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { KitAttachmentResponse } from '@/common/config/storage';
import {
  projectItemCount,
  scopeAttachment,
  scopeItems,
  scopeToggle,
  type ScopeItems,
  type ScopeToggle,
} from '@/renderer/hooks/mcp/market/kitScope';
import {
  SERVER_NAME_PATTERN,
  type CreateServerRequest,
  type ServerResponse,
  type UpdateServerRequest,
} from '@/common/types/platform/serverPools';

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** Category key of servers without a label. */
export const UNLABELLED = '__unlabelled__';

// ---------------------------------------------------------------------------
// What a scope gets (attachments with item_kind 'server', see kitScope)
// ---------------------------------------------------------------------------

export type ScopeServers = ScopeItems;
export type { ScopeToggle };

/** Servers a scope delivers (shared kit-scope rule, `item_kind: 'server'`). */
export const scopeServers = (attachments: readonly KitAttachmentResponse[], projectId: string | null): ScopeItems =>
  scopeItems(attachments, 'server', projectId);

/** The attachment row of one server at a scope's own level, if any. */
export const attachmentAt = (
  attachments: readonly KitAttachmentResponse[],
  serverId: string,
  projectId: string | null
): KitAttachmentResponse | undefined => scopeAttachment(attachments, 'server', serverId, projectId);

/** What flipping "On in <scope>" does for a server. */
export const scopeToggleAction = (
  attachments: readonly KitAttachmentResponse[],
  serverId: string,
  projectId: string | null,
  turnOn: boolean
): ScopeToggle => scopeToggle(attachments, 'server', serverId, projectId, turnOn);

/** Number of servers a project delivers (rail counts). */
export const projectServerCount = (attachments: readonly KitAttachmentResponse[], projectId: string): number =>
  projectItemCount(attachments, 'server', projectId);

/** Category keys (labels) of a server; `UNLABELLED` when it has none. */
export const serverCategories = (server: ServerResponse): string[] =>
  server.labels.length > 0 ? server.labels : [UNLABELLED];

export const serverMatches = (server: ServerResponse, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [server.name, server.host, server.ssh_user, server.notes, ...server.labels].some((field) =>
    field.toLowerCase().includes(q)
  );
};

/** `user@host` (`:port` when not 22). */
export const serverAddress = (server: Pick<ServerResponse, 'ssh_user' | 'host' | 'port'>): string =>
  `${server.ssh_user}@${server.host}${server.port && server.port !== 22 ? `:${server.port}` : ''}`;

// ---------------------------------------------------------------------------
// Host keys
// ---------------------------------------------------------------------------

export type HostKeyLine = { type: string; base64: string };

/** `<type> <base64>` lines (a known_hosts line with a leading host is accepted too). */
export const parseHostKeys = (text: string): HostKeyLine[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(/\s+/);
      const index = parts.findIndex((part) => /^(ssh-|ecdsa-|sk-)/.test(part));
      if (index < 0 || !parts[index + 1]) return null;
      return { type: parts[index] as string, base64: parts[index + 1] as string };
    })
    .filter((line): line is HostKeyLine => line !== null && /^[A-Za-z0-9+/]+={0,2}$/.test(line.base64));

/** `SHA256:…` exactly as `ssh-keygen -lf` prints it (unpadded base64 of the key blob's SHA-256). */
export const hostKeyFingerprint = async (base64: string): Promise<string> => {
  const blob = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', blob));
  let binary = '';
  digest.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `SHA256:${btoa(binary).replace(/=+$/, '')}`;
};

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export type ServerFormValues = {
  name: string;
  host: string;
  port: string;
  ssh_user: string;
  /** Empty = keep the stored key (edit) / missing (create). Never pre-filled. */
  private_key: string;
  host_key: string;
  labels: string[];
  environment: string;
  tier: string;
  notes: string;
  enabled: boolean;
};

export type ServerFormProblem =
  | 'nameRequired'
  | 'nameFormat'
  | 'hostRequired'
  | 'hostFormat'
  | 'portRange'
  | 'userRequired'
  | 'keyRequired'
  | 'keyPublic'
  | 'keyFormat'
  | 'keyPassphrase'
  | 'hostKeyFormat';

export const emptyServerForm = (): ServerFormValues => ({
  name: '',
  host: '',
  port: '22',
  ssh_user: '',
  private_key: '',
  host_key: '',
  labels: [],
  environment: 'staging',
  tier: 'read',
  notes: '',
  enabled: true,
});

export const serverFormOf = (server: ServerResponse): ServerFormValues => ({
  name: server.name,
  host: server.host,
  port: String(server.port || 22),
  ssh_user: server.ssh_user,
  private_key: '',
  host_key: server.host_key,
  labels: [...server.labels],
  environment: server.environment,
  tier: server.tier,
  notes: server.notes,
  enabled: server.enabled,
});

const PRIVATE_KEY =
  /-----BEGIN (OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY-----[\s\S]+-----END (OPENSSH|RSA|EC|DSA)? ?PRIVATE KEY-----/;

/** Field → problem; empty when the form can be saved. `existing` = editing (a key is optional). */
export const validateServerForm = (
  values: ServerFormValues,
  existing: ServerResponse | null
): Partial<Record<keyof ServerFormValues, ServerFormProblem>> => {
  const problems: Partial<Record<keyof ServerFormValues, ServerFormProblem>> = {};
  const name = values.name.trim();
  if (!name) problems.name = 'nameRequired';
  else if (!SERVER_NAME_PATTERN.test(name) || name.length > 64) problems.name = 'nameFormat';
  const host = values.host.trim();
  if (!host) problems.host = 'hostRequired';
  else if (!/^[A-Za-z0-9.:\-[\]]+$/.test(host)) problems.host = 'hostFormat';
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.port = 'portRange';
  if (!values.ssh_user.trim()) problems.ssh_user = 'userRequired';
  const key = values.private_key.trim();
  if (!key) {
    if (!existing?.has_key) problems.private_key = 'keyRequired';
  } else if (/^(ssh-|ecdsa-|sk-)/.test(key)) {
    problems.private_key = 'keyPublic';
  } else if (/ENCRYPTED|Proc-Type: 4,ENCRYPTED/.test(key)) {
    problems.private_key = 'keyPassphrase';
  } else if (!PRIVATE_KEY.test(key)) {
    problems.private_key = 'keyFormat';
  }
  if (values.host_key.trim() && parseHostKeys(values.host_key).length === 0) problems.host_key = 'hostKeyFormat';
  return problems;
};

/** The destination (host, port, user) differs from the stored one. */
export const destinationChanged = (values: ServerFormValues, existing: ServerResponse): boolean =>
  values.host.trim() !== existing.host ||
  Number(values.port) !== (existing.port || 22) ||
  values.ssh_user.trim() !== existing.ssh_user;

/** Normalised host-key text: one `<type> <base64>` per line. */
const hostKeyText = (text: string): string =>
  parseHostKeys(text)
    .map((line) => `${line.type} ${line.base64}`)
    .join('\n');

export const createRequest = (values: ServerFormValues): CreateServerRequest => ({
  name: values.name.trim(),
  host: values.host.trim(),
  port: Number(values.port),
  ssh_user: values.ssh_user.trim(),
  private_key: values.private_key.trim(),
  ...(values.host_key.trim() ? { host_key: hostKeyText(values.host_key) } : {}),
  labels: values.labels.map((label) => label.trim()).filter(Boolean),
  environment: values.environment,
  tier: values.tier,
  notes: values.notes.trim(),
  enabled: values.enabled,
});

/** Only what changed (PATCH semantics); the key only when a new one was typed. */
export const updateRequest = (values: ServerFormValues, existing: ServerResponse): UpdateServerRequest => {
  const next = createRequest(values);
  const request: UpdateServerRequest = {};
  if (next.name !== existing.name) request.name = next.name;
  if (next.host !== existing.host) request.host = next.host;
  if (next.port !== (existing.port || 22)) request.port = next.port;
  if (next.ssh_user !== existing.ssh_user) request.ssh_user = next.ssh_user;
  if (next.private_key) request.private_key = next.private_key;
  const hostKey = values.host_key.trim() ? hostKeyText(values.host_key) : '';
  // A new destination clears the stored host key on the server unless one is sent.
  if (hostKey !== existing.host_key || (destinationChanged(values, existing) && hostKey)) request.host_key = hostKey;
  if (JSON.stringify(next.labels) !== JSON.stringify(existing.labels)) request.labels = next.labels;
  if (next.environment !== existing.environment) request.environment = next.environment;
  if (next.tier !== existing.tier) request.tier = next.tier;
  if (next.notes !== existing.notes) request.notes = next.notes;
  if (next.enabled !== existing.enabled) request.enabled = next.enabled;
  return request;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const describeServerError = (t: TFn, error: unknown): string => {
  if (!isBackendHttpError(error)) {
    return error instanceof Error && error.message ? error.message : t('settings.servers.errors.generic');
  }
  const detail = error.backendMessage.trim();
  switch (error.code) {
    case 'SERVER_INVALID':
      return detail ? t('settings.servers.errors.invalid', { detail }) : t('settings.servers.errors.generic');
    case 'SERVER_NAME_TAKEN':
      return t('settings.servers.errors.nameTaken');
    case 'SERVER_NOT_FOUND':
      return t('settings.servers.errors.notFound');
    case 'SERVER_POOL_UNAVAILABLE':
      return t('settings.servers.errors.unavailable');
    case 'SERVER_UNREACHABLE':
      return t('settings.servers.errors.unreachable');
    case 'MCP_MARKET_SESSION_REQUIRED':
    case 'UNAUTHORIZED':
      return t('settings.servers.errors.sessionRequired');
    case 'CSRF_INVALID':
      return t('settings.servers.errors.csrf');
    default:
      return detail || t('settings.servers.errors.generic');
  }
};

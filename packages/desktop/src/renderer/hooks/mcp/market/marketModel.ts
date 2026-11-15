/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP market (card C15) view model: pure helpers shared by the market hook and
 * the Tools page market view. The backend (AionCore market service) is the
 * source of truth for every rule; the checks here only explain a rule before
 * the request is sent, and every refusal still comes from the server.
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { MCP_SECRET_MASK } from '@/common/config/storage';
import type {
  IMcpServer,
  McpMarketAssignment,
  McpMarketCli,
  McpMarketInstance,
  McpMarketTemplate,
} from '@/common/config/storage';

/** The only extension whose `mcpServers` entries are market templates (AionCore `CATALOG_EXTENSION`). */
export const MCP_CATALOG_EXTENSION = 'studio-mcp-catalog';
/** R2: the only instances that may be assigned globally. */
export const MCP_GLOBAL_INSTANCE_IDS: readonly string[] = ['context7', 'studio-memory'];
export const MCP_MARKET_CLIS: readonly McpMarketCli[] = ['claude', 'codex', 'gemini'];
export const MCP_MARKET_ENVIRONMENTS: readonly string[] = ['production', 'staging', 'sandbox', 'local'];
/** R1 #14: name length limit. */
export const MCP_INSTANCE_NAME_MAX = 24;
/** The response mask of hidden values; never a real value. */
/** The mask AionCore shows instead of a secret value (one definition, common/config/storage.ts). */
export const MCP_MASK = MCP_SECRET_MASK;

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const RESERVED_NAMES = new Set(['aionui-team', 'aionui']);
/** R11, matched as prefixes. */
const NOT_IN_MARKET = [
  'playwright',
  'mcp-playwright',
  'chrome-devtools',
  'github',
  'codex-cli',
  'gemini-cli',
  'sequential-thinking',
  'serena',
  'openai-image',
];
const APPROVAL_REF_PATTERN = /^OA-\d{8}-[a-z0-9]+(-[a-z0-9]+)*$/;

type TFn = (key: string, options?: Record<string, unknown>) => string;

// ---------------------------------------------------------------------------
// Validation (explains the server's rules; the server decides)
// ---------------------------------------------------------------------------

export type InstanceNameProblem = 'required' | 'pattern' | 'tooLong' | 'reserved' | 'notInMarket' | 'taken';

/** The first problem of an instance name, or `null` when the server's rules allow it. */
export const instanceNameProblem = (name: string, takenNames: readonly string[] = []): InstanceNameProblem | null => {
  if (!name) return 'required';
  if (name.length > MCP_INSTANCE_NAME_MAX) return 'tooLong';
  if (!NAME_PATTERN.test(name)) return 'pattern';
  if (RESERVED_NAMES.has(name)) return 'reserved';
  if (NOT_IN_MARKET.some((prefix) => name.startsWith(prefix))) return 'notInMarket';
  if (takenNames.includes(name)) return 'taken';
  return null;
};

/** Owner approval record id: `OA-<yyyymmdd>-<slug>` (AionCore `is_valid_approval_ref`). */
export const isValidApprovalRef = (value: string): boolean => APPROVAL_REF_PATTERN.test(value);

/** Production write instances stay dormant until the owner's written approval is recorded (owner decision 3). */
export const needsApprovalRef = (instance: Pick<McpMarketInstance, 'tier' | 'environment'>): boolean =>
  instance.tier === 'write' && instance.environment === 'production';

/** A value the user pasted from a masked response: it has to be re-entered. */
export const isMaskedValue = (value: string): boolean => value.includes(MCP_MASK);

/** CLIs an instance may be delivered to: its own list; write instances are Claude-only (R3). */
export const allowedClis = (instance: Pick<McpMarketInstance, 'clis' | 'tier'>): string[] =>
  MCP_MARKET_CLIS.filter((cli) => instance.clis.includes(cli) && (instance.tier !== 'write' || cli === 'claude'));

/** CLIs a template offers for a tier (write = Claude only). */
export const templateClisForTier = (template: Pick<McpMarketTemplate, 'clis'>, tier: string): string[] =>
  MCP_MARKET_CLIS.filter((cli) => template.clis.includes(cli) && (tier !== 'write' || cli === 'claude'));

/** Why an instance cannot be global, or `null` when it can (R2, R3). */
export const globalBlockReason = (instance: Pick<McpMarketInstance, 'name' | 'tier'>): 'write' | 'notGlobal' | null => {
  if (instance.tier === 'write') return 'write';
  if (!MCP_GLOBAL_INSTANCE_IDS.includes(instance.name)) return 'notGlobal';
  return null;
};

/** Versions of a pending template update (`from` = the instance's snapshot, `to` = the catalogue). */
export const templateUpdate = (
  instance: Pick<McpMarketInstance, 'template_update_available' | 'template_version' | 'template_current_version'>
): { from?: string; to?: string } | null =>
  instance.template_update_available
    ? { from: instance.template_version, to: instance.template_current_version }
    : null;

/**
 * Secret keys the catalogue's current template declares that the instance's
 * snapshot does not have yet: a refresh is refused until the required ones are
 * set (409 `MCP_TEMPLATE_SECRET_MISSING`); the secrets route accepts them first.
 */
export const pendingTemplateSecretKeys = (
  instance: Pick<McpMarketInstance, 'template_update_available' | 'secrets'>,
  template: Pick<McpMarketTemplate, 'env'> | undefined
): string[] =>
  instance.template_update_available && template
    ? secretKeys(template).filter((key) => !instance.secrets.some((s) => s.key === key))
    : [];

/** The keys a `MCP_TEMPLATE_SECRET_MISSING` refusal names ("… needs secret A, B first; …"). */
export const missingSecretKeysOf = (error: unknown): string[] => {
  if (!isBackendHttpError(error) || error.code !== 'MCP_TEMPLATE_SECRET_MISSING') return [];
  const match = /needs secrets? (.+?) first/.exec(error.backendMessage);
  return match
    ? match[1]
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [];
};

/** Plain env keys of a template, sorted. */
export const plainKeys = (template: Pick<McpMarketTemplate, 'env'>): string[] =>
  Object.keys(template.env)
    .filter((key) => template.env[key].kind === 'plain')
    .sort();

/** Secret env keys of a template, sorted. */
export const secretKeys = (template: Pick<McpMarketTemplate, 'env'>): string[] =>
  Object.keys(template.env)
    .filter((key) => template.env[key].kind === 'secret')
    .sort();

/** Plain values the tier forces (they cannot be edited). */
export const forcedPlainEnv = (template: Pick<McpMarketTemplate, 'tier_env'>, tier: string): Record<string, string> =>
  template.tier_env?.[tier] ?? {};

// ---------------------------------------------------------------------------
// Attachments (assignment model: global | project | project + assistant, per CLI)
// ---------------------------------------------------------------------------

export type AttachScope =
  | { kind: 'global' }
  | { kind: 'project'; projectId: string }
  | {
      kind: 'assistant';
      projectId: string;
      assistantId: string;
    };

/** One place an instance is attached, with the CLIs it reaches there. */
export type AttachmentSummary = {
  key: string;
  scope: AttachScope;
  clis: Array<{ cli: string; assignmentId: string }>;
};

export const scopeOfAssignment = (a: Pick<McpMarketAssignment, 'project_id' | 'assistant_id'>): AttachScope => {
  if (!a.project_id) return { kind: 'global' };
  if (a.assistant_id) return { kind: 'assistant', projectId: a.project_id, assistantId: a.assistant_id };
  return { kind: 'project', projectId: a.project_id };
};

export const scopeKey = (scope: AttachScope): string => {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${scope.projectId}`;
    case 'assistant':
      return `assistant:${scope.projectId}:${scope.assistantId}`;
  }
};

/** Attachments of one instance, grouped by scope (global first, then by key), CLIs in a fixed order. */
export const summarizeAttachments = (
  instanceId: string,
  assignments: readonly McpMarketAssignment[]
): AttachmentSummary[] => {
  const byKey = new Map<string, AttachmentSummary>();
  for (const a of assignments) {
    if (a.instance_id !== instanceId) continue;
    const scope = scopeOfAssignment(a);
    const key = scopeKey(scope);
    const entry = byKey.get(key) ?? { key, scope, clis: [] };
    entry.clis.push({ cli: a.cli, assignmentId: a.id });
    byKey.set(key, entry);
  }
  const order = (cli: string) => {
    const index = MCP_MARKET_CLIS.indexOf(cli as McpMarketCli);
    return index === -1 ? MCP_MARKET_CLIS.length : index;
  };
  const entries = [...byKey.values()];
  for (const entry of entries) entry.clis = entry.clis.toSorted((x, y) => order(x.cli) - order(y.cli));
  return entries.toSorted((x, y) => (x.key === 'global' ? -1 : y.key === 'global' ? 1 : x.key.localeCompare(y.key)));
};

export type AttachConflict = { cli: string; reason: 'alreadyAttached' | 'otherChannel' };

/**
 * CLIs that cannot be attached in `scope` because of an existing assignment:
 * the same (scope, cli) row exists (unique), or the instance already reaches
 * that CLI in the project through the other channel (R7: native file or
 * assistant binding, never both).
 */
export const attachConflicts = (
  instanceId: string,
  scope: AttachScope,
  assignments: readonly McpMarketAssignment[]
): AttachConflict[] => {
  const out: AttachConflict[] = [];
  const key = scopeKey(scope);
  for (const a of assignments) {
    if (a.instance_id !== instanceId) continue;
    const other = scopeOfAssignment(a);
    if (scopeKey(other) === key) {
      out.push({ cli: a.cli, reason: 'alreadyAttached' });
    } else if (
      scope.kind !== 'global' &&
      other.kind !== 'global' &&
      other.projectId === scope.projectId &&
      (other.kind === 'assistant') !== (scope.kind === 'assistant')
    ) {
      out.push({ cli: a.cli, reason: 'otherChannel' });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Grouping: Global, one group per project, Unassigned
// ---------------------------------------------------------------------------

/** A project the sidebar lists (`useStandardProjects`); only ones with a backend id can be attached. */
export type MarketProject = { workspace: string; name: string; project_id?: string };

export type MarketProjectGroup = {
  projectId: string;
  /** `null` when the assignment names a project the sidebar does not list. */
  project: MarketProject | null;
  instances: McpMarketInstance[];
};

export type MarketGroups = {
  global: McpMarketInstance[];
  projects: MarketProjectGroup[];
  unassigned: McpMarketInstance[];
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Group market instances: Global (a global assignment), one group per project
 * (an instance shows in every project it is attached to, whole project or an
 * assistant of it), and Unassigned. Every listed project gets a group, even an
 * empty one, so something can be attached to it.
 */
export const groupMarketInstances = (
  instances: readonly McpMarketInstance[],
  assignments: readonly McpMarketAssignment[],
  projects: readonly MarketProject[]
): MarketGroups => {
  const known = new Set(instances.map((i) => i.id));
  const globalIds = new Set<string>();
  const projectInstances = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!known.has(a.instance_id)) continue;
    if (!a.project_id) {
      globalIds.add(a.instance_id);
      continue;
    }
    const set = projectInstances.get(a.project_id) ?? new Set<string>();
    set.add(a.instance_id);
    projectInstances.set(a.project_id, set);
  }
  const sorted = [...instances].toSorted(byName);
  const pick = (ids: Set<string> | undefined) => sorted.filter((i) => ids?.has(i.id));

  const groups: MarketProjectGroup[] = [];
  const seen = new Set<string>();
  for (const project of [...projects].toSorted(byName)) {
    if (!project.project_id || seen.has(project.project_id)) continue;
    seen.add(project.project_id);
    groups.push({ projectId: project.project_id, project, instances: pick(projectInstances.get(project.project_id)) });
  }
  for (const [projectId, ids] of [...projectInstances.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (seen.has(projectId)) continue;
    groups.push({ projectId, project: null, instances: pick(ids) });
  }

  const attached = new Set(globalIds);
  for (const ids of projectInstances.values()) for (const id of ids) attached.add(id);
  return {
    global: pick(globalIds),
    projects: groups,
    unassigned: sorted.filter((i) => !attached.has(i.id)),
  };
};

// ---------------------------------------------------------------------------
// Search and filters
// ---------------------------------------------------------------------------

export type MarketStatusFilter = 'all' | 'active' | 'dormant' | 'revoked' | 'missing';

const includesQuery = (query: string, ...fields: Array<string | undefined>) =>
  fields.some((field) => field?.toLowerCase().includes(query));

export const instanceMatches = (
  instance: McpMarketInstance,
  query: string,
  status: MarketStatusFilter,
  template?: McpMarketTemplate
): boolean => {
  if (status === 'missing' ? instance.missing.length === 0 : status !== 'all' && instance.status !== status) {
    return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return includesQuery(
    q,
    instance.name,
    instance.description,
    instance.template_id,
    template?.name,
    instance.environment,
    instance.tier,
    instance.status
  );
};

export const templateMatches = (template: McpMarketTemplate, query: string): boolean => {
  const q = query.trim().toLowerCase();
  return !q || includesQuery(q, template.id, template.name, template.description);
};

/** Legacy (non-market) servers have no market status: only `all` shows them. */
export const legacyServerMatches = (server: IMcpServer, query: string, status: MarketStatusFilter): boolean => {
  if (status !== 'all') return false;
  const q = query.trim().toLowerCase();
  return !q || includesQuery(q, server.name, server.description);
};

/** Legacy rows and extension servers without the market ones (rows are listed raw by the market, R1 #16). */
export const withoutMarketRows = <T extends { id: string; name: string }>(
  servers: readonly T[],
  instances: readonly Pick<McpMarketInstance, 'id' | 'name'>[]
): T[] => {
  const ids = new Set(instances.map((i) => i.id));
  const names = new Set(instances.map((i) => i.name));
  return servers.filter((s) => !ids.has(s.id) && !names.has(s.name));
};

// ---------------------------------------------------------------------------
// Errors: backend refusal → plain words
// ---------------------------------------------------------------------------

/**
 * The instance was created but some of its secrets were not saved (create and
 * set-secret are separate requests). The instance exists: callers treat the
 * create as done and tell the user which keys to set in the drawer.
 */
export class McpMarketSecretsNotSavedError extends Error {
  constructor(
    readonly instance: McpMarketInstance,
    readonly keys: string[]
  ) {
    super(`MCP instance ${instance.name} created; secrets not saved: ${keys.join(', ')}`);
    this.name = 'McpMarketSecretsNotSavedError';
  }
}

export type MarketErrorContext = 'generic' | 'name' | 'attach' | 'secret' | 'refresh' | 'activate';

/** Whether a backend refusal is about a masked ("•••") value that has to be re-entered. */
export const isMaskedValueError = (error: unknown): boolean =>
  isBackendHttpError(error) &&
  (error.code === 'MCP_MASKED_VALUE' || (error.status === 400 && error.backendMessage.includes(MCP_MASK)));

/**
 * A user-facing message for a failed MCP market (or legacy MCP) request. The
 * backend's own message is shown as the detail where it explains a rule; it
 * names keys and rules only, never a value.
 */
export const describeMarketError = (t: TFn, error: unknown, context: MarketErrorContext = 'generic'): string => {
  if (isMaskedValueError(error)) return t('mcp.market.errors.maskedValue');
  if (!isBackendHttpError(error)) {
    return error instanceof Error && error.message ? error.message : t('mcp.market.errors.generic');
  }
  const detail = error.backendMessage.trim();
  switch (error.code) {
    case 'MCP_MARKET_SESSION_REQUIRED':
    case 'UNAUTHORIZED':
      return t('mcp.market.errors.sessionRequired');
    case 'MCP_MARKET_FORBIDDEN':
    case 'FORBIDDEN':
      return t('mcp.market.errors.forbidden');
    case 'CSRF_INVALID':
      return t('mcp.market.errors.csrf');
    case 'MCP_MARKET_UNAVAILABLE':
      return t('mcp.market.errors.catalogueUnavailable');
    case 'MCP_TEMPLATE_SECRET_MISSING': {
      const keys = missingSecretKeysOf(error);
      return keys.length > 0
        ? t('mcp.market.errors.templateSecretMissing', { keys: keys.join(', ') })
        : t('mcp.market.errors.templateSecretMissingUnknown', { detail });
    }
    case 'MCP_MARKET_INVALID':
      return detail ? t('mcp.market.errors.rejected', { detail }) : t('mcp.market.errors.generic');
    case 'CONFLICT':
      if (context === 'attach') return t('mcp.market.errors.alreadyAttached', { detail });
      if (context === 'name') return t('mcp.market.errors.nameTaken', { detail });
      return t('mcp.market.errors.conflict', { detail });
    case 'NOT_FOUND':
      return t('mcp.market.errors.notFound');
    case 'PAYLOAD_TOO_LARGE':
      return t('mcp.market.errors.tooLarge');
    case 'RATE_LIMITED':
      return t('mcp.market.errors.rateLimited');
    case 'INTERNAL_ERROR':
      return t('mcp.market.errors.internal');
    case 'BAD_GATEWAY':
    case 'GATEWAY_TIMEOUT':
      return t('mcp.market.errors.upstream');
  }
  // Codes this view does not know (older or newer backends): by status.
  if (error.status === 409) return t('mcp.market.errors.conflict', { detail });
  if (error.status === 400 || error.status === 422) {
    return detail ? t('mcp.market.errors.rejected', { detail }) : t('mcp.market.errors.generic');
  }
  if (error.status === 401) return t('mcp.market.errors.sessionRequired');
  if (error.status === 403) return t('mcp.market.errors.forbidden');
  if (error.status >= 500) return t('mcp.market.errors.internal');
  return detail || t('mcp.market.errors.generic');
};

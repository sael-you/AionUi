/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP market view model (card C15): grouping, attachment conflicts, name and
 * approval-reference checks, error mapping.
 */

import { describe, expect, it } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { McpMarketAssignment, McpMarketInstance } from '@/common/config/storage';
import {
  attachConflicts,
  describeMarketError,
  globalBlockReason,
  groupMarketInstances,
  instanceMatches,
  instanceNameProblem,
  isMaskedValueError,
  isValidApprovalRef,
  needsApprovalRef,
  summarizeAttachments,
  missingSecretKeysOf,
  pendingTemplateSecretKeys,
  templateUpdate,
  withoutMarketRows,
  allowedClis,
} from '@/renderer/hooks/mcp/market/marketModel';

const inst = (name: string, extra: Partial<McpMarketInstance> = {}): McpMarketInstance => ({
  id: `id-${name}`,
  name,
  template_id: 'paddle',
  transport: 'stdio',
  environment: 'production',
  tier: 'read',
  enforcement: 'server',
  status: 'dormant',
  clis: ['claude', 'codex', 'gemini'],
  plain_env: {},
  secrets: [],
  missing: [],
  tools_allow: [],
  tools_block: [],
  tools_seen: [],
  last_test_status: 'unknown',
  template_in_catalogue: true,
  template_update_available: false,
  created_at: 1,
  updated_at: 1,
  ...extra,
});

let seq = 0;
const asg = (instance: McpMarketInstance, cli: string, project_id?: string, assistant_id?: string) =>
  ({
    id: `a${++seq}`,
    instance_id: instance.id,
    instance_name: instance.name,
    project_id,
    assistant_id,
    cli,
    created_at: 1,
  }) as McpMarketAssignment;

const err = (status: number, code: string, error = '') =>
  new BackendHttpError({ method: 'POST', path: '/api/mcp/market/x', status, body: { success: false, error, code } });

const t = (key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key}|${JSON.stringify(options)}` : key;

describe('groupMarketInstances', () => {
  const projects = [
    { workspace: '/p/beta', name: 'beta', project_id: 'p-beta' },
    { workspace: '/p/alpha', name: 'alpha', project_id: 'p-alpha' },
    { workspace: '/p/no-id', name: 'no-id' },
  ];

  it('groups by Global, by project (every project it is attached to) and Unassigned', () => {
    const ctx = inst('context7');
    const paddle = inst('tb-paddle-prod-read');
    const resend = inst('tb-resend-drafts');
    const lonely = inst('tb-lonely');
    const assignments = [
      asg(ctx, 'claude'),
      asg(paddle, 'claude', 'p-alpha'),
      asg(paddle, 'codex', 'p-beta', 'asst-1'),
      asg(resend, 'claude', 'p-alpha'),
    ];

    const groups = groupMarketInstances([lonely, resend, paddle, ctx], assignments, projects);

    expect(groups.global.map((i) => i.name)).toEqual(['context7']);
    // Projects sorted by name; projects without a backend id get no group.
    expect(groups.projects.map((g) => g.projectId)).toEqual(['p-alpha', 'p-beta']);
    expect(groups.projects[0].instances.map((i) => i.name)).toEqual(['tb-paddle-prod-read', 'tb-resend-drafts']);
    // An assistant binding puts the instance in that project too.
    expect(groups.projects[1].instances.map((i) => i.name)).toEqual(['tb-paddle-prod-read']);
    expect(groups.unassigned.map((i) => i.name)).toEqual(['tb-lonely']);
  });

  it('keeps empty project groups and adds groups for projects the sidebar does not list', () => {
    const x = inst('tb-x');
    const groups = groupMarketInstances([x], [asg(x, 'claude', 'p-gone')], projects);
    expect(groups.projects.map((g) => [g.projectId, g.instances.length, g.project?.name ?? null])).toEqual([
      ['p-alpha', 0, 'alpha'],
      ['p-beta', 0, 'beta'],
      ['p-gone', 1, null],
    ]);
    expect(groups.unassigned).toEqual([]);
  });

  it('ignores assignments of instances that are filtered out', () => {
    const shown = inst('tb-shown');
    const hidden = inst('tb-hidden');
    const groups = groupMarketInstances([shown], [asg(hidden, 'claude'), asg(hidden, 'claude', 'p-alpha')], projects);
    expect(groups.global).toEqual([]);
    expect(groups.projects[0].instances).toEqual([]);
    expect(groups.unassigned.map((i) => i.name)).toEqual(['tb-shown']);
  });
});

describe('summarizeAttachments', () => {
  it('groups CLIs by scope, Global first, CLIs in a fixed order', () => {
    const x = inst('tb-x');
    const rows = [asg(x, 'gemini', 'p1'), asg(x, 'claude', 'p1'), asg(x, 'codex'), asg(x, 'claude', 'p1', 'a1')];
    const summary = summarizeAttachments(x.id, rows);
    expect(summary.map((s) => [s.key, s.clis.map((c) => c.cli)])).toEqual([
      ['global', ['codex']],
      ['assistant:p1:a1', ['claude']],
      ['project:p1', ['claude', 'gemini']],
    ]);
  });
});

describe('attachConflicts', () => {
  const x = inst('tb-x');
  const rows = [asg(x, 'claude', 'p1'), asg(x, 'codex', 'p1', 'a1'), asg(x, 'gemini')];

  it('flags the same (scope, cli) as already attached', () => {
    expect(attachConflicts(x.id, { kind: 'project', projectId: 'p1' }, rows)).toEqual([
      { cli: 'claude', reason: 'alreadyAttached' },
      { cli: 'codex', reason: 'otherChannel' },
    ]);
    expect(attachConflicts(x.id, { kind: 'global' }, rows)).toEqual([{ cli: 'gemini', reason: 'alreadyAttached' }]);
  });

  it('flags the other channel in the same project (R7) and nothing in another project', () => {
    expect(attachConflicts(x.id, { kind: 'assistant', projectId: 'p1', assistantId: 'a2' }, rows)).toEqual([
      { cli: 'claude', reason: 'otherChannel' },
    ]);
    expect(attachConflicts(x.id, { kind: 'project', projectId: 'p2' }, rows)).toEqual([]);
  });
});

describe('rules explained client-side', () => {
  it('checks instance names like the server (R1 #14, R11)', () => {
    expect(instanceNameProblem('')).toBe('required');
    expect(instanceNameProblem('tb-paddle-prod-read')).toBeNull();
    expect(instanceNameProblem('Tb')).toBe('pattern');
    expect(instanceNameProblem('tb--x')).toBe('pattern');
    expect(instanceNameProblem('tb_x')).toBe('pattern');
    expect(instanceNameProblem('a-very-long-instance-name-x')).toBe('tooLong');
    expect(instanceNameProblem('aionui-team')).toBe('reserved');
    expect(instanceNameProblem('github-x')).toBe('notInMarket');
    expect(instanceNameProblem('tb-x', ['tb-x'])).toBe('taken');
  });

  it('accepts only OA-<yyyymmdd>-<slug> approval references', () => {
    expect(isValidApprovalRef('OA-20261115-paddle-prod')).toBe(true);
    expect(isValidApprovalRef('OA-2026111-paddle')).toBe(false);
    expect(isValidApprovalRef('OA-20261115-')).toBe(false);
    expect(isValidApprovalRef('OA-20261115-Paddle')).toBe(false);
    expect(isValidApprovalRef('ok')).toBe(false);
    expect(isValidApprovalRef('')).toBe(false);
  });

  it('requires an approval reference for production write instances only', () => {
    expect(needsApprovalRef({ tier: 'write', environment: 'production' })).toBe(true);
    expect(needsApprovalRef({ tier: 'write', environment: 'sandbox' })).toBe(false);
    expect(needsApprovalRef({ tier: 'read', environment: 'production' })).toBe(false);
  });

  it('limits write instances to Claude and to non-global scopes', () => {
    expect(allowedClis(inst('tb-w', { tier: 'write' }))).toEqual(['claude']);
    expect(allowedClis(inst('tb-r', { clis: ['gemini', 'claude'] }))).toEqual(['claude', 'gemini']);
    expect(globalBlockReason(inst('context7'))).toBeNull();
    expect(globalBlockReason(inst('context7', { tier: 'write' }))).toBe('write');
    expect(globalBlockReason(inst('tb-x'))).toBe('notGlobal');
  });

  it('reports a pending template update with both versions, from the backend flag', () => {
    expect(
      templateUpdate({ template_update_available: true, template_version: '0.1.0', template_current_version: '0.2.0' })
    ).toEqual({ from: '0.1.0', to: '0.2.0' });
    expect(
      templateUpdate({ template_update_available: false, template_version: '0.1.0', template_current_version: '0.2.0' })
    ).toBeNull();
  });

  it('lists the secret keys a pending template adds', () => {
    const template = {
      env: {
        API_KEY: { kind: 'secret' as const, required: true },
        NEW_TOKEN: { kind: 'secret' as const, required: true },
        MODE: { kind: 'plain' as const },
      },
    };
    const withSecret = inst('tb-x', {
      template_update_available: true,
      secrets: [{ key: 'API_KEY', name: 'N', instance_id: 'i', instance_name: 'tb-x', required: true, set: true }],
    });
    expect(pendingTemplateSecretKeys(withSecret, template)).toEqual(['NEW_TOKEN']);
    expect(pendingTemplateSecretKeys({ ...withSecret, template_update_available: false }, template)).toEqual([]);
  });

  it('reads the keys of a MCP_TEMPLATE_SECRET_MISSING refusal', () => {
    const refusal = err(
      409,
      'MCP_TEMPLATE_SECRET_MISSING',
      'template paddle 0.2.0 needs secret NEW_TOKEN, OTHER first; the instance stays on its current version'
    );
    expect(missingSecretKeysOf(refusal)).toEqual(['NEW_TOKEN', 'OTHER']);
    expect(missingSecretKeysOf(err(409, 'CONFLICT', 'needs secret X first'))).toEqual([]);
  });
});

describe('filters', () => {
  it('matches search text and status, and "missing" shows instances with missing values', () => {
    const a = inst('tb-paddle', { status: 'active' });
    const b = inst('tb-resend', { missing: ['RESEND_API_KEY'] });
    expect(instanceMatches(a, 'PADDLE', 'all')).toBe(true);
    expect(instanceMatches(a, 'resend', 'all')).toBe(false);
    expect(instanceMatches(a, '', 'dormant')).toBe(false);
    expect(instanceMatches(b, '', 'missing')).toBe(true);
    expect(instanceMatches(a, '', 'missing')).toBe(false);
  });

  it('removes market rows from the legacy list by id or name', () => {
    const rows = [
      { id: 'id-tb-x', name: 'tb-x' },
      { id: 'legacy-1', name: 'my-server' },
      { id: 'other', name: 'tb-y' },
    ];
    expect(withoutMarketRows(rows, [inst('tb-x'), inst('tb-y')]).map((r) => r.id)).toEqual(['legacy-1']);
  });
});

describe('describeMarketError', () => {
  it('explains masked-value refusals in plain words', () => {
    expect(isMaskedValueError(err(400, 'MCP_MASKED_VALUE', 'a value is masked'))).toBe(true);
    // An older backend: a plain 400 whose message names the mask.
    expect(isMaskedValueError(err(400, 'BAD_REQUEST', 'a value is masked ("•••"); enter the real value'))).toBe(true);
    expect(isMaskedValueError(err(400, 'BAD_REQUEST', 'other'))).toBe(false);
    expect(describeMarketError(t, err(400, 'MCP_MASKED_VALUE'))).toBe('mcp.market.errors.maskedValue');
  });

  it('maps 409 by context: name taken vs already attached', () => {
    const conflict = err(409, 'CONFLICT', "MCP server name 'tb-x' already exists");
    expect(describeMarketError(t, conflict, 'name')).toContain('mcp.market.errors.nameTaken');
    expect(describeMarketError(t, conflict, 'name')).toContain('already exists');
    expect(describeMarketError(t, conflict, 'attach')).toContain('mcp.market.errors.alreadyAttached');
    expect(describeMarketError(t, conflict)).toContain('mcp.market.errors.conflict');
  });

  it('maps session, CSRF, catalogue, template-secret and not-found codes', () => {
    expect(describeMarketError(t, err(403, 'MCP_MARKET_SESSION_REQUIRED'))).toBe('mcp.market.errors.sessionRequired');
    expect(describeMarketError(t, err(403, 'CSRF_INVALID'))).toBe('mcp.market.errors.csrf');
    expect(describeMarketError(t, err(503, 'MCP_MARKET_UNAVAILABLE'))).toBe('mcp.market.errors.catalogueUnavailable');
    expect(
      describeMarketError(t, err(409, 'MCP_TEMPLATE_SECRET_MISSING', 'template p 2 needs secret API_KEY first; stays'))
    ).toBe('mcp.market.errors.templateSecretMissing|{"keys":"API_KEY"}');
    expect(describeMarketError(t, err(409, 'MCP_TEMPLATE_SECRET_MISSING', 'odd'))).toContain(
      'mcp.market.errors.templateSecretMissingUnknown'
    );
    expect(describeMarketError(t, err(404, 'NOT_FOUND'))).toBe('mcp.market.errors.notFound');
  });

  it('maps every backend code to its own message', () => {
    const cases: Array<[number, string, string]> = [
      [403, 'MCP_MARKET_FORBIDDEN', 'mcp.market.errors.forbidden'],
      [403, 'FORBIDDEN', 'mcp.market.errors.forbidden'],
      [401, 'UNAUTHORIZED', 'mcp.market.errors.sessionRequired'],
      [413, 'PAYLOAD_TOO_LARGE', 'mcp.market.errors.tooLarge'],
      [429, 'RATE_LIMITED', 'mcp.market.errors.rateLimited'],
      [500, 'INTERNAL_ERROR', 'mcp.market.errors.internal'],
      [502, 'BAD_GATEWAY', 'mcp.market.errors.upstream'],
      [504, 'GATEWAY_TIMEOUT', 'mcp.market.errors.upstream'],
      [500, 'SOMETHING_NEW', 'mcp.market.errors.internal'],
    ];
    for (const [status, code, key] of cases) expect(describeMarketError(t, err(status, code))).toBe(key);
    expect(describeMarketError(t, err(400, 'MCP_MARKET_INVALID', 'R3'))).toBe(
      'mcp.market.errors.rejected|{"detail":"R3"}'
    );
  });

  it('shows the server rule for a 400 and falls back to a generic message', () => {
    expect(describeMarketError(t, err(400, 'MCP_MARKET_INVALID', 'write instances are Claude-only'))).toBe(
      'mcp.market.errors.rejected|{"detail":"write instances are Claude-only"}'
    );
    expect(describeMarketError(t, err(400, 'MCP_MARKET_INVALID'))).toBe('mcp.market.errors.generic');
    expect(describeMarketError(t, new Error('network down'))).toBe('network down');
    expect(describeMarketError(t, 'weird')).toBe('mcp.market.errors.generic');
  });
});

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { KitAttachmentResponse, KitEffectiveItem, KitResponse } from '@/common/config/storage';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  attachRequest,
  describeImportError,
  describeKitError,
  importInstanceName,
  createKitRequest,
  globalAttachBlock,
  kitAttachmentLevels,
  kitFormFromKit,
  sortEffectiveItems,
  updateKitRequest,
  validateKitForm,
} from '@/renderer/hooks/mcp/market/kitModel';

const kit: KitResponse = {
  id: 'k1',
  name: 'Platform Dev',
  description: 'Build AionUi',
  builtin_key: 'K1',
  skills: ['cs-build', 'pf-ui'],
  mcps: [{ instance_id: 'i-ctx', instance_name: 'context7' }],
  mcp_templates: ['github'],
  created_at: 1,
  updated_at: 42,
};

const attachment = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'a',
  level: 'global',
  target_id: '',
  item_kind: 'kit',
  item_ref: 'k1',
  item_name: 'Platform Dev',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

const item = (ref: string, included: boolean, name?: string): KitEffectiveItem => ({
  kind: name ? 'mcp' : 'skill',
  item_ref: ref,
  included,
  provenance: { level: 'global', op: included ? 'add' : 'remove' },
  ...(name
    ? { mcp: { instance_name: name, status: 'active', clis: [], delivered: true, shadowed_by_project_file: false } }
    : {}),
});

/** `t` stand-ins: key with options, and key only. */
const echoT = (key: string, options?: Record<string, unknown>) => `${key}|${JSON.stringify(options)}`;
const keyT = (key: string) => key;

describe('kitModel', () => {
  it('sends exactly the CreateKitRequest fields, trimmed, sorted and de-duplicated', () => {
    const request = createKitRequest({
      name: '  Ops  ',
      description: '  ',
      skills: ['pf-ui', 'cs-build', 'pf-ui', ' '],
      mcpInstanceIds: ['b', 'a'],
      mcpTemplates: [],
    });

    expect(request).toEqual({
      name: 'Ops',
      skills: ['cs-build', 'pf-ui'],
      mcp_instance_ids: ['a', 'b'],
      mcp_templates: [],
    });
    expect(Object.keys(request)).not.toContain('description');
  });

  it('creates a project kit with project_id only when a project is given', () => {
    const values = { ...kitFormFromKit(null), name: 'TB-test' };
    expect(createKitRequest(values, 'proj-tb')).toEqual({
      name: 'TB-test',
      project_id: 'proj-tb',
      skills: [],
      mcp_instance_ids: [],
      mcp_templates: [],
    });
    expect(Object.keys(createKitRequest(values))).not.toContain('project_id');
  });

  it('replaces every member set on update, guarded by the updated_at the editor opened with', () => {
    const request = updateKitRequest(kit, { ...kitFormFromKit(kit), skills: ['pf-core'] });

    expect(request).toEqual({
      name: 'Platform Dev',
      description: 'Build AionUi',
      skills: ['pf-core'],
      mcp_instance_ids: ['i-ctx'],
      mcp_templates: ['github'],
      expected_updated_at: 42,
    });
  });

  it('validates the name length and skill names like the server', () => {
    const base = kitFormFromKit(null);
    expect(validateKitForm(base)).toBe('nameRequired');
    expect(validateKitForm({ ...base, name: 'x'.repeat(81) })).toBe('nameTooLong');
    expect(validateKitForm({ ...base, name: 'x'.repeat(80) })).toBeNull();
    expect(validateKitForm({ ...base, name: 'Ok', skills: ['bad name'] })).toBe('skillInvalid');
  });

  it('omits target_id at the global level only', () => {
    expect(attachRequest('global', 'ignored', 'kit', 'k1', 'add')).toEqual({
      level: 'global',
      item_kind: 'kit',
      item_ref: 'k1',
      op: 'add',
    });
    expect(attachRequest('project', 'p1', 'skill', 'pf-ui', 'remove')).toEqual({
      level: 'project',
      target_id: 'p1',
      item_kind: 'skill',
      item_ref: 'pf-ui',
      op: 'remove',
    });
  });

  it('lists the levels a kit is attached to, in resolution order', () => {
    const levels = kitAttachmentLevels('k1', [
      attachment({ id: '1', level: 'conversation', target_id: 'c1' }),
      attachment({ id: '2', level: 'project', target_id: 'p1' }),
      attachment({ id: '3', level: 'project', target_id: 'p2', op: 'remove' }),
      attachment({ id: '4', item_kind: 'skill', item_ref: 'k1' }),
      attachment({ id: '5', item_ref: 'other' }),
    ]);

    expect(levels).toEqual([
      { level: 'project', count: 2, removes: 1 },
      { level: 'conversation', count: 1, removes: 0 },
    ]);
  });

  it('applies the R2/R3 global rule only at the global level', () => {
    expect(globalAttachBlock('global', { name: 'tb-sb-prod', tier: 'read' })).toBe('notGlobal');
    expect(globalAttachBlock('global', { name: 'context7', tier: 'write' })).toBe('write');
    expect(globalAttachBlock('global', { name: 'context7', tier: 'read' })).toBeNull();
    expect(globalAttachBlock('project', { name: 'tb-sb-prod', tier: 'write' })).toBeNull();
  });

  it('sorts effective items: included first, then by display name', () => {
    const sorted = sortEffectiveItems([item('b', false), item('z', true), item('id-1', true, 'alpha')]);
    expect(sorted.map((entry) => entry.item_ref)).toEqual(['id-1', 'z', 'b']);
  });

  it.each([
    ['KIT_NAME_TAKEN', 409, 'nameTaken'],
    ['KIT_STALE', 409, 'stale'],
    ['KIT_NOT_FOUND', 404, 'notFound'],
    ['KIT_ATTACHMENT_NOT_FOUND', 404, 'attachmentNotFound'],
    ['KIT_UNKNOWN_TARGET', 404, 'unknownTarget'],
    ['KIT_INVALID_NAME', 400, 'invalidName'],
    ['KIT_INVALID_ITEM', 400, 'invalidItem'],
    ['KIT_INVALID_TARGET', 400, 'invalidTarget'],
    ['KIT_GLOBAL_NOT_ALLOWED', 400, 'globalNotAllowed'],
    ['KIT_PROJECT_HAS_KIT', 409, 'projectHasKit'],
  ])('maps %s to its own message with the server detail', (code, status, key) => {
    const error = new BackendHttpError({ method: 'POST', path: '/api/kits', status, body: { code, error: ' why ' } });
    expect(describeKitError(echoT, error)).toBe(`mcp.kits.errors.${key}|{"detail":"why","max":80}`);
  });

  it('falls back to the shared mapping for other failures', () => {
    const csrf = new BackendHttpError({
      method: 'POST',
      path: '/api/kits',
      status: 403,
      body: { code: 'CSRF_INVALID' },
    });

    expect(describeKitError(keyT, csrf)).toBe('mcp.market.errors.csrf');
    expect(describeKitError(keyT, new Error('offline'))).toBe('offline');
  });

  it('suggests tb-<template> instance names that fit the market name rule', () => {
    expect(importInstanceName('TB-test', 'paddle')).toBe('tb-paddle');
    expect(importInstanceName('clauterm-studio', 'google_workspace')).toBe('clauterm-google-workspac');
    expect(importInstanceName('9 Lives', 'sentry')).toBe('lives-sentry');
    expect(importInstanceName('', 'github')).toBe('p-github');
  });

  it('explains import error codes with the server message, unknown codes generically', () => {
    expect(describeImportError(echoT, 'MCP_MARKET_CONFLICT', ' taken ')).toBe(
      'mcp.kits.import.errors.nameTaken|{"detail":"taken"}'
    );
    expect(describeImportError(echoT, 'KIT_IMPORT_NOT_IN_FILE')).toBe(
      'mcp.kits.import.errors.notInFile|{"detail":"KIT_IMPORT_NOT_IN_FILE"}'
    );
    expect(describeImportError(echoT, 'MCP_MARKET_SOMETHING', 'x')).toBe('mcp.kits.import.errors.other|{"detail":"x"}');
  });
});

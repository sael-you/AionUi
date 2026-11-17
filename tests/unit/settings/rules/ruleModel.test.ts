/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { RULE_BODY_MAX_BYTES, type RuleResponse } from '@/common/types/platform/rules';
import {
  createRuleRequest,
  describeRuleError,
  formatBytes,
  ruleFormOf,
  ruleMatches,
  ruleSource,
  sizeState,
  updateRuleRequest,
  utf8Bytes,
  validateRuleForm,
} from '@/renderer/pages/settings/RulesSettings/ruleModel';

const rule = (over: Partial<RuleResponse> = {}): RuleResponse => ({
  id: 'r1',
  name: 'Commit messages',
  description: 'Conventional Commits',
  body: '- Use `feat:`',
  enabled: true,
  origin: 'owner',
  created_at: 1,
  updated_at: 2,
  ...over,
});

const t = (key: string, options?: Record<string, unknown>) =>
  options && 'detail' in options ? `${key}:${String(options.detail)}` : key;

const httpError = (code: string, message = '') =>
  new BackendHttpError({ method: 'PUT', path: '/api/rules/r1', status: 409, body: { code, error: message } });

describe('ruleModel (C37)', () => {
  it('counts bytes as UTF-8, like core', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('规则')).toBe(6);
  });

  it('size state: near from 85 %, over past the cap', () => {
    expect(sizeState(0, 100)).toBe('ok');
    expect(sizeState(84, 100)).toBe('ok');
    expect(sizeState(85, 100)).toBe('near');
    expect(sizeState(100, 100)).toBe('near');
    expect(sizeState(101, 100)).toBe('over');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(24 * 1024)).toBe('24 KB');
  });

  it('source: imported rules come from an AGENTS.md, the rest are mine', () => {
    expect(ruleSource(rule())).toBe('mine');
    expect(ruleSource(rule({ origin: 'import' }))).toBe('imported');
  });

  it('search matches name, description and body', () => {
    expect(ruleMatches(rule(), '')).toBe(true);
    expect(ruleMatches(rule(), 'COMMIT')).toBe(true);
    expect(ruleMatches(rule(), 'conventional')).toBe(true);
    expect(ruleMatches(rule(), 'feat:')).toBe(true);
    expect(ruleMatches(rule(), 'deploy')).toBe(false);
  });

  it('validates the form: name, description, body and the 8 KB cap', () => {
    const ok = { name: 'A', description: '', body: 'x', enabled: true };
    expect(validateRuleForm(ok)).toEqual({});
    expect(validateRuleForm({ ...ok, name: '  ' }).name).toBe('nameRequired');
    expect(validateRuleForm({ ...ok, name: 'n'.repeat(81) }).name).toBe('nameTooLong');
    expect(validateRuleForm({ ...ok, description: 'd'.repeat(301) }).description).toBe('descriptionTooLong');
    expect(validateRuleForm({ ...ok, body: ' \n ' }).body).toBe('bodyRequired');
    expect(validateRuleForm({ ...ok, body: 'x'.repeat(RULE_BODY_MAX_BYTES) })).toEqual({});
    expect(validateRuleForm({ ...ok, body: 'é'.repeat(RULE_BODY_MAX_BYTES / 2 + 1) }).body).toBe('bodyTooLarge');
  });

  it('create request trims name and description, keeps the body as written', () => {
    expect(createRuleRequest({ name: ' A ', description: ' d ', body: '  x\n', enabled: false })).toEqual({
      name: 'A',
      description: 'd',
      body: '  x\n',
      enabled: false,
    });
  });

  it('update request: only the changes, guarded by the edited version; nothing when unchanged', () => {
    const existing = rule();
    expect(updateRuleRequest(ruleFormOf(existing), existing)).toEqual({});
    expect(updateRuleRequest({ ...ruleFormOf(existing), body: 'new' }, existing)).toEqual({
      body: 'new',
      expected_updated_at: 2,
    });
    expect(updateRuleRequest({ ...ruleFormOf(existing), enabled: false, name: 'B' }, existing)).toEqual({
      name: 'B',
      enabled: false,
      expected_updated_at: 2,
    });
  });

  it('describes the core errors', () => {
    expect(describeRuleError(t, httpError('RULE_STALE'))).toBe('settings.rules.errors.stale');
    expect(describeRuleError(t, httpError('RULE_NAME_TAKEN'))).toBe('settings.rules.errors.nameTaken');
    expect(describeRuleError(t, httpError('RULE_ALREADY_IMPORTED'))).toBe('settings.rules.errors.alreadyImported');
    expect(describeRuleError(t, httpError('RULE_CONFIRM_REQUIRED'))).toBe('settings.rules.errors.confirmRequired');
    expect(describeRuleError(t, httpError('RULE_NOT_FOUND'))).toBe('settings.rules.errors.notFound');
    expect(describeRuleError(t, httpError('RULE_INVALID', 'body too large'))).toBe(
      'settings.rules.errors.invalid:body too large'
    );
    expect(describeRuleError(t, httpError('MCP_MARKET_SESSION_REQUIRED'))).toBe(
      'settings.rules.errors.sessionRequired'
    );
    expect(describeRuleError(t, new Error('offline'))).toBe('offline');
    expect(describeRuleError(t, 'x')).toBe('settings.rules.errors.generic');
  });
});

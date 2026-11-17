/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the Rules page (C37, TASK-131): sizes against the caps, the
 * form rules, the requests and the error messages. Unit-tested.
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  RULE_BODY_MAX_BYTES,
  type CreateRuleRequest,
  type RuleResponse,
  type UpdateRuleRequest,
} from '@/common/types/platform/rules';

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** Longest rule name the form accepts (core checks again). */
export const RULE_NAME_MAX = 80;
/** Longest description (one or two lines on a card). */
export const RULE_DESCRIPTION_MAX = 300;

/** Where a rule came from: written here, or imported from an AGENTS.md. */
export type RuleSource = 'mine' | 'imported';
export const RULE_SOURCES: readonly RuleSource[] = ['mine', 'imported'];

export const ruleSource = (rule: Pick<RuleResponse, 'origin'>): RuleSource =>
  rule.origin === 'import' ? 'imported' : 'mine';

/** Size in bytes as core counts it (UTF-8). */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

export type SizeState = 'ok' | 'near' | 'over';

/** `near` from 85 % of the cap, `over` past it. */
export const sizeState = (bytes: number, max: number): SizeState =>
  bytes > max ? 'over' : bytes >= max * 0.85 ? 'near' : 'ok';

/** `1.2 KB` style, one decimal under 10 KB. */
export const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;

export const ruleMatches = (rule: RuleResponse, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [rule.name, rule.description, rule.body].some((field) => field.toLowerCase().includes(q));
};

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export type RuleFormValues = { name: string; description: string; body: string; enabled: boolean };
export type RuleFormProblem = 'nameRequired' | 'nameTooLong' | 'descriptionTooLong' | 'bodyRequired' | 'bodyTooLarge';

export const emptyRuleForm = (): RuleFormValues => ({ name: '', description: '', body: '', enabled: true });

export const ruleFormOf = (rule: RuleResponse): RuleFormValues => ({
  name: rule.name,
  description: rule.description,
  body: rule.body,
  enabled: rule.enabled,
});

export const validateRuleForm = (values: RuleFormValues): Partial<Record<keyof RuleFormValues, RuleFormProblem>> => {
  const problems: Partial<Record<keyof RuleFormValues, RuleFormProblem>> = {};
  const name = values.name.trim();
  if (!name) problems.name = 'nameRequired';
  else if ([...name].length > RULE_NAME_MAX) problems.name = 'nameTooLong';
  if ([...values.description.trim()].length > RULE_DESCRIPTION_MAX) problems.description = 'descriptionTooLong';
  if (!values.body.trim()) problems.body = 'bodyRequired';
  else if (utf8Bytes(values.body) > RULE_BODY_MAX_BYTES) problems.body = 'bodyTooLarge';
  return problems;
};

export const createRuleRequest = (values: RuleFormValues): CreateRuleRequest => ({
  name: values.name.trim(),
  description: values.description.trim(),
  body: values.body,
  enabled: values.enabled,
});

/** Only what changed, guarded by the version the owner edited (409 RULE_STALE otherwise). */
export const updateRuleRequest = (values: RuleFormValues, existing: RuleResponse): UpdateRuleRequest => {
  const next = createRuleRequest(values);
  const request: UpdateRuleRequest = {};
  if (next.name !== existing.name) request.name = next.name;
  if (next.description !== existing.description) request.description = next.description;
  if (next.body !== existing.body) request.body = next.body;
  if (next.enabled !== existing.enabled) request.enabled = next.enabled;
  return Object.keys(request).length > 0 ? { ...request, expected_updated_at: existing.updated_at } : {};
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const describeRuleError = (t: TFn, error: unknown): string => {
  if (!isBackendHttpError(error)) {
    return error instanceof Error && error.message ? error.message : t('settings.rules.errors.generic');
  }
  const detail = error.backendMessage.trim();
  switch (error.code) {
    case 'RULE_INVALID':
      return detail ? t('settings.rules.errors.invalid', { detail }) : t('settings.rules.errors.generic');
    case 'RULE_NAME_TAKEN':
      return t('settings.rules.errors.nameTaken');
    case 'RULE_STALE':
      return t('settings.rules.errors.stale');
    case 'RULE_ALREADY_IMPORTED':
      return t('settings.rules.errors.alreadyImported');
    case 'RULE_CONFIRM_REQUIRED':
      return t('settings.rules.errors.confirmRequired');
    case 'RULE_NOT_FOUND':
      return t('settings.rules.errors.notFound');
    case 'MCP_MARKET_SESSION_REQUIRED':
    case 'UNAUTHORIZED':
      return t('settings.rules.errors.sessionRequired');
    case 'CSRF_INVALID':
      return t('settings.rules.errors.csrf');
    default:
      return detail || t('settings.rules.errors.generic');
  }
};

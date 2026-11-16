/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for Kits (C27, D49/D50): request payloads that match the
 * server's `deny_unknown_fields` types, form validation mirroring the server's
 * rules, and how attachments are grouped for display. The server stays the
 * authority on every rule.
 */

import type {
  AttachKitItemRequest,
  CreateKitRequest,
  KitAttachmentResponse,
  KitEffectiveItem,
  KitItemKind,
  KitLevel,
  KitOp,
  KitResponse,
  McpMarketInstance,
  UpdateKitRequest,
} from '@/common/config/storage';
import { KIT_LEVELS } from '@/common/config/storage';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { MCP_INSTANCE_NAME_MAX, describeMarketError, globalBlockReason } from './marketModel';

/** Server rule: kit name 1–80 characters, unique per user among live kits. */
export const KIT_NAME_MAX = 80;
/** Server rule for skill names inside a kit. */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** The kit form as the editor holds it. */
export type KitFormValues = {
  name: string;
  description: string;
  skills: string[];
  mcpInstanceIds: string[];
  mcpTemplates: string[];
};

export type KitFormError = 'nameRequired' | 'nameTooLong' | 'skillInvalid';

/** Sorted, de-duplicated, without empty entries. */
const normalizeList = (values: readonly string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();

export const kitFormFromKit = (kit: KitResponse | null): KitFormValues => ({
  name: kit?.name ?? '',
  description: kit?.description ?? '',
  skills: kit ? [...kit.skills] : [],
  mcpInstanceIds: kit ? kit.mcps.map((member) => member.instance_id) : [],
  mcpTemplates: kit ? [...kit.mcp_templates] : [],
});

/** The first rule the form breaks, or `null` when the server may accept it. */
export const validateKitForm = (values: KitFormValues): KitFormError | null => {
  const name = values.name.trim();
  if (!name) return 'nameRequired';
  if ([...name].length > KIT_NAME_MAX) return 'nameTooLong';
  if (values.skills.some((skill) => !SKILL_NAME_PATTERN.test(skill.trim()))) return 'skillInvalid';
  return null;
};

export const createKitRequest = (values: KitFormValues, projectId?: string): CreateKitRequest => {
  const description = values.description.trim();
  return {
    name: values.name.trim(),
    ...(description ? { description } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    skills: normalizeList(values.skills),
    mcp_instance_ids: normalizeList(values.mcpInstanceIds),
    mcp_templates: normalizeList(values.mcpTemplates),
  };
};

/**
 * Full replacement of the kit's fields and member sets, guarded by the
 * `updated_at` the editor was opened with (409 when the kit changed since).
 */
export const updateKitRequest = (kit: KitResponse, values: KitFormValues): UpdateKitRequest => ({
  name: values.name.trim(),
  description: values.description.trim(),
  skills: normalizeList(values.skills),
  mcp_instance_ids: normalizeList(values.mcpInstanceIds),
  mcp_templates: normalizeList(values.mcpTemplates),
  expected_updated_at: kit.updated_at,
});

/** The attach payload; `target_id` is omitted at the global level (the server requires that). */
export const attachRequest = (
  level: KitLevel,
  targetId: string,
  itemKind: KitItemKind,
  itemRef: string,
  op: KitOp
): AttachKitItemRequest => ({
  level,
  ...(level === 'global' ? {} : { target_id: targetId }),
  item_kind: itemKind,
  item_ref: itemRef,
  op,
});

/** Levels a kit is attached to (any op), in resolution order, with how many targets per level. */
export const kitAttachmentLevels = (
  kitId: string,
  attachments: readonly KitAttachmentResponse[],
  /** A project kit (C28) applies at its project without an attachment row: counted as one project add. */
  projectId?: string
): Array<{ level: KitLevel; count: number; removes: number }> => {
  const rows = attachments.filter((row) => row.item_kind === 'kit' && row.item_ref === kitId);
  return KIT_LEVELS.map((level) => {
    const atLevel = rows.filter((row) => row.level === level);
    const implicit = level === 'project' && projectId ? 1 : 0;
    return { level, count: atLevel.length + implicit, removes: atLevel.filter((row) => row.op === 'remove').length };
  }).filter((entry) => entry.count > 0);
};

/** Why an MCP instance cannot be attached at the global level (R2/R3), or `null`. */
export const globalAttachBlock = (
  level: KitLevel,
  instance: Pick<McpMarketInstance, 'name' | 'tier'>
): ReturnType<typeof globalBlockReason> => (level === 'global' ? globalBlockReason(instance) : null);

/** Effective items for display: included first, then removed; by name within each group. */
export const sortEffectiveItems = (items: readonly KitEffectiveItem[]): KitEffectiveItem[] =>
  [...items].toSorted((a, b) => {
    if (a.included !== b.included) return a.included ? -1 : 1;
    const nameA = a.mcp?.instance_name || a.item_ref;
    const nameB = b.mcp?.instance_name || b.item_ref;
    return nameA.localeCompare(nameB);
  });

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** AionCore `KitErrorCode` (`ErrorResponse.code`) → `mcp.kits.errors.*` key. */
const KIT_ERROR_KEYS: Record<string, string> = {
  KIT_NAME_TAKEN: 'nameTaken',
  KIT_STALE: 'stale',
  KIT_NOT_FOUND: 'notFound',
  KIT_ATTACHMENT_NOT_FOUND: 'attachmentNotFound',
  KIT_UNKNOWN_TARGET: 'unknownTarget',
  KIT_INVALID_NAME: 'invalidName',
  KIT_INVALID_ITEM: 'invalidItem',
  KIT_INVALID_TARGET: 'invalidTarget',
  KIT_GLOBAL_NOT_ALLOWED: 'globalNotAllowed',
  KIT_PROJECT_HAS_KIT: 'projectHasKit',
};

/**
 * A user-facing message for a failed kits request: one message per
 * `KitErrorCode` (with the server's detail where it names the rule), and the
 * shared market mapping for everything else (session, CSRF, 5xx, …).
 */
export const describeKitError = (t: TFn, error: unknown): string => {
  if (isBackendHttpError(error)) {
    const key = KIT_ERROR_KEYS[error.code];
    if (key) return t(`mcp.kits.errors.${key}`, { detail: error.backendMessage.trim(), max: KIT_NAME_MAX });
  }
  return describeMarketError(t, error);
};

/** Lowercase letters and digits joined by single hyphens. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Suggested instance name for an imported server, `tb-<template>` style: the
 * project name's first word as prefix, then the template id, fitted to the
 * market name rule (lowercase letters, digits and single hyphens, at most 24).
 */
export const importInstanceName = (projectName: string, templateId: string): string => {
  const prefix =
    (
      slug(projectName)
        .replace(/^[^a-z]+/, '')
        .split('-')[0] ?? ''
    ).slice(0, 8) || 'p';
  return `${prefix}-${slug(templateId)}`.slice(0, MCP_INSTANCE_NAME_MAX).replace(/-+$/, '');
};

/** `error_code` of one import result → `mcp.kits.import.errors.*` key (unknown codes use the generic one). */
const IMPORT_ERROR_KEYS: Record<string, string> = {
  MCP_MARKET_INVALID: 'invalid',
  MCP_MARKET_CONFLICT: 'nameTaken',
  KIT_IMPORT_NOT_IN_FILE: 'notInFile',
  KIT_IMPORT_UNKNOWN_TEMPLATE: 'unknownTemplate',
};

/** The message for a failed import row; the server's own message is shown as the detail. */
export const describeImportError = (t: TFn, code: string, message?: string): string =>
  t(`mcp.kits.import.errors.${IMPORT_ERROR_KEYS[code] ?? 'other'}`, { detail: message?.trim() || code });

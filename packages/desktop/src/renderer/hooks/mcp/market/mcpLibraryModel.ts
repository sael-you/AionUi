/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Tools page in the shared library layout (C33, TASK-119). Pure:
 *
 * - **Source** of an MCP: Official / Community (catalogue templates by their
 *   `official` flag) or Custom (the owner's own servers and instances whose
 *   template is not in the catalogue).
 * - **Scope** of an instance from the market assignments (global, a project —
 *   whole project or one of its assistants) and from kits (the server's
 *   effective set).
 * - **Active groups** of a scope by where an MCP comes from, and rail counts.
 */

import type {
  KitAttachmentResponse,
  KitEffectiveItem,
  KitResponse,
  McpMarketAssignment,
  McpMarketInstance,
  McpMarketTemplate,
} from '@/common/config/storage';
import { templateCategory, type McpTemplateCategory } from './marketModel';

export type McpSource = 'official' | 'community' | 'custom';
export type McpSourceFilter = 'all' | McpSource;
export const MCP_SOURCE_FILTERS: readonly McpSourceFilter[] = ['all', 'official', 'community', 'custom'];

/** Where an MCP comes from: a catalogue template (official or community) or the owner's own definition. */
export const mcpSource = (template: Pick<McpMarketTemplate, 'official'> | undefined): McpSource =>
  template ? (template.official ? 'official' : 'community') : 'custom';

/** Category of an instance: its template's, `other` without one. */
export const instanceCategory = (template: McpMarketTemplate | undefined): McpTemplateCategory =>
  template ? templateCategory(template) : 'other';

/** Assignments of one instance in one scope (Global = no project; a project = whole project or its assistants). */
export const assignmentsIn = (
  assignments: readonly McpMarketAssignment[],
  instanceId: string,
  projectId: string | null
): McpMarketAssignment[] =>
  assignments.filter(
    (row) => row.instance_id === instanceId && (projectId ? row.project_id === projectId : !row.project_id)
  );

/** Instance ids attached directly in a scope. */
export const instancesAttachedIn = (
  assignments: readonly McpMarketAssignment[],
  projectId: string | null
): Set<string> =>
  new Set(
    assignments
      .filter((row) => (projectId ? row.project_id === projectId : !row.project_id))
      .map((row) => row.instance_id)
  );

/** Instance ids a project's kits bring in (its project kit plus kits attached at project level). */
export const kitInstancesOfProject = (
  kits: readonly KitResponse[],
  attachments: readonly KitAttachmentResponse[],
  projectId: string
): Set<string> => {
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  const ids = new Set<string>();
  const projectKit = kits.find((kit) => kit.project_id === projectId);
  projectKit?.mcps.forEach((member) => ids.add(member.instance_id));
  for (const row of attachments) {
    if (row.level !== 'project' || row.target_id !== projectId) continue;
    if (row.item_kind === 'mcp' && row.op === 'add') ids.add(row.item_ref);
    if (row.item_kind === 'kit' && row.op === 'add') {
      kitById.get(row.item_ref)?.mcps.forEach((member) => ids.add(member.instance_id));
    }
  }
  return ids;
};

/** What a project holds of its own (direct attachments + kit instances): the rail count. */
export const projectMcpCount = (
  assignments: readonly McpMarketAssignment[],
  kits: readonly KitResponse[],
  attachments: readonly KitAttachmentResponse[],
  projectId: string
): number =>
  new Set([...instancesAttachedIn(assignments, projectId), ...kitInstancesOfProject(kits, attachments, projectId)])
    .size;

export type McpActiveGroupKind = 'attached' | 'kit' | 'fromGlobal' | 'unassigned';

export type McpActiveGroup = {
  key: string;
  kind: McpActiveGroupKind;
  /** The kit that delivers these instances (kind `kit`). */
  kitId?: string;
  kitName?: string;
  instanceIds: string[];
};

/**
 * Market instances a scope gets, by where they come from: attached here,
 * each kit (from the server's effective set), From Global (projects only) and,
 * for Global, the instances attached nowhere (so they stay reachable).
 */
export const buildMcpActiveGroups = (input: {
  instances: readonly McpMarketInstance[];
  assignments: readonly McpMarketAssignment[];
  effective: readonly KitEffectiveItem[];
  projectId: string | null;
}): McpActiveGroup[] => {
  const { instances, assignments, effective, projectId } = input;
  const known = new Set(instances.map((instance) => instance.id));
  const byName = (ids: Iterable<string>) =>
    [...ids]
      .filter((id) => known.has(id))
      .toSorted((a, b) =>
        (instances.find((i) => i.id === a)?.name ?? a).localeCompare(instances.find((i) => i.id === b)?.name ?? b)
      );
  const groups: McpActiveGroup[] = [];

  const attached = instancesAttachedIn(assignments, projectId);
  groups.push({ key: 'attached', kind: 'attached', instanceIds: byName(attached) });

  const scopeLevel = projectId ? 'project' : 'global';
  const viaKit = new Map<string, { name: string; ids: Set<string> }>();
  for (const item of effective) {
    if (!item.included || item.provenance.level !== scopeLevel || !item.provenance.kit_id) continue;
    if (attached.has(item.item_ref)) continue;
    const entry = viaKit.get(item.provenance.kit_id) ?? { name: item.provenance.kit_name ?? '', ids: new Set() };
    entry.ids.add(item.item_ref);
    viaKit.set(item.provenance.kit_id, entry);
  }
  for (const [kitId, entry] of [...viaKit.entries()].toSorted(([, a], [, b]) => a.name.localeCompare(b.name))) {
    groups.push({ key: `kit:${kitId}`, kind: 'kit', kitId, kitName: entry.name, instanceIds: byName(entry.ids) });
  }

  if (projectId) {
    const global = instancesAttachedIn(assignments, null);
    groups.push({
      key: 'fromGlobal',
      kind: 'fromGlobal',
      instanceIds: byName([...global].filter((id) => !attached.has(id))),
    });
  } else {
    const anywhere = new Set(assignments.map((row) => row.instance_id));
    const inKits = new Set(effective.filter((item) => item.included).map((item) => item.item_ref));
    groups.push({
      key: 'unassigned',
      kind: 'unassigned',
      instanceIds: byName(instances.map((i) => i.id).filter((id) => !anywhere.has(id) && !inKits.has(id))),
    });
  }
  return groups;
};

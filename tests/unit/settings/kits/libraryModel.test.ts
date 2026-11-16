/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Library layout models (C33, TASK-119): rail scopes, grid keys, tones, search; the Tools (MCP) library model. */

import { describe, expect, it } from 'vitest';
import {
  categoryTone,
  gridColumnsFor,
  gridMove,
  matchesQuery,
  projectIdOfScope,
  projectScopeKey,
  splitRailScopes,
} from '@/renderer/components/settings/SettingsModal/library/libraryModel';
import type { KitEffectiveItem, McpMarketAssignment, McpMarketInstance } from '@/common/config/storage';
import {
  assignmentsIn,
  buildMcpActiveGroups,
  kitInstancesOfProject,
  mcpSource,
  projectMcpCount,
} from '@/renderer/hooks/mcp/market/mcpLibraryModel';
import { KIT_PLATFORM, attachmentRow, instance } from './kitFixtures';

const global = { key: 'global', label: 'Global', count: 5 };
const project = (id: string, count: number) => ({ key: projectScopeKey(id), label: id, count });

describe('rail scopes', () => {
  it('Global first, projects with something by count, empty projects folded', () => {
    const { shown, empty } = splitRailScopes(
      global,
      [project('store', 0), project('aionui', 10), project('TB-test', 14), project('skill-probe', 0)],
      'global'
    );
    expect(shown.map((s) => s.label)).toEqual(['Global', 'TB-test', 'aionui']);
    expect(empty.map((s) => s.label)).toEqual(['skill-probe', 'store']);
  });

  it('the selected scope stays visible even when empty', () => {
    const { shown, empty } = splitRailScopes(
      global,
      [project('store', 0), project('moel', 0)],
      projectScopeKey('store')
    );
    expect(shown.map((s) => s.label)).toEqual(['Global', 'store']);
    expect(empty.map((s) => s.label)).toEqual(['moel']);
  });

  it('scope keys round-trip', () => {
    expect(projectIdOfScope(projectScopeKey('p-1'))).toBe('p-1');
    expect(projectIdOfScope('global')).toBeNull();
  });
});

describe('grid', () => {
  it('3 columns at 1440, 2 at 1024, 1 at 390', () => {
    expect(gridColumnsFor(1440)).toBe(3);
    expect(gridColumnsFor(1024)).toBe(2);
    expect(gridColumnsFor(390)).toBe(1);
  });

  it('arrow keys move by one or by a row, never out of the grid', () => {
    expect(gridMove(0, 'ArrowRight', 3, 7)).toBe(1);
    expect(gridMove(1, 'ArrowDown', 3, 7)).toBe(4);
    expect(gridMove(5, 'ArrowDown', 3, 7)).toBeNull();
    expect(gridMove(0, 'ArrowLeft', 3, 7)).toBeNull();
    expect(gridMove(4, 'Home', 3, 7)).toBe(0);
    expect(gridMove(0, 'End', 3, 7)).toBe(6);
    expect(gridMove(0, 'a', 3, 7)).toBeNull();
  });
});

describe('tones and search', () => {
  it('a category always gets the same tone', () => {
    expect(categoryTone('kit:abc')).toBe(categoryTone('kit:abc'));
  });

  it('search is case-insensitive over any field', () => {
    expect(matchesQuery('SEO', 'seo-audit', undefined)).toBe(true);
    expect(matchesQuery('', 'x')).toBe(true);
    expect(matchesQuery('zzz', 'abc', 'def')).toBe(false);
  });
});

const assignment = (instanceId: string, projectId?: string, cli = 'claude'): McpMarketAssignment => ({
  id: `as-${instanceId}-${projectId ?? 'g'}-${cli}`,
  instance_id: instanceId,
  instance_name: instanceId,
  project_id: projectId,
  cli,
  created_at: 1,
});

const INSTANCES: McpMarketInstance[] = [
  instance({ id: 'i-ctx', name: 'context7' }),
  instance({ id: 'i-sb', name: 'supabase' }),
  instance({ id: 'i-lone', name: 'lonely' }),
  instance({ id: 'i-kit', name: 'kit-only' }),
];

const viaKit = (id: string, level: 'global' | 'project'): KitEffectiveItem => ({
  kind: 'mcp',
  item_ref: id,
  included: true,
  provenance: { level, op: 'add', kit_id: 'kit-1', kit_name: 'Platform Dev' },
});

describe('MCP library: source', () => {
  it('official / community by the template flag, custom without a catalogue template', () => {
    expect(mcpSource({ official: true })).toBe('official');
    expect(mcpSource({ official: false })).toBe('community');
    expect(mcpSource(undefined)).toBe('custom');
  });
});

describe('MCP library: scope membership', () => {
  const assignments = [assignment('i-ctx'), assignment('i-sb', 'p1'), assignment('i-sb', 'p1', 'codex')];

  it('assignments in a scope: Global has no project, a project matches its id', () => {
    expect(assignmentsIn(assignments, 'i-ctx', null).map((a) => a.id)).toEqual(['as-i-ctx-g-claude']);
    expect(assignmentsIn(assignments, 'i-sb', 'p1')).toHaveLength(2);
    expect(assignmentsIn(assignments, 'i-sb', null)).toHaveLength(0);
  });

  it("a project's kit instances (project kit + kits attached at project level) count on the rail", () => {
    const kits = [
      KIT_PLATFORM,
      { ...KIT_PLATFORM, id: 'kit-p', project_id: 'p2', mcps: [{ instance_id: 'i-kit', instance_name: 'kit-only' }] },
    ];
    const attachments = [attachmentRow({ level: 'project', target_id: 'p1', item_ref: 'kit-1' })];
    expect([...kitInstancesOfProject(kits, attachments, 'p1')].toSorted()).toEqual(['inst-ctx', 'inst-gone']);
    expect([...kitInstancesOfProject(kits, attachments, 'p2')]).toEqual(['i-kit']);
    expect(projectMcpCount(assignments, kits, attachments, 'p1')).toBe(3);
    expect(projectMcpCount(assignments, kits, [], 'p-none')).toBe(0);
  });
});

describe('MCP library: Active groups', () => {
  const assignments = [assignment('i-ctx'), assignment('i-sb', 'p1')];

  it('Global: attached here, each kit, then the instances attached nowhere', () => {
    const groups = buildMcpActiveGroups({
      instances: INSTANCES,
      assignments,
      effective: [viaKit('i-kit', 'global')],
      projectId: null,
    });
    expect(groups.map((g) => [g.key, g.instanceIds])).toEqual([
      ['attached', ['i-ctx']],
      ['kit:kit-1', ['i-kit']],
      ['unassigned', ['i-lone']],
    ]);
    expect(groups[1].kitName).toBe('Platform Dev');
  });

  it('a project: attached here, its kits, then From Global (not repeated when attached here too)', () => {
    const groups = buildMcpActiveGroups({
      instances: INSTANCES,
      assignments: [...assignments, assignment('i-sb')],
      effective: [viaKit('i-kit', 'project'), viaKit('i-sb', 'project'), viaKit('i-ctx', 'global')],
      projectId: 'p1',
    });
    expect(groups.map((g) => [g.key, g.instanceIds])).toEqual([
      ['attached', ['i-sb']],
      ['kit:kit-1', ['i-kit']],
      ['fromGlobal', ['i-ctx']],
    ]);
  });
});

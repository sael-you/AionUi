/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Skills library (C33, TASK-119): categories, scope resolution, Active groups, toggle plan. */

import { describe, expect, it } from 'vitest';
import type { KitAttachmentResponse, KitEffectiveItem, KitResponse } from '@/common/config/storage';
import {
  buildActiveGroups,
  buildSkillCategories,
  conversationIdOfPath,
  planSkillToggle,
  resolveSkills,
  scopeOwnCount,
  skillMatchesSource,
  type LibrarySkill,
} from '@/renderer/pages/settings/SkillsSettings/skillLibraryModel';

const kit = (over: Partial<KitResponse>): KitResponse => ({
  id: 'k',
  name: 'Kit',
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});

const row = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'a',
  level: 'global',
  target_id: '',
  item_kind: 'kit',
  item_ref: 'k',
  item_name: '',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

const K0 = kit({ id: 'k0', name: 'Global', builtin_key: 'K0', skills: ['memory'] });
const SEO = kit({ id: 'k6', name: 'SEO', builtin_key: 'K6', skills: ['seo-audit', 'schema'] });
const CRO = kit({ id: 'k7', name: 'CRO', builtin_key: 'K7', skills: ['schema', 'ab-test'] });
const TB_KIT = kit({ id: 'kp', name: 'TB-test', project_id: 'p-tb', skills: ['tb-deploy'], updated_at: 50 });
const KITS = [CRO, K0, SEO, TB_KIT];

const SKILLS: LibrarySkill[] = [
  { name: 'memory', source: 'builtin' },
  { name: 'seo-audit', source: 'custom' },
  { name: 'schema', source: 'custom' },
  { name: 'ab-test', source: 'extension' },
  { name: 'tb-deploy', source: 'custom' },
  { name: 'cron', source: 'builtin', is_auto_inject: true },
  { name: 'notes', source: 'custom' },
];

const GLOBAL_K0 = row({ id: 'g0', item_ref: 'k0' });

describe('skill categories', () => {
  it('a skill in several shared kits shows under each; built-ins and the rest get their own groups', () => {
    const categories = buildSkillCategories(SKILLS, KITS, null);
    expect(categories.map((c) => c.key)).toEqual(['kit:k6', 'kit:k7', 'builtin', 'other']);
    expect(categories.find((c) => c.key === 'kit:k6')?.skills).toEqual(['schema', 'seo-audit']);
    expect(categories.find((c) => c.key === 'kit:k7')?.skills).toEqual(['ab-test', 'schema']);
    // K0 is not a category: its builtin skill lands in Built-in.
    expect(categories.find((c) => c.key === 'builtin')?.skills).toEqual(['cron', 'memory']);
    expect(categories.find((c) => c.key === 'other')?.skills).toEqual(['notes', 'tb-deploy']);
  });

  it('in a project scope the project kit comes first as "Project"', () => {
    const categories = buildSkillCategories(SKILLS, KITS, 'p-tb');
    expect(categories[0]).toMatchObject({ key: 'project', kind: 'project', skills: ['tb-deploy'] });
  });

  it('source filter: Mine = own skills, Official = built-in, Imported = extension', () => {
    expect(SKILLS.filter((s) => skillMatchesSource(s, 'mine')).map((s) => s.name)).toEqual([
      'seo-audit',
      'schema',
      'tb-deploy',
      'notes',
    ]);
    expect(SKILLS.filter((s) => skillMatchesSource(s, 'official')).map((s) => s.name)).toEqual(['memory', 'cron']);
    expect(SKILLS.filter((s) => skillMatchesSource(s, 'imported')).map((s) => s.name)).toEqual(['ab-test']);
  });
});

describe('scope resolution (mirror of kit_resolve)', () => {
  const attachments = [
    GLOBAL_K0,
    row({ id: 'p1', level: 'project', target_id: 'p-tb', item_ref: 'k6' }),
    row({ id: 'p2', level: 'project', target_id: 'p-tb', item_kind: 'skill', item_ref: 'memory', op: 'remove' }),
  ];

  it('Global delivers the global kit; a project adds its kit (implicit) and its attached kits', () => {
    const global = resolveSkills(KITS, attachments, null);
    expect([...global.entries()].filter(([, d]) => d.included).map(([n]) => n)).toEqual(['memory']);
    const tb = resolveSkills(KITS, attachments, 'p-tb');
    expect(tb.get('tb-deploy')).toEqual({ included: true, level: 'project', kitId: 'kp' });
    expect(tb.get('seo-audit')).toEqual({ included: true, level: 'project', kitId: 'k6' });
    // A project-level remove beats the global add.
    expect(tb.get('memory')).toEqual({ included: false, level: 'project' });
  });

  it('inside one level remove beats add', () => {
    const decisions = resolveSkills(
      KITS,
      [GLOBAL_K0, row({ id: 'g1', item_kind: 'skill', item_ref: 'memory', op: 'remove' })],
      null
    );
    expect(decisions.get('memory')?.included).toBe(false);
  });

  it('a project kit never applies in another project', () => {
    expect(resolveSkills(KITS, [], 'p-other').has('tb-deploy')).toBe(false);
  });

  it('rail count = what the scope decides itself', () => {
    expect(scopeOwnCount(resolveSkills(KITS, attachments, null), null)).toBe(1);
    expect(scopeOwnCount(resolveSkills(KITS, attachments, 'p-tb'), 'p-tb')).toBe(3);
    expect(scopeOwnCount(resolveSkills(KITS, [GLOBAL_K0], 'p-empty'), 'p-empty')).toBe(0);
  });
});

const item = (name: string, included: boolean, level: 'global' | 'project', kitId?: string): KitEffectiveItem => ({
  kind: 'skill',
  item_ref: name,
  included,
  provenance: { level, op: included ? 'add' : 'remove', kit_id: kitId },
});

describe('Active groups', () => {
  it('a project: its kit, added here, each shared kit, From Global, turned off here — with the summary', () => {
    const { groups, summary } = buildActiveGroups({
      effective: [
        item('tb-deploy', true, 'project', 'kp'),
        item('notes', true, 'project'),
        item('seo-audit', true, 'project', 'k6'),
        item('schema', true, 'project', 'k6'),
        item('memory', true, 'global', 'k0'),
        item('ab-test', false, 'project'),
        item('other', false, 'global'),
      ],
      kits: KITS,
      attachments: [GLOBAL_K0, row({ id: 'p1', level: 'project', target_id: 'p-tb', item_ref: 'k6' })],
      projectId: 'p-tb',
    });
    expect(groups.map((g) => [g.key, g.skills])).toEqual([
      ['projectKit', ['tb-deploy']],
      ['single', ['notes']],
      ['kit:k6', ['schema', 'seo-audit']],
      ['fromGlobal', ['memory']],
      ['removed', ['ab-test']],
    ]);
    expect(groups.find((g) => g.key === 'kit:k6')?.attachmentId).toBe('p1');
    expect(summary).toEqual({ active: 5, fromGlobal: 1, kits: 2 });
  });

  it('Global: the Global kit first, then shared kits and singles; an empty project kit is still shown', () => {
    const global = buildActiveGroups({
      effective: [item('memory', true, 'global', 'k0'), item('schema', true, 'global', 'k7')],
      kits: KITS,
      attachments: [GLOBAL_K0, row({ id: 'g7', item_ref: 'k7' })],
      projectId: null,
    });
    expect(global.groups.map((g) => g.key)).toEqual(['kit:k0', 'kit:k7']);
    const emptyKit = buildActiveGroups({
      effective: [],
      kits: [kit({ id: 'kq', project_id: 'p-q' })],
      attachments: [],
      projectId: 'p-q',
    });
    expect(emptyKit.groups).toEqual([expect.objectContaining({ key: 'projectKit', skills: [] })]);
  });
});

describe('toggle plan', () => {
  it('on in a project with a kit: drop a same-level remove, then add to the kit', () => {
    const writes = planSkillToggle({
      name: 'memory',
      on: true,
      projectId: 'p-tb',
      kits: KITS,
      attachments: [
        row({ id: 'rm', level: 'project', target_id: 'p-tb', item_kind: 'skill', item_ref: 'memory', op: 'remove' }),
      ],
    });
    expect(writes).toEqual([
      { type: 'detach', attachmentId: 'rm' },
      { type: 'setProjectKitSkills', kit: TB_KIT, skills: ['tb-deploy', 'memory'] },
    ]);
  });

  it('on in Global or a project without a kit: one single-skill attachment', () => {
    expect(planSkillToggle({ name: 'notes', on: true, projectId: null, kits: KITS, attachments: [] })).toEqual([
      { type: 'attach', request: { level: 'global', item_kind: 'skill', item_ref: 'notes', op: 'add' } },
    ]);
    expect(planSkillToggle({ name: 'notes', on: true, projectId: 'p-x', kits: KITS, attachments: [] })).toEqual([
      {
        type: 'attach',
        request: { level: 'project', target_id: 'p-x', item_kind: 'skill', item_ref: 'notes', op: 'add' },
      },
    ]);
  });

  it('off: out of the project kit; off for something from Global adds a project-level remove', () => {
    expect(planSkillToggle({ name: 'tb-deploy', on: false, projectId: 'p-tb', kits: KITS, attachments: [] })).toEqual([
      { type: 'setProjectKitSkills', kit: TB_KIT, skills: [] },
    ]);
    expect(
      planSkillToggle({ name: 'memory', on: false, projectId: 'p-x', kits: KITS, attachments: [GLOBAL_K0] })
    ).toEqual([
      {
        type: 'attach',
        request: { level: 'project', target_id: 'p-x', item_kind: 'skill', item_ref: 'memory', op: 'remove' },
      },
    ]);
  });

  it('off for a single add only detaches it; off for a kit member at this level adds a remove', () => {
    const single = row({ id: 's1', item_kind: 'skill', item_ref: 'notes' });
    expect(planSkillToggle({ name: 'notes', on: false, projectId: null, kits: KITS, attachments: [single] })).toEqual([
      { type: 'detach', attachmentId: 's1' },
    ]);
    expect(
      planSkillToggle({
        name: 'schema',
        on: false,
        projectId: null,
        kits: KITS,
        attachments: [row({ id: 'g7', item_ref: 'k7' })],
      })
    ).toEqual([{ type: 'attach', request: { level: 'global', item_kind: 'skill', item_ref: 'schema', op: 'remove' } }]);
  });
});

describe('origin scope', () => {
  it('reads the conversation id of the last chat route', () => {
    expect(conversationIdOfPath('/conversation/abc-1?x=1')).toBe('abc-1');
    expect(conversationIdOfPath('/guid')).toBeNull();
    expect(conversationIdOfPath(null)).toBeNull();
  });
});

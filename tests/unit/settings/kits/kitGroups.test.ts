/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { KitAttachmentResponse, KitResponse } from '@/common/config/storage';
import { attachableKits, groupSkillsByKit } from '@/renderer/hooks/mcp/market/kitGroups';

const kit = (over: Partial<KitResponse> & Pick<KitResponse, 'id' | 'name'>): KitResponse => ({
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});

const globalRow = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'a',
  level: 'global',
  target_id: '',
  item_kind: 'kit',
  item_ref: 'k0',
  item_name: 'Global',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

const K0 = kit({ id: 'k0', name: 'Global', builtin_key: 'K0', skills: ['cs-verify', 'cs-delegate'] });
const K1 = kit({ id: 'k1', name: 'Platform Dev', builtin_key: 'K1', skills: ['pf-ui', 'cs-verify'] });
const TB = kit({ id: 'kp', name: 'TB-test', project_id: 'proj-tb', skills: ['paddle-rules', 'pf-ui'] });
const OTHER = kit({ id: 'kq', name: 'Other', project_id: 'proj-other', skills: ['seo-audit'] });
const LIBRARY = ['cs-delegate', 'cs-verify', 'paddle-rules', 'pf-ui', 'seo-audit', 'voice-extractor', 'copywriting'];

describe('groupSkillsByKit (C28)', () => {
  it('builds Global from global kit and single-skill adds, ignoring removes and other levels', () => {
    const groups = groupSkillsByKit({
      skills: LIBRARY,
      kits: [K0, K1, TB],
      attachments: [
        globalRow({ id: '1' }),
        globalRow({ id: '2', item_kind: 'skill', item_ref: 'copywriting', item_name: 'copywriting' }),
        globalRow({ id: '3', item_kind: 'skill', item_ref: 'seo-audit', op: 'remove' }),
        globalRow({ id: '4', level: 'project', target_id: 'p', item_ref: 'k1' }),
      ],
    });

    expect(groups.global).toEqual(['copywriting', 'cs-delegate', 'cs-verify']);
  });

  it('shows the project kit only for its own project and keeps project kits out of Shared', () => {
    const forTb = groupSkillsByKit({
      skills: LIBRARY,
      kits: [K0, K1, TB, OTHER],
      attachments: [],
      projectId: 'proj-tb',
    });
    expect(forTb.project?.kit.id).toBe('kp');
    expect(forTb.project?.skills).toEqual(['paddle-rules', 'pf-ui']);
    expect(forTb.shared.map((group) => group.kit.id)).toEqual(['k1']);

    const noProject = groupSkillsByKit({ skills: LIBRARY, kits: [K0, K1, TB], attachments: [] });
    expect(noProject.project).toBeNull();
  });

  it('lists skills no kit holds as Not in any kit, and a skill can be in several groups', () => {
    const groups = groupSkillsByKit({
      skills: LIBRARY,
      kits: [K0, K1, TB, OTHER],
      attachments: [globalRow({})],
      projectId: 'proj-tb',
    });

    expect(groups.ungrouped).toEqual(['copywriting', 'voice-extractor']);
    expect(groups.membership.get('pf-ui')).toEqual(['project', 'shared']);
    expect(groups.membership.get('cs-verify')).toEqual(['global', 'shared']);
    // seo-audit is only in another project's kit: in a kit, but in no group shown here.
    expect(groups.membership.get('seo-audit')).toBeUndefined();
  });

  it('drops kit skills the library does not have', () => {
    const groups = groupSkillsByKit({ skills: ['pf-ui'], kits: [K1], attachments: [] });
    expect(groups.shared[0]?.skills).toEqual(['pf-ui']);
  });

  it('never offers a project kit for attaching', () => {
    expect(attachableKits([K0, K1, TB]).map((entry) => entry.id)).toEqual(['k0', 'k1']);
  });
});

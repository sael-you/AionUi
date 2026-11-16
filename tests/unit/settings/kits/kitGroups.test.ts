/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { KitResponse } from '@/common/config/storage';
import { attachableKits } from '@/renderer/hooks/mcp/market/kitGroups';

const kit = (over: Partial<KitResponse> & Pick<KitResponse, 'id' | 'name'>): KitResponse => ({
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 1,
  updated_at: 1,
  ...over,
});

const K0 = kit({ id: 'k0', name: 'Global', builtin_key: 'K0', skills: ['cs-verify', 'cs-delegate'] });
const K1 = kit({ id: 'k1', name: 'Platform Dev', builtin_key: 'K1', skills: ['pf-ui', 'cs-verify'] });
const TB = kit({ id: 'kp', name: 'TB-test', project_id: 'proj-tb', skills: ['paddle-rules', 'pf-ui'] });
const OTHER = kit({ id: 'kq', name: 'Other', project_id: 'proj-other', skills: ['seo-audit'] });

describe('attachableKits (C28)', () => {
  it('offers a project kit only where the server allows it', () => {
    const ids = (level: Parameters<typeof attachableKits>[1], projectId?: string) =>
      attachableKits([K0, K1, TB, OTHER], level, projectId).map((entry) => entry.id);

    expect(ids('global')).toEqual(['k0', 'k1']);
    expect(ids('project', 'proj-tb')).toEqual(['k0', 'k1']);
    expect(ids('assistant')).toEqual(['k0', 'k1', 'kp', 'kq']);
    expect(ids('conversation', 'proj-tb')).toEqual(['k0', 'k1', 'kp']);
    expect(ids('conversation')).toEqual(['k0', 'k1']);
  });
});

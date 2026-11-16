/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared data and render helper for the Kits dom tests (C27). Mocks live in each test file. */

import { render } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import type {
  KitAttachmentResponse,
  KitEffectiveSetResponse,
  KitResponse,
  McpMarketInstance,
} from '@/common/config/storage';

export const KIT_PLATFORM: KitResponse = {
  id: 'kit-1',
  name: 'Platform Dev',
  description: 'Build AionUi',
  builtin_key: 'K1',
  skills: ['cs-build', 'pf-ui'],
  mcps: [
    { instance_id: 'inst-ctx', instance_name: 'context7' },
    { instance_id: 'inst-gone', instance_name: '', missing: true },
  ],
  mcp_templates: ['github'],
  created_at: 1,
  updated_at: 100,
};

export const KIT_OPS: KitResponse = {
  id: 'kit-2',
  name: 'Ship & Ops',
  description: '',
  skills: [],
  mcps: [],
  mcp_templates: [],
  created_at: 2,
  updated_at: 200,
};

export const instance = (over: Partial<McpMarketInstance>): McpMarketInstance => ({
  id: 'inst',
  name: 'inst',
  template_id: 'tpl',
  template_in_catalogue: true,
  template_update_available: false,
  transport: 'stdio',
  environment: 'production',
  tier: 'read',
  enforcement: 'server',
  status: 'active',
  clis: ['claude'],
  plain_env: {},
  secrets: [],
  missing: [],
  tools_block: [],
  tools_seen: [],
  last_test_status: '',
  created_at: 1,
  updated_at: 1,
  ...over,
});

export const INSTANCES: McpMarketInstance[] = [
  instance({ id: 'inst-ctx', name: 'context7', tier: 'read' }),
  instance({ id: 'inst-sb', name: 'tb-sb-prod', tier: 'write' }),
];

export const attachmentRow = (over: Partial<KitAttachmentResponse>): KitAttachmentResponse => ({
  id: 'att-1',
  level: 'project',
  target_id: 'proj-1',
  item_kind: 'kit',
  item_ref: 'kit-1',
  item_name: 'Platform Dev',
  op: 'add',
  created_at: 1,
  updated_at: 1,
  ...over,
});

export const EFFECTIVE: KitEffectiveSetResponse = {
  conversation_id: 'conv-1',
  project_id: 'proj-1',
  skills: [
    {
      kind: 'skill',
      item_ref: 'pf-ui',
      included: true,
      provenance: { level: 'project', op: 'add', kit_id: 'kit-1', kit_name: 'Platform Dev' },
    },
    { kind: 'skill', item_ref: 'seo-audit', included: false, provenance: { level: 'conversation', op: 'remove' } },
  ],
  mcps: [
    {
      kind: 'mcp',
      item_ref: 'inst-ctx',
      included: true,
      provenance: { level: 'global', op: 'add' },
      mcp: {
        instance_name: 'context7',
        status: 'active',
        environment: 'production',
        tier: 'read',
        clis: ['claude'],
        delivered: true,
        shadowed_by_project_file: false,
      },
    },
    {
      kind: 'mcp',
      item_ref: 'inst-sb',
      included: true,
      provenance: { level: 'assistant', op: 'add', kit_id: 'kit-3', kit_name: 'Backend' },
      mcp: {
        instance_name: 'tb-sb-prod',
        status: 'dormant',
        clis: ['claude'],
        delivered: false,
        reason: 'instance is dormant',
        shadowed_by_project_file: true,
      },
    },
  ],
  conversation_skills: ['cs-build', 'pf-ui'],
  missing_templates: [{ template_id: 'github', kit_id: 'kit-1', kit_name: 'Platform Dev' }],
};

/** `t` that shows the key and its options, so tests can assert both. */
export const fakeT = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}|${JSON.stringify(options)}` : key;

export const renderWithSwr = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

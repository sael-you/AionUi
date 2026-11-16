/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The kits providers against the AionCore contract (C27 `kit.rs`): paths,
 * methods, query strings and bodies, and that writes carry the CSRF header.
 */

const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];

beforeEach(() => {
  calls.length = 0;
  document.cookie = `aionui-csrf-token=${'a'.repeat(64)}`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pathOf = (url: string): string => new URL(url, 'http://host').pathname + new URL(url, 'http://host').search;

describe('ipcBridge.kits', () => {
  it('reads kits, attachments and the effective set at the contract paths', async () => {
    const { kits } = await import('@/common/adapter/ipcBridge');

    await kits.list.invoke({});
    await kits.list.invoke({ project_id: 'proj 1' });
    await kits.projectKit.invoke({ project_id: 'proj/1' });
    await kits.get.invoke({ id: 'k/1' });
    await kits.listAttachments.invoke({});
    await kits.listAttachments.invoke({ level: 'project', target_id: 'p1' });
    await kits.effective.invoke({ conversation_id: 'c1' });
    await kits.effective.invoke({ project_id: 'p1', assistant_id: 'a1' });

    expect(calls.map((call) => `${call.method} ${pathOf(call.url)}`)).toEqual([
      'GET /api/kits',
      'GET /api/kits?project_id=proj+1',
      'GET /api/projects/proj%2F1/kit',
      'GET /api/kits/k%2F1',
      'GET /api/kits/attachments',
      'GET /api/kits/attachments?level=project&target_id=p1',
      'GET /api/kits/effective?conversation_id=c1',
      'GET /api/kits/effective?project_id=p1&assistant_id=a1',
    ]);
  });

  it('writes with the exact request bodies and a CSRF header', async () => {
    const { kits } = await import('@/common/adapter/ipcBridge');

    await kits.create.invoke({ name: 'Ops', skills: ['pf-ui'], mcp_instance_ids: [], mcp_templates: [] });
    await kits.create.invoke({
      name: 'TB-test',
      project_id: 'proj-tb',
      skills: [],
      mcp_instance_ids: [],
      mcp_templates: [],
    });
    await kits.update.invoke({ id: 'k1', data: { name: 'Ops 2', expected_updated_at: 7 } });
    await kits.remove.invoke({ id: 'k1' });
    await kits.attach.invoke({ level: 'global', item_kind: 'kit', item_ref: 'k1', op: 'add' });
    await kits.detach.invoke({ id: 'att 1' });

    // Writes prime the CSRF cookie once per page load (GET /api/auth/user); only the kit calls matter here.
    const kitCalls = calls.filter((call) => pathOf(call.url).startsWith('/api/kits'));
    expect(kitCalls.map((call) => `${call.method} ${pathOf(call.url)}`)).toEqual([
      'POST /api/kits',
      'POST /api/kits',
      'PUT /api/kits/k1',
      'DELETE /api/kits/k1',
      'POST /api/kits/attachments',
      'DELETE /api/kits/attachments/att%201',
    ]);
    expect(kitCalls[0]?.body).toEqual({ name: 'Ops', skills: ['pf-ui'], mcp_instance_ids: [], mcp_templates: [] });
    expect(kitCalls[1]?.body).toEqual({
      name: 'TB-test',
      project_id: 'proj-tb',
      skills: [],
      mcp_instance_ids: [],
      mcp_templates: [],
    });
    expect(kitCalls[2]?.body).toEqual({ name: 'Ops 2', expected_updated_at: 7 });
    expect(kitCalls[4]?.body).toEqual({ level: 'global', item_kind: 'kit', item_ref: 'k1', op: 'add' });
    for (const call of kitCalls) {
      const names = Object.keys(call.headers).map((name) => name.toLowerCase());
      expect(names, `${call.method} ${call.url}`).toContain('x-csrf-token');
    }
  });
});

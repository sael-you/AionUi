/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { KitAttachmentResponse } from '@/common/config/storage';
import type { ServerResponse } from '@/common/types/platform/serverPools';
import {
  createRequest,
  describeServerError,
  destinationChanged,
  emptyServerForm,
  hostKeyFingerprint,
  parseHostKeys,
  projectServerCount,
  scopeServers,
  scopeToggleAction,
  serverAddress,
  serverFormOf,
  updateRequest,
  validateServerForm,
} from '@/renderer/pages/settings/ServersSettings/serverModel';

const att = (
  id: string,
  ref: string,
  level: KitAttachmentResponse['level'],
  op: KitAttachmentResponse['op'],
  target = ''
): KitAttachmentResponse => ({
  id,
  level,
  target_id: target,
  item_kind: 'server',
  item_ref: ref,
  item_name: ref,
  op,
  created_at: 1,
  updated_at: 1,
});

const server = (over: Partial<ServerResponse> = {}): ServerResponse => ({
  id: 's1',
  name: 'web-1',
  host: 'web1.example.com',
  port: 22,
  ssh_user: 'deploy',
  host_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKKUmej5+uq4elbDcluSJ9ySH9I4u8QmlVuNVi3i4qKZ',
  labels: ['tb'],
  environment: 'staging',
  tier: 'read',
  notes: '',
  enabled: true,
  has_key: true,
  crucial_commands_ask: false,
  tier_note: 'guidance only',
  created_at: 1,
  updated_at: 2,
  ...over,
});

const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----';
const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key);

describe('what a scope gets (C36)', () => {
  const rows = [
    att('a1', 'g1', 'global', 'add'),
    att('a2', 'g2', 'global', 'add'),
    att('a3', 'g2', 'project', 'remove', 'p1'),
    att('a4', 'p', 'project', 'add', 'p1'),
    att('a5', 'other', 'project', 'add', 'p2'),
    { ...att('k', 'skill-x', 'global', 'add'), item_kind: 'skill' as const },
  ];

  it('Global: its own adds only, other kinds ignored', () => {
    expect(scopeServers(rows, null)).toEqual({ here: ['g1', 'g2'], fromGlobal: [], offHere: [] });
  });

  it('a project: own adds, inherited Global ones, and Global ones turned off here', () => {
    expect(scopeServers(rows, 'p1')).toEqual({ here: ['p'], fromGlobal: ['g1'], offHere: ['g2'] });
    expect(projectServerCount(rows, 'p1')).toBe(2);
    expect(projectServerCount(rows, 'p2')).toBe(3);
  });
});

describe('"On in <scope>" toggle', () => {
  it('Global on/off adds or drops the Global attachment', () => {
    expect(scopeToggleAction([], 's', null, true)).toEqual({ kind: 'attach', op: 'add' });
    expect(scopeToggleAction([att('x', 's', 'global', 'add')], 's', null, false)).toEqual({
      kind: 'detach',
      attachmentId: 'x',
    });
    expect(scopeToggleAction([att('x', 's', 'global', 'add')], 's', null, true)).toEqual({ kind: 'none' });
  });

  it('a project: turning an inherited server off writes a remove, turning it back on drops the remove', () => {
    const inherited = [att('g', 's', 'global', 'add')];
    expect(scopeToggleAction(inherited, 's', 'p1', false)).toEqual({ kind: 'attach', op: 'remove' });
    const turnedOff = [...inherited, att('r', 's', 'project', 'remove', 'p1')];
    expect(scopeToggleAction(turnedOff, 's', 'p1', true)).toEqual({ kind: 'detach', attachmentId: 'r' });
  });

  it('a project: its own add is dropped, unless Global would keep it on (then a remove)', () => {
    expect(scopeToggleAction([att('p', 's', 'project', 'add', 'p1')], 's', 'p1', false)).toEqual({
      kind: 'detach',
      attachmentId: 'p',
    });
    const both = [att('g', 's', 'global', 'add'), att('p', 's', 'project', 'add', 'p1')];
    expect(scopeToggleAction(both, 's', 'p1', false)).toEqual({ kind: 'attach', op: 'remove' });
  });

  it('a project remove with nothing inherited is turned into an add', () => {
    expect(scopeToggleAction([att('r', 's', 'project', 'remove', 'p1')], 's', 'p1', true)).toEqual({
      kind: 'attach',
      op: 'add',
    });
  });
});

describe('the form', () => {
  const valid = { ...emptyServerForm(), name: 'web-1', host: '203.0.113.10', ssh_user: 'deploy', private_key: KEY };

  it('accepts a valid new server and builds the exact create body', () => {
    expect(validateServerForm(valid, null)).toEqual({});
    expect(createRequest({ ...valid, labels: [' tb ', ''], host_key: 'web ssh-ed25519 AAAA' })).toEqual({
      name: 'web-1',
      host: '203.0.113.10',
      port: 22,
      ssh_user: 'deploy',
      private_key: KEY,
      host_key: 'ssh-ed25519 AAAA',
      labels: ['tb'],
      environment: 'staging',
      tier: 'read',
      notes: '',
      enabled: true,
    });
  });

  it('names each problem', () => {
    expect(validateServerForm({ ...valid, name: 'Web 1' }, null).name).toBe('nameFormat');
    expect(validateServerForm({ ...valid, host: 'a b' }, null).host).toBe('hostFormat');
    expect(validateServerForm({ ...valid, port: '70000' }, null).port).toBe('portRange');
    expect(validateServerForm({ ...valid, ssh_user: ' ' }, null).ssh_user).toBe('userRequired');
    expect(validateServerForm({ ...valid, private_key: '' }, null).private_key).toBe('keyRequired');
    expect(validateServerForm({ ...valid, private_key: 'ssh-ed25519 AAAA x' }, null).private_key).toBe('keyPublic');
    expect(validateServerForm({ ...valid, private_key: 'hello' }, null).private_key).toBe('keyFormat');
    expect(
      validateServerForm({ ...valid, private_key: `${KEY.replace('b3Bl', 'Proc-Type: 4,ENCRYPTED\nb3Bl')}` }, null)
        .private_key
    ).toBe('keyPassphrase');
    expect(validateServerForm({ ...valid, host_key: 'garbage' }, null).host_key).toBe('hostKeyFormat');
  });

  it('editing: the key is optional, never pre-filled, and only changes are sent', () => {
    const existing = server();
    const form = serverFormOf(existing);
    expect(form.private_key).toBe('');
    expect(validateServerForm(form, existing)).toEqual({});
    expect(updateRequest(form, existing)).toEqual({});
    expect(updateRequest({ ...form, notes: 'db box', private_key: KEY }, existing)).toEqual({
      notes: 'db box',
      private_key: KEY,
    });
  });

  it('a new destination keeps a re-entered host key and otherwise lets core clear it', () => {
    const existing = server();
    const moved = { ...serverFormOf(existing), host: 'web2.example.com' };
    expect(destinationChanged(moved, existing)).toBe(true);
    expect(updateRequest(moved, existing)).toEqual({ host: 'web2.example.com', host_key: existing.host_key });
    expect(updateRequest({ ...moved, host_key: '' }, existing)).toEqual({ host: 'web2.example.com', host_key: '' });
  });
});

describe('host keys', () => {
  it('reads key lines (with or without a known_hosts host) and skips the rest', () => {
    expect(parseHostKeys('# comment\nweb1 ssh-ed25519 AAAAC3Nz\necdsa-sha2-nistp256 AAAAE2Vj==\nnot a key')).toEqual([
      { type: 'ssh-ed25519', base64: 'AAAAC3Nz' },
      { type: 'ecdsa-sha2-nistp256', base64: 'AAAAE2Vj==' },
    ]);
  });

  it('prints the same SHA-256 fingerprint as ssh-keygen -lf', async () => {
    const [line] = parseHostKeys(server().host_key);
    // Expected value from `ssh-keygen -lf` on the same public key.
    expect(await hostKeyFingerprint(line?.base64 ?? '')).toBe('SHA256:F5PC1joOfsbtrInNkCVG7u0x3TsD8rQtKGLDgxK2+bc');
  });
});

describe('labels and errors', () => {
  it('shows the address with a port only when it is not 22', () => {
    expect(serverAddress(server())).toBe('deploy@web1.example.com');
    expect(serverAddress(server({ port: 2222 }))).toBe('deploy@web1.example.com:2222');
  });

  it('maps every server error code', () => {
    const err = (code: string, message = '') =>
      new BackendHttpError({ method: 'POST', path: '/api/servers', status: 400, body: { code, error: message } });
    expect(describeServerError(t, err('SERVER_INVALID', 'bad port'))).toBe(
      'settings.servers.errors.invalid|{"detail":"bad port"}'
    );
    expect(describeServerError(t, err('SERVER_NAME_TAKEN'))).toBe('settings.servers.errors.nameTaken');
    expect(describeServerError(t, err('SERVER_NOT_FOUND'))).toBe('settings.servers.errors.notFound');
    expect(describeServerError(t, err('SERVER_POOL_UNAVAILABLE'))).toBe('settings.servers.errors.unavailable');
    expect(describeServerError(t, err('SERVER_UNREACHABLE'))).toBe('settings.servers.errors.unreachable');
    expect(describeServerError(t, err('MCP_MARKET_SESSION_REQUIRED'))).toBe('settings.servers.errors.sessionRequired');
    expect(describeServerError(t, new Error('offline'))).toBe('offline');
  });
});

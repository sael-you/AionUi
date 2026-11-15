/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The password tools (resetpass, first-start seeding) follow the identity the
 * data dir was last served with, not only the shell's environment (card C11).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isExplicitLocalIdentity,
  readIdentityMarker,
  recordIdentityMarker,
  writeIdentityMarker,
} from '../../../packages/web-host/src/backend-launcher.js';
import { passwordToolsIdentity, startPasswordPolicy } from '../../../packages/web-cli/src/passwordGuard.js';

const dirs: string[] = [];
const dataDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-guard-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('password tools identity', () => {
  it('refuses (webui) when the data dir was served in WebUI identity, even without the env var', () => {
    const dir = dataDir();
    writeIdentityMarker(dir, 'webui');
    expect(passwordToolsIdentity(dir, {})).toBe('webui');
    expect(passwordToolsIdentity(dir, { AIONUI_BACKEND_IDENTITY: 'local' })).toBe('webui');
  });

  it('refuses (webui) when the shell says webui, even if the marker says local', () => {
    const dir = dataDir();
    writeIdentityMarker(dir, 'local');
    expect(passwordToolsIdentity(dir, { AIONUI_BACKEND_IDENTITY: 'webui' })).toBe('webui');
  });

  it('allows (local) with a local marker or no marker and no env var', () => {
    const local = dataDir();
    writeIdentityMarker(local, 'local');
    expect(passwordToolsIdentity(local, {})).toBe('local');
    expect(passwordToolsIdentity(dataDir(), {})).toBe('local');
  });
});

describe('start password policy (messages follow this start, seeding follows the data dir)', () => {
  it('first local start after WebUI identity: local messages, seeding still refused', () => {
    const dir = dataDir();
    writeIdentityMarker(dir, 'webui');
    expect(startPasswordPolicy('local', dir, { AIONUI_BACKEND_IDENTITY: 'local' })).toEqual({
      identity: 'local',
      seedingAllowed: false,
    });
    expect(startPasswordPolicy('local', dir, {})).toEqual({ identity: 'local', seedingAllowed: false });
  });

  it('local start on a local or fresh data dir may seed; a WebUI start never does', () => {
    const local = dataDir();
    writeIdentityMarker(local, 'local');
    expect(startPasswordPolicy('local', local, {})).toEqual({ identity: 'local', seedingAllowed: true });
    expect(startPasswordPolicy('local', dataDir(), {})).toEqual({ identity: 'local', seedingAllowed: true });
    expect(startPasswordPolicy('webui', dataDir(), { AIONUI_BACKEND_IDENTITY: 'webui' })).toEqual({
      identity: 'webui',
      seedingAllowed: false,
    });
  });
});

describe('identity marker: a webui marker stays until a deliberate rollback', () => {
  it('a stray local start (no explicit AIONUI_BACKEND_IDENTITY=local) keeps webui, resetpass stays refused', () => {
    const dir = dataDir();
    writeIdentityMarker(dir, 'webui');
    for (const env of [{}, { AIONUI_BACKEND_IDENTITY: '' }, { AIONUI_BACKEND_IDENTITY: 'lcoal' }]) {
      expect(recordIdentityMarker(dir, 'local', isExplicitLocalIdentity(env))).toBe(false);
      expect(readIdentityMarker(dir)).toBe('webui');
      expect(passwordToolsIdentity(dir, env)).toBe('webui');
    }
  });

  it('a deliberate rollback (explicit local) writes local; the next start may seed again', () => {
    const dir = dataDir();
    writeIdentityMarker(dir, 'webui');
    const env = { AIONUI_BACKEND_IDENTITY: ' local\n' };
    const policy = startPasswordPolicy('local', dir, env); // read before the start
    expect(recordIdentityMarker(dir, 'local', isExplicitLocalIdentity(env))).toBe(true);
    expect(readIdentityMarker(dir)).toBe('local');
    expect(policy.seedingAllowed).toBe(false);
    expect(startPasswordPolicy('local', dir, env).seedingAllowed).toBe(true);
  });

  it('webui is always recorded; local over local or no marker is unchanged', () => {
    const dir = dataDir();
    expect(recordIdentityMarker(dir, 'local')).toBe(true);
    expect(readIdentityMarker(dir)).toBe('local');
    expect(recordIdentityMarker(dir, 'webui')).toBe(true);
    expect(readIdentityMarker(dir)).toBe('webui');
  });

  it('removes the temp file when the write cannot complete', () => {
    const dir = dataDir();
    // A non-empty directory at the target makes the rename fail.
    fs.mkdirSync(path.join(dir, 'identity-mode'));
    fs.writeFileSync(path.join(dir, 'identity-mode', 'x'), '');
    expect(() => writeIdentityMarker(dir, 'webui')).toThrow();
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

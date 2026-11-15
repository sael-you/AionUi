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

import { writeIdentityMarker } from '../../../packages/web-host/src/backend-launcher.js';
import { passwordToolsIdentity } from '../../../packages/web-cli/src/passwordGuard.js';

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

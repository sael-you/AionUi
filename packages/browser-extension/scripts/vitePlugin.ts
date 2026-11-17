/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vite plugin (renderer build only, TASK-133): builds the AionUi Browser
 * Bridge and ships it with the web UI as static assets, so Settings → Browser
 * can offer the download:
 *
 *   extension/aionui-browser-bridge-<version>.zip
 *   extension/latest.json   { version, file, sha256, size }
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ExtensionRelease = { version: string; file: string; sha256: string; size: number };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The release descriptor of a built zip. */
export const describeRelease = (version: string, zip: Uint8Array): ExtensionRelease => ({
  version,
  file: `aionui-browser-bridge-${version}.zip`,
  sha256: createHash('sha256').update(zip).digest('hex'),
  size: zip.byteLength,
});

type EmitContext = { emitFile(file: { type: 'asset'; fileName: string; source: string | Uint8Array }): string };

export const browserExtensionBundle = () => {
  let emitted = false;
  return {
    name: 'aionui-browser-extension-bundle',
    apply: 'build' as const,
    generateBundle(this: EmitContext) {
      if (emitted) return;
      emitted = true;
      // The extension's own build needs Bun (Bun.build); the UI build already runs under bun.
      execFileSync('bun', [join(root, 'scripts/build.ts')], { stdio: 'inherit' });
      const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
      const zip = readFileSync(join(root, 'dist', `aionui-browser-bridge-${version}.zip`));
      const release = describeRelease(version, zip);
      this.emitFile({ type: 'asset', fileName: `extension/${release.file}`, source: zip });
      this.emitFile({ type: 'asset', fileName: 'extension/latest.json', source: `${JSON.stringify(release)}\n` });
    },
  };
};

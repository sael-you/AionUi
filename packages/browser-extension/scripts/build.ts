/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Build the AionUi Browser Bridge (C34): bundles the service worker and the
 * popup with Bun, copies the manifest (version from package.json, pinned key →
 * stable extension id) and the icon, writes `dist/unpacked/` (Load unpacked)
 * and `dist/aionui-browser-bridge-<version>.zip`.
 *
 *   bun packages/browser-extension/scripts/build.ts
 */

import { crc32 } from './zip';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const dist = join(root, 'dist');
const out = join(dist, 'unpacked');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, 'src/background.ts'), join(root, 'src/popup.tsx')],
  outdir: out,
  target: 'browser',
  format: 'esm',
  minify: true,
  naming: '[name].[ext]',
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
manifest.version = pkg.version;
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(join(root, 'src/popup.html'), join(out, 'popup.html'));
copyFileSync(join(repo, 'public/pwa/icon-192.png'), join(out, 'icon.png'));

for (const required of ['background.js', 'popup.js', 'popup.css', 'popup.html', 'manifest.json', 'icon.png']) {
  if (!existsSync(join(out, required))) {
    console.error(`missing ${required} in ${out}`);
    process.exit(1);
  }
}

// ---- zip (stored as deflate, no external tool) ----
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir).toSorted()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};
walk(out);

const local: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const path of files) {
  const name = Buffer.from(relative(out, path).split('\\').join('/'));
  const data = readFileSync(path);
  const deflated = deflateRawSync(data);
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(deflated.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, deflated);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(deflated.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + deflated.length;
}
const centralSize = central.reduce((sum, b) => sum + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
const zipPath = join(dist, `aionui-browser-bridge-${pkg.version}.zip`);
writeFileSync(zipPath, Buffer.concat([...local, ...central, end]));

console.log(`unpacked: ${out}`);
console.log(`zip:      ${zipPath}`);

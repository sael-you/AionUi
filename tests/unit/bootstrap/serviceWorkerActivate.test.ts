/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * public/sw.js activation: open tabs are reloaded only when the worker replaces an
 * older one's caches. On a first install a reload would cancel the page's own
 * in-flight requests (the "Failed to fetch current user" console error on a first
 * visit) and load the app twice.
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf-8');

const activate = async (existingCaches: string[]) => {
  const listeners: Record<string, (event: { waitUntil: (p: Promise<unknown>) => void }) => void> = {};
  const navigate = vi.fn(() => Promise.resolve());
  const deleted: string[] = [];
  const self = {
    location: { href: 'http://127.0.0.1:3100/sw.js', origin: 'http://127.0.0.1:3100' },
    addEventListener: (name: string, fn: (typeof listeners)[string]) => {
      listeners[name] = fn;
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([{ url: 'http://127.0.0.1:3100/#/board/p1', navigate }]),
    },
    skipWaiting: () => Promise.resolve(),
  };
  const caches = {
    keys: () => Promise.resolve(existingCaches),
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve(true);
    },
  };
  vm.runInNewContext(SOURCE, { self, caches, URL, Response, fetch: () => Promise.reject(new Error('offline')) });
  let done: Promise<unknown> = Promise.resolve();
  listeners.activate({ waitUntil: (p) => (done = p) });
  await done;
  return { navigate, deleted };
};

describe('service worker activation', () => {
  it('does not reload the page on a first install', async () => {
    const { navigate, deleted } = await activate(['aionui-webui-v2']);
    expect(navigate).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('drops the old caches and reloads open tabs after an upgrade', async () => {
    const { navigate, deleted } = await activate(['aionui-webui-v1', 'aionui-webui-v2']);
    expect(deleted).toEqual(['aionui-webui-v1']);
    expect(navigate).toHaveBeenCalledWith('http://127.0.0.1:3100/#/board/p1');
  });
});

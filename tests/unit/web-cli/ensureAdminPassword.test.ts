/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ensureAdminPassword,
  SEEDING_REFUSED_AFTER_WEBUI,
  WEBUI_FIRST_PASSWORD_STEPS,
  WEBUI_PASSWORD_PROCEDURE,
  type EnsureAdminPasswordDeps,
} from '../../../packages/web-cli/src/ensureAdminPassword.js';

type FetchCall = { url: string; init?: RequestInit };

function mockResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDeps(opts: { handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>> }): {
  deps: EnsureAdminPasswordDeps;
  calls: FetchCall[];
  logs: string[];
  warns: string[];
  sleeps: number[];
} {
  const calls: FetchCall[] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const sleeps: number[] = [];
  let nowVal = 0;
  let idx = 0;
  const deps: EnsureAdminPasswordDeps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      const handler = opts.handlers[idx] ?? opts.handlers[opts.handlers.length - 1];
      idx++;
      return handler(url, init);
    }) as typeof fetch,
    log: (msg) => logs.push(msg),
    warn: (msg) => warns.push(msg),
    sleep: async (ms) => {
      sleeps.push(ms);
      nowVal += ms;
    },
    now: () => nowVal,
  };
  return { deps, calls, logs, warns, sleeps };
}

describe('ensureAdminPassword in WebUI identity (card C11)', () => {
  it('probes the status and, with no password yet, warns with the first-password steps', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: true })],
    });

    await ensureAdminPassword({ backendPort: 25808, identity: 'webui' }, deps);

    expect(calls.map((call) => call.url)).toEqual(['http://127.0.0.1:25808/api/auth/status']);
    expect(warns).toEqual(WEBUI_FIRST_PASSWORD_STEPS.map((line) => `[aionui-web] ${line}`));
    expect(warns.join('\n')).toContain('aioncore user set-password');
    expect(warns.join('\n')).toContain('internal.json');
    expect(warns.join('\n')).toContain('cli.js set-password');
    expect(logs).toEqual([]);
  });

  it('with a password set, never calls the reset endpoint and prints the procedure', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: false })],
    });

    await ensureAdminPassword({ backendPort: 25808, identity: 'webui' }, deps);

    expect(calls).toHaveLength(1);
    expect(warns).toEqual([]);
    expect(logs).toEqual(WEBUI_PASSWORD_PROCEDURE.map((line) => `[aionui-web] ${line}`));
    expect(logs.join('\n')).toContain('cli.js set-password');
    expect(logs.join('\n')).toContain('user disable --username');
    expect(logs.join('\n')).not.toContain('users.json');
  });

  it('local identity keeps the seeding flow unchanged', async () => {
    const { deps, calls } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: true }),
        () => mockResponse(200, { data: { new_password: 'pw' } }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808, identity: 'local' }, deps);

    expect(calls[1].url).toBe('http://127.0.0.1:25808/api/webui/reset-password');
  });
});

describe('ensureAdminPassword on the first local start after WebUI identity (rollback)', () => {
  const procedureLines = [...WEBUI_PASSWORD_PROCEDURE, ...WEBUI_FIRST_PASSWORD_STEPS];

  it('with a password set, prints the local login hint, not the WebUI procedure', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: false }), () => mockResponse(200, { data: { username: 'u' } })],
    });

    await ensureAdminPassword({ backendPort: 25808, identity: 'local', seedingAllowed: false }, deps);

    expect(calls.map((call) => call.url)).not.toContain('http://127.0.0.1:25808/api/webui/reset-password');
    expect(logs).toEqual(['[aionui-web] Log in with username "u". Forgot the password? Run `aionui-web resetpass`.']);
    expect(warns).toEqual([]);
    for (const line of procedureLines) expect([...logs, ...warns].join('\n')).not.toContain(line);
  });

  it('without a password, still refuses to seed and prints no WebUI procedure', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: true })],
    });

    await ensureAdminPassword({ backendPort: 25808, identity: 'local', seedingAllowed: false }, deps);

    expect(calls.map((call) => call.url)).toEqual(['http://127.0.0.1:25808/api/auth/status']);
    expect(warns).toEqual([`[aionui-web] ${SEEDING_REFUSED_AFTER_WEBUI}`]);
    expect(logs).toEqual([]);
  });
});

describe('ensureAdminPassword', () => {
  it('seeds password on fresh install (needs_setup=true)', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [
        // /api/auth/status
        () => mockResponse(200, { needs_setup: true }),
        // POST /api/webui/reset-password
        () => mockResponse(200, { data: { new_password: 'SuperSecret123' } }),
        // /api/auth/internal/users/system
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(calls[0].url).toBe('http://127.0.0.1:25808/api/auth/status');
    expect(calls[1].url).toBe('http://127.0.0.1:25808/api/webui/reset-password');
    expect(calls[1].init?.method).toBe('POST');
    expect(logs).toContain('[aionui-web] Generated initial admin password: SuperSecret123');
    expect(logs.some((m) => m.includes('Log in with username "admin"'))).toBe(true);
    expect(warns).toEqual([]);
  });

  it('accepts top-level new_password in reset-password response', async () => {
    const { deps, logs } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: true }),
        () => mockResponse(200, { new_password: 'FromTopLevel' }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(logs).toContain('[aionui-web] Generated initial admin password: FromTopLevel');
  });

  it('reads needs_setup from nested data field', async () => {
    const { deps, calls, logs } = makeDeps({
      handlers: [
        () => mockResponse(200, { data: { needs_setup: true } }),
        () => mockResponse(200, { data: { new_password: 'Nested' } }),
        () => mockResponse(200, { data: { username: 'custom-admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(calls).toHaveLength(3);
    expect(logs.some((m) => m.includes('custom-admin'))).toBe(true);
  });

  it('no-op when admin already provisioned (needs_setup=false)', async () => {
    const { deps, calls, logs, warns } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: false }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe('http://127.0.0.1:25808/api/auth/internal/users/system');
    expect(logs.some((m) => m.includes('resetpass'))).toBe(true);
    expect(logs.every((m) => !m.includes('Generated initial admin password'))).toBe(true);
    expect(warns).toEqual([]);
  });

  it('polls /api/auth/status until backend is ready', async () => {
    let statusAttempts = 0;
    const { deps, sleeps, logs } = makeDeps({
      handlers: [
        // First three fetches are all /api/auth/status: 2 failures then success.
        () => {
          statusAttempts++;
          throw new Error('connect ECONNREFUSED');
        },
        () => {
          statusAttempts++;
          throw new Error('connect ECONNREFUSED');
        },
        () => {
          statusAttempts++;
          return mockResponse(200, { needs_setup: true });
        },
        () => mockResponse(200, { data: { new_password: 'Pw' } }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808, statusTimeoutMs: 10_000, statusPollIntervalMs: 100 }, deps);

    expect(statusAttempts).toBe(3);
    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((m) => m.includes('Generated initial admin password'))).toBe(true);
  });

  it('warns (not throws) when status never comes up within budget', async () => {
    const { deps, warns, logs } = makeDeps({
      handlers: [() => mockResponse(500, 'oops')],
    });

    await ensureAdminPassword({ backendPort: 25808, statusTimeoutMs: 1_000, statusPollIntervalMs: 250 }, deps);

    expect(warns.some((w) => w.includes('could not verify admin credentials'))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('warns (not throws) when reset-password fails', async () => {
    const { deps, warns, logs } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: true }), () => mockResponse(500, 'boom')],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(warns.some((w) => w.includes('/api/webui/reset-password returned 500'))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('warns (not throws) when reset-password returns no password', async () => {
    const { deps, warns, logs } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: true }), () => mockResponse(200, { data: {} })],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(warns.some((w) => w.includes('returned no new_password'))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('falls back to "admin" username when system user lookup fails', async () => {
    const { deps, logs } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: true }),
        () => mockResponse(200, { data: { new_password: 'Pw' } }),
        () => mockResponse(500, 'broken'),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(logs.some((m) => m.includes('Log in with username "admin"'))).toBe(true);
  });

  it('uses caller-supplied resetCommand in the "Forgot the password" hint', async () => {
    const { deps, logs } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: false }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808, resetCommand: 'bun run resetpass' }, deps);

    expect(logs.some((m) => m.includes('bun run resetpass'))).toBe(true);
    expect(logs.every((m) => !m.includes('aionui-web resetpass'))).toBe(true);
  });

  it('defaults to `aionui-web resetpass` when resetCommand is not provided', async () => {
    const { deps, logs } = makeDeps({
      handlers: [
        () => mockResponse(200, { needs_setup: false }),
        () => mockResponse(200, { data: { username: 'admin' } }),
      ],
    });

    await ensureAdminPassword({ backendPort: 25808 }, deps);

    expect(logs.some((m) => m.includes('aionui-web resetpass'))).toBe(true);
  });

  it('propagates resetCommand into warn messages when reset-password fails', async () => {
    const { deps, warns } = makeDeps({
      handlers: [() => mockResponse(200, { needs_setup: true }), () => mockResponse(500, 'boom')],
    });

    await ensureAdminPassword({ backendPort: 25808, resetCommand: 'bun run resetpass' }, deps);

    expect(warns.some((w) => w.includes('bun run resetpass'))).toBe(true);
  });
});

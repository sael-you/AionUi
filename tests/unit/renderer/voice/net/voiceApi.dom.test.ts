import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER_NAME } from '@/common/adapter/csrf';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import * as voiceApiModule from '@/renderer/voice/net/voiceApi';
import { resolveClipPath, VoiceBusyError, voiceApi, voiceErrorCode } from '@/renderer/voice/net/voiceApi';

// Spy on the shared `httpRequest` while still running the real one, so the
// tests prove voice writes take the shared C11 path (csrf.ts) and nothing else.
const shared = vi.hoisted(() => ({
  spy: undefined as unknown as Mock<(...args: unknown[]) => Promise<unknown>>,
  real: undefined as unknown as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common/adapter/httpBridge')>();
  const { vi: hoistedVi } = await import('vitest');
  shared.real = actual.httpRequest as (...args: unknown[]) => Promise<unknown>;
  shared.spy = hoistedVi.fn((...args: unknown[]) => shared.real(...args));
  return { ...actual, httpRequest: shared.spy };
});

const TOKEN = 'ab'.repeat(32);

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status: number; body?: unknown; setCookie?: string }>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    if (r.setCookie) document.cookie = r.setCookie;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const clearCookie = () => {
  document.cookie = 'aionui-csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
};

beforeEach(() => {
  clearCookie();
  shared.spy.mockClear();
  shared.spy.mockImplementation((...args: unknown[]) => shared.real(...args));
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearCookie();
});

describe('voiceApi', () => {
  it('has no CSRF code of its own', () => {
    const exported = Object.keys(voiceApiModule);
    expect(exported.some((name) => /csrf/i.test(name))).toBe(false);
    // The source itself: no csrf import, cookie read or header outside comments.
    const source = readFileSync(
      path.resolve(__dirname, '../../../../../packages/desktop/src/renderer/voice/net/voiceApi.ts'),
      'utf-8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/csrf/i);
    expect(code).not.toMatch(/document\.cookie/);
    expect(code).not.toMatch(/authorization/i);
    expect(code).not.toMatch(/from ['"][^'"]*csrf['"]/);
  });

  it('sends every write through the shared httpRequest with no headers of its own', async () => {
    shared.spy.mockResolvedValue({ voice_session_id: 'vs', sdp_answer: 'a' });
    await voiceApi.createSession({ engine: 'openai-realtime', sdp_offer: 'o', device_id: 'd' });
    await voiceApi.putSettings({ enabled: true });
    await voiceApi.endSession('vs 1', 'user');
    expect(shared.spy.mock.calls).toEqual([
      [
        'POST',
        '/api/voice/sessions',
        { engine: 'openai-realtime', sdp_offer: 'o', device_id: 'd' },
        { silentStatuses: [409] },
      ],
      ['PUT', '/api/voice/settings', { enabled: true }, { silentStatuses: [409] }],
      ['POST', '/api/voice/sessions/vs%201/end', { reason: 'user' }, { silentStatuses: [409] }],
    ]);
  });

  it('gets x-csrf-token from the shared C11 cookie handling and never an Authorization header', async () => {
    document.cookie = `aionui-csrf-token=${TOKEN}; path=/`;
    const calls = mockFetch([
      { status: 200, body: { success: true, data: { voice_session_id: 'vs', sdp_answer: 'a' } } },
    ]);
    const res = await voiceApi.createSession({ engine: 'openai-realtime', sdp_offer: 'o', device_id: 'd' });
    expect(res.voice_session_id).toBe('vs');
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBe(TOKEN);
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(headers).some((h) => h.toLowerCase().startsWith('x-aionui-'))).toBe(false);
    expect(calls[0].url).toMatch(/\/api\/voice\/sessions$/);
  });

  it('maps 409 on session creation to VoiceBusyError', async () => {
    document.cookie = `aionui-csrf-token=${TOKEN}; path=/`;
    mockFetch([{ status: 409, body: { code: 'VOICE_BUSY' } }]);
    await expect(
      voiceApi.createSession({ engine: 'openai-realtime', sdp_offer: 'o', device_id: 'd' })
    ).rejects.toBeInstanceOf(VoiceBusyError);
  });

  it('fills defaults into partial settings (voice off by default)', async () => {
    mockFetch([{ status: 200, body: { success: true, data: { engine: 'openai-realtime' } } }]);
    const s = await voiceApi.getSettings();
    expect(s.enabled).toBe(false);
    expect(s.daily_budget_usd).toBe(5);
  });

  it('reads the session list with a plain GET of /api/voice/sessions (TASK-37 #5)', async () => {
    const row = { id: 's1', engine: 'openai-realtime', model: 'm', state: 'ended', created_at: 1, cost_usd: 0.1 };
    const calls = mockFetch([{ status: 200, body: { success: true, data: [row] } }]);
    await expect(voiceApi.listSessions()).resolves.toEqual([row]);
    expect(calls[0].url).toMatch(/\/api\/voice\/sessions$/);
    expect(calls[0].init.method ?? 'GET').toBe('GET');
  });

  it('refuses to fetch a clip from a URL outside /api/voice/readbacks', async () => {
    mockFetch([]);
    await expect(voiceApi.fetchClip('https://evil.example/x')).rejects.toThrow(/refused/);
  });
});

describe('resolveClipPath', () => {
  it('accepts ids, same-origin readback paths and same-origin absolute URLs', () => {
    expect(resolveClipPath('rb_1')).toBe('/api/voice/readbacks/rb_1');
    expect(resolveClipPath('/api/voice/readbacks/rb1')).toBe('/api/voice/readbacks/rb1');
    expect(resolveClipPath(`${window.location.origin}/api/voice/readbacks/rb1`)).toBe('/api/voice/readbacks/rb1');
  });

  it('rejects traversal, other paths and other origins', () => {
    expect(resolveClipPath('/api/voice/readbacks/../providers')).toBeNull();
    expect(resolveClipPath('/api/providers')).toBeNull();
    expect(resolveClipPath('https://evil.example/api/voice/readbacks/rb1')).toBeNull();
    expect(resolveClipPath('')).toBeNull();
  });
});

describe('voiceErrorCode', () => {
  it('maps errors to UI codes', () => {
    expect(voiceErrorCode(new VoiceBusyError())).toBe('busy');
    expect(voiceErrorCode(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('maps the POST /api/voice/sessions refusals of PROTOCOL.md', () => {
    const err = (status: number, code: string) =>
      new BackendHttpError({ method: 'POST', path: '/api/voice/sessions', status, body: { success: false, code } });
    expect(voiceErrorCode(err(403, 'VOICE_DISABLED'))).toBe('disabled');
    expect(voiceErrorCode(err(412, 'VOICE_NO_PROVIDER'))).toBe('noProvider');
    expect(voiceErrorCode(err(412, 'VOICE_NO_MINIMAX_PROVIDER'))).toBe('noMinimaxProvider');
    expect(voiceErrorCode(err(429, 'VOICE_BUDGET_REACHED'))).toBe('budget');
    expect(voiceErrorCode(err(429, 'RATE_LIMITED'))).toBe('rateLimited');
    expect(voiceErrorCode(err(502, 'BAD_GATEWAY'))).toBe('callFailed');
    expect(voiceErrorCode(err(401, 'UNAUTHORIZED'))).toBe('unauthorized');
  });
});

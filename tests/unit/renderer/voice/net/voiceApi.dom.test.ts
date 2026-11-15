import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CSRF_HEADER_NAME,
  readCsrfCookie,
  resolveClipPath,
  VoiceBusyError,
  voiceApi,
  voiceErrorCode,
} from '@/renderer/voice/net/voiceApi';

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
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearCookie();
});

describe('readCsrfCookie', () => {
  it('reads the aionui-csrf-token cookie among others', () => {
    expect(readCsrfCookie('a=1; aionui-csrf-token=abc%20d; b=2')).toBe('abc d');
    expect(readCsrfCookie('csrf-token=nope')).toBe('');
  });
});

describe('voiceApi', () => {
  it('sends x-csrf-token from the cookie on POST and never an Authorization header', async () => {
    document.cookie = 'aionui-csrf-token=tok123; path=/';
    const calls = mockFetch([
      { status: 200, body: { success: true, data: { voice_session_id: 'vs', sdp_answer: 'a' } } },
    ]);
    const res = await voiceApi.createSession({ engine: 'openai-realtime', sdp_offer: 'o', device_id: 'd' });
    expect(res.voice_session_id).toBe('vs');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers[CSRF_HEADER_NAME]).toBe('tok123');
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(headers).some((h) => h.toLowerCase().startsWith('x-aionui-'))).toBe(false);
    expect(calls[0].url).toMatch(/\/api\/voice\/sessions$/);
  });

  it('primes the CSRF cookie with a safe GET when it is missing', async () => {
    const calls = mockFetch([
      { status: 200, body: { enabled: false }, setCookie: 'aionui-csrf-token=fresh; path=/' },
      { status: 200, body: { enabled: true } },
    ]);
    await voiceApi.putSettings({ enabled: true });
    expect(calls[0].init.method).toBe('GET');
    expect(calls[1].init.method).toBe('PUT');
    expect((calls[1].init.headers as Record<string, string>)[CSRF_HEADER_NAME]).toBe('fresh');
  });

  it('maps 409 on session creation to VoiceBusyError', async () => {
    document.cookie = 'aionui-csrf-token=t; path=/';
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
});

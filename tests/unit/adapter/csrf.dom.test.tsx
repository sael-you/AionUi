/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSRF double-submit on every unsafe request (card C11, row 5): cookie read per
 * request (`__Host-` name first), one priming GET /api/auth/user per page load at
 * most, one retry on 403 CSRF_INVALID — and in local identity (no cookie) zero
 * extra requests per write.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The DOM test setup marks the window as Electron desktop; these are WebUI paths.
vi.hoisted(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

import {
  CSRF_HEADER_NAME,
  csrfHeaders,
  fetchWithCsrf,
  noteAuthUserRequest,
  readCsrfCookie,
  resetCsrfForTest,
} from '@/common/adapter/csrf';
import { httpRequest } from '@/common/adapter/httpBridge';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { configService } from '@/common/config/configService';
import { createApiClient } from '@/renderer/api/client';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import { transcribeAudioBlob } from '@/renderer/services/SpeechToTextService';

type WindowWithPort = { __backendPort?: number };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const csrfRejection = () => json(403, { success: false, error: 'CSRF token validation failed', code: 'CSRF_INVALID' });

const setCookie = (value: string) => {
  document.cookie = `aionui-csrf-token=${value}; Path=/`;
};
const clearCookie = () => {
  document.cookie = 'aionui-csrf-token=; Path=/; Max-Age=0';
};

/** Header value a fetch call was made with. */
const sentToken = (init: RequestInit | undefined): string | null => new Headers(init?.headers).get(CSRF_HEADER_NAME);

/** fetch mock: `/api/auth/user` answers 200 (optionally setting the cookie), everything else via `answer`. */
const mockFetch = (answer: (url: string, init?: RequestInit) => Response, cookieOnAuthUser?: string) => {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/user')) {
      if (cookieOnAuthUser) setCookie(cookieOnAuthUser);
      return json(200, { success: true, user: { id: 'u1', username: 'me' } });
    }
    return answer(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};
const writes = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([url]) => !String(url).endsWith('/api/auth/user'));
const authChecks = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/user'));

beforeEach(() => {
  delete (window as WindowWithPort).__backendPort;
  resetCsrfForTest();
  clearCookie();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearCookie();
});

describe('reading the CSRF cookie', () => {
  it('prefers the __Host- name, falls back to the legacy name, else empty', () => {
    expect(readCsrfCookie('a=1; aionui-csrf-token=legacy; __Host-aionui-csrf-token=host')).toBe('host');
    expect(readCsrfCookie('aionui-csrf-token=legacy')).toBe('legacy');
    expect(readCsrfCookie('other=1')).toBe('');
  });

  it('adds no header for safe methods and never primes for them', async () => {
    const fn = mockFetch(() => json(200, {}));
    expect(await csrfHeaders('GET')).toEqual({});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('local identity (production today): no cookie is ever set', () => {
  it('makes zero extra requests per write once the page has checked the user', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    noteAuthUserRequest(Promise.resolve()); // the AuthProvider's check of this page load
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await httpRequest('PUT', `/api/x/${i}`, { i });
    }
    expect(writes(fn)).toHaveLength(5);
    expect(authChecks(fn)).toHaveLength(0);
    expect(writes(fn).every(([, init]) => sentToken(init) === null)).toBe(true);
  });

  it('without an earlier check: one priming GET for the whole page, then no header', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('POST', '/api/a', {});
    await httpRequest('DELETE', '/api/b');
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual([null, null]);
  });

  it('desktop renderer (no cookie session): no priming, no header', async () => {
    (window as WindowWithPort).__backendPort = 13400;
    setCookie('ignored');
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('PUT', '/api/x', {});
    expect(authChecks(fn)).toHaveLength(0);
    expect(sentToken(writes(fn)[0][1])).toBeNull();
  });
});

describe('WebUI identity: every write path sends the header', () => {
  it('httpBridge (board, client settings, all ipcBridge writes)', async () => {
    setCookie('tok-1');
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('PATCH', '/api/board/cards/c1', { version: 1 });
    expect(sentToken(writes(fn)[0][1])).toBe('tok-1');
    expect(authChecks(fn)).toHaveLength(0);
  });

  it('httpBridge primes a missing cookie once, then sends it', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }), 'tok-primed');
    await httpRequest('PUT', '/api/settings/client', { a: 1 });
    await httpRequest('PUT', '/api/settings/client', { a: 2 });
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual(['tok-primed', 'tok-primed']);
  });

  it('httpBridge retries once on 403 CSRF_INVALID with a re-primed cookie, then gives up', async () => {
    setCookie('stale');
    let calls = 0;
    const fn = mockFetch(() => {
      calls += 1;
      return calls === 1 ? csrfRejection() : json(200, { success: true, data: 'ok' });
    }, 'fresh');
    await expect(httpRequest('POST', '/api/x', {})).resolves.toBe('ok');
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual(['stale', 'fresh']);

    const always = mockFetch(() => csrfRejection(), 'fresh');
    await expect(httpRequest('POST', '/api/y', {})).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(writes(always)).toHaveLength(2);
  });

  it('sessionRefresh (POST /api/auth/refresh)', async () => {
    setCookie('tok-r');
    const fn = mockFetch(() => json(200, {}));
    await expect(refreshSession()).resolves.toBe(true);
    expect(writes(fn)[0][0]).toBe('/api/auth/refresh');
    expect(sentToken(writes(fn)[0][1])).toBe('tok-r');
  });

  it('configService (PUT /api/settings/client)', async () => {
    setCookie('tok-c');
    const fn = mockFetch(() => json(200, { success: true }));
    await configService.set('language', 'en-US');
    const put = writes(fn).find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toContain('/api/settings/client');
    expect(sentToken(put?.[1])).toBe('tok-c');
  });

  it('renderer api client', async () => {
    setCookie('tok-a');
    const fn = mockFetch(() => json(200, {}));
    await createApiClient('').post('/api/thing', { a: 1 });
    expect(sentToken(writes(fn)[0][1])).toBe('tok-a');
  });

  it('fetchWithCsrf leaves safe methods untouched', async () => {
    setCookie('tok-g');
    const fn = mockFetch(() => json(200, {}));
    await fetchWithCsrf('/api/thing');
    expect(sentToken(fn.mock.calls[0][1])).toBeNull();
  });

  it('AuthContext logout (POST /logout)', async () => {
    setCookie('tok-l');
    const fn = mockFetch(() => json(200, { success: true }));
    let logout: (() => Promise<void>) | undefined;
    const Probe: React.FC = () => {
      const auth = useAuth();
      logout = auth.logout;
      return <span data-testid='status'>{auth.status}</span>;
    };
    const { getByTestId } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(getByTestId('status')).toHaveTextContent('authenticated'));
    await act(async () => logout?.());
    const post = writes(fn).find(([url]) => url === '/logout');
    expect(sentToken(post?.[1])).toBe('tok-l');
  });
});

/** Minimal XHR double: records headers, answers with the queued status/body. */
const installXhr = (answers: Array<{ status: number; body: unknown }>) => {
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  class FakeXhr {
    status = 0;
    statusText = '';
    responseText = '';
    upload = { addEventListener: () => undefined };
    private listeners: Record<string, () => void> = {};
    private request = { url: '', headers: {} as Record<string, string> };
    open(_method: string, url: string) {
      this.request.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.request.headers[name] = value;
    }
    addEventListener(name: string, fn: () => void) {
      this.listeners[name] = fn;
    }
    abort() {}
    send() {
      sent.push(this.request);
      const answer = answers.shift() ?? { status: 200, body: { success: true, data: 'ok' } };
      setTimeout(() => {
        this.status = answer.status;
        this.responseText = JSON.stringify(answer.body);
        this.listeners.load?.();
      }, 0);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
};

describe('WebUI identity: XHR uploads', () => {
  it('FileService upload sends the header and retries once on CSRF_INVALID', async () => {
    setCookie('stale');
    mockFetch(() => json(200, {}), 'fresh');
    const sent = installXhr([
      { status: 403, body: { code: 'CSRF_INVALID' } },
      { status: 200, body: { success: true, data: '/tmp/a.txt' } },
    ]);
    await expect(uploadFileViaHttp(new File(['x'], 'a.txt'))).resolves.toBe('/tmp/a.txt');
    expect(sent.map((request) => request.headers[CSRF_HEADER_NAME])).toEqual(['stale', 'fresh']);
  });

  it('SpeechToTextService sends the header', async () => {
    setCookie('tok-s');
    mockFetch(() => json(200, {}));
    const sent = installXhr([{ status: 200, body: { success: true, data: { text: 'hi' } } }]);
    await transcribeAudioBlob(new Blob(['a'], { type: 'audio/webm' }));
    expect(sent[0].headers[CSRF_HEADER_NAME]).toBe('tok-s');
  });

  it('local identity: no cookie, no header, no extra request', async () => {
    const fn = mockFetch(() => json(200, {}));
    noteAuthUserRequest(Promise.resolve());
    const sent = installXhr([{ status: 200, body: { success: true, data: '/tmp/b.txt' } }]);
    await uploadFileViaHttp(new File(['x'], 'b.txt'));
    expect(sent[0].headers[CSRF_HEADER_NAME]).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});

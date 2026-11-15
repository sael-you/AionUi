/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSRF double-submit on every unsafe request (card C11, row 5): cookie read per
 * request (the protocol's one name, a well-formed token only), one priming
 * GET /api/auth/user per page load at most, one retry on 403 CSRF_INVALID with
 * one shared re-prime per burst — and in local identity (no cookie) zero extra
 * requests per write.
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
  expectAuthUserRequest,
  fetchWithCsrf,
  noteAuthUserRequest,
  readCsrfCookie,
  resetCsrfForTest,
  resolveCsrfToken,
} from '@/common/adapter/csrf';
import { httpRequest } from '@/common/adapter/httpBridge';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { configService } from '@/common/config/configService';
import { createApiClient } from '@/renderer/api/client';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import { transcribeAudioBlob } from '@/renderer/services/SpeechToTextService';

type WindowWithPort = { __backendPort?: number };

/** A well-formed AionCore token (64 lowercase hex digits). */
const tok = (digit: string): string => digit.repeat(64);

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
const mockFetch = (
  answer: (url: string, init?: RequestInit) => Response,
  cookieOnAuthUser?: string,
  authUserDelayMs = 0
) => {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/user')) {
      // Like a browser: the cookie exists once the response arrives.
      if (authUserDelayMs) await new Promise((resolve) => setTimeout(resolve, authUserDelayMs));
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

/** Renders the real AuthProvider with `children`; resolves once its auth check answered. */
const renderAuthProvider = async (children?: React.ReactNode) => {
  const auth: { logout?: () => Promise<void> } = {};
  const Probe: React.FC = () => {
    const value = useAuth();
    auth.logout = value.logout;
    return <span data-testid='status'>{value.status}</span>;
  };
  const view = render(
    <AuthProvider>
      {children}
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(view.getByTestId('status')).toHaveTextContent('authenticated'));
  return auth;
};

describe('reading the CSRF cookie', () => {
  it('over HTTPS reads only the __Host- cookie, over HTTP only the legacy one', () => {
    const both = `a=1; aionui-csrf-token=${tok('1')}; __Host-aionui-csrf-token=${tok('2')}`;
    expect(readCsrfCookie(both, 'https:')).toBe(tok('2'));
    expect(readCsrfCookie(both, 'http:')).toBe(tok('1'));
    // A plain-named cookie (settable by a sibling subdomain) is ignored over HTTPS.
    expect(readCsrfCookie(`aionui-csrf-token=${tok('1')}`, 'https:')).toBe('');
    expect(readCsrfCookie('other=1', 'http:')).toBe('');
  });

  it('treats a malformed cookie as none (bad encoding, wrong length, not lowercase hex)', () => {
    expect(readCsrfCookie('aionui-csrf-token=%E0%A4%A', 'http:')).toBe('');
    expect(readCsrfCookie(`aionui-csrf-token=${tok('a').slice(1)}`, 'http:')).toBe('');
    expect(readCsrfCookie(`aionui-csrf-token=${tok('A')}`, 'http:')).toBe('');
    expect(readCsrfCookie(`aionui-csrf-token=${tok('g')}`, 'http:')).toBe('');
    expect(readCsrfCookie(`aionui-csrf-token=${tok('a')};x`, 'http:')).toBe(tok('a'));
  });

  it('sends no header for a malformed cookie', async () => {
    setCookie('not-a-token');
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    noteAuthUserRequest(Promise.resolve());
    await httpRequest('PUT', '/api/x', {});
    expect(sentToken(writes(fn)[0][1])).toBeNull();
  });

  it('adds no header for safe methods and never primes for them', async () => {
    const fn = mockFetch(() => json(200, {}));
    expect(await csrfHeaders('GET')).toEqual({});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('local identity (production today): no cookie is ever set', () => {
  it('with the real AuthProvider: zero requests beyond its own check, for any number of writes', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await renderAuthProvider();
    expect(authChecks(fn)).toHaveLength(1); // the page's existing auth check
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await httpRequest('PUT', `/api/x/${i}`, { i });
    }
    expect(writes(fn)).toHaveLength(5);
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn).every(([, init]) => sentToken(init) === null)).toBe(true);
  });

  it('a child that writes in its mount effect (before the provider check starts) makes no request of its own', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    const EarlyWriter: React.FC = () => {
      React.useEffect(() => {
        void httpRequest('PUT', '/api/early', {});
      }, []);
      return null;
    };
    await renderAuthProvider(<EarlyWriter />);
    await waitFor(() => expect(writes(fn)).toHaveLength(1));
    expect(authChecks(fn)).toHaveLength(1);
    // The write waited for the provider's check.
    const order = fn.mock.calls.map(([url]) => String(url));
    expect(order.indexOf('/api/auth/user')).toBeLessThan(order.findIndex((url) => url.endsWith('/api/early')));
  });

  it('XHR upload with the real AuthProvider: no header, no extra request', async () => {
    const fn = mockFetch(() => json(200, {}));
    await renderAuthProvider();
    const sent = installXhr([{ status: 200, body: { success: true, data: '/tmp/b.txt' } }]);
    await uploadFileViaHttp(new File(['x'], 'b.txt'));
    expect(sent[0].headers[CSRF_HEADER_NAME]).toBeUndefined();
    expect(authChecks(fn)).toHaveLength(1);
  });

  it('without an AuthProvider on the page: the first write makes the one priming GET of the page load, later writes none', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('POST', '/api/a', {});
    await httpRequest('DELETE', '/api/b');
    await httpRequest('PUT', '/api/c', {});
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual([null, null, null]);
  });

  it('desktop renderer (no cookie session): no priming, no header', async () => {
    (window as WindowWithPort).__backendPort = 13400;
    setCookie(tok('e'));
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('PUT', '/api/x', {});
    expect(authChecks(fn)).toHaveLength(0);
    expect(sentToken(writes(fn)[0][1])).toBeNull();
  });
});

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('the page priming request', () => {
  it('an aborted auth check does not count: the waiting write makes its own GET', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }), tok('b'));
    expectAuthUserRequest();
    const write = httpRequest('PUT', '/api/x', {});
    noteAuthUserRequest(Promise.reject(abortError()));
    await write;
    expect(authChecks(fn)).toHaveLength(1);
    expect(sentToken(writes(fn)[0][1])).toBe(tok('b'));
  });

  it('an aborted check replaced by a newer one: the write waits for the newer one', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    expectAuthUserRequest();
    const write = httpRequest('PUT', '/api/x', {});
    noteAuthUserRequest(Promise.reject(abortError()));
    let release: (() => void) | undefined;
    noteAuthUserRequest(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes(fn)).toHaveLength(0);
    setCookie(tok('c'));
    release?.();
    await write;
    expect(authChecks(fn)).toHaveLength(0);
    expect(sentToken(writes(fn)[0][1])).toBe(tok('c'));
  });
});

describe('403 CSRF_INVALID re-priming', () => {
  it('a burst of concurrent rejections makes at most one GET /api/auth/user', async () => {
    setCookie(tok('1'));
    const fn = mockFetch(
      (_url, init) => (sentToken(init) === tok('2') ? json(200, { success: true, data: 'ok' }) : csrfRejection()),
      tok('2'),
      20
    );
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => httpRequest('POST', `/api/w/${i}`, {})));
    expect(results).toEqual(Array.from({ length: 8 }, () => 'ok'));
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn)).toHaveLength(16);
  });

  it('when the re-prime does not change the cookie, a burst still makes one GET and each write retries once', async () => {
    setCookie(tok('1'));
    const fn = mockFetch(() => csrfRejection());
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => httpRequest('POST', `/api/w/${i}`, {}))
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn)).toHaveLength(12);
    // A later rejection of the same token moments after makes no new request either.
    await expect(httpRequest('POST', '/api/later', {})).rejects.toMatchObject({ status: 403 });
    expect(authChecks(fn)).toHaveLength(1);
  });

  it('makes no GET when the cookie already changed since the rejected attempt', async () => {
    setCookie(tok('9'));
    const fn = mockFetch(() => json(200, {}));
    await expect(resolveCsrfToken({ rejected: tok('8') })).resolves.toBe(tok('9'));
    expect(authChecks(fn)).toHaveLength(0);
  });
});

describe('WebUI identity: every write path sends the header', () => {
  it('httpBridge (board, client settings, all ipcBridge writes)', async () => {
    setCookie(tok('1'));
    const fn = mockFetch(() => json(200, { success: true, data: null }));
    await httpRequest('PATCH', '/api/board/cards/c1', { version: 1 });
    expect(sentToken(writes(fn)[0][1])).toBe(tok('1'));
    expect(authChecks(fn)).toHaveLength(0);
  });

  it('httpBridge primes a missing cookie once, then sends it', async () => {
    const fn = mockFetch(() => json(200, { success: true, data: null }), tok('2'));
    await httpRequest('PUT', '/api/settings/client', { a: 1 });
    await httpRequest('PUT', '/api/settings/client', { a: 2 });
    expect(authChecks(fn)).toHaveLength(1);
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual([tok('2'), tok('2')]);
  });

  it('httpBridge retries once on 403 CSRF_INVALID with a re-primed cookie, then gives up', async () => {
    setCookie(tok('3'));
    let calls = 0;
    const fn = mockFetch(() => {
      calls += 1;
      return calls === 1 ? csrfRejection() : json(200, { success: true, data: 'ok' });
    }, tok('4'));
    await expect(httpRequest('POST', '/api/x', {})).resolves.toBe('ok');
    expect(writes(fn).map(([, init]) => sentToken(init))).toEqual([tok('3'), tok('4')]);

    const always = mockFetch(() => csrfRejection(), tok('4'));
    await expect(httpRequest('POST', '/api/y', {})).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(writes(always)).toHaveLength(2);
  });

  it('sessionRefresh (POST /api/auth/refresh)', async () => {
    setCookie(tok('5'));
    const fn = mockFetch(() => json(200, {}));
    await expect(refreshSession()).resolves.toBe(true);
    expect(writes(fn)[0][0]).toBe('/api/auth/refresh');
    expect(sentToken(writes(fn)[0][1])).toBe(tok('5'));
  });

  it('configService (PUT /api/settings/client)', async () => {
    setCookie(tok('6'));
    const fn = mockFetch(() => json(200, { success: true }));
    await configService.set('language', 'en-US');
    const put = writes(fn).find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toContain('/api/settings/client');
    expect(sentToken(put?.[1])).toBe(tok('6'));
  });

  it('renderer api client', async () => {
    setCookie(tok('7'));
    const fn = mockFetch(() => json(200, {}));
    await createApiClient('').post('/api/thing', { a: 1 });
    expect(sentToken(writes(fn)[0][1])).toBe(tok('7'));
  });

  it('fetchWithCsrf leaves safe methods untouched', async () => {
    setCookie(tok('8'));
    const fn = mockFetch(() => json(200, {}));
    await fetchWithCsrf('/api/thing');
    expect(sentToken(fn.mock.calls[0][1])).toBeNull();
  });

  it('AuthContext logout (POST /logout)', async () => {
    setCookie(tok('9'));
    const fn = mockFetch(() => json(200, { success: true }));
    const auth = await renderAuthProvider();
    await act(async () => auth.logout?.());
    const post = writes(fn).find(([url]) => url === '/logout');
    expect(sentToken(post?.[1])).toBe(tok('9'));
  });

  it('AuthContext logout after a 401 refreshes the session and logs out once more', async () => {
    setCookie(tok('9'));
    let logouts = 0;
    const fn = mockFetch((url) => {
      if (url === '/logout') {
        logouts += 1;
        return logouts === 1 ? json(401, { success: false }) : json(200, { success: true });
      }
      return json(200, { success: true });
    });
    const auth = await renderAuthProvider();
    await act(async () => auth.logout?.());
    expect(writes(fn).map(([url]) => url)).toEqual(['/logout', '/api/auth/refresh', '/logout']);
    expect(writes(fn).every(([, init]) => sentToken(init) === tok('9'))).toBe(true);
  });

  it('AuthContext logout after a 401 does not retry when the refresh fails', async () => {
    setCookie(tok('9'));
    const fn = mockFetch((url) => (url === '/logout' ? json(401, {}) : json(401, { success: false })));
    const auth = await renderAuthProvider();
    await act(async () => auth.logout?.());
    expect(writes(fn).map(([url]) => url)).toEqual(['/logout', '/api/auth/refresh']);
  });

  it('fetchWithCsrf never sends the token to another origin', async () => {
    setCookie(tok('8'));
    const fn = mockFetch(() => json(200, {}));
    await fetchWithCsrf('https://elsewhere.example/api/thing', { method: 'POST' });
    await fetchWithCsrf('//elsewhere.example/api/thing', { method: 'POST' });
    await fetchWithCsrf(`${location.origin}/api/thing`, { method: 'POST' });
    expect(fn.mock.calls.map(([, init]) => sentToken(init))).toEqual([null, null, tok('8')]);
    expect(authChecks(fn)).toHaveLength(0);
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
    setCookie(tok('3'));
    mockFetch(() => json(200, {}), tok('4'));
    const sent = installXhr([
      { status: 403, body: { code: 'CSRF_INVALID' } },
      { status: 200, body: { success: true, data: '/tmp/a.txt' } },
    ]);
    await expect(uploadFileViaHttp(new File(['x'], 'a.txt'))).resolves.toBe('/tmp/a.txt');
    expect(sent.map((request) => request.headers[CSRF_HEADER_NAME])).toEqual([tok('3'), tok('4')]);
  });

  it('SpeechToTextService sends the header', async () => {
    setCookie(tok('a'));
    mockFetch(() => json(200, {}));
    const sent = installXhr([{ status: 200, body: { success: true, data: { text: 'hi' } } }]);
    await transcribeAudioBlob(new Blob(['a'], { type: 'audio/webm' }));
    expect(sent[0].headers[CSRF_HEADER_NAME]).toBe(tok('a'));
  });
});

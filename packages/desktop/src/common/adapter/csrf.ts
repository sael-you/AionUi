/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSRF double-submit for AionCore in WebUI identity (card C11, row 5).
 *
 * In WebUI identity AionCore refuses an unsafe request (POST/PUT/PATCH/DELETE)
 * unless the `x-csrf-token` header equals its CSRF cookie: `__Host-aionui-csrf-token`
 * over HTTPS, the legacy `aionui-csrf-token` otherwise. It sets that cookie on any
 * response to a client that has none, so the first `GET /api/auth/user` of a page
 * load provides it.
 *
 * Rules every write path follows:
 * - read the cookie per request (both names, the `__Host-` one first);
 * - when it is missing, wait for ONE `GET /api/auth/user` per page load — the
 *   AuthProvider's own check when it has run ({@link noteAuthUserRequest}),
 *   otherwise one request made here — then send without the header if the cookie
 *   is still missing;
 * - on `403 CSRF_INVALID`, re-read the cookie after a fresh `GET /api/auth/user`
 *   and retry once.
 *
 * Local identity (production today) never sets the cookie: writes go out without
 * the header exactly as before, after the page's existing auth check — no extra
 * request per write. The desktop renderer (no cookie session) skips all of this.
 */

export const CSRF_COOKIE_NAMES = ['__Host-aionui-csrf-token', 'aionui-csrf-token'] as const;
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const CSRF_INVALID_CODE = 'CSRF_INVALID';

const AUTH_USER_ENDPOINT = '/api/auth/user';
/** A hung auth check must not block writes forever. */
const PRIME_TIMEOUT_MS = 5000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * WebUI browser mode: a real DOM and no Electron preload port. Only here is there
 * a cookie session; the desktop renderer talks to a local backend on another
 * origin. Same check as `httpBridge.ts` / `sessionRefresh.ts`.
 */
export function isCookieSession(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !(window as { __backendPort?: number }).__backendPort
  );
}

export const isUnsafeMethod = (method: string): boolean => UNSAFE_METHODS.has(method.toUpperCase());

/** The CSRF cookie value (`__Host-` name first), or `''`. */
export function readCsrfCookie(cookies: string = typeof document === 'undefined' ? '' : document.cookie): string {
  const values = new Map<string, string>();
  for (const part of cookies.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!values.has(name)) values.set(name, part.slice(index + 1).trim());
  }
  for (const name of CSRF_COOKIE_NAMES) {
    const value = values.get(name);
    if (value) return decodeURIComponent(value);
  }
  return '';
}

let primed: Promise<void> | null = null;

/**
 * The AuthProvider's `GET /api/auth/user` doubles as the page's CSRF priming
 * request, so writes need no request of their own.
 */
export function noteAuthUserRequest(request: Promise<unknown>): void {
  if (primed) return;
  primed = request.then(
    (): void => undefined,
    (): void => undefined
  );
}

const prime = (force: boolean): Promise<void> => {
  if (!primed || force) {
    primed = fetch(AUTH_USER_ENDPOINT, { method: 'GET', credentials: 'include' }).then(
      (): void => undefined,
      (): void => undefined
    );
  }
  return primed;
};

const withTimeout = (promise: Promise<void>): Promise<void> =>
  Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, PRIME_TIMEOUT_MS))]);

/**
 * The token to send with an unsafe request, or `''` (no cookie session, or the
 * backend set no cookie — local identity). `force` re-primes after a rejection.
 */
export async function resolveCsrfToken(options: { force?: boolean } = {}): Promise<string> {
  if (!isCookieSession()) return '';
  if (!options.force) {
    const current = readCsrfCookie();
    if (current) return current;
  }
  await withTimeout(prime(Boolean(options.force)));
  return readCsrfCookie();
}

/** Headers to add for `method`: the CSRF header for unsafe methods when a token exists. */
export async function csrfHeaders(method: string, options: { force?: boolean } = {}): Promise<Record<string, string>> {
  if (!isUnsafeMethod(method)) return {};
  const token = await resolveCsrfToken(options);
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}

/** Whether a parsed error body is AionCore's CSRF rejection. */
export const isCsrfRejectionBody = (status: number, body: unknown): boolean =>
  status === 403 &&
  Boolean(body) &&
  typeof body === 'object' &&
  (body as { code?: unknown }).code === CSRF_INVALID_CODE;

/** Whether a response is AionCore's CSRF rejection (reads a clone; the original stays unread). */
export async function isCsrfRejection(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    return isCsrfRejectionBody(403, await response.clone().json());
  } catch {
    return false;
  }
}

/** Whether a finished XHR is AionCore's CSRF rejection. */
export const isXhrCsrfRejection = (xhr: XMLHttpRequest): boolean => {
  if (xhr.status !== 403) return false;
  try {
    return isCsrfRejectionBody(403, JSON.parse(xhr.responseText));
  } catch {
    return false;
  }
};

/**
 * `fetch` for AionCore with the CSRF header on unsafe methods and one retry on
 * `403 CSRF_INVALID`. Safe methods and the desktop renderer pass straight through.
 */
export async function fetchWithCsrf(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!isUnsafeMethod(method) || !isCookieSession()) return fetch(input, init);
  const send = async (force: boolean): Promise<Response> => {
    const headers = new Headers(init.headers);
    const token = await resolveCsrfToken({ force });
    if (token) headers.set(CSRF_HEADER_NAME, token);
    else headers.delete(CSRF_HEADER_NAME);
    return fetch(input, { ...init, headers });
  };
  const first = await send(false);
  if (!(await isCsrfRejection(first))) return first;
  return send(true);
}

/** Test hook: forget the page's priming request. */
export function resetCsrfForTest(): void {
  primed = null;
}

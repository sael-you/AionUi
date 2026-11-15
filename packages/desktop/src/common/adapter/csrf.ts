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
 * - read the cookie per request: over HTTPS only the `__Host-` name (a plain
 *   name there could be planted by a sibling subdomain); over HTTP the `__Host-`
 *   name first (an AionCore started with `AIONUI_HTTPS=true` behind a plain-HTTP
 *   loopback, e.g. webui staging, sets only that one), then the legacy one;
 *   anything but AionCore's 64 lowercase hex digits counts as none;
 * - when it is missing, wait for ONE `GET /api/auth/user` per page load — the
 *   AuthProvider's own check, registered while it renders
 *   ({@link expectAuthUserRequest}) so child effects that write first wait for
 *   it too, otherwise one request made here — then send without the header if
 *   the cookie is still missing;
 * - on `403 CSRF_INVALID`, retry once after a fresh `GET /api/auth/user`. A burst
 *   of rejections shares ONE such request, and none is made when the cookie
 *   already changed since the rejected attempt (the endpoint is rate-limited).
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
/** A rejection within this long after a re-prime for the same token makes no new request. */
const REPRIME_WINDOW_MS = 10_000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** AionCore's token: 32 random bytes as lowercase hex. */
const CSRF_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

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

const currentProtocol = (): string => (typeof location === 'undefined' ? 'http:' : location.protocol);

/** The first cookie named `name`, if it holds a well-formed token; else `''`. */
function readTokenCookie(cookies: string, name: string): string {
  for (const part of cookies.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return '';
    }
    return CSRF_TOKEN_PATTERN.test(value) ? value : '';
  }
  return '';
}

/**
 * The CSRF cookie value, or `''`: over HTTPS only the `__Host-` cookie; over HTTP
 * the `__Host-` cookie first, then the legacy one. Only a well-formed token counts.
 */
export function readCsrfCookie(
  cookies: string = typeof document === 'undefined' ? '' : document.cookie,
  protocol: string = currentProtocol()
): string {
  const names = protocol === 'https:' ? CSRF_COOKIE_NAMES.slice(0, 1) : CSRF_COOKIE_NAMES;
  for (const name of names) {
    const value = readTokenCookie(cookies, name);
    if (value) return value;
  }
  return '';
}

/** `cancelled`: the auth check was aborted before it answered — it primed nothing. */
type PrimeOutcome = 'done' | 'cancelled';

const settled = (): PrimeOutcome => 'done';

let primed: Promise<PrimeOutcome> | null = null;
/** The AuthProvider's registered check, until its latest request settles. */
let expected: { resolve: (outcome: PrimeOutcome) => void; latest: Promise<unknown> | null } | null = null;

const isAbortError = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError';

/**
 * Called while the AuthProvider renders (before any child effect can write):
 * the page's `GET /api/auth/user` is coming and doubles as the CSRF priming
 * request, so writes wait for it instead of making their own.
 */
export function expectAuthUserRequest(): void {
  if (primed || !isCookieSession()) return;
  let settle: ((outcome: PrimeOutcome) => void) | undefined;
  primed = new Promise<PrimeOutcome>((resolve) => {
    settle = resolve;
  });
  expected = { resolve: (outcome) => settle?.(outcome), latest: null };
}

/**
 * The AuthProvider's `GET /api/auth/user` request. Only the latest one counts;
 * an aborted one primes nothing, so waiting writes then make their own request.
 */
export function noteAuthUserRequest(request: Promise<unknown>): void {
  if (!expected) expectAuthUserRequest();
  const slot = expected;
  if (!slot) return;
  slot.latest = request;
  const finish = (outcome: PrimeOutcome): void => {
    if (expected !== slot || slot.latest !== request) return;
    expected = null;
    if (outcome === 'cancelled') primed = null;
    slot.resolve(outcome);
  };
  request.then(
    () => finish('done'),
    (error: unknown) => finish(isAbortError(error) ? 'cancelled' : 'done')
  );
}

const getAuthUser = (): Promise<PrimeOutcome> =>
  fetch(AUTH_USER_ENDPOINT, { method: 'GET', credentials: 'include' }).then(settled, settled);

const withTimeout = (promise: Promise<PrimeOutcome>): Promise<PrimeOutcome> =>
  Promise.race([promise, new Promise<PrimeOutcome>((resolve) => setTimeout(() => resolve('done'), PRIME_TIMEOUT_MS))]);

/**
 * Wait for the page's priming request (made here when nobody else made one).
 * Bounded: a cancelled check is replaced by the next one or by our own request.
 */
async function awaitPrime(attemptsLeft = 3): Promise<void> {
  if (!primed) primed = getAuthUser();
  const outcome = await withTimeout(primed);
  if (outcome === 'cancelled' && attemptsLeft > 1) await awaitPrime(attemptsLeft - 1);
}

let reprime: Promise<PrimeOutcome> | null = null;
let lastReprime: { token: string; at: number } | null = null;

/** After a rejection of `rejectedToken`: one shared fresh `GET /api/auth/user`, if any is useful. */
async function reprimeAfterRejection(rejectedToken: string): Promise<void> {
  if (!reprime) {
    // The cookie already changed since the rejected attempt: just retry with it.
    if (readCsrfCookie() !== rejectedToken) return;
    // Re-primed for this very token moments ago: another request changes nothing.
    if (lastReprime && lastReprime.token === rejectedToken && Date.now() - lastReprime.at < REPRIME_WINDOW_MS) return;
    lastReprime = { token: rejectedToken, at: Date.now() };
    const request = getAuthUser().then((outcome) => {
      lastReprime = { token: rejectedToken, at: Date.now() };
      reprime = null;
      return outcome;
    });
    reprime = request;
  }
  await withTimeout(reprime);
}

/**
 * The token to send with an unsafe request, or `''` (no cookie session, or the
 * backend set no cookie — local identity). `rejected`: the token (or `''`) the
 * previous attempt was refused with — re-primes before reading the cookie again.
 */
export async function resolveCsrfToken(options: { rejected?: string } = {}): Promise<string> {
  if (!isCookieSession()) return '';
  if (options.rejected !== undefined) {
    await reprimeAfterRejection(options.rejected);
    return readCsrfCookie();
  }
  const current = readCsrfCookie();
  if (current) return current;
  await awaitPrime();
  return readCsrfCookie();
}

/** Headers to add for `method`: the CSRF header for unsafe methods when a token exists. */
export async function csrfHeaders(
  method: string,
  options: { rejected?: string } = {}
): Promise<Record<string, string>> {
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

/** Whether `input` goes to this page's own origin (the only one that gets the token). */
function isSameOrigin(input: string): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URL(input, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * `fetch` for AionCore with the CSRF header on unsafe same-origin requests and
 * one retry on `403 CSRF_INVALID`. Safe methods, other origins and the desktop
 * renderer pass straight through.
 */
export async function fetchWithCsrf(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (!isUnsafeMethod(method) || !isCookieSession() || !isSameOrigin(input)) return fetch(input, init);
  const send = async (rejected?: string): Promise<{ response: Response; token: string }> => {
    const headers = new Headers(init.headers);
    const token = await resolveCsrfToken(rejected === undefined ? {} : { rejected });
    if (token) headers.set(CSRF_HEADER_NAME, token);
    else headers.delete(CSRF_HEADER_NAME);
    return { response: await fetch(input, { ...init, headers }), token };
  };
  const first = await send();
  if (!(await isCsrfRejection(first.response))) return first.response;
  return (await send(first.token)).response;
}

/** Test hook: forget the page's priming and re-priming requests. */
export function resetCsrfForTest(): void {
  primed = null;
  expected = null;
  reprime = null;
  lastReprime = null;
}

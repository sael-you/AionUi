/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rules for the web (non-Electron) browser panel, which renders pages in an <iframe>.
 * Kept separate from the component so the security rules are unit-tested on their own.
 *
 * Threat model: the embedded page is untrusted, including dev servers on subdomains of the app
 * host (they run project code and its dependencies). The panel must never let it act as the app,
 * steer the app window, or silently use powers the user granted to the app.
 */

/**
 * Sandbox for embedded pages. Scripts, forms and same-origin storage work (real sites and dev
 * servers need them). Deliberately absent:
 * - `allow-top-navigation*`: the page cannot navigate the app window;
 * - `allow-popups-to-escape-sandbox`: popups the page opens stay sandboxed (no unsandboxed window
 *   that could steer its opener);
 * - `allow-modals` (only for dev servers, see `sandboxFor`): untrusted sites cannot show native
 *   dialogs that look like the app's own.
 * `allow-same-origin` is only dangerous for documents on the app's own origin: those are refused
 * up front (`decideEmbed`) and, if the frame navigates there later, detected on load and removed
 * (`isAppOriginFrame`); the app shell also sends `frame-ancestors 'none'` (gateway).
 */
const BASE_SANDBOX = ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-downloads'];

export const BLANK_URL = 'about:blank';

/** Parses an http(s) URL; returns null for anything else (javascript:, data:, file:, malformed). */
export const parseWebUrl = (raw: string): URL | null => {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
};

export type RefuseReason = 'scheme' | 'self' | 'insecure';

export type EmbedDecision =
  | { kind: 'blank' }
  | { kind: 'embed'; url: string }
  | { kind: 'refuse'; reason: RefuseReason };

/**
 * Decides whether a URL may be shown in the iframe.
 * - the app's own origin is refused: an embedded copy of the app with scripts and same-origin
 *   access could act as the app itself, and showing it inside its own panel is never useful;
 * - an http page inside an https app is refused: the browser blocks it as mixed content anyway,
 *   so say so instead of showing an empty frame.
 */
export const decideEmbed = (raw: string, appOrigin: string): EmbedDecision => {
  if (!raw || raw === BLANK_URL) return { kind: 'blank' };
  const parsed = parseWebUrl(raw);
  if (!parsed) return { kind: 'refuse', reason: 'scheme' };
  if (parsed.origin === appOrigin) return { kind: 'refuse', reason: 'self' };
  if (parsed.protocol === 'http:' && appOrigin.startsWith('https:')) return { kind: 'refuse', reason: 'insecure' };
  return { kind: 'embed', url: parsed.href };
};

/**
 * A dev server published by this platform: `https://<project>-<port>.<app host>`.
 * Only these may get extra powers, and only after the user opts in per tab.
 */
export const isDevServerUrl = (url: string, appHostname: string): boolean => {
  const parsed = parseWebUrl(url);
  if (!parsed || parsed.protocol !== 'https:' || !appHostname) return false;
  const suffix = `.${appHostname}`;
  if (!parsed.hostname.endsWith(suffix)) return false;
  const label = parsed.hostname.slice(0, -suffix.length);
  return /^[a-z0-9-]+-\d{2,5}$/.test(label);
};

/** The sandbox attribute for a URL: dev servers may also show native dialogs (alert/confirm). */
export const sandboxFor = (url: string, appHostname: string): string =>
  (isDevServerUrl(url, appHostname) ? [...BASE_SANDBOX, 'allow-modals'] : BASE_SANDBOX).join(' ');

/**
 * The iframe `allow` attribute. Nothing is delegated by default; microphone, camera and clipboard
 * are delegated only to a platform dev server **and** only after the user turned them on for this
 * tab (a permission granted to the app would otherwise be inherited by the embedded page).
 */
export const iframeAllowFor = (url: string, appHostname: string, devicesOptIn: boolean): string => {
  const allow = ['fullscreen'];
  if (devicesOptIn && isDevServerUrl(url, appHostname))
    allow.push('microphone', 'camera', 'clipboard-read', 'clipboard-write');
  return allow.join('; ');
};

/** Default address-bar handling, identical to the desktop webview: bare input gets `https://`. */
export const resolveDefaultUrlInput = (raw: string): string => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

/** A short tab label for pages whose title can't be read (cross-origin); empty for non-web URLs. */
export const labelForUrl = (url: string): string => {
  const parsed = parseWebUrl(url);
  return parsed ? parsed.hostname : '';
};

/**
 * True when the frame now shows a document on the app's own origin (e.g. the embedded page
 * redirected there). Cross-origin frames throw on access, which means "not the app".
 */
export const isAppOriginFrame = (frame: HTMLIFrameElement | null, appOrigin: string): boolean => {
  try {
    return frame?.contentWindow?.location.origin === appOrigin;
  } catch {
    return false;
  }
};

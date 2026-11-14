/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rules for the web (non-Electron) browser panel, which renders pages in an <iframe>.
 * Kept separate from the component so the security rules are unit-tested on their own.
 */

/** Sandbox for embedded pages: scripts and forms work, but the page cannot navigate the top window. */
export const IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

/** Features every embedded page may use. */
const BASE_ALLOW = ['clipboard-write', 'fullscreen'];

/**
 * Powerful features are delegated only to pages on a subdomain of the app's own host
 * (e.g. dev servers at `<project>-<port>.y.talkseeds.com` when the app runs on `y.talkseeds.com`).
 * A permission the user granted to the app is otherwise inherited by any embedded site.
 */
const TRUSTED_SUBDOMAIN_ALLOW = ['microphone', 'camera', 'clipboard-read'];

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

export type EmbedDecision =
  | { kind: 'blank' }
  | { kind: 'embed'; url: string }
  | { kind: 'refuse'; reason: 'scheme' | 'self' };

/**
 * Decides whether a URL may be shown in the iframe.
 * The app's own origin is refused: an embedded copy of the app with scripts and same-origin
 * access could act as the app itself, and showing it inside its own panel is never useful.
 */
export const decideEmbed = (raw: string, appOrigin: string): EmbedDecision => {
  if (!raw || raw === BLANK_URL) return { kind: 'blank' };
  const parsed = parseWebUrl(raw);
  if (!parsed) return { kind: 'refuse', reason: 'scheme' };
  if (parsed.origin === appOrigin) return { kind: 'refuse', reason: 'self' };
  return { kind: 'embed', url: parsed.href };
};

/** The iframe `allow` attribute for a URL embedded by an app running on `appHostname`. */
export const iframeAllowFor = (url: string, appHostname: string): string => {
  const parsed = parseWebUrl(url);
  const trusted =
    parsed !== null &&
    parsed.protocol === 'https:' &&
    appHostname.length > 0 &&
    parsed.hostname.endsWith(`.${appHostname}`);
  return (trusted ? [...BASE_ALLOW, ...TRUSTED_SUBDOMAIN_ALLOW] : BASE_ALLOW).join('; ');
};

/** Default address-bar handling, identical to the desktop webview: bare input gets `https://`. */
export const resolveDefaultUrlInput = (raw: string): string => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

/** A short tab label for pages whose title can't be read (cross-origin). */
export const labelForUrl = (url: string): string => {
  const parsed = parseWebUrl(url);
  return parsed ? parsed.hostname : url;
};

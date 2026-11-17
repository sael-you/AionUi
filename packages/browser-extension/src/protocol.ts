/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire between the AionUi browser extension and AionCore (C34 / TASK-125),
 * agreed with the core builder: WebSocket `/api/browser/extension`, no cookie;
 * AionCore checks `Origin: chrome-extension://<pinned id>` and authenticates
 * the FIRST frame (`pair` with a one-time code, later `hello` with the device
 * token). Field names are snake_case and must not change without core.
 */

/** Wire version sent in `hello`. */
export const PROTOCOL_VERSION = 1;

/** Path of the extension socket on the AionUi host. */
export const EXTENSION_SOCKET_PATH = '/api/browser/extension';

/** Keepalive: a message every 20 s keeps an MV3 service worker alive (Chrome ≥116). */
export const PING_INTERVAL_MS = 20_000;

export type SharedTab = { tab_id: number; url: string; title: string };

// ---- extension → core ----
/** `extension_version` (TASK-133): lets AionUi say when a newer build is available. */
export type PairFrame = { type: 'pair'; code: string; device_name: string; browser: string; extension_version: string };
export type HelloFrame = {
  type: 'hello';
  token: string;
  browser: string;
  version: number;
  extension_version: string;
};
export type StateFrame = { type: 'state'; new_tabs: boolean; tabs: SharedTab[] };
export type ResultFrame =
  | { type: 'result'; id: number; result: unknown }
  | { type: 'result'; id: number; error: { message: string; code?: string } };
export type EventFrame = { type: 'event'; tab_id: number; method: string; params: unknown };
export type DetachedFrame = { type: 'detached'; tab_id: number; reason: string };
export type PingFrame = { type: 'ping' };

export type ExtensionFrame = PairFrame | HelloFrame | StateFrame | ResultFrame | EventFrame | DetachedFrame | PingFrame;

// ---- core → extension ----
export type WelcomeFrame = { type: 'welcome'; device_id: string; token?: string };
export type ErrorFrame = { type: 'error'; code: string };
export type CommandFrame = { type: 'command'; id: number; tab_id: number; method: string; params?: unknown };
export type CreateTabFrame = { type: 'create_tab'; id: number; url: string };
export type CloseTabFrame = { type: 'close_tab'; id: number; tab_id: number };
export type PongFrame = { type: 'pong' };

export type CoreFrame = WelcomeFrame | ErrorFrame | CommandFrame | CreateTabFrame | CloseTabFrame | PongFrame;

/** Error codes after which reconnecting cannot help (the device must pair again). */
export const FATAL_ERROR_CODES: ReadonlySet<string> = new Set(['BROWSER_PAIRING_INVALID', 'BROWSER_DEVICE_REVOKED']);

/** Result error code when core asks for a new tab while the owner turned new tabs off. */
export const NEW_TABS_DISABLED = 'new_tabs_disabled';

/** Parse one core frame; null for anything that is not a known, well-formed frame. */
export const parseCoreFrame = (data: unknown): CoreFrame | null => {
  if (typeof data !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const frame = value as Record<string, unknown>;
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  switch (frame.type) {
    case 'welcome':
      return typeof frame.device_id === 'string' && (frame.token === undefined || typeof frame.token === 'string')
        ? (frame as WelcomeFrame)
        : null;
    case 'error':
      return typeof frame.code === 'string' ? (frame as ErrorFrame) : null;
    case 'command':
      return isInt(frame.id) && isInt(frame.tab_id) && typeof frame.method === 'string'
        ? (frame as CommandFrame)
        : null;
    case 'create_tab':
      return isInt(frame.id) && typeof frame.url === 'string' ? (frame as CreateTabFrame) : null;
    case 'close_tab':
      return isInt(frame.id) && isInt(frame.tab_id) ? (frame as CloseTabFrame) : null;
    case 'pong':
      return { type: 'pong' };
    default:
      return null;
  }
};

/** Hosts where plain http/ws is allowed (the token never leaves the computer). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The socket URL for an AionUi address the owner typed ("y.example.com",
 * "https://y.example.com/", "http://localhost:8080"): https → wss; http → ws
 * only for localhost / 127.0.0.1 / [::1]. Null otherwise (the device token must
 * not travel over plain ws).
 */
export const socketUrlFor = (address: string): string | null => {
  const trimmed = address.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // The device token travels in the first frame: plain ws only to this computer (local development).
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return null;
  const scheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${url.host}${EXTENSION_SOCKET_PATH}`;
};

/** The normalised origin stored for an address ("https://y.example.com"), or null. */
export const originFor = (address: string): string | null => {
  const socket = socketUrlFor(address);
  if (!socket) return null;
  const url = new URL(socket);
  return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
};

/** "Chrome 157", "Edge 140", … from a user agent (Arc reports itself as Chrome). */
export const browserLabelFrom = (userAgent: string): string => {
  const edge = /Edg\/(\d+)/.exec(userAgent);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(userAgent);
  if (chrome) return `Chrome ${chrome[1]}`;
  return 'Chromium';
};

/** Pairing codes look like "ABCD-2345": letters and digits, optional dash; normalised to upper case. */
export const normalizePairingCode = (code: string): string => code.trim().toUpperCase().replace(/\s+/g, '');

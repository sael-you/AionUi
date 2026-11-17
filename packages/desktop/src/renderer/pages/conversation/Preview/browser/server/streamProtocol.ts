/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers of the server-browser panel stream (C30, TASK-111): decode the
 * binary screencast frames, parse server messages, fit a frame into the panel,
 * map pointer positions back to page CSS pixels, and turn DOM input events into
 * the wire's mouse / key messages.
 */

import type {
  BrowserFrameMeta,
  BrowserKeyInput,
  BrowserMouseInput,
  BrowserServerMessage,
} from '@/common/types/platform/serverBrowser';

/** A frame header bigger than this is not a header: drop the frame. */
const MAX_META_BYTES = 64 * 1024;
const SERVER_MESSAGE_TYPES = new Set(['state', 'dialog', 'file_chooser', 'error']);

export type DecodedFrame = { meta: BrowserFrameMeta; jpeg: Uint8Array };

/** `[u32 BE meta_len][meta JSON][JPEG]` → parts, or `null` for a malformed frame. */
export const decodeFrame = (buffer: ArrayBuffer): DecodedFrame | null => {
  if (buffer.byteLength < 4) return null;
  const metaLength = new DataView(buffer).getUint32(0, false);
  if (metaLength === 0 || metaLength > MAX_META_BYTES || 4 + metaLength >= buffer.byteLength) return null;
  try {
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLength))) as BrowserFrameMeta;
    if (typeof meta.seq !== 'number' || !(meta.width > 0) || !(meta.height > 0)) return null;
    return { meta, jpeg: new Uint8Array(buffer, 4 + metaLength) };
  } catch {
    return null;
  }
};

/** A server text message, or `null` when it is not one the panel knows. */
export const parseServerMessage = (text: string): BrowserServerMessage | null => {
  try {
    const value = JSON.parse(text) as { type?: unknown };
    return typeof value.type === 'string' && SERVER_MESSAGE_TYPES.has(value.type)
      ? (value as BrowserServerMessage)
      : null;
  } catch {
    return null;
  }
};

export type Box = { left: number; top: number; width: number; height: number };

/** Where a frame of `meta`'s aspect is drawn inside `box` (contain, centred). */
export const fitFrame = (box: Pick<Box, 'width' | 'height'>, meta: Pick<BrowserFrameMeta, 'width' | 'height'>): Box => {
  const scale = Math.min(box.width / meta.width, box.height / meta.height);
  const width = meta.width * scale;
  const height = meta.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
};

/**
 * A pointer position (client pixels) → page CSS pixels of the frame, or `null`
 * outside the drawn frame. `element` is the panel surface's client rect.
 */
export const toPagePoint = (
  clientX: number,
  clientY: number,
  element: Box,
  meta: Pick<BrowserFrameMeta, 'width' | 'height'>
): { x: number; y: number } | null => {
  const drawn = fitFrame(element, meta);
  const localX = clientX - element.left - drawn.left;
  const localY = clientY - element.top - drawn.top;
  if (localX < 0 || localY < 0 || localX > drawn.width || localY > drawn.height) return null;
  return { x: (localX / drawn.width) * meta.width, y: (localY / drawn.height) * meta.height };
};

type ModifierState = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export const modifiersOf = (event: ModifierState): number =>
  (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

/** DOM `MouseEvent.button` → wire button. */
export const mouseButtonOf = (button: number): BrowserMouseInput['button'] => {
  if (button === 0) return 'left';
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'none';
};

type KeyLike = ModifierState & { key: string; code: string; keyCode: number };

/**
 * A DOM keyboard event → wire key message. `down` of a printable key (or Enter)
 * carries `text`, so the page receives the character; shortcuts with Ctrl/Meta
 * carry none.
 */
export const keyInputOf = (event: KeyLike, kind: 'down' | 'up'): BrowserKeyInput => {
  const modifiers = modifiersOf(event);
  const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey;
  const text = kind === 'down' ? (event.key === 'Enter' ? '\r' : printable ? event.key : undefined) : undefined;
  return {
    event: kind,
    key: event.key,
    code: event.code,
    key_code: event.keyCode,
    modifiers,
    ...(text === undefined ? {} : { text }),
  };
};

/** Google refused the sign-in (it does in this browser; C30 decision a). */
export const isGoogleSignInRejected = (url: string): boolean =>
  /^https:\/\/accounts\.google\.com\/v3\/signin\/rejected(?:[/?#]|$)/.test(url);

/** `wss://<host>/api/browser/ws?instance=<n>` for this page. */
export const browserStreamUrl = (location: Pick<Location, 'protocol' | 'host'>, instance: number): string =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/browser/ws?instance=${instance}`;

/** Engine whose live view is VNC (no CDP screencast): Camoufox (C35 v2, TASK-136 U4). */
export const VNC_ENGINE = 'camoufox';

/** The VNC socket of a Camoufox profile: raw RFB 3.8 in binary frames; connecting starts or attaches. */
export const browserVncUrl = (location: Pick<Location, 'protocol' | 'host'>, instance: number): string =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/browser/instances/${instance}/vnc`;

/** Why AionCore closed the VNC socket (i18n key under `preview.serverBrowser.vnc.closed`). */
export const vncCloseKey = (code: number): 'notCamoufox' | 'notAllowed' | 'startFailed' | 'ended' => {
  if (code === 4409) return 'notCamoufox';
  if (code === 4403) return 'notAllowed';
  if (code === 4503) return 'startFailed';
  return 'ended';
};

/** `BROWSER_URL_BLOCKED` → `urlBlocked`: the key under `preview.serverBrowser.errors`. */
export const errorKey = (code: string): string =>
  code
    .replace(/^BROWSER_/, '')
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

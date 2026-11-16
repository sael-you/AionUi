/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  browserStreamUrl,
  decodeFrame,
  fitFrame,
  isGoogleSignInRejected,
  keyInputOf,
  modifiersOf,
  mouseButtonOf,
  parseServerMessage,
  toPagePoint,
} from '@/renderer/pages/conversation/Preview/browser/server/streamProtocol';

const frame = (meta: unknown, jpeg = [0xff, 0xd8, 0xff]): ArrayBuffer => {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const buffer = new ArrayBuffer(4 + metaBytes.length + jpeg.length);
  new DataView(buffer).setUint32(0, metaBytes.length, false);
  new Uint8Array(buffer, 4).set(metaBytes);
  new Uint8Array(buffer, 4 + metaBytes.length).set(jpeg);
  return buffer;
};

const META = {
  seq: 3,
  tab_id: 't1',
  width: 1280,
  height: 800,
  device_scale_factor: 2,
  page_scale_factor: 1,
  offset_top: 0,
};

const keys = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe('server browser stream protocol (TASK-111)', () => {
  it('decodes a [u32 BE len][meta][jpeg] frame', () => {
    const decoded = decodeFrame(frame(META));
    expect(decoded?.meta).toEqual(META);
    expect([...(decoded?.jpeg ?? [])]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('drops malformed frames', () => {
    expect(decodeFrame(new ArrayBuffer(2))).toBeNull();
    const tooLong = frame(META);
    new DataView(tooLong).setUint32(0, 10_000_000, false);
    expect(decodeFrame(tooLong)).toBeNull();
    expect(decodeFrame(frame(META, []))).toBeNull();
    expect(decodeFrame(frame({ ...META, width: 0 }))).toBeNull();
    const garbage = new ArrayBuffer(10);
    new DataView(garbage).setUint32(0, 3, false);
    expect(decodeFrame(garbage)).toBeNull();
  });

  it('parses only known server messages', () => {
    expect(parseServerMessage('{"type":"error","code":"BROWSER_URL_BLOCKED"}')).toEqual({
      type: 'error',
      code: 'BROWSER_URL_BLOCKED',
    });
    expect(parseServerMessage('{"type":"eval"}')).toBeNull();
    expect(parseServerMessage('not json')).toBeNull();
  });

  it('fits the frame inside the panel and maps pointer positions back to page pixels', () => {
    // A 1280x800 page in a 640x600 panel: drawn 640x400, centred vertically (100 px bands).
    expect(fitFrame({ width: 640, height: 600 }, META)).toEqual({ left: 0, top: 100, width: 640, height: 400 });
    const panel = { left: 10, top: 20, width: 640, height: 600 };
    expect(toPagePoint(10 + 320, 20 + 100 + 200, panel, META)).toEqual({ x: 640, y: 400 });
    expect(toPagePoint(10 + 320, 20 + 50, panel, META)).toBeNull();
  });

  it('builds CDP modifiers and buttons', () => {
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
    expect(modifiersOf({ ...keys, shiftKey: true })).toBe(8);
    expect([0, 1, 2, 3].map(mouseButtonOf)).toEqual(['left', 'middle', 'right', 'none']);
  });

  it('sends text with printable key downs and Enter, not with shortcuts or key ups', () => {
    expect(keyInputOf({ ...keys, key: 'a', code: 'KeyA', keyCode: 65 }, 'down')).toEqual({
      event: 'down',
      key: 'a',
      code: 'KeyA',
      key_code: 65,
      modifiers: 0,
      text: 'a',
    });
    expect(keyInputOf({ ...keys, key: 'Enter', code: 'Enter', keyCode: 13 }, 'down').text).toBe('\r');
    expect(keyInputOf({ ...keys, ctrlKey: true, key: 'c', code: 'KeyC', keyCode: 67 }, 'down').text).toBeUndefined();
    expect(keyInputOf({ ...keys, key: 'a', code: 'KeyA', keyCode: 65 }, 'up').text).toBeUndefined();
    expect(keyInputOf({ ...keys, key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, 'down').text).toBeUndefined();
  });

  it('recognises Google refusing the sign-in', () => {
    expect(isGoogleSignInRejected('https://accounts.google.com/v3/signin/rejected?x=1')).toBe(true);
    expect(isGoogleSignInRejected('https://accounts.google.com/v3/signin/identifier')).toBe(false);
    expect(isGoogleSignInRejected('https://evil.example/accounts.google.com/v3/signin/rejected')).toBe(false);
  });

  it('builds the stream url from the page location', () => {
    expect(browserStreamUrl({ protocol: 'https:', host: 'y.example.com' }, 2)).toBe(
      'wss://y.example.com/api/browser/ws?instance=2'
    );
    expect(browserStreamUrl({ protocol: 'http:', host: '127.0.0.1:25809' }, 1)).toBe(
      'ws://127.0.0.1:25809/api/browser/ws?instance=1'
    );
  });
});

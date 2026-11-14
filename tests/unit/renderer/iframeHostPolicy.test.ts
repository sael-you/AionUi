/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_URL,
  decideEmbed,
  iframeAllowFor,
  isAppOriginFrame,
  isDevServerUrl,
  labelForUrl,
  parseWebUrl,
  resolveDefaultUrlInput,
  sandboxFor,
} from '@/renderer/components/media/iframeHostPolicy';

const APP_ORIGIN = 'https://y.talkseeds.com';
const APP_HOST = 'y.talkseeds.com';
const DEV = 'https://voice-s0-3870.y.talkseeds.com/';

describe('decideEmbed', () => {
  it('embeds https pages from other origins', () => {
    expect(decideEmbed(DEV, APP_ORIGIN)).toEqual({ kind: 'embed', url: DEV });
    expect(decideEmbed('https://example.com/a?b=1', APP_ORIGIN).kind).toBe('embed');
  });

  it('treats empty and about:blank as blank', () => {
    expect(decideEmbed('', APP_ORIGIN)).toEqual({ kind: 'blank' });
    expect(decideEmbed(BLANK_URL, APP_ORIGIN)).toEqual({ kind: 'blank' });
  });

  it('refuses non-web schemes', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'not a url']) {
      expect(decideEmbed(raw, APP_ORIGIN)).toEqual({ kind: 'refuse', reason: 'scheme' });
    }
  });

  it("refuses the app's own origin, including case and default-port variants", () => {
    for (const raw of [
      'https://y.talkseeds.com/conversation/1',
      'https://Y.TALKSEEDS.COM/',
      'https://y.talkseeds.com:443/x',
    ]) {
      expect(decideEmbed(raw, APP_ORIGIN)).toEqual({ kind: 'refuse', reason: 'self' });
    }
  });

  it('treats other ports, www. and trailing-dot hosts as different origins (cross-origin, so harmless)', () => {
    for (const raw of ['https://y.talkseeds.com:8080/', 'https://www.y.talkseeds.com/', 'https://y.talkseeds.com./']) {
      expect(decideEmbed(raw, APP_ORIGIN).kind).toBe('embed');
    }
  });

  it('refuses http pages inside an https app (mixed content) but allows them in an http app', () => {
    expect(decideEmbed('http://example.com/', APP_ORIGIN)).toEqual({ kind: 'refuse', reason: 'insecure' });
    expect(decideEmbed('http://example.com/', 'http://localhost:25809').kind).toBe('embed');
  });
});

describe('dev servers, sandbox and permission delegation', () => {
  it('recognises only platform dev servers <project>-<port>.<app host> over https', () => {
    expect(isDevServerUrl(DEV, APP_HOST)).toBe(true);
    for (const url of [
      'https://example.com/',
      'http://voice-s0-3870.y.talkseeds.com/',
      'https://www.y.talkseeds.com/',
      'https://evil-y.talkseeds.com.attacker.io/',
      'https://a.b-3000.y.talkseeds.com/',
      'https://talkseeds.com/',
    ]) {
      expect(isDevServerUrl(url, APP_HOST)).toBe(false);
    }
    expect(isDevServerUrl(DEV, '')).toBe(false);
  });

  it('never delegates devices or clipboard without the per-tab opt-in', () => {
    expect(iframeAllowFor(DEV, APP_HOST, false)).toBe('fullscreen');
    expect(iframeAllowFor('https://example.com/', APP_HOST, true)).toBe('fullscreen');
  });

  it('delegates microphone, camera and clipboard to a dev server after opt-in', () => {
    const allow = iframeAllowFor(DEV, APP_HOST, true);
    for (const feature of ['microphone', 'camera', 'clipboard-read', 'clipboard-write', 'fullscreen']) {
      expect(allow).toContain(feature);
    }
  });

  it('keeps popups and the top window sandboxed; modals only for dev servers', () => {
    for (const url of [DEV, 'https://example.com/']) {
      const sandbox = sandboxFor(url, APP_HOST);
      expect(sandbox).not.toContain('allow-top-navigation');
      expect(sandbox).not.toContain('allow-popups-to-escape-sandbox');
      expect(sandbox).toContain('allow-scripts');
    }
    expect(sandboxFor(DEV, APP_HOST)).toContain('allow-modals');
    expect(sandboxFor('https://example.com/', APP_HOST)).not.toContain('allow-modals');
  });
});

describe('helpers', () => {
  it('resolves bare address input like the desktop webview', () => {
    expect(resolveDefaultUrlInput('example.com')).toBe('https://example.com');
    expect(resolveDefaultUrlInput('http://a.b')).toBe('http://a.b');
  });

  it('labels tabs by hostname and leaves non-web URLs unlabelled', () => {
    expect(labelForUrl(`${DEV}x`)).toBe('voice-s0-3870.y.talkseeds.com');
    expect(labelForUrl(BLANK_URL)).toBe('');
    expect(parseWebUrl('ftp://x')).toBeNull();
  });

  it('detects a frame that landed on the app origin; cross-origin access counts as not the app', () => {
    const sameOrigin = { contentWindow: { location: { origin: APP_ORIGIN } } } as unknown as HTMLIFrameElement;
    const crossOrigin = {
      get contentWindow() {
        return {
          get location(): never {
            throw new DOMException('Blocked a frame', 'SecurityError');
          },
        };
      },
    } as unknown as HTMLIFrameElement;
    expect(isAppOriginFrame(sameOrigin, APP_ORIGIN)).toBe(true);
    expect(isAppOriginFrame(crossOrigin, APP_ORIGIN)).toBe(false);
    expect(isAppOriginFrame(null, APP_ORIGIN)).toBe(false);
  });
});

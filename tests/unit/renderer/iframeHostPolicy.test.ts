/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_URL,
  IFRAME_SANDBOX,
  decideEmbed,
  iframeAllowFor,
  labelForUrl,
  parseWebUrl,
  resolveDefaultUrlInput,
} from '@/renderer/components/media/iframeHostPolicy';

const APP_ORIGIN = 'https://y.talkseeds.com';

describe('iframeHostPolicy', () => {
  it('embeds http(s) pages from other origins', () => {
    expect(decideEmbed('https://voice-s0-3870.y.talkseeds.com/', APP_ORIGIN)).toEqual({
      kind: 'embed',
      url: 'https://voice-s0-3870.y.talkseeds.com/',
    });
    expect(decideEmbed('http://example.com/a?b=1', APP_ORIGIN).kind).toBe('embed');
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

  it("refuses the app's own origin", () => {
    expect(decideEmbed('https://y.talkseeds.com/conversation/1', APP_ORIGIN)).toEqual({
      kind: 'refuse',
      reason: 'self',
    });
    expect(decideEmbed('https://Y.TALKSEEDS.COM/', APP_ORIGIN)).toEqual({ kind: 'refuse', reason: 'self' });
  });

  it('delegates microphone/camera only to https subdomains of the app host', () => {
    const trusted = iframeAllowFor('https://voice-s0-3870.y.talkseeds.com/', 'y.talkseeds.com');
    expect(trusted).toContain('microphone');
    expect(trusted).toContain('camera');
    for (const url of [
      'https://example.com/',
      'http://voice-s0-3870.y.talkseeds.com/',
      'https://evil-y.talkseeds.com.attacker.io/',
      'https://talkseeds.com/',
    ]) {
      const allow = iframeAllowFor(url, 'y.talkseeds.com');
      expect(allow).not.toContain('microphone');
      expect(allow).not.toContain('camera');
      expect(allow).toContain('fullscreen');
    }
    expect(iframeAllowFor('https://x.y.talkseeds.com/', '')).not.toContain('microphone');
  });

  it('never lets the frame navigate the top window', () => {
    expect(IFRAME_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('resolves bare address input like the desktop webview', () => {
    expect(resolveDefaultUrlInput('example.com')).toBe('https://example.com');
    expect(resolveDefaultUrlInput('http://a.b')).toBe('http://a.b');
  });

  it('labels tabs by hostname', () => {
    expect(labelForUrl('https://voice-s0-3870.y.talkseeds.com/x')).toBe('voice-s0-3870.y.talkseeds.com');
    expect(parseWebUrl('ftp://x')).toBeNull();
  });
});

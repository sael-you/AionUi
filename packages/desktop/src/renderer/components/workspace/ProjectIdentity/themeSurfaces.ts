/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The active theme's surface colours (`--bg-base`, `--bg-1`, `--bg-2`), read
 * from the theme root so the project colour contrast holds for user themes
 * too, whatever colour syntax a pasted theme uses (see `parseOpaqueColor`).
 * Themes write their tokens as `<style>` elements in `<head>` and switch
 * light/dark through attributes on `<html>`, so both are observed and the
 * surfaces are re-read when either changes. A token that is missing or not an
 * opaque colour falls back to the built-in value for that slot.
 */

import type { ThemeAppearance } from '@/common/theme/types';
import { useMemo, useSyncExternalStore } from 'react';
import { PROJECT_SURFACES, rgbToHex } from './projectTheme';

/** Surface tokens, in the order of `PROJECT_SURFACES`. */
export const SURFACE_TOKENS = ['--bg-base', '--bg-1', '--bg-2'] as const;

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** `12`, `12.5`, `40%` → 0…255 channel; `null` when not a number. */
const channelOf = (token: string): number | null => {
  const n = parseFloat(token);
  if (Number.isNaN(n)) return null;
  return clampByte(token.endsWith('%') ? (n / 100) * 255 : n);
};

/** `0.5`, `50%` → 0…1; `null` when not a number. */
const alphaOf = (token: string | undefined): number | null => {
  if (token === undefined) return 1;
  const n = parseFloat(token);
  if (Number.isNaN(n)) return null;
  return token.endsWith('%') ? n / 100 : n;
};

/** Function arguments split on commas, spaces and the `/` alpha separator. */
const argsOf = (body: string): string[] => body.split(/[\s,/]+/).filter(Boolean);

const hslToHex = (h: number, s: number, l: number): string => {
  // CSS Color 4 hsl() → sRGB.
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([clampByte(f(0) * 255), clampByte(f(8) * 255), clampByte(f(4) * 255)]);
};

/**
 * Parse a colour in a canonical form: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()` / `rgba()` (numbers or percentages), `hsl()` / `hsla()`,
 * `color(srgb r g b)` (the forms browsers serialise colours to, plus hsl) →
 * `#rrggbb` when opaque; non-opaque or unknown → `null`.
 */
export const parseCanonicalColor = (value: string): string | null => {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('');
    if (digits.length === 8 && !digits.endsWith('ff')) return null;
    return `#${digits.slice(0, 6)}`;
  }
  const fn = /^(rgba?|hsla?|color)\((.*)\)$/.exec(text);
  if (!fn) return null;
  const args = argsOf(fn[2]);
  if (fn[1] === 'color') {
    // color(srgb r g b [/ a]) with 0…1 (or %) channels.
    if (args[0] !== 'srgb' || args.length < 4 || args.length > 5) return null;
    const alpha = alphaOf(args[4]);
    if (alpha === null || alpha < 1) return null;
    const rgb = args.slice(1, 4).map((t) => parseFloat(t) * (t.endsWith('%') ? 2.55 : 255));
    if (rgb.some(Number.isNaN)) return null;
    return rgbToHex([clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2])]);
  }
  if (args.length < 3 || args.length > 4) return null;
  const alpha = alphaOf(args[3]);
  if (alpha === null || alpha < 1) return null;
  if (fn[1].startsWith('rgb')) {
    const rgb = args.slice(0, 3).map(channelOf);
    if (rgb.some((c) => c === null)) return null;
    return rgbToHex(rgb as [number, number, number]);
  }
  const hue = parseFloat(args[0]);
  const sat = parseFloat(args[1]);
  const light = parseFloat(args[2]);
  if ([hue, sat, light].some(Number.isNaN)) return null;
  const turns = args[0].endsWith('turn') ? hue * 360 : args[0].endsWith('rad') ? (hue * 180) / Math.PI : hue;
  return hslToHex(((turns % 360) + 360) % 360, Math.min(1, sat / 100), Math.min(1, light / 100));
};

/**
 * Turns any CSS colour into a canonical form (`#rrggbb` / `rgba()`), or `null`
 * when the value is not a colour. `undefined` = no normaliser available.
 */
export type CssColorNormalizer = (value: string) => string | null | undefined;

let canvasContext: CanvasRenderingContext2D | null | undefined;
const normalizedCache = new Map<string, string | null>();

/**
 * The browser's own colour parser: a canvas 2D context serialises `fillStyle`
 * to `#rrggbb` (opaque) or `rgba()` for every syntax the browser understands
 * (named colours, hsl, lab, oklch, color-mix, …); a colour kept in a
 * wide-gamut serialisation is painted to one pixel and read back as sRGB. Invalid values are rejected
 * by `CSS.supports` and, as a second guard, detected through two different
 * `fillStyle` sentinels (an invalid assignment leaves the previous value).
 */
export const canvasColorNormalizer: CssColorNormalizer = (value) => {
  // A browser engine (CSS.supports) is required; DOM emulations without one
  // (jsdom) fall back to the canonical parser.
  const supports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports : null;
  if (!supports) return undefined;
  if (canvasContext === undefined) {
    try {
      if (typeof document === 'undefined') canvasContext = null;
      else {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        canvasContext = canvas.getContext('2d', { willReadFrequently: true });
      }
    } catch {
      canvasContext = null;
    }
  }
  const ctx = canvasContext;
  if (!ctx) return undefined;
  const cached = normalizedCache.get(value);
  if (cached !== undefined) return cached;
  if (!supports.call(CSS, 'color', value)) {
    normalizedCache.set(value, null);
    return null;
  }
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value;
  const onBlack = String(ctx.fillStyle);
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = value;
  const onWhite = String(ctx.fillStyle);
  let result: string | null = onBlack === onWhite ? onBlack : null;
  if (result !== null && parseCanonicalColor(result) === null && !result.startsWith('rgba(')) {
    // Serialised in a wide-gamut space (e.g. oklch(), color(display-p3 …)):
    // paint one pixel and read the sRGB bytes back.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    result = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }
  if (normalizedCache.size > 64) normalizedCache.clear();
  normalizedCache.set(value, result);
  return result;
};

let normalizeCssColor: CssColorNormalizer = canvasColorNormalizer;

/** Test hook: replace the browser colour normaliser (`null` restores the canvas one). */
export const setCssColorNormalizerForTest = (normalizer: CssColorNormalizer | null) => {
  normalizeCssColor = normalizer ?? canvasColorNormalizer;
};

/**
 * Any CSS colour → `#rrggbb` when it is opaque; transparent, translucent or
 * invalid → `null`. The browser normalises the value first (so named colours,
 * hsl, percentage rgb, lab, color-mix, … all work); without a normaliser the
 * canonical parser handles hex, rgb, hsl and color(srgb).
 */
export const parseOpaqueColor = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  const normalized = normalizeCssColor(text);
  if (normalized === null) return null;
  return parseCanonicalColor(normalized ?? text);
};

/** Surfaces from raw token values (in `SURFACE_TOKENS` order), each slot falling back to the built-in value. */
export const resolveThemeSurfaces = (raw: readonly string[], appearance: ThemeAppearance): string[] => {
  const fallback = PROJECT_SURFACES[appearance];
  return fallback.map((builtIn, i) => parseOpaqueColor(raw[i] ?? '') ?? builtIn);
};

// Raw token values on the theme root, joined: the external-store snapshot (stable while unchanged).
const SEPARATOR = '|';
const readRawTokens = (): string => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  const style = getComputedStyle(document.documentElement);
  return SURFACE_TOKENS.map((t) => style.getPropertyValue(t).trim()).join(SEPARATOR);
};

/** Current surfaces of the theme root for `appearance`. */
export const readThemeSurfaces = (appearance: ThemeAppearance): string[] =>
  resolveThemeSurfaces(readRawTokens().split(SEPARATOR), appearance);

let snapshot = '';
let observer: MutationObserver | null = null;
let scheduled = false;
const listeners = new Set<() => void>();

const refresh = () => {
  scheduled = false;
  const next = readRawTokens();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
};

const scheduleRefresh = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(refresh);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-color-scheme', 'style', 'class'],
    });
    snapshot = readRawTokens();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
};

const getSnapshot = () => {
  // Without an observer (first render, or nothing subscribed) read directly.
  if (!observer) snapshot = readRawTokens();
  return snapshot;
};

/** The active theme's surface colours, re-read when the theme tokens change. */
export const useThemeSurfaces = (appearance: ThemeAppearance): readonly string[] => {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => resolveThemeSurfaces(raw.split(SEPARATOR), appearance), [appearance, raw]);
};

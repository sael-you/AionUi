/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The active theme's surface colours (`--bg-base`, `--bg-1`, `--bg-2`), read
 * from the theme root so the project colour contrast holds for user themes
 * too. Themes write their tokens as `<style>` elements in `<head>` and switch
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

/**
 * An opaque CSS colour (`#rgb`, `#rrggbb`, `#rrggbbff`, `rgb()` / `rgba()` with
 * alpha 1, comma or space syntax) → `#rrggbb`; anything else → `null`.
 */
export const parseOpaqueColor = (value: string): string | null => {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) return `#${[...digits].map((d) => d + d).join('')}`;
    if (digits.length === 8 && !digits.endsWith('ff')) return null;
    return `#${digits.slice(0, 6)}`;
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(text);
  if (!fn) return null;
  const alpha = fn[4];
  if (alpha !== undefined) {
    const a = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha);
    if (a < 1) return null;
  }
  return rgbToHex([clampByte(Number(fn[1])), clampByte(Number(fn[2])), clampByte(Number(fn[3]))]);
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

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project colour → design tokens.
 *
 * Every project surface reads the same six CSS custom properties, set once on
 * the surface root (conversation / team layout, file panel, mobile titlebar,
 * active sidebar group):
 *
 * | Property                    | Use                                              | Guarantee                    |
 * | --------------------------- | ------------------------------------------------ | ---------------------------- |
 * | `--project-accent`          | identity strips, dots (same colour as sidebar)   | palette colour, unchanged    |
 * | `--project-accent-contrast` | text and icons placed on the tint or background  | ≥ 4.5:1 (WCAG AA, body text) |
 * | `--project-focus`           | focus border of inputs (send box)                | ≥ 3:1 (WCAG 1.4.11)          |
 * | `--project-tint`            | chip / active group background                   | accent at 6 % alpha          |
 * | `--project-border`          | resting border of the chip and send box          | accent at 40 % alpha         |
 * | `--project-focus-shadow`    | focus glow of the send box                       | soft accent glow             |
 *
 * Contrast is measured against the theme's three surface backgrounds
 * (`--bg-base`, `--bg-1`, `--bg-2` of `styles/themes/default-color-scheme.css`)
 * with the tint composited on top, and the worst case must pass. When the
 * palette accent falls short, it is mixed towards black (light theme) or white
 * (dark theme) in 5 % steps until it passes, so the hue stays recognisable.
 *
 * With `highContrast` (the OS asks for more contrast) the tint is dropped, the
 * text colour is raised to 7:1 (WCAG AAA), and borders and the focus ring use
 * that text colour at full strength.
 */

import type { ThemeAppearance } from '@/common/theme/types';
import type { CSSProperties } from 'react';
import { projectAccent, type ProjectColor } from './projectColors';

type Rgb = readonly [number, number, number];

/** Tint alpha (≤ 6 % by design: a wash, never a fill). */
export const PROJECT_TINT_ALPHA = 0.06;
/** Resting border alpha. */
export const PROJECT_BORDER_ALPHA = 0.4;
/** Focus glow alpha per theme (a 400 shade on dark glows brighter, so less is needed). */
export const PROJECT_GLOW_ALPHA: Record<ThemeAppearance, number> = { light: 0.18, dark: 0.28 };
/** WCAG AA for normal text. */
export const TEXT_CONTRAST_MIN = 4.5;
/** WCAG AAA, used when the OS asks for more contrast. */
export const HIGH_CONTRAST_TEXT_MIN = 7;
/** WCAG 1.4.11 for UI component boundaries (focus border). */
export const FOCUS_CONTRAST_MIN = 3;

/** Surface backgrounds per theme (`--bg-base`, `--bg-1`, `--bg-2`), the reference for contrast. */
export const PROJECT_SURFACES: Record<ThemeAppearance, readonly string[]> = {
  light: ['#ffffff', '#f9fafb', '#f2f3f5'],
  dark: ['#0e0e0e', '#1a1a1a', '#262626'],
};

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** `#rrggbb` → [r, g, b]. */
export const hexToRgb = (hex: string): Rgb => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** [r, g, b] → `#rrggbb`. */
export const rgbToHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `#rrggbb` + alpha → `rgba(r, g, b, a)`. */
export const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Linear interpolation in sRGB: `t = 0` → `from`, `t = 1` → `to`. */
const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  Math.round(from[0] + (to[0] - from[0]) * t),
  Math.round(from[1] + (to[1] - from[1]) * t),
  Math.round(from[2] + (to[2] - from[2]) * t),
];

/** Opaque result of painting `top` at `alpha` over `bottom`. */
export const composite = (topHex: string, alpha: number, bottomHex: string): string =>
  rgbToHex(mix(hexToRgb(bottomHex), hexToRgb(topHex), alpha));

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** WCAG 2.x contrast ratio, 1 … 21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Lowest contrast of `color` against any of `backgrounds`. */
export const worstContrast = (color: string, backgrounds: readonly string[]): number =>
  Math.min(...backgrounds.map((bg) => contrastRatio(color, bg)));

/**
 * The palette colour itself when it reaches `min` against every background,
 * otherwise the first 5 % step towards black (light) / white (dark) that does.
 */
export const ensureContrast = (
  hex: string,
  backgrounds: readonly string[],
  min: number,
  appearance: ThemeAppearance
): string => {
  const base = hexToRgb(hex);
  const target = appearance === 'dark' ? WHITE : BLACK;
  for (let step = 0; step <= 20; step += 1) {
    const candidate = rgbToHex(mix(base, target, step / 20));
    if (worstContrast(candidate, backgrounds) >= min) return candidate;
  }
  return rgbToHex(target);
};

export type ProjectThemeTokens = {
  accent: string;
  accentContrast: string;
  focus: string;
  tint: string;
  border: string;
  focusShadow: string;
};

export type ProjectThemeOptions = { highContrast?: boolean };

/** Tokens of one project colour for one theme. */
export const buildProjectTheme = (
  color: ProjectColor,
  appearance: ThemeAppearance,
  { highContrast = false }: ProjectThemeOptions = {}
): ProjectThemeTokens => {
  const accent = projectAccent(color, appearance);
  const surfaces = PROJECT_SURFACES[appearance];
  const tintedSurfaces = highContrast ? surfaces : surfaces.map((bg) => composite(accent, PROJECT_TINT_ALPHA, bg));
  const textMin = highContrast ? HIGH_CONTRAST_TEXT_MIN : TEXT_CONTRAST_MIN;
  const accentContrast = ensureContrast(accent, tintedSurfaces, textMin, appearance);
  const focus = ensureContrast(accent, surfaces, FOCUS_CONTRAST_MIN, appearance);

  if (highContrast) {
    return {
      accent,
      accentContrast,
      focus: accentContrast,
      tint: 'transparent',
      border: accentContrast,
      focusShadow: `0 0 0 2px ${accentContrast}`,
    };
  }
  return {
    accent,
    accentContrast,
    focus,
    tint: withAlpha(accent, PROJECT_TINT_ALPHA),
    border: withAlpha(accent, PROJECT_BORDER_ALPHA),
    focusShadow: `0px 2px 20px ${withAlpha(accent, PROJECT_GLOW_ALPHA[appearance])}`,
  };
};

/** The tokens as the CSS custom properties consumed by project surfaces. */
export const projectThemeStyle = (tokens: ProjectThemeTokens): CSSProperties =>
  ({
    '--project-accent': tokens.accent,
    '--project-accent-contrast': tokens.accentContrast,
    '--project-focus': tokens.focus,
    '--project-tint': tokens.tint,
    '--project-border': tokens.border,
    '--project-focus-shadow': tokens.focusShadow,
  }) as CSSProperties;

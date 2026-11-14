/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS } from '@/renderer/components/workspace/ProjectIdentity/projectColors';
import {
  FOCUS_CONTRAST_MIN,
  HIGH_CONTRAST_TEXT_MIN,
  PROJECT_SURFACES,
  PROJECT_TINT_ALPHA,
  TEXT_CONTRAST_MIN,
  buildProjectTheme,
  composite,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  projectThemeStyle,
  relativeLuminance,
  rgbToHex,
  withAlpha,
  worstContrast,
} from '@/renderer/components/workspace/ProjectIdentity/projectTheme';

const THEMES = ['light', 'dark'] as const;

describe('project theme colour maths', () => {
  it('converts between hex and rgb', () => {
    expect(hexToRgb('#2563eb')).toEqual([37, 99, 235]);
    expect(rgbToHex([37, 99, 235])).toBe('#2563eb');
    expect(() => hexToRgb('blue')).toThrow();
  });

  it('computes WCAG relative luminance and contrast', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 6);
    // Symmetric, and the known value for #767676 on white (the classic AA grey).
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(contrastRatio('#767676', '#ffffff'), 10);
  });

  it('composites a translucent colour over a background', () => {
    expect(composite('#000000', 0.5, '#ffffff')).toBe('#808080');
    expect(composite('#2563eb', 0, '#f9fafb')).toBe('#f9fafb');
    expect(composite('#2563eb', 1, '#f9fafb')).toBe('#2563eb');
    expect(withAlpha('#2563eb', 0.06)).toBe('rgba(37, 99, 235, 0.06)');
  });

  it('keeps a colour that already passes and darkens / lightens one that does not', () => {
    expect(ensureContrast('#475569', ['#ffffff'], 4.5, 'light')).toBe('#475569');
    const amber = ensureContrast('#d97706', ['#ffffff'], 4.5, 'light');
    expect(amber).not.toBe('#d97706');
    expect(contrastRatio(amber, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // Darkened, not replaced: still warmer (more red than blue) like the original amber.
    const [r, , b] = hexToRgb(amber);
    expect(r).toBeGreaterThan(b);
    const dim = ensureContrast('#475569', ['#0e0e0e'], 4.5, 'dark');
    expect(relativeLuminance(dim)).toBeGreaterThan(relativeLuminance('#475569'));
    expect(contrastRatio(dim, '#0e0e0e')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('buildProjectTheme', () => {
  for (const theme of THEMES) {
    for (const color of PROJECT_COLORS) {
      it(`${color.id} / ${theme}: AA text on the tint, 3:1 focus border, ≤6 % tint`, () => {
        const tokens = buildProjectTheme(color, theme);
        // The accent is the palette colour, so it matches the sidebar dot.
        expect(tokens.accent).toBe(theme === 'dark' ? color.dark : color.light);
        const tinted = PROJECT_SURFACES[theme].map((bg) => composite(tokens.accent, PROJECT_TINT_ALPHA, bg));
        expect(worstContrast(tokens.accentContrast, tinted)).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
        expect(worstContrast(tokens.accentContrast, PROJECT_SURFACES[theme])).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
        expect(worstContrast(tokens.focus, PROJECT_SURFACES[theme])).toBeGreaterThanOrEqual(FOCUS_CONTRAST_MIN);
        expect(PROJECT_TINT_ALPHA).toBeLessThanOrEqual(0.06);
        expect(tokens.tint).toBe(withAlpha(tokens.accent, PROJECT_TINT_ALPHA));
        expect(tokens.border).toBe(withAlpha(tokens.accent, 0.4));
        expect(tokens.focusShadow).toContain(theme === 'light' ? '0.18)' : '0.28)');
      });
    }
  }

  it('leaves passing accents untouched (no needless darkening)', () => {
    const slate = PROJECT_COLORS.find((c) => c.id === 'slate')!;
    expect(buildProjectTheme(slate, 'light').accentContrast).toBe(slate.light);
    const amber = PROJECT_COLORS.find((c) => c.id === 'amber')!;
    expect(buildProjectTheme(amber, 'dark').accentContrast).toBe(amber.dark);
    expect(buildProjectTheme(amber, 'light').accentContrast).not.toBe(amber.light);
  });

  it('drops the tint and strengthens borders when the OS asks for more contrast', () => {
    for (const theme of THEMES) {
      for (const color of PROJECT_COLORS) {
        const tokens = buildProjectTheme(color, theme, { highContrast: true });
        expect(tokens.tint).toBe('transparent');
        expect(worstContrast(tokens.accentContrast, PROJECT_SURFACES[theme])).toBeGreaterThanOrEqual(
          HIGH_CONTRAST_TEXT_MIN
        );
        expect(tokens.border).toBe(tokens.accentContrast);
        expect(tokens.focus).toBe(tokens.accentContrast);
        expect(tokens.focusShadow).toBe(`0 0 0 2px ${tokens.accentContrast}`);
      }
    }
  });

  it('exposes the tokens as --project-* custom properties', () => {
    const tokens = buildProjectTheme(PROJECT_COLORS[0], 'light');
    expect(projectThemeStyle(tokens)).toEqual({
      '--project-accent': tokens.accent,
      '--project-accent-contrast': tokens.accentContrast,
      '--project-focus': tokens.focus,
      '--project-tint': tokens.tint,
      '--project-border': tokens.border,
      '--project-focus-shadow': tokens.focusShadow,
    });
  });
});

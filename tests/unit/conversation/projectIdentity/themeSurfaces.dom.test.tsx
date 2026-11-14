/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  // Project colour preferences: no backend in these tests.
  httpRequest: vi.fn(async () => undefined),
}));

import { PROJECT_COLORS, buildProjectTheme, useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { composite, worstContrast } from '@/renderer/components/workspace/ProjectIdentity/projectTheme';
import {
  canvasColorNormalizer,
  parseCanonicalColor,
  parseOpaqueColor,
  readThemeSurfaces,
  setCssColorNormalizerForTest,
} from '@/renderer/components/workspace/ProjectIdentity/themeSurfaces';
import { resetProjectColorsForTest } from '@/renderer/components/workspace/ProjectIdentity/useProjectColors';
import { STORAGE_KEYS } from '@/common/config/storageKeys';

const WS = '/root/projects/sepia';
const amber = PROJECT_COLORS.find((c) => c.id === 'amber')!;
const SEPIA = ['#e9e1cc', '#ded4ba', '#d2c6a6'];

const setSurfaces = (values: string[] | null) => {
  const root = document.documentElement;
  ['--bg-base', '--bg-1', '--bg-2'].forEach((token, i) => {
    if (values) root.style.setProperty(token, values[i]);
    else root.style.removeProperty(token);
  });
};

const Probe: React.FC = () => {
  const project = useProjectTheme(WS);
  return <div data-testid='probe' style={project?.style} />;
};

beforeEach(() => {
  localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'amber' }));
  resetProjectColorsForTest();
});

afterEach(() => {
  setSurfaces(null);
  localStorage.clear();
  setCssColorNormalizerForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stand-in for the browser normaliser: what Chrome's canvas returns for these inputs. */
const BROWSER: Record<string, string | null> = {
  oldlace: '#fdf5e6',
  OldLace: '#fdf5e6',
  'hsl(40 30% 90%)': '#ede8df',
  'rgb(90% 88% 84%)': '#e6e0d6',
  'oklch(0.95 0.02 85)': '#f5efe2',
  transparent: 'rgba(0, 0, 0, 0)',
  'rgb(255 255 255 / 0.5)': 'rgba(255, 255, 255, 0.5)',
  'not-a-colour': null,
};
const stubBrowser = () => setCssColorNormalizerForTest((value) => (value in BROWSER ? BROWSER[value] : null));

describe('parseCanonicalColor (no browser normaliser)', () => {
  it('parses hex, numeric and percentage rgb, hsl and color(srgb)', () => {
    expect(parseCanonicalColor('#abc')).toBe('#aabbcc');
    expect(parseCanonicalColor('#abcf')).toBe('#aabbcc');
    expect(parseCanonicalColor('rgb(100%, 50%, 0%)')).toBe('#ff8000');
    expect(parseCanonicalColor('rgb(90% 88% 84%)')).toBe('#e6e0d6');
    expect(parseCanonicalColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(parseCanonicalColor('hsl(120deg 100% 25%)')).toBe('#008000');
    expect(parseCanonicalColor('hsla(0.5turn 100% 50% / 1)')).toBe('#00ffff');
    expect(parseCanonicalColor('color(srgb 1 0.5 0)')).toBe('#ff8000');
  });

  it('rejects non-opaque, unknown and malformed values', () => {
    expect(parseCanonicalColor('hsl(0 100% 50% / 0.5)')).toBeNull();
    expect(parseCanonicalColor('#abc8')).toBeNull();
    expect(parseCanonicalColor('color(display-p3 1 0 0)')).toBeNull();
    expect(parseCanonicalColor('rgb(1, 2)')).toBeNull();
    expect(parseCanonicalColor('oldlace')).toBeNull();
    expect(parseCanonicalColor('transparent')).toBeNull();
  });
});

describe('parseOpaqueColor through the browser normaliser', () => {
  it('handles named, hsl, percentage rgb and wide-gamut colours', () => {
    stubBrowser();
    expect(parseOpaqueColor('oldlace')).toBe('#fdf5e6');
    expect(parseOpaqueColor(' OldLace ')).toBe('#fdf5e6');
    expect(parseOpaqueColor('hsl(40 30% 90%)')).toBe('#ede8df');
    expect(parseOpaqueColor('rgb(90% 88% 84%)')).toBe('#e6e0d6');
    expect(parseOpaqueColor('oklch(0.95 0.02 85)')).toBe('#f5efe2');
  });

  it('rejects transparent, translucent and invalid values (the slot falls back)', () => {
    stubBrowser();
    expect(parseOpaqueColor('transparent')).toBeNull();
    expect(parseOpaqueColor('rgb(255 255 255 / 0.5)')).toBeNull();
    expect(parseOpaqueColor('not-a-colour')).toBeNull();
  });

  it('feeds custom theme surfaces of any syntax into the contrast reference', () => {
    stubBrowser();
    setSurfaces(['oldlace', 'hsl(40 30% 90%)', 'not-a-colour']);
    expect(readThemeSurfaces('light')).toEqual(['#fdf5e6', '#ede8df', '#f2f3f5']);
    setSurfaces(['transparent', 'rgb(90% 88% 84%)', 'oklch(0.95 0.02 85)']);
    expect(readThemeSurfaces('light')).toEqual(['#ffffff', '#e6e0d6', '#f5efe2']);
  });
});

describe('canvasColorNormalizer', () => {
  it('is unavailable without a browser engine (jsdom), so the canonical parser is used', () => {
    expect(canvasColorNormalizer('oldlace')).toBeUndefined();
    expect(parseOpaqueColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
  });

  it('uses the canvas serialisation, rejects invalid values and reads wide-gamut colours back as sRGB', () => {
    const known: Record<string, string> = {
      'peachpuff-test': '#ffdab9',
      'oklch-test': 'oklch(0.7 0.1 30)',
      'clear-test': 'rgba(0, 0, 0, 0)',
    };
    let fill = '#000000';
    const ctx = {
      get fillStyle() {
        return fill;
      },
      set fillStyle(value: string) {
        if (value.startsWith('#') && value.length === 7) fill = value;
        else if (value in known) fill = known[value];
      },
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([230, 160, 140, 255]) })),
    };
    vi.stubGlobal('CSS', { supports: (_p: string, value: string) => value !== 'bogus' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    // The canvas context is created lazily once per module: load a fresh instance.
    vi.resetModules();
    return import('@/renderer/components/workspace/ProjectIdentity/themeSurfaces').then((fresh) => {
      expect(fresh.canvasColorNormalizer('peachpuff-test')).toBe('#ffdab9');
      expect(fresh.canvasColorNormalizer('clear-test')).toBe('rgba(0, 0, 0, 0)');
      expect(fresh.canvasColorNormalizer('bogus')).toBeNull(); // CSS.supports says no
      expect(fresh.canvasColorNormalizer('unknown-but-supported')).toBeNull(); // sentinels disagree
      expect(fresh.canvasColorNormalizer('oklch-test')).toBe('rgba(230, 160, 140, 1)');
      expect(fresh.parseOpaqueColor('oklch-test')).toBe('#e6a08c');
    });
  });
});

describe('parseOpaqueColor', () => {
  it('accepts opaque hex and rgb() forms and rejects the rest', () => {
    expect(parseOpaqueColor('#FFF')).toBe('#ffffff');
    expect(parseOpaqueColor(' #1a1a1a ')).toBe('#1a1a1a');
    expect(parseOpaqueColor('#1a1a1aff')).toBe('#1a1a1a');
    expect(parseOpaqueColor('#1a1a1a80')).toBeNull();
    expect(parseOpaqueColor('rgb(26, 26, 26)')).toBe('#1a1a1a');
    expect(parseOpaqueColor('rgb(26 26 26 / 100%)')).toBe('#1a1a1a');
    expect(parseOpaqueColor('rgba(26, 26, 26, 0.5)')).toBeNull();
    expect(parseOpaqueColor('var(--x)')).toBeNull();
    expect(parseOpaqueColor('')).toBeNull();
  });
});

describe('active theme surfaces', () => {
  it('reads the theme root tokens, slot by slot falling back to the built-in values', () => {
    expect(readThemeSurfaces('light')).toEqual(['#ffffff', '#f9fafb', '#f2f3f5']);
    document.documentElement.style.setProperty('--bg-1', 'rgb(222, 212, 186)');
    expect(readThemeSurfaces('light')).toEqual(['#ffffff', '#ded4ba', '#f2f3f5']);
  });

  it('recomputes the project tokens when a user theme changes the surface tokens', async () => {
    const { getByTestId } = render(<Probe />);
    const probe = getByTestId('probe');
    const builtIn = buildProjectTheme(amber, 'light');
    expect(probe.style.getPropertyValue('--project-accent-contrast')).toBe(builtIn.accentContrast);

    await act(async () => {
      setSurfaces(SEPIA);
      await Promise.resolve();
    });
    const custom = buildProjectTheme(amber, 'light', { surfaces: SEPIA });
    expect(custom.accentContrast).not.toBe(builtIn.accentContrast);
    const text = probe.style.getPropertyValue('--project-accent-contrast');
    expect(text).toBe(custom.accentContrast);
    expect(
      worstContrast(
        text,
        SEPIA.map((bg) => composite(amber.light, 0.06, bg))
      )
    ).toBeGreaterThanOrEqual(4.5);

    await act(async () => {
      setSurfaces(null);
      await Promise.resolve();
    });
    expect(probe.style.getPropertyValue('--project-accent-contrast')).toBe(builtIn.accentContrast);
  });
});

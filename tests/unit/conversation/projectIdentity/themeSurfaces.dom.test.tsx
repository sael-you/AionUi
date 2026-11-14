/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/config/configService', () => ({
  configService: { whenReady: () => Promise.resolve(), get: () => undefined, set: () => Promise.resolve() },
}));

import { PROJECT_COLORS, buildProjectTheme, useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { composite, worstContrast } from '@/renderer/components/workspace/ProjectIdentity/projectTheme';
import { parseOpaqueColor, readThemeSurfaces } from '@/renderer/components/workspace/ProjectIdentity/themeSurfaces';
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

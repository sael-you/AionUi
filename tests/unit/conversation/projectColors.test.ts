/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  PROJECT_COLORS,
  autoProjectColorId,
  isProjectColorId,
  projectAccent,
  resolveProjectColor,
} from '@/renderer/pages/conversation/GroupedHistory/utils/projectColors';

describe('project colour palette', () => {
  it('has 12 distinct hues with distinct light and dark accents', () => {
    expect(PROJECT_COLORS).toHaveLength(12);
    expect(new Set(PROJECT_COLORS.map((c) => c.id)).size).toBe(12);
    expect(new Set(PROJECT_COLORS.map((c) => c.light)).size).toBe(12);
    expect(new Set(PROJECT_COLORS.map((c) => c.dark)).size).toBe(12);
    for (const c of PROJECT_COLORS) {
      expect(c.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives each workspace a stable automatic colour', () => {
    const a = autoProjectColorId('/root/projects/TB-test');
    expect(autoProjectColorId('/root/projects/TB-test')).toBe(a);
    expect(isProjectColorId(a)).toBe(true);
    const spread = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => autoProjectColorId(`/root/projects/${n}`))
    );
    expect(spread.size).toBeGreaterThan(1);
  });

  it('uses a valid user choice and ignores an invalid one', () => {
    const ws = '/root/projects/airtable';
    expect(resolveProjectColor(ws, { [ws]: 'violet' }).id).toBe('violet');
    expect(resolveProjectColor(ws, { [ws]: 'not-a-colour' }).id).toBe(autoProjectColorId(ws));
    expect(resolveProjectColor(ws).id).toBe(autoProjectColorId(ws));
  });

  it('picks the accent for the active theme', () => {
    const blue = PROJECT_COLORS.find((c) => c.id === 'blue')!;
    expect(projectAccent(blue, 'light')).toBe(blue.light);
    expect(projectAccent(blue, 'dark')).toBe(blue.dark);
  });
});

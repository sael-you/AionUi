/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared library layout model (C33, TASK-119): rail scopes, grid keys, tones, search. */

import { describe, expect, it } from 'vitest';
import {
  categoryTone,
  gridColumnsFor,
  gridMove,
  matchesQuery,
  projectIdOfScope,
  projectScopeKey,
  splitRailScopes,
} from '@/renderer/components/settings/SettingsModal/library/libraryModel';

const global = { key: 'global', label: 'Global', count: 5 };
const project = (id: string, count: number) => ({ key: projectScopeKey(id), label: id, count });

describe('rail scopes', () => {
  it('Global first, projects with something by count, empty projects folded', () => {
    const { shown, empty } = splitRailScopes(
      global,
      [project('store', 0), project('aionui', 10), project('TB-test', 14), project('skill-probe', 0)],
      'global'
    );
    expect(shown.map((s) => s.label)).toEqual(['Global', 'TB-test', 'aionui']);
    expect(empty.map((s) => s.label)).toEqual(['skill-probe', 'store']);
  });

  it('the selected scope stays visible even when empty', () => {
    const { shown, empty } = splitRailScopes(
      global,
      [project('store', 0), project('moel', 0)],
      projectScopeKey('store')
    );
    expect(shown.map((s) => s.label)).toEqual(['Global', 'store']);
    expect(empty.map((s) => s.label)).toEqual(['moel']);
  });

  it('scope keys round-trip', () => {
    expect(projectIdOfScope(projectScopeKey('p-1'))).toBe('p-1');
    expect(projectIdOfScope('global')).toBeNull();
  });
});

describe('grid', () => {
  it('3 columns at 1440, 2 at 1024, 1 at 390', () => {
    expect(gridColumnsFor(1440)).toBe(3);
    expect(gridColumnsFor(1024)).toBe(2);
    expect(gridColumnsFor(390)).toBe(1);
  });

  it('arrow keys move by one or by a row, never out of the grid', () => {
    expect(gridMove(0, 'ArrowRight', 3, 7)).toBe(1);
    expect(gridMove(1, 'ArrowDown', 3, 7)).toBe(4);
    expect(gridMove(5, 'ArrowDown', 3, 7)).toBeNull();
    expect(gridMove(0, 'ArrowLeft', 3, 7)).toBeNull();
    expect(gridMove(4, 'Home', 3, 7)).toBe(0);
    expect(gridMove(0, 'End', 3, 7)).toBe(6);
    expect(gridMove(0, 'a', 3, 7)).toBeNull();
  });
});

describe('tones and search', () => {
  it('a category always gets the same tone', () => {
    expect(categoryTone('kit:abc')).toBe(categoryTone('kit:abc'));
  });

  it('search is case-insensitive over any field', () => {
    expect(matchesQuery('SEO', 'seo-audit', undefined)).toBe(true);
    expect(matchesQuery('', 'x')).toBe(true);
    expect(matchesQuery('zzz', 'abc', 'def')).toBe(false);
  });
});

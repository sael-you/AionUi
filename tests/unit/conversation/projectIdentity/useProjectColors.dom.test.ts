/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => {
  const state = {
    store: new Map<string, unknown>(),
    ready: Promise.resolve() as Promise<void>,
  };
  return {
    state,
    configService: {
      whenReady: vi.fn(() => state.ready),
      get: vi.fn((key: string) => state.store.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        state.store.set(key, value);
      }),
    },
  };
});

vi.mock('@/common/config/configService', () => ({ configService: backend.configService }));

import { STORAGE_KEYS } from '@/common/config/storageKeys';
import {
  PROJECT_COLORS_SETTING_KEY,
  resetProjectColorsForTest,
  sanitizeProjectColorOverrides,
  useProjectColors,
} from '@/renderer/components/workspace/ProjectIdentity/useProjectColors';

const WS = '/root/projects/aionui';
const readLocal = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECT_COLORS) ?? '{}');

beforeEach(() => {
  localStorage.clear();
  backend.state.store.clear();
  backend.state.ready = Promise.resolve();
  vi.clearAllMocks();
  resetProjectColorsForTest();
});

describe('sanitizeProjectColorOverrides', () => {
  it('keeps only workspace → valid palette id entries', () => {
    expect(sanitizeProjectColorOverrides({ [WS]: 'teal', '/x': 'nope', '/y': 3 })).toEqual({ [WS]: 'teal' });
    expect(sanitizeProjectColorOverrides(null)).toEqual({});
    expect(sanitizeProjectColorOverrides(['teal'])).toEqual({});
  });
});

describe('useProjectColors (backend client preference)', () => {
  it('loads the backend copy, which wins over this browser', async () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'red' }));
    backend.state.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet' });
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    expect(result.current.overrides).toEqual({ [WS]: 'red' }); // local copy until the backend answers
    await waitFor(() => expect(result.current.overrides).toEqual({ [WS]: 'violet' }));
    expect(readLocal()).toEqual({ [WS]: 'violet' });
    expect(backend.configService.set).not.toHaveBeenCalled();
  });

  it('migrates legacy localStorage colours to the backend once, when the backend has none', async () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'amber', '/bad': 'x' }));
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    await waitFor(() =>
      expect(backend.configService.set).toHaveBeenCalledWith(PROJECT_COLORS_SETTING_KEY, { [WS]: 'amber' })
    );
    expect(result.current.overrides).toEqual({ [WS]: 'amber' });
  });

  it('does not write the backend when there is nothing to migrate', async () => {
    renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.configService.whenReady).toHaveBeenCalled());
    await act(async () => {});
    expect(backend.configService.set).not.toHaveBeenCalled();
  });

  it('writes a choice through to memory, localStorage and the backend, shared by every consumer', async () => {
    const first = renderHook(() => useProjectColors());
    const second = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.configService.whenReady).toHaveBeenCalled());

    act(() => first.result.current.setProjectColor(WS, 'green'));
    expect(second.result.current.overrides).toEqual({ [WS]: 'green' });
    expect(readLocal()).toEqual({ [WS]: 'green' });
    await waitFor(() =>
      expect(backend.configService.set).toHaveBeenLastCalledWith(PROJECT_COLORS_SETTING_KEY, { [WS]: 'green' })
    );

    act(() => second.result.current.setProjectColor(WS, null));
    expect(first.result.current.overrides).toEqual({});
    await waitFor(() => expect(backend.configService.set).toHaveBeenLastCalledWith(PROJECT_COLORS_SETTING_KEY, {}));
  });

  it('keeps a choice made while the backend copy is still loading', async () => {
    let release: (() => void) | undefined;
    backend.state.ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.state.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet' });

    const { result } = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.configService.whenReady).toHaveBeenCalled());
    act(() => result.current.setProjectColor(WS, 'pink'));
    await act(async () => {
      release?.();
    });
    expect(result.current.overrides).toEqual({ [WS]: 'pink' });
  });

  it('keeps the local copy when the backend is unreachable', async () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'cyan' }));
    backend.state.ready = Promise.reject(new Error('offline'));
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    await act(async () => {});
    expect(result.current.overrides).toEqual({ [WS]: 'cyan' });
  });

  it('follows another tab through the storage event', async () => {
    const { result } = renderHook(() => useProjectColors());
    await act(async () => {});
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'lime' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.PROJECT_COLORS }));
    });
    expect(result.current.overrides).toEqual({ [WS]: 'lime' });
  });
});

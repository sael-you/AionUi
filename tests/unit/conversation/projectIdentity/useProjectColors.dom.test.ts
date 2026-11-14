/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => {
  const state = {
    /** Backend preferences per account (the session decides which one a request reaches). */
    stores: new Map<string, Map<string, unknown>>(),
    user: 'local',
    ready: Promise.resolve() as Promise<void>,
  };
  const storeOf = (user: string) => {
    if (!state.stores.has(user)) state.stores.set(user, new Map());
    return state.stores.get(user)!;
  };
  const fake = {
    state,
    get store() {
      return storeOf(state.user);
    },
    storeOf,
    /** GET /api/settings/client (waits for `state.ready`). */
    load: vi.fn(() => state.ready),
    /** PUT /api/settings/client. */
    save: vi.fn(async (key: string, value: unknown) => {
      storeOf(state.user).set(key, value);
    }),
  };
  return fake;
});

const auth = vi.hoisted(() => ({ value: undefined as undefined | { status: string; user: { id: string } | null } }));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'GET') {
      await backend.load();
      const key = decodeURIComponent(path.split('keys=')[1] ?? '');
      return { [key]: backend.store.get(key) };
    }
    const [key, value] = Object.entries(body ?? {})[0];
    return backend.save(key, value);
  },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useOptionalAuth: () => auth.value }));

import { STORAGE_KEYS } from '@/common/config/storageKeys';
import {
  PROJECT_COLORS_RETRY_DELAYS_MS,
  PROJECT_COLORS_SETTING_KEY,
  projectColorsCacheKey,
  projectColorsPendingKey,
  resetProjectColorsForTest,
  setProjectColorOverride,
  sanitizeProjectColorOverrides,
  useProjectColors,
} from '@/renderer/components/workspace/ProjectIdentity/useProjectColors';

const WS = '/root/projects/aionui';
const LOCAL_CACHE = projectColorsCacheKey('local');
const LOCAL_PENDING = projectColorsPendingKey('local');
const readLocal = () => JSON.parse(localStorage.getItem(LOCAL_CACHE) ?? '{}');

beforeEach(() => {
  localStorage.clear();
  backend.state.stores.clear();
  backend.state.user = 'local';
  auth.value = undefined;
  backend.state.ready = Promise.resolve();
  vi.clearAllMocks();
  resetProjectColorsForTest();
});

afterEach(() => {
  vi.useRealTimers();
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
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet' });
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    expect(result.current.overrides).toEqual({ [WS]: 'red' }); // local copy until the backend answers
    await waitFor(() => expect(result.current.overrides).toEqual({ [WS]: 'violet' }));
    expect(readLocal()).toEqual({ [WS]: 'violet' });
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('migrates legacy localStorage colours to the backend once, when the backend has none', async () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'amber', '/bad': 'x' }));
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.save).toHaveBeenCalledWith(PROJECT_COLORS_SETTING_KEY, { [WS]: 'amber' }));
    expect(result.current.overrides).toEqual({ [WS]: 'amber' });
  });

  it('does not write the backend when there is nothing to migrate', async () => {
    renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalled());
    await act(async () => {});
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('writes a choice through to memory, localStorage and the backend, shared by every consumer', async () => {
    const first = renderHook(() => useProjectColors());
    const second = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalled());

    act(() => first.result.current.setProjectColor(WS, 'green'));
    expect(second.result.current.overrides).toEqual({ [WS]: 'green' });
    expect(readLocal()).toEqual({ [WS]: 'green' });
    await waitFor(() => expect(backend.save).toHaveBeenLastCalledWith(PROJECT_COLORS_SETTING_KEY, { [WS]: 'green' }));

    act(() => second.result.current.setProjectColor(WS, null));
    expect(first.result.current.overrides).toEqual({});
    await waitFor(() => expect(backend.save).toHaveBeenLastCalledWith(PROJECT_COLORS_SETTING_KEY, {}));
  });

  it('merges a choice made while loading over the backend map (no remote colour is lost)', async () => {
    let release: (() => void) | undefined;
    backend.state.ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The backend knows two projects; this browser's stale copy only one of them.
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet', '/root/projects/other': 'teal' });
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'violet' }));
    resetProjectColorsForTest();

    const { result } = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalled());
    act(() => result.current.setProjectColor(WS, 'pink'));
    expect(result.current.overrides).toEqual({ [WS]: 'pink' }); // shown at once
    expect(backend.save).not.toHaveBeenCalled(); // buffered, not a blind overwrite

    await act(async () => {
      release?.();
    });
    const merged = { [WS]: 'pink', '/root/projects/other': 'teal' };
    expect(result.current.overrides).toEqual(merged);
    expect(readLocal()).toEqual(merged);
    await waitFor(() => expect(backend.save).toHaveBeenCalledWith(PROJECT_COLORS_SETTING_KEY, merged));
    expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual(merged);
  });

  it('replays a reset made while loading over the backend map', async () => {
    let release: (() => void) | undefined;
    backend.state.ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet', '/root/projects/other': 'teal' });

    const { result } = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalled());
    act(() => result.current.setProjectColor(WS, null));
    await act(async () => {
      release?.();
    });
    expect(result.current.overrides).toEqual({ '/root/projects/other': 'teal' });
  });

  it('retries a failed backend load with backoff while mounted, keeping edits made meanwhile', async () => {
    vi.useFakeTimers();
    backend.load.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { '/root/projects/other': 'teal' });

    const { result } = renderHook(() => useProjectColors());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(backend.load).toHaveBeenCalledTimes(1);
    act(() => result.current.setProjectColor(WS, 'amber'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_COLORS_RETRY_DELAYS_MS[0]);
    });
    expect(backend.load).toHaveBeenCalledTimes(2);
    expect(result.current.overrides).toEqual({ [WS]: 'amber', '/root/projects/other': 'teal' });
    expect(backend.save).toHaveBeenCalledWith(PROJECT_COLORS_SETTING_KEY, {
      [WS]: 'amber',
      '/root/projects/other': 'teal',
    });
  });

  it('retries at once when the browser comes back online', async () => {
    backend.load.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'slate' });

    const { result } = renderHook(() => useProjectColors());
    await act(async () => {});
    expect(result.current.overrides).toEqual({});
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.overrides).toEqual({ [WS]: 'slate' }));
  });

  it('keeps a failed save pending across a reload: the choice wins over the older backend value and is re-saved', async () => {
    backend.store.set(PROJECT_COLORS_SETTING_KEY, { [WS]: 'violet', '/root/projects/other': 'teal' });
    const first = renderHook(() => useProjectColors());
    await waitFor(() => expect(first.result.current.overrides[WS]).toBe('violet'));

    backend.save.mockRejectedValueOnce(new Error('offline'));
    act(() => first.result.current.setProjectColor(WS, 'pink'));
    await waitFor(() => expect(backend.save).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual({
      [WS]: 'violet',
      '/root/projects/other': 'teal',
    });
    expect(JSON.parse(localStorage.getItem(LOCAL_PENDING) ?? '{}')).toEqual({ [WS]: 'pink' });

    // Reload: fresh module state from localStorage, backend still holds the older value.
    first.unmount();
    resetProjectColorsForTest();
    const second = renderHook(() => useProjectColors());
    await waitFor(() =>
      expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual({
        [WS]: 'pink',
        '/root/projects/other': 'teal',
      })
    );
    expect(second.result.current.overrides).toEqual({ [WS]: 'pink', '/root/projects/other': 'teal' });
    expect(localStorage.getItem(LOCAL_PENDING)).toBeNull();
  });

  it('retries a failed save with the backoff while mounted', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useProjectColors());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    backend.save.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.setProjectColor(WS, 'green'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_COLORS_RETRY_DELAYS_MS[0]);
    });
    expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual({ [WS]: 'green' });
    expect(localStorage.getItem(LOCAL_PENDING)).toBeNull();
  });

  it('keeps an edit made during a save pending and saves it next', async () => {
    let finish: (() => void) | undefined;
    const { result } = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalled());
    await act(async () => {});
    backend.save.mockImplementationOnce(
      (key: string, value: unknown) =>
        new Promise<void>((resolve) => {
          finish = () => {
            backend.store.set(key, value);
            resolve();
          };
        })
    );
    act(() => result.current.setProjectColor(WS, 'red'));
    await waitFor(() => expect(finish).toBeDefined());
    act(() => result.current.setProjectColor('/root/projects/other', 'blue'));
    await act(async () => {
      finish?.();
    });
    await waitFor(() =>
      expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual({
        [WS]: 'red',
        '/root/projects/other': 'blue',
      })
    );
    expect(localStorage.getItem(LOCAL_PENDING)).toBeNull();
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
    localStorage.setItem(LOCAL_CACHE, JSON.stringify({ [WS]: 'lime' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_CACHE }));
    });
    expect(result.current.overrides).toEqual({ [WS]: 'lime' });
  });
});

const signIn = (id: string) => {
  auth.value = { status: 'authenticated', user: { id } };
  backend.state.user = id;
};

describe('useProjectColors per account', () => {
  it("never sends user A's failed edit to user B, and replays it for A", async () => {
    signIn('A');
    const view = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.load).toHaveBeenCalledTimes(1));
    await act(async () => {});

    backend.save.mockRejectedValueOnce(new Error('offline'));
    act(() => view.result.current.setProjectColor(WS, 'pink'));
    await act(async () => {});
    expect(JSON.parse(localStorage.getItem(projectColorsPendingKey('A')) ?? '{}')).toEqual({ [WS]: 'pink' });

    // Account change in the same browser: B has its own colours.
    backend.storeOf('B').set(PROJECT_COLORS_SETTING_KEY, { '/root/projects/b': 'teal' });
    signIn('B');
    view.rerender();
    await waitFor(() => expect(view.result.current.overrides).toEqual({ '/root/projects/b': 'teal' }));
    act(() => view.result.current.setProjectColor('/root/projects/b2', 'lime'));
    await waitFor(() =>
      expect(backend.storeOf('B').get(PROJECT_COLORS_SETTING_KEY)).toEqual({
        '/root/projects/b': 'teal',
        '/root/projects/b2': 'lime',
      })
    );
    expect(JSON.stringify([...backend.storeOf('B').values()])).not.toContain(WS);
    expect(localStorage.getItem(projectColorsPendingKey('B'))).toBeNull();

    // Back to A: its pending edit is replayed and saved to A only.
    signIn('A');
    view.rerender();
    await waitFor(() => expect(backend.storeOf('A').get(PROJECT_COLORS_SETTING_KEY)).toEqual({ [WS]: 'pink' }));
    expect(view.result.current.overrides).toEqual({ [WS]: 'pink' });
  });

  it('lets only the first account adopt the legacy browser-wide copy', async () => {
    localStorage.setItem(STORAGE_KEYS.PROJECT_COLORS, JSON.stringify({ [WS]: 'amber' }));
    signIn('A');
    const view = renderHook(() => useProjectColors());
    await waitFor(() => expect(backend.storeOf('A').get(PROJECT_COLORS_SETTING_KEY)).toEqual({ [WS]: 'amber' }));
    expect(localStorage.getItem(STORAGE_KEYS.PROJECT_COLORS)).toBeNull();

    signIn('B');
    view.rerender();
    await waitFor(() => expect(backend.load).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(view.result.current.overrides).toEqual({});
    expect(backend.storeOf('B').has(PROJECT_COLORS_SETTING_KEY)).toBe(false);
  });

  it('neither loads nor saves while signed out', async () => {
    auth.value = { status: 'unauthenticated', user: null };
    const view = renderHook(() => useProjectColors());
    await act(async () => {});
    act(() => setProjectColorOverride(WS, 'red'));
    await act(async () => {});
    expect(backend.load).not.toHaveBeenCalled();
    expect(backend.save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    view.unmount();
  });

  it('saves pending edits on remount after the last consumer unmounted during the backoff', async () => {
    vi.useFakeTimers();
    const first = renderHook(() => useProjectColors());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    backend.save.mockRejectedValueOnce(new Error('offline'));
    act(() => first.result.current.setProjectColor(WS, 'indigo'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    first.unmount(); // the retry timer is dropped with the last consumer

    renderHook(() => useProjectColors());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(backend.store.get(PROJECT_COLORS_SETTING_KEY)).toEqual({ [WS]: 'indigo' });
    expect(localStorage.getItem(LOCAL_PENDING)).toBeNull();
  });
});

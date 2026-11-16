/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({
  value: { openBrowserTab: vi.fn() } as { openBrowserTab: ReturnType<typeof vi.fn> } | null,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => preview.value,
}));

import {
  isBrowserShortcut,
  useInAppBrowserLauncher,
  useInAppBrowserShortcut,
} from '@/renderer/pages/conversation/Preview/browser/useInAppBrowserLauncher';

const at =
  (path: string) =>
  ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

const ShortcutHost: React.FC = () => {
  useInAppBrowserShortcut();
  return null;
};

describe('in-app browser launcher (TASK-124)', () => {
  beforeEach(() => {
    preview.value = { openBrowserTab: vi.fn() };
  });

  it('opens an empty browser tab in a conversation', () => {
    const { result } = renderHook(() => useInAppBrowserLauncher(), { wrapper: at('/conversation/c1') });
    expect(result.current.available).toBe(true);
    act(() => result.current.open());
    expect(preview.value?.openBrowserTab).toHaveBeenCalledWith();
  });

  it('is unavailable outside a conversation or without a preview host', () => {
    const settings = renderHook(() => useInAppBrowserLauncher(), { wrapper: at('/settings/system') });
    expect(settings.result.current.available).toBe(false);
    act(() => settings.result.current.open());
    expect(preview.value?.openBrowserTab).not.toHaveBeenCalled();

    preview.value = null;
    const noHost = renderHook(() => useInAppBrowserLauncher(), { wrapper: at('/conversation/c1') });
    expect(noHost.result.current.available).toBe(false);
  });

  it('recognises Ctrl+Shift+B and Cmd+Shift+B only', () => {
    const base = { key: 'B', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false };
    expect(isBrowserShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isBrowserShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isBrowserShortcut({ ...base })).toBe(false);
    expect(isBrowserShortcut({ ...base, ctrlKey: true, shiftKey: false })).toBe(false);
    expect(isBrowserShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false);
  });

  it('opens the browser on the shortcut in a conversation, not elsewhere', () => {
    const inConversation = render(<ShortcutHost />, { wrapper: at('/conversation/c1') });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true });
    expect(preview.value?.openBrowserTab).toHaveBeenCalledTimes(1);
    inConversation.unmount();

    render(<ShortcutHost />, { wrapper: at('/guid') });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true, shiftKey: true });
    expect(preview.value?.openBrowserTab).toHaveBeenCalledTimes(1);
  });
});

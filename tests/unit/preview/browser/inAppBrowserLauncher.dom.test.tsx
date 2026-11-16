/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Tab = { id: string; content: string; content_type: string };
type FakePreview = {
  tabs: Tab[];
  activeTabId: string | null;
  openBrowserTab: ReturnType<typeof vi.fn>;
  revealTab: ReturnType<typeof vi.fn>;
};

const preview = vi.hoisted(() => ({ value: null as FakePreview | null }));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => preview.value,
}));

import {
  focusBrowserAddress,
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
    preview.value = { tabs: [], activeTabId: null, openBrowserTab: vi.fn(), revealTab: vi.fn() };
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const openWith = (tabs: Tab[], activeTabId: string | null) => {
    preview.value = { tabs, activeTabId, openBrowserTab: vi.fn(), revealTab: vi.fn() };
    const { result } = renderHook(() => useInAppBrowserLauncher(), { wrapper: at('/conversation/c1') });
    act(() => result.current.open());
    return preview.value;
  };

  const FILE: Tab = { id: 'f', content: '# notes', content_type: 'markdown' };
  const PAGE: Tab = { id: 'p', content: 'https://example.com/', content_type: 'browser' };
  const BLANK: Tab = { id: 'b', content: 'about:blank', content_type: 'browser' };

  it('opens an empty browser tab when there is no browser tab yet', () => {
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

  it('shows the current browser tab instead of opening another one', () => {
    const value = openWith([FILE, PAGE, BLANK], 'p');
    expect(value.revealTab).toHaveBeenCalledWith('p');
    expect(value.openBrowserTab).not.toHaveBeenCalled();
  });

  it('reuses a blank browser tab when the current tab is not a browser', () => {
    const value = openWith([FILE, PAGE, BLANK], 'f');
    expect(value.revealTab).toHaveBeenCalledWith('b');
    expect(value.openBrowserTab).not.toHaveBeenCalled();
  });

  it('opens a new blank tab when only pages are open and the current tab is not a browser', () => {
    const value = openWith([FILE, PAGE], 'f');
    expect(value.openBrowserTab).toHaveBeenCalledWith();
    expect(value.revealTab).not.toHaveBeenCalled();
  });

  it('puts the cursor in the visible address bar only', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    document.body.innerHTML = `
      <div style="visibility: hidden"><input data-browser-address id="hidden" /></div>
      <div><input data-browser-address id="shown" /></div>`;
    focusBrowserAddress();
    expect(document.activeElement?.id).toBe('shown');
  });

  it('stops looking after a while when no address bar shows up', () => {
    const frame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('requestAnimationFrame', frame);
    focusBrowserAddress(5);
    expect(frame).toHaveBeenCalledTimes(5);
  });
});

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Open the in-app browser on purpose (TASK-124), not only from a link, and put
 * the cursor in its address bar. It reuses what is there: the current browser
 * tab, else an existing blank one; a new blank tab only when neither exists.
 * The panel lives in conversations, so the launcher is available there only.
 * Shared by the titlebar button, the sidebar menu and the Ctrl/Cmd+Shift+B shortcut.
 */

import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useOptionalPreviewContext, type PreviewTab } from '../context/PreviewContext';
import { BROWSER_BLANK_URL } from './constants';

/** Marks every browser address bar (iframe, webview and server browser hosts). */
export const BROWSER_ADDRESS_ATTR = 'data-browser-address';

/** Which tab the launcher shows: the current browser tab, else a blank one; `null` = open a new tab. */
export const pickBrowserTab = (tabs: PreviewTab[], activeTabId: string | null): PreviewTab | null => {
  const browserTabs = tabs.filter((tab) => tab.content_type === 'browser');
  return (
    browserTabs.find((tab) => tab.id === activeTabId) ??
    browserTabs.find((tab) => !tab.content || tab.content === BROWSER_BLANK_URL) ??
    null
  );
};

const isShown = (element: HTMLElement) =>
  element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';

/** Focus the visible address bar once the panel has rendered it (a new tab mounts a frame or two later). */
export const focusBrowserAddress = (maxFrames = 60): void => {
  let frame = 0;
  const attempt = () => {
    const input = [...document.querySelectorAll<HTMLElement>(`[${BROWSER_ADDRESS_ATTR}]`)].find(isShown);
    if (input) {
      input.focus();
      return;
    }
    frame += 1;
    if (frame < maxFrames) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
};

/** Ctrl+Shift+B (Cmd+Shift+B on macOS). */
export const isBrowserShortcut = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) =>
  event.key.toLowerCase() === 'b' && event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey);

export const useInAppBrowserLauncher = (): { available: boolean; open: () => void } => {
  const preview = useOptionalPreviewContext();
  const { pathname } = useLocation();
  const available = Boolean(preview) && pathname.startsWith('/conversation/');
  const open = useCallback(() => {
    if (!available || !preview) return;
    const target = pickBrowserTab(preview.tabs, preview.activeTabId);
    if (target) preview.revealTab(target.id);
    else preview.openBrowserTab();
    focusBrowserAddress();
  }, [available, preview]);
  return { available, open };
};

/** Ctrl/Cmd+Shift+B opens the in-app browser wherever it is available (mounted once, in the layout). */
export const useInAppBrowserShortcut = (): void => {
  const { available, open } = useInAppBrowserLauncher();
  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBrowserShortcut(event)) return;
      event.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [available, open]);
};

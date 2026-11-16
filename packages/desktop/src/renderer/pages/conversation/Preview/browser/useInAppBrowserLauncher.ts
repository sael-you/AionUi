/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Open the in-app browser on purpose (TASK-124), not only from a link: a new
 * browser tab with an empty address bar in the preview panel. The panel lives
 * in conversations, so the launcher is available there only. Shared by the
 * titlebar button, the sidebar menu and the Ctrl/Cmd+Shift+B shortcut.
 */

import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useOptionalPreviewContext } from '../context/PreviewContext';

/** Ctrl+Shift+B (Cmd+Shift+B on macOS). */
export const isBrowserShortcut = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) =>
  event.key.toLowerCase() === 'b' && event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey);

export const useInAppBrowserLauncher = (): { available: boolean; open: () => void } => {
  const preview = useOptionalPreviewContext();
  const { pathname } = useLocation();
  const available = Boolean(preview) && pathname.startsWith('/conversation/');
  const open = useCallback(() => {
    if (available) preview?.openBrowserTab();
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

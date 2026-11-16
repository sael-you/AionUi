/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether the panel should use the server browser (C30): only in the WebUI
 * (desktop keeps its webview) and only when AionCore reports it available.
 * Anything else, including a failed status request, keeps the iframe fallback.
 */

import useSWR from 'swr';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type { BrowserInstanceSettings } from '@/common/types/platform/serverBrowser';
import { isElectronDesktop } from '@/renderer/utils/platform';

export const SERVER_BROWSER_STATUS_KEY = 'server-browser.status';
export const SERVER_BROWSER_SETTINGS_KEY = 'server-browser.settings';

export type ServerBrowserProfile = Pick<BrowserInstanceSettings, 'instance' | 'name' | 'color' | 'emoji'>;

export const useServerBrowserAvailability = (): {
  available: boolean;
  profiles: ServerBrowserProfile[];
  /** "Agents may use my Mac browser" AND "Agents can use the browser" (C34). */
  devicesAgentsEnabled: boolean;
} => {
  const web = !isElectronDesktop();
  const { data: status } = useSWR(web ? SERVER_BROWSER_STATUS_KEY : null, () => serverBrowser.getStatus.invoke());
  const { data: settings } = useSWR(web && status?.available ? SERVER_BROWSER_SETTINGS_KEY : null, () =>
    serverBrowser.getSettings.invoke()
  );
  return {
    available: Boolean(web && status?.available),
    profiles: settings?.instances ?? [],
    devicesAgentsEnabled: Boolean(settings?.agents_enabled && settings?.devices_agents_enabled),
  };
};

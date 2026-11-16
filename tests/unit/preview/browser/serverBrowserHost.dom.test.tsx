/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  desktop: false,
  getStatus: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => env.desktop }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  serverBrowser: { getStatus: { invoke: env.getStatus }, getSettings: { invoke: env.getSettings } },
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserViewer', () => ({
  default: ({ url }: { url: string }) => <div data-testid='webview-host'>{url}</div>,
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/server/ServerBrowserView', () => ({
  default: ({ maxInstances, requestedUrl }: { maxInstances: number; requestedUrl?: string }) => (
    <div data-testid='server-browser-host'>{`${maxInstances}|${requestedUrl}`}</div>
  ),
}));

import BrowserTabLayer from '@/renderer/pages/conversation/Preview/browser/BrowserTabLayer';
import type { PreviewTab } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

const tabs = [
  { id: 'b1', type: 'browser', title: 'Discord', content: 'https://discord.com/login' },
  { id: 'b2', type: 'browser', title: 'Example', content: 'https://example.com' },
] as unknown as PreviewTab[];

const renderLayer = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BrowserTabLayer browserTabs={tabs} activeTabId='b2' updateTab={vi.fn()} />
    </SWRConfig>
  );

describe('browser panel host (C30)', () => {
  beforeEach(() => {
    env.desktop = false;
    env.getStatus.mockResolvedValue({ available: true, instances: [], idle_timeout_secs: 900 });
    env.getSettings.mockResolvedValue({ agents_enabled: true, max_instances: 3, max_tabs: 10, instances: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses one server browser view in the WebUI when the server browser is available', async () => {
    renderLayer();
    expect(await screen.findByTestId('server-browser-host')).toHaveTextContent('3|https://example.com');
    expect(screen.queryByTestId('webview-host')).toBeNull();
  });

  it('keeps the per-tab hosts (iframe fallback) when the server browser is unavailable', async () => {
    env.getStatus.mockResolvedValue({ available: false, instances: [], idle_timeout_secs: 900 });
    renderLayer();
    await waitFor(() => expect(env.getStatus).toHaveBeenCalled());
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
    expect(screen.queryByTestId('server-browser-host')).toBeNull();
    expect(env.getSettings).not.toHaveBeenCalled();
  });

  it('never asks for the server browser on desktop', async () => {
    env.desktop = true;
    renderLayer();
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
    expect(env.getStatus).not.toHaveBeenCalled();
  });

  it('falls back to the iframe hosts when the status request fails', async () => {
    env.getStatus.mockRejectedValue(new Error('offline'));
    renderLayer();
    await waitFor(() => expect(env.getStatus).toHaveBeenCalled());
    expect(screen.getAllByTestId('webview-host')).toHaveLength(2);
  });
});

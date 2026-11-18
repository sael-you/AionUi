/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en-US' } }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ openPreview: () => {} }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    project: {
      get: {
        invoke: async () => ({ project_id: 'p1', name: 'P', explorer: { workspace_pe_id: '', entries: [] } }),
      },
    },
    board: { get: { invoke: () => new Promise(() => {}) }, changed: { on: () => () => {} } },
    realtime: { reconnected: { on: () => () => {} } },
  },
}));
const reloadContext = vi.fn(async (_id: string) => {});
vi.mock('@/renderer/pages/conversation/explorer/context/useContextReport', () => ({
  reloadConversationContext: (id: string) => reloadContext(id),
}));
vi.mock('@/renderer/pages/conversation/explorer/context/ContextPanel', () => ({
  default: ({ conversationId }: { conversationId: string | null }) => (
    <div data-testid='context-panel'>{conversationId}</div>
  ),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Popover: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import { useProjectPanelCollapse } from '@/renderer/hooks/ui/useProjectPanelCollapse';
import {
  requestContextTab,
  resetContextPanelStoreForTest,
} from '@/renderer/pages/conversation/explorer/context/contextPanelStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { ExplorerContainer } from '@/renderer/pages/conversation/explorer/ExplorerContainer';
import { resetExplorerStoreForTest } from '@/renderer/pages/conversation/explorer/explorerStore';

// The tab bar appears once the project detail has loaded.
const renderContainer = async () => {
  mount();
  await screen.findByText('conversation.explorer.tabs.files');
};

const mount = () =>
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ExplorerContainer projectId='p1' />
      </SWRConfig>
    </MemoryRouter>
  );

beforeEach(() => {
  resetExplorerStoreForTest();
  resetContextPanelStoreForTest();
  resetCurrentConversationForTest();
  reloadContext.mockClear();
  localStorage.clear();
});
afterEach(() => cleanup());

describe('Context tab in the project panel', () => {
  it('is offered only while a conversation is active, and shows that conversation', async () => {
    await renderContainer();
    expect(screen.queryByText('conversation.explorer.tabs.context')).not.toBeInTheDocument();

    act(() => setCurrentConversation('c1'));
    const tab = screen.getByText('conversation.explorer.tabs.context');
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByTestId('context-panel')).toHaveTextContent('c1');

    // Leaving the conversation falls back to Files instead of an empty tab.
    act(() => setCurrentConversation(null));
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
  });

  it('opens on a request from the ring, again after the owner moved to another tab', async () => {
    act(() => setCurrentConversation('c1'));
    await renderContainer();
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();

    act(() => requestContextTab());
    expect(screen.getByTestId('context-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('conversation.explorer.tabs.changes'));
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
    act(() => requestContextTab());
    expect(screen.getByTestId('context-panel')).toBeInTheDocument();
  });

  it('does not steal the tab on a later mount because of an old request', async () => {
    act(() => setCurrentConversation('c1'));
    act(() => requestContextTab());
    await renderContainer();
    expect(screen.queryByTestId('context-panel')).not.toBeInTheDocument();
  });

  it('refreshes the report from the tab bar', async () => {
    act(() => setCurrentConversation('c1'));
    await renderContainer();
    act(() => requestContextTab());
    await act(async () => {
      fireEvent.click(screen.getByLabelText('conversation.context.refresh'));
    });
    expect(reloadContext).toHaveBeenCalledWith('c1');
  });
});

describe('useProjectPanelCollapse and the Context tab request', () => {
  it('opens a collapsed desktop column on a new request and remembers it', () => {
    localStorage.setItem('project-panel-collapse:p1', 'collapsed');
    const { result } = renderHook(() => useProjectPanelCollapse({ projectId: 'p1', isMobile: false, active: true }));
    expect(result.current.collapsed).toBe(true);
    act(() => requestContextTab());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem('project-panel-collapse:p1')).toBe('expanded');
  });

  it('ignores a request made before it mounted, on mobile, and without a live host', () => {
    localStorage.setItem('project-panel-collapse:p1', 'collapsed');
    act(() => requestContextTab());
    const old = renderHook(() => useProjectPanelCollapse({ projectId: 'p1', isMobile: false, active: true }));
    expect(old.result.current.collapsed).toBe(true);

    const mobile = renderHook(() => useProjectPanelCollapse({ projectId: 'p1', isMobile: true, active: true }));
    const inactive = renderHook(() => useProjectPanelCollapse({ projectId: 'p1', isMobile: false, active: false }));
    act(() => requestContextTab());
    expect(mobile.result.current.collapsed).toBe(true);
    expect(inactive.result.current.collapsed).toBe(true);
  });
});

describe('ContextUsageIndicator as the way in', () => {
  it('is a labelled button that opens the panel by click and by keyboard', () => {
    const onClick = vi.fn();
    render(<ContextUsageIndicator tokenUsage={{ total_tokens: 100 }} context_limit={1000} onClick={onClick} />);
    const ring = screen.getByRole('button', { name: 'conversation.context.open' });
    fireEvent.click(ring);
    fireEvent.keyDown(ring, { key: 'Enter' });
    fireEvent.keyDown(ring, { key: ' ' });
    fireEvent.keyDown(ring, { key: 'a' });
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('stays a plain readout without a handler', () => {
    render(<ContextUsageIndicator tokenUsage={{ total_tokens: 100 }} context_limit={1000} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

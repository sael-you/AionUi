/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The conversation route publishes the project colour identity (sidebar group,
 * mobile titlebar, file panel) synchronously from the list snapshot on a
 * switch, so the previous project never shows while the new conversation's
 * request is pending; the fetched identity is applied only for the routed id.
 */

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/config/storage';

let currentId = 'c1';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: currentId }), useNavigate: () => vi.fn() }));
vi.mock('@/renderer/pages/conversation/components/ChatConversation', () => ({
  default: () => <div data-testid='chat' />,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ closePreviewIfScopeChanged: vi.fn() }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({ useAutoTitle: () => ({ syncTitleFromHistory: vi.fn() }) }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { listChanged: { on: () => () => {} } } } }));

const pending = new Map<string, (value: TChatConversation | null) => void>();
const responses = new Map<string, TChatConversation>();
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: (id: string) =>
    responses.has(id)
      ? Promise.resolve(responses.get(id)!)
      : new Promise<TChatConversation | null>((resolve) => pending.set(id, resolve)),
}));

import ChatConversationIndex from '@/renderer/pages/conversation/index';
import {
  getCurrentProjectIdentity,
  resetCurrentProjectIdentityForTest,
} from '@/renderer/components/workspace/ProjectIdentity/currentProjectIdentityStore';
import { setConversationSnapshotForTest } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

const row = (id: string, workspace: string, project_id: string): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    project_id,
    extra: { workspace, custom_workspace: true },
  }) as unknown as TChatConversation;

const C1 = row('c1', '/root/projects/alpha', 'p1');
const C2 = row('c2', '/root/projects/beta', 'p2');

const tree = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ChatConversationIndex />
  </SWRConfig>
);

const switchTo = (view: ReturnType<typeof render>, id: string) => {
  currentId = id;
  view.rerender(tree());
};

beforeEach(() => {
  resetCurrentProjectIdentityForTest();
  pending.clear();
  responses.clear();
  responses.set('c1', C1);
  currentId = 'c1';
  setConversationSnapshotForTest([C1, C2]);
});

afterEach(() => {
  cleanup();
  setConversationSnapshotForTest([]);
});

describe('conversation route — project identity on switch', () => {
  it('shows the new project at once while its conversation request is pending', async () => {
    const view = render(tree());
    await act(async () => {});
    expect(getCurrentProjectIdentity()).toEqual({ projectId: 'p1', workspace: '/root/projects/alpha' });

    switchTo(view, 'c2'); // c2's request never resolves in this test
    expect(pending.has('c2')).toBe(true);
    expect(getCurrentProjectIdentity()).toEqual({ projectId: 'p2', workspace: '/root/projects/beta' });
  });

  it('clears the identity for a conversation not in the snapshot — never the previous project', async () => {
    const view = render(tree());
    await act(async () => {});
    switchTo(view, 'c-new');
    expect(getCurrentProjectIdentity()).toBeNull();

    // Once its request lands, the fetched identity is published.
    await act(async () => {
      pending.get('c-new')?.(row('c-new', '/root/projects/gamma', 'p3'));
    });
    expect(getCurrentProjectIdentity()).toEqual({ projectId: 'p3', workspace: '/root/projects/gamma' });
  });

  it('clears the identity when leaving the conversation route', async () => {
    const view = render(tree());
    await act(async () => {});
    expect(getCurrentProjectIdentity()).not.toBeNull();
    view.unmount();
    expect(getCurrentProjectIdentity()).toBeNull();
  });

  it('ignores a response that is not for the routed conversation', async () => {
    const view = render(tree());
    await act(async () => {});
    switchTo(view, 'c2');
    await act(async () => {
      pending.get('c2')?.(C1); // a stale payload for the previous id
    });
    expect(getCurrentProjectIdentity()).toEqual({ projectId: 'p2', workspace: '/root/projects/beta' });
  });
});

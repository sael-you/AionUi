/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({ ipcBridge: { realtime: { reconnected: { on: () => () => {} } } } }));

import { parseStoredStack, quoteStackStore } from '@/renderer/components/chat/SendBox/quoteStack';
import { getSendBoxDraftHook, resetSendBoxDraftsForTests } from '@/renderer/hooks/chat/useSendBoxDraft';
import { useUnsentMessage } from '@/renderer/pages/conversation/platforms/useUnsentMessage';
import {
  OFFLINE_DRAFT_TTL_MS,
  adoptOfflineOwner,
  getOfflineOwner,
  isOfflineDraftExpired,
  resetOfflineOwnerForTests,
} from '@/renderer/services/pendingUploads/offlineOwner';
import { pendingUploadStore } from '@/renderer/services/pendingUploads/pendingUploadStore';

const useAcpDraft = getSendBoxDraftHook('acp', { _type: 'acp', atPath: [], content: '', uploadFile: [] });
const page = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);
const draftOf = (id = 'c1') => renderHook(() => useAcpDraft(id), { wrapper: page });
const keysWith = (prefix: string) => Object.keys(window.localStorage).filter((key) => key.startsWith(prefix));
const QUOTE = { id: 'q', messageId: 'm', position: 'left', content: 'quoted', reply: '' } as const;

/** Everything a signed-in user can leave in the browser for conversation c1. */
const leaveDrafts = async () => {
  const draft = draftOf();
  act(() => draft.result.current.mutate((value) => ({ ...value, content: 'secret draft' })));
  await waitFor(() => expect(keysWith('aionui.sendBoxDraft.')).toHaveLength(1));
  draft.unmount();
  quoteStackStore.set('c1', [QUOTE]);
  const unsent = renderHook(() => useUnsentMessage({ conversation_id: 'c1', content: '', resend: vi.fn() }), {
    wrapper: page,
  });
  act(() => unsent.result.current.remember({ input: 'not sent', files: [], draftText: 'not sent' }));
  unsent.unmount();
  await pendingUploadStore.save('c1', new File(['x'], 'a.png', { type: 'image/png' }));
};

describe('composer state kept in the browser: per user, 14 days, cleared on logout (TASK-127 review)', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    resetOfflineOwnerForTests(null);
    adoptOfflineOwner(null);
    resetSendBoxDraftsForTests();
    quoteStackStore.resetForTests();
    await pendingUploadStore.clearAll();
  });

  it('keys every store by the signed-in user', async () => {
    adoptOfflineOwner('alice');
    await leaveDrafts();
    expect(keysWith('aionui.sendBoxDraft.alice.')).toHaveLength(1);
    expect(keysWith('aionui.unsentMessage.alice.')).toHaveLength(1);
    expect(keysWith('aionui.quoteStack.alice.')).toHaveLength(1);
    expect(await pendingUploadStore.list('c1')).toEqual([expect.objectContaining({ owner: 'alice' })]);
  });

  it('a different user signing in clears what the previous one left, in storage and in memory', async () => {
    adoptOfflineOwner('alice');
    await leaveDrafts();

    adoptOfflineOwner('bob');
    expect(getOfflineOwner()).toBe('bob');
    expect(keysWith('aionui.sendBoxDraft.')).toEqual([]);
    expect(keysWith('aionui.unsentMessage.')).toEqual([]);
    expect(keysWith('aionui.quoteStack.')).toEqual([]);
    expect(quoteStackStore.get('c1')).toEqual([]);
    expect(await pendingUploadStore.list('c1')).toEqual([]);
    const bobDraft = draftOf();
    await waitFor(() => expect(bobDraft.result.current.data).toBeUndefined());
  });

  it('the same user signing in again keeps the drafts', async () => {
    adoptOfflineOwner('alice');
    await leaveDrafts();
    adoptOfflineOwner('alice');
    expect(keysWith('aionui.sendBoxDraft.alice.')).toHaveLength(1);
    expect(await pendingUploadStore.list('c1')).toHaveLength(1);
  });

  it('logout clears everything and stops writing until the next sign-in', async () => {
    adoptOfflineOwner('alice');
    await leaveDrafts();

    adoptOfflineOwner(null);
    expect(getOfflineOwner()).toBeNull();
    expect(keysWith('aionui.')).toEqual([]);
    expect(await pendingUploadStore.list('c1')).toEqual([]);

    quoteStackStore.set('c1', [QUOTE]);
    expect(keysWith('aionui.quoteStack.')).toEqual([]);
  });

  it('drops anything saved more than 14 days ago', async () => {
    const now = Date.now();
    expect(isOfflineDraftExpired(now - OFFLINE_DRAFT_TTL_MS + 1000, now)).toBe(false);
    expect(isOfflineDraftExpired(now - OFFLINE_DRAFT_TTL_MS - 1000, now)).toBe(true);
    expect(isOfflineDraftExpired(undefined, now)).toBe(true);

    adoptOfflineOwner('alice');
    const old = now - OFFLINE_DRAFT_TTL_MS - 60_000;
    window.localStorage.setItem(
      'aionui.sendBoxDraft.alice.acp.c1',
      JSON.stringify({ v: 1, savedAt: old, draft: { _type: 'acp', content: 'stale', atPath: [], uploadFile: [] } })
    );
    window.localStorage.setItem(
      'aionui.unsentMessage.alice.c1',
      JSON.stringify({ key: 'k', input: 'stale', files: [], draftText: 'stale', savedAt: old })
    );
    const draft = draftOf();
    await waitFor(() => expect(draft.result.current.data).toBeUndefined());
    expect(window.localStorage.getItem('aionui.sendBoxDraft.alice.acp.c1')).toBeNull();

    const unsent = renderHook(() => useUnsentMessage({ conversation_id: 'c1', content: '', resend: vi.fn() }), {
      wrapper: page,
    });
    expect(unsent.result.current.unsent).toBeNull();
    expect(window.localStorage.getItem('aionui.unsentMessage.alice.c1')).toBeNull();

    expect(parseStoredStack(JSON.stringify({ savedAt: old, items: [QUOTE] }))).toEqual([]);
    expect(parseStoredStack(JSON.stringify({ savedAt: now, items: [QUOTE] }))).toEqual([QUOTE]);

    vi.spyOn(Date, 'now').mockReturnValue(old);
    await pendingUploadStore.save('c1', new File(['x'], 'old.png', { type: 'image/png' }));
    vi.restoreAllMocks();
    expect(await pendingUploadStore.list('c1')).toEqual([]);
  });

  it('keeps nothing on disk while no user is known', async () => {
    adoptOfflineOwner(null);
    const draft = draftOf();
    act(() => draft.result.current.mutate((value) => ({ ...value, content: 'typed before sign-in' })));
    quoteStackStore.set('c1', [QUOTE]);
    await pendingUploadStore.save('c1', new File(['x'], 'a.png', { type: 'image/png' }));
    // Held in memory for this page only (no user to own it on disk).
    expect(quoteStackStore.get('c1')).toEqual([QUOTE]);
    expect(await pendingUploadStore.list('c1')).toEqual([expect.objectContaining({ owner: '' })]);
    expect(keysWith('aionui.')).toEqual([]);
  });
});

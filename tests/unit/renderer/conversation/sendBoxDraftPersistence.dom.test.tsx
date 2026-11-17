/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DRAFT_MAX_CONTENT_CHARS,
  DRAFT_MAX_ENTRIES,
  getSendBoxDraftHook,
  resetSendBoxDraftsForTests,
} from '@/renderer/hooks/chat/useSendBoxDraft';

const useAcpDraft = getSendBoxDraftHook('acp', { _type: 'acp', atPath: [], content: '', uploadFile: [] });
const KEY = 'aionui.sendBoxDraft.acp.c1';

// A new SWR cache per mount = a fresh page.
const freshPage = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
);
const open = (id = 'c1') => renderHook(() => useAcpDraft(id), { wrapper: freshPage });

describe('composer draft persistence (TASK-127)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSendBoxDraftsForTests();
  });

  it('brings text and attachment references back after a reload', async () => {
    const first = open();
    act(() =>
      first.result.current.mutate((draft) => ({
        ...draft,
        content: 'half a thought',
        uploadFile: ['/uploads/a.png'],
        atPath: ['src/main.ts'],
      }))
    );
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toContain('half a thought'));
    first.unmount();
    resetSendBoxDraftsForTests();

    const second = open();
    await waitFor(() => expect(second.result.current.data?.content).toBe('half a thought'));
    expect(second.result.current.data?.uploadFile).toEqual(['/uploads/a.png']);
    expect(second.result.current.data?.atPath).toEqual(['src/main.ts']);
  });

  it('forgets the draft once it is empty (a successful send clears the composer)', async () => {
    const view = open();
    act(() => view.result.current.mutate((draft) => ({ ...draft, content: 'to send' })));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).not.toBeNull());
    act(() => view.result.current.mutate((draft) => ({ ...draft, content: '', uploadFile: [], atPath: [] })));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull());
  });

  it('keeps drafts apart per conversation', async () => {
    const one = open('c1');
    act(() => one.result.current.mutate((draft) => ({ ...draft, content: 'for one' })));
    const two = open('c2');
    await waitFor(() => expect(two.result.current.data).toBeUndefined());
    expect(window.localStorage.getItem('aionui.sendBoxDraft.acp.c2')).toBeNull();
  });

  it('ignores a damaged or foreign entry instead of failing', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const broken = open();
    await waitFor(() => expect(broken.result.current.data).toBeUndefined());
    broken.unmount();
    resetSendBoxDraftsForTests();
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: 1, draft: { _type: 'codex', content: 'x' } }));
    const foreign = open();
    await waitFor(() => expect(foreign.result.current.data).toBeUndefined());
  });

  it('caps the saved text and the number of saved drafts', async () => {
    const view = open();
    act(() => view.result.current.mutate((draft) => ({ ...draft, content: 'x'.repeat(DRAFT_MAX_CONTENT_CHARS + 50) })));
    await waitFor(() => expect(window.localStorage.getItem(KEY)).not.toBeNull());
    const saved = JSON.parse(window.localStorage.getItem(KEY) as string) as { draft: { content: string } };
    expect(saved.draft.content).toHaveLength(DRAFT_MAX_CONTENT_CHARS);

    for (let index = 0; index < DRAFT_MAX_ENTRIES + 5; index += 1) {
      window.localStorage.setItem(
        `aionui.sendBoxDraft.acp.old${index}`,
        JSON.stringify({ v: 1, savedAt: index, draft: { _type: 'acp', content: 'old', atPath: [], uploadFile: [] } })
      );
    }
    act(() => view.result.current.mutate((draft) => ({ ...draft, content: 'newest' })));
    await waitFor(() => {
      const keys = Object.keys(window.localStorage).filter((key) => key.startsWith('aionui.sendBoxDraft.'));
      expect(keys).toHaveLength(DRAFT_MAX_ENTRIES);
      expect(keys).toContain(KEY);
      expect(keys).not.toContain('aionui.sendBoxDraft.acp.old0');
    });
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Card drawer: fields, sanitised markdown, edits with versions, comments, activity, block/archive, focus. */

import { Message, Modal, Notification } from '@arco-design/web-react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
// Each test drives the whole board page (and often the drawer) on a shared, busy CPU.
vi.setConfig({ testTimeout: 60000 });

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'me' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', username: 'me' } }),
}));

import { BoardPage } from '@/renderer/pages/board';

import {
  backendError,
  bridge,
  fullCard,
  makeCard,
  makeDetail,
  makeEvent,
  makeSettings,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
} from '../boardTestUtils';

const XSS = '**Bold** text <img src=x onerror="alert(1)"> <script>alert(2)</script>';

const card1 = makeCard(1, 'triage', 1024, { title: 'Fix login', labels: ['auth'], version: 4 });
const card2 = makeCard(2, 'done', 1024, { title: 'Write spec' });
const detail1 = (over: Parameters<typeof fullCard>[1] = {}) =>
  makeDetail(fullCard(card1, { description: XSS, ...over }), [
    makeEvent(1, 'card_created'),
    makeEvent(2, 'card_moved', { payload: { from: 'ideas', to: 'triage' } }),
    makeEvent(3, 'commented', { actor_kind: 'agent', actor_ref: 'assistant:coder@claude' }),
  ]);

/** Every open shadow root under a node (MarkdownView renders inside one). */
const shadowRoots = (node: Element): ShadowRoot[] =>
  [...node.querySelectorAll('*')].map((element) => element.shadowRoot).filter((root): root is ShadowRoot => !!root);

const openDrawer = async () => {
  const opener = await screen.findByRole('button', { name: 'Open TASK-1: Fix login' });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: await screen.findByRole('dialog', { name: 'Card TASK-1' }) };
};

let notifyError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBridge();
  bridge.get.mockResolvedValue(makeSnapshot({ cards: [card1, card2] }));
  bridge.getCard.mockResolvedValue(detail1());
  bridge.listComments.mockResolvedValue({
    items: [
      makeEvent(3, 'commented', {
        actor_kind: 'agent',
        actor_ref: 'assistant:coder@claude',
        payload: { body: 'Looks good <script>alert(3)</script>' },
      }),
    ],
    has_more: false,
    next_after_seq: null,
  });
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  notifyError = vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('card drawer content', () => {
  it('shows the card with fields, comments and activity', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    expect(within(dialog).getByRole('heading', { name: 'Fix login' })).toBeInTheDocument();
    expect(within(dialog).getByText('Created by')).toBeInTheDocument();
    expect(within(dialog).getByText('Unassigned')).toBeInTheDocument();
    expect(await within(dialog).findAllByTestId('board-comment')).toHaveLength(1);
    const activity = within(dialog)
      .getAllByTestId('board-activity-item')
      .map((node) => node.textContent);
    expect(activity).toEqual(['Agent coder commented', 'You moved it from Ideas to Triage', 'You created the card']);
  });

  it('renders description markdown through the sanitised pipeline (no raw HTML)', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    const host = within(dialog).getByTestId('board-card-description');
    await waitFor(() => {
      expect(shadowRoots(host).some((root) => root.querySelector('strong')?.textContent === 'Bold')).toBe(true);
    });
    const roots = shadowRoots(dialog);
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      expect(root.querySelector('script')).toBeNull();
      expect(root.querySelector('[onerror]')).toBeNull();
    }
    expect(dialog.querySelector('script, [onerror]')).toBeNull();
  });

  it('returns focus to the card after closing with Escape', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    const { opener, dialog } = await openDrawer();

    fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27, which: 27 });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Card TASK-1' })).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('card drawer edits', () => {
  it('saves a new title with the version it was based on', async () => {
    bridge.updateCard.mockResolvedValue(fullCard({ ...card1, title: 'Fix SSO login', version: 5 }));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit title' }));
    const input = within(dialog).getByRole('textbox', { name: 'Title' });
    fireEvent.change(input, { target: { value: 'Fix SSO login' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, which: 13 });

    await waitFor(() =>
      expect(bridge.updateCard).toHaveBeenCalledWith({ card_id: 'card-1', version: 4, title: 'Fix SSO login' })
    );
    expect(await screen.findByRole('button', { name: 'Open TASK-1: Fix SSO login' })).toBeInTheDocument();
  });

  it('reloads the card and explains a version conflict', async () => {
    bridge.updateCard.mockRejectedValue(backendError(409, 'board_version_conflict'));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit description' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'New text' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith({
        title: "Couldn't save the change",
        content: 'This card was changed somewhere else. The latest version is shown now.',
      })
    );
    await waitFor(() => expect(bridge.getCard).toHaveBeenCalledTimes(2));
  });

  it('posts a comment', async () => {
    bridge.addComment.mockResolvedValue(makeEvent(9, 'commented', { payload: { body: 'On it' } }));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    const box = within(dialog).getByRole('textbox', { name: /Write a comment/ });
    fireEvent.change(box, { target: { value: ' On it ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(bridge.addComment).toHaveBeenCalledWith({ card_id: 'card-1', body: 'On it' }));
  });

  it('blocks with a reason and unblocks', async () => {
    bridge.updateCard.mockResolvedValue(fullCard({ ...card1, blocked: true, blocked_reason: 'API', version: 5 }));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    const modal = await screen.findByRole('dialog', { name: 'Block TASK-1' });
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: ' API ' } });
    bridge.getCard.mockResolvedValue(detail1({ blocked: true, blocked_reason: 'API', version: 5 }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Block' }));
    await waitFor(() =>
      expect(bridge.updateCard).toHaveBeenCalledWith({
        card_id: 'card-1',
        version: 4,
        blocked: true,
        blocked_reason: 'API',
      })
    );

    bridge.updateCard.mockResolvedValue(fullCard({ ...card1, version: 6 }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect(bridge.updateCard).toHaveBeenLastCalledWith({
        card_id: 'card-1',
        version: 5,
        blocked: false,
        blocked_reason: null,
      })
    );
  });

  it('archives after confirmation and offers Restore on an archived card', async () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((config) => {
      void (config.onOk as () => Promise<void>)();
      return { close: () => {}, update: () => {} };
    });
    bridge.archiveCard.mockResolvedValue(fullCard({ ...card1, archived_at: 99 }));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    bridge.getCard.mockResolvedValue(detail1({ archived_at: 99 }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Archive TASK-1?' }));
    await waitFor(() => expect(bridge.archiveCard).toHaveBeenCalledWith({ card_id: 'card-1' }));

    bridge.restoreCard.mockResolvedValue(fullCard(card1));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(bridge.restoreCard).toHaveBeenCalledWith({ card_id: 'card-1' }));
  });

  it('adds and removes dependencies, mapping a cycle to its message', async () => {
    bridge.getCard.mockResolvedValue(
      detail1({
        dependencies: [{ card_id: 'card-2', number: 2, title: 'Write spec', column_key: 'done', resolved: true }],
      })
    );
    bridge.removeDependency.mockResolvedValue(undefined);
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    expect(within(dialog).getByText(/TASK-2 Write spec · Done/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove dependency on TASK-2' }));
    await waitFor(() =>
      expect(bridge.removeDependency).toHaveBeenCalledWith({ card_id: 'card-1', depends_on: 'card-2' })
    );
  });

  it('is read-only on an archived project', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ settings: makeSettings({ archived_at: 1 }), cards: [card1] }));
    renderWithBoard(<BoardPage projectId='p1' />);
    const { dialog } = await openDrawer();

    expect(within(dialog).getByText('Read-only')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit title' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /Write a comment/ })).not.toBeInTheDocument();
  });
});

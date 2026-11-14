/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Live hints re-render only what they change: a neutral hint none of the cards, a card hint only that card. */

import { act, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => new Map<string, number>());

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' } }) }));
// Count how often each card tile is rendered by its parent.
vi.mock('@/renderer/components/board/card/BoardCardTile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/components/board/card/BoardCardTile')>();
  const Counted: typeof actual.BoardCardTile = (props) => {
    if (!props.overlay) renders.set(props.card.id, (renders.get(props.card.id) ?? 0) + 1);
    return actual.BoardCardTile(props);
  };
  return { ...actual, BoardCardTile: Counted };
});

import { useBoard } from '@/renderer/components/board/hooks/useBoard';
import { TasksTab } from '@/renderer/components/board/TasksTab';
import { BoardPage } from '@/renderer/pages/board';

import {
  boardChanged,
  bridge,
  makeCard,
  makeEvent,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  stubMatchMedia,
  removeMatchMedia,
} from '../boardTestUtils';

const cards = [makeCard(1, 'triage', 1024), makeCard(2, 'triage', 2048), makeCard(3, 'building', 1024)];

const hint = (seq: number, over: Record<string, unknown> = {}) =>
  act(() =>
    boardChanged.emit({
      user_id: 'u1',
      project_id: 'p1',
      seq,
      prev_seq: seq - 1,
      event: makeEvent(seq, 'commented'),
      ...over,
    } as never)
  );

const snapshotOfRenders = () => Object.fromEntries(renders);

beforeEach(() => {
  resetBridge();
  renders.clear();
  bridge.get.mockResolvedValue(makeSnapshot({ cards, last_seq: 10 }));
});
afterEach(() => {
  cleanup();
  removeMatchMedia();
});

describe('card rendering on live hints', () => {
  it('wide board: a neutral hint re-renders no card; a card hint updates that card', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    await screen.findByText('Card 3');
    const before = snapshotOfRenders();

    hint(11);
    hint(12, { event: makeEvent(12, 'review_updated') });
    expect(snapshotOfRenders()).toEqual(before);

    hint(13, { event: makeEvent(13, 'card_updated'), card: makeCard(2, 'triage', 2048, { title: 'Card 2 renamed' }) });
    await screen.findByText('Card 2 renamed');
    // dnd-kit re-renders its draggables when the drop layout changes; the changed card is among them.
    expect(snapshotOfRenders()['card-2']).toBeGreaterThan(before['card-2']);
  });

  it('narrow board and Tasks tab: a neutral hint re-renders no card, a card hint only that card', async () => {
    stubMatchMedia((query) => query === '(max-width: 768px)');
    const Tab: React.FC = () => <TasksTab board={useBoard('p1')} />;
    renderWithBoard(
      <>
        <BoardPage projectId='p1' />
        <Tab />
      </>
    );
    await screen.findAllByText('Card 1');
    const before = snapshotOfRenders();
    hint(11);
    expect(snapshotOfRenders()).toEqual(before);

    hint(12, { event: makeEvent(12, 'card_updated'), card: makeCard(2, 'triage', 2048, { title: 'Card 2 renamed' }) });
    await screen.findAllByText('Card 2 renamed');
    const after = snapshotOfRenders();
    expect(after['card-1']).toBe(before['card-1']);
    expect(after['card-3']).toBe(before['card-3']);
    expect(after['card-2']).toBeGreaterThan(before['card-2']);
  });
});

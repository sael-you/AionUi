/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Tasks tab (project panel): stacked columns, chips, quick add, Move to…, drawer, open full board, states. */

import { Message, Notification } from '@arco-design/web-react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);

import { useBoard } from '@/renderer/components/board/hooks/useBoard';
import { TasksTab } from '@/renderer/components/board/TasksTab';

import {
  bridge,
  fullCard,
  makeCard,
  makeDetail,
  makeSettings,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  flowColumns,
} from '../boardTestUtils';

const Harness: React.FC = () => {
  const board = useBoard('p1');
  return <TasksTab board={board} />;
};

const renderTab = () =>
  renderWithBoard(
    <Routes>
      <Route path='/' element={<Harness />} />
      <Route path='/board/:projectId' element={<div>full board page</div>} />
    </Routes>
  );

beforeEach(() => {
  resetBridge();
  bridge.get.mockResolvedValue(
    makeSnapshot({
      columns: flowColumns({ building: { wip_limit: 1 } }),
      cards: [
        makeCard(1, 'triage', 1024, { title: 'Fix login' }),
        makeCard(2, 'triage', 2048, { title: 'Dark mode' }),
        makeCard(3, 'building', 1024, { title: 'API' }),
        makeCard(4, 'done', 1024, { title: 'Ship v1' }),
      ],
    })
  );
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Tasks tab', () => {
  it('stacks the columns with counts; Done starts collapsed', async () => {
    renderTab();
    expect(await screen.findByText('Shared by this project')).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Columns' });
    expect(within(chips).getByRole('button', { name: 'Triage, 2 cards' })).toBeInTheDocument();

    expect(screen.getByText('Fix login')).toBeInTheDocument();
    expect(screen.queryByText('Ship v1')).not.toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Expand Done' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(screen.getByText('Ship v1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Done' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('expands a collapsed column from its chip', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Done, 1 card' }));
    expect(await screen.findByText('Ship v1')).toBeInTheDocument();
  });

  it('opens the full board', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Open full board' }));
    expect(await screen.findByText('full board page')).toBeInTheDocument();
  });

  it('moves a card with "Move to…" (no drag in the narrow panel)', async () => {
    bridge.moveCard.mockResolvedValue(fullCard(makeCard(1, 'building', 2048, { title: 'Fix login' })));
    renderTab();
    expect(screen.queryByRole('button', { name: /^Move TASK-/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for TASK-1' }));

    const current = await screen.findByRole('menuitem', { name: 'Triage (current)' });
    expect(current).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Building (full)' }));

    await waitFor(() =>
      expect(bridge.moveCard).toHaveBeenCalledWith({
        card_id: 'card-1',
        to_column: 'building',
        after_id: 'card-3',
        expected_column: 'triage',
      })
    );
  });

  it('opens the card drawer from a card', async () => {
    bridge.getCard.mockResolvedValue(makeDetail(fullCard(makeCard(1, 'triage', 1024, { title: 'Fix login' }))));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-1: Fix login' }));
    expect(await screen.findByRole('dialog', { name: 'Card TASK-1' })).toBeInTheDocument();
  });

  it('offers "Turn on the board" when the board is off and empty', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ settings: makeSettings({ enabled: false, version: 0 }), columns: [] }));
    renderTab();
    expect(await screen.findByRole('heading', { name: 'Turn on the board' })).toBeInTheDocument();
  });

  it('shows the error state with a retry', async () => {
    bridge.get.mockRejectedValueOnce(new Error('boom'));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fix login')).toBeInTheDocument();
  });
});

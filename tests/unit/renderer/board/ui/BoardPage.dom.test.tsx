/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Board page: every state, columns + WIP, filters, archived toggle, column settings, virtualisation. */

import { Message, Notification } from '@arco-design/web-react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  makeCard,
  makeSettings,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  flowColumns,
} from '../boardTestUtils';

const renderPage = () => renderWithBoard(<BoardPage projectId='p1' />);
const region = (name: RegExp) => screen.getByRole('region', { name });

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
};

beforeEach(() => {
  resetBridge();
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setOnline(true);
});

describe('board page states', () => {
  it('shows a skeleton while the first snapshot loads', () => {
    bridge.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading the board…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the error state and retries', async () => {
    bridge.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPage();

    expect(await screen.findByText("Couldn't load the board")).toBeInTheDocument();
    expect(screen.getByText(/Can't reach AionUi/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: /^Ideas/ })).toBeInTheDocument();
  });

  it('shows "not found" for a project without a board', async () => {
    bridge.get.mockRejectedValue(backendError(404, 'board_not_found'));
    renderPage();
    expect(await screen.findByText('Board not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to chats' })).toBeInTheDocument();
  });

  it('offers "Turn on the board" with the department flow when the board is off and empty', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ settings: makeSettings({ enabled: false, version: 0 }), columns: [] }));
    bridge.updateSettings.mockResolvedValue(makeSettings());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Turn on the board' })).toBeInTheDocument();
    expect(screen.getByText('Department flow')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on the board' }));

    await waitFor(() =>
      expect(bridge.updateSettings).toHaveBeenCalledWith({
        project_id: 'p1',
        version: 0,
        enabled: true,
        template: 'studio',
      })
    );
  });

  it('keeps an off board with cards usable and offers to turn it on', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({ settings: makeSettings({ enabled: false }), cards: [makeCard(1, 'triage', 1)] })
    );
    renderPage();
    expect(await screen.findByText(/The board is off/)).toBeInTheDocument();
    expect(within(region(/^Triage/)).getByText('Card 1')).toBeInTheDocument();
  });

  it('is read-only for an archived project and can be reactivated', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({ settings: makeSettings({ archived_at: 5 }), cards: [makeCard(1, 'triage', 1)] })
    );
    bridge.unarchiveProject.mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByText('Read-only board')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move TASK-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Add a card to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Column settings' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate board' }));
    await waitFor(() => expect(bridge.unarchiveProject).toHaveBeenCalledWith({ project_id: 'p1' }));
  });

  it('shows the offline banner', async () => {
    renderPage();
    await screen.findByRole('region', { name: /^Ideas/ });
    setOnline(false);
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  });

  it('shows the empty board and empty columns', async () => {
    renderPage();
    expect(await screen.findByText('No cards yet. Add the first one to get started.')).toBeInTheDocument();
    expect(within(region(/^Done/)).getByText('No cards')).toBeInTheDocument();
  });
});

describe('board columns', () => {
  it('lays columns out in order with their names, counts and WIP state (text + icon)', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({
        columns: flowColumns({ building: { wip_limit: 2, name: 'Doing' }, triage: { wip_limit: 3 } }),
        cards: [makeCard(1, 'building', 1), makeCard(2, 'building', 2), makeCard(3, 'triage', 1)],
      })
    );
    renderPage();

    const regions = await screen.findAllByRole('region');
    expect(regions.map((node) => node.getAttribute('aria-label'))).toEqual([
      'Ideas, 0 cards',
      'Triage, 1 card',
      'Doing, 2 cards',
      'Done, 0 cards',
    ]);
    expect(within(region(/^Doing/)).getByLabelText('2 of 2 cards, work-in-progress limit, Full')).toHaveTextContent(
      '2/2 Full'
    );
    expect(within(region(/^Triage/)).getByLabelText('1 of 3 cards, work-in-progress limit')).toHaveTextContent('1/3');
  });

  it('adds a card from the column’s quick add', async () => {
    bridge.createCard.mockResolvedValue({ ...makeCard(10, 'triage', 1), description: '' });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Add a card to Triage' });

    fireEvent.change(input, { target: { value: '  Write docs ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

    await waitFor(() =>
      expect(bridge.createCard).toHaveBeenCalledWith({ project_id: 'p1', title: 'Write docs', column_key: 'triage' })
    );
    expect(await within(region(/^Triage/)).findByText('Card 10')).toBeInTheDocument();
  });

  it('virtualises a column with more than 100 cards', async () => {
    const many = Array.from({ length: 150 }, (_, index) => makeCard(index + 1, 'ideas', (index + 1) * 1024));
    bridge.get.mockResolvedValue(makeSnapshot({ cards: many }));
    renderPage();

    const backlog = await screen.findByRole('region', { name: 'Ideas, 150 cards' });
    expect(backlog.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(backlog.querySelectorAll('[data-board-card]').length).toBeLessThan(150);
  });
});

describe('filters', () => {
  beforeEach(() => {
    bridge.get.mockResolvedValue(
      makeSnapshot({
        cards: [
          makeCard(1, 'triage', 1, { title: 'Fix login', type: 'bug', labels: ['auth'] }),
          makeCard(2, 'triage', 2, { title: 'Dark mode', blocked: true }),
          makeCard(3, 'done', 1, { title: 'Docs', creator_kind: 'agent', creator_ref: 'assistant:a@b' }),
        ],
      })
    );
  });

  it('narrows the board by search and shows the count', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search cards' }), { target: { value: 'login' } });

    expect(screen.getByText('Fix login')).toBeInTheDocument();
    expect(screen.queryByText('Dark mode')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3 cards')).toBeInTheDocument();
  });

  it('filters blocked and "mine" cards, and clears all filters', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Blocked only' }));
    expect(screen.queryByText('Fix login')).not.toBeInTheDocument();
    expect(screen.getByText('Dark mode')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mine' }));
    expect(screen.getByText('Fix login')).toBeInTheDocument();
    expect(screen.queryByText('Docs')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    renderPage();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search cards' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No cards match the filters.')).toBeInTheDocument();
  });

  it('reads archived cards when "Show archived" is on', async () => {
    renderPage();
    await screen.findByText('Fix login');
    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(4, 'done', 1, { title: 'Old', archived_at: 9 })] }));
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(bridge.get).toHaveBeenLastCalledWith({ project_id: 'p1', include_archived: true }));
    expect(await screen.findByText('Old')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
  });
});

describe('column settings dialog', () => {
  it('renames, sets a WIP limit, adds a column and saves the full list', async () => {
    bridge.updateColumns.mockResolvedValue({ columns: [], version: 4 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Column settings' }));

    fireEvent.change(await screen.findByRole('textbox', { name: 'Triage · Name' }), { target: { value: 'Next' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Building · WIP limit' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Done up' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New column name' }), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(bridge.updateColumns).toHaveBeenCalled());
    const request = bridge.updateColumns.mock.calls[0][0] as {
      version: number;
      columns: Array<{ key: string; name: string | null; wip_limit: number | null; position: number }>;
    };
    expect(request.version).toBe(3);
    expect(
      request.columns.map((column) => [column.key.startsWith('col_') ? 'new' : column.key, column.position])
    ).toEqual([
      ['ideas', 0],
      ['triage', 1],
      ['done', 2],
      ['building', 3],
      ['new', 4],
    ]);
    expect(request.columns[1].name).toBe('Next');
    expect(request.columns[3].wip_limit).toBe(3);
    expect(request.columns[4]).toMatchObject({ name: 'Review', category: 'todo', kind: 'normal', archived: false });
  });

  it('only lets empty columns be archived', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ cards: [makeCard(1, 'triage', 1)] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Column settings' }));

    expect(await screen.findByRole('button', { name: 'Archive Triage' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive Ideas' })).toBeEnabled();
  });

  it('refuses to save a new column without a name', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({
        columns: [...flowColumns(), { ...flowColumns()[1], id: 'c5', key: 'col_x', name: 'X', position: 9 }],
      })
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Column settings' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'X · Name' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Every column needs a name');
    expect(bridge.updateColumns).not.toHaveBeenCalled();
  });
});

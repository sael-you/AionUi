/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyboard drag and drop on the board page (LTR + RTL), optimistic moves with
 * rollback, and the code → i18n toasts with "Move anyway" on a full column.
 */

import { Notification } from '@arco-design/web-react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
// Each test drives the whole board page (and often the drawer) on a shared, busy CPU.
vi.setConfig({ testTimeout: 60000 });

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' } }) }));

import { BoardPage } from '@/renderer/pages/board';

import {
  backendError,
  boardChanged,
  bridge,
  createTestI18n,
  fullCard,
  makeCard,
  makeEvent,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  flowColumns,
} from '../boardTestUtils';

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const press = async (target: Element | Document, code: string) => {
  fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code });
  await tick();
};

/** Pick up a card by its handle, press the given arrows, drop. */
const keyboardMove = async (handleName: string, arrows: string[]) => {
  const handle = await screen.findByRole('button', { name: handleName });
  handle.focus();
  await press(handle, 'Space');
  for (const arrow of arrows) {
    // Key presses are sequential by nature.
    // eslint-disable-next-line no-await-in-loop
    await press(document, arrow);
  }
  await press(document, 'Space');
};

const region = (name: RegExp) => screen.getByRole('region', { name });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let notifyError: ReturnType<typeof vi.spyOn>;
let notifyWarning: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBridge();
  bridge.get.mockResolvedValue(
    makeSnapshot({ cards: [makeCard(1, 'ideas', 1024), makeCard(2, 'triage', 1024)], last_seq: 1 })
  );
  notifyError = vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
  notifyWarning = vi.spyOn(Notification, 'warning').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('board keyboard drag and drop', () => {
  it('moves a card to the next column with → (LTR), optimistically, then confirms', async () => {
    const pending = deferred<ReturnType<typeof fullCard>>();
    bridge.moveCard.mockReturnValue(pending.promise);
    renderWithBoard(<BoardPage projectId='p1' />);

    await keyboardMove('Move TASK-1', ['ArrowRight']);

    expect(bridge.moveCard).toHaveBeenCalledWith({
      card_id: 'card-1',
      to_column: 'triage',
      before_id: 'card-2',
      expected_column: 'ideas',
    });
    // Optimistic: already shown in "Triage" while the request is in flight.
    expect(within(region(/^Triage/)).getByText('Card 1')).toBeInTheDocument();

    await act(async () => pending.resolve(fullCard(makeCard(1, 'triage', 0))));
    expect(await screen.findByText('TASK-1 moved to Triage.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move TASK-1' })));
  });

  it('mirrors ← / → in a right-to-left layout (fa-IR)', async () => {
    bridge.moveCard.mockResolvedValue(fullCard(makeCard(1, 'triage', 0)));
    renderWithBoard(<BoardPage projectId='p1' />, { i18n: createTestI18n('fa-IR') });
    const i18n = createTestI18n('fa-IR');
    const handleName = i18n.t('board.card.dragHandle', { ref: 'TASK-1' });

    // → in RTL goes towards the start: there is no column before Ideas, so nothing moves.
    await keyboardMove(handleName, ['ArrowRight']);
    expect(bridge.moveCard).not.toHaveBeenCalled();

    // ← in RTL is the next column.
    await keyboardMove(handleName, ['ArrowLeft']);
    expect(bridge.moveCard).toHaveBeenCalledWith(expect.objectContaining({ card_id: 'card-1', to_column: 'triage' }));
  });

  it('moves within a column with ↑ and announces in the user’s language', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({ cards: [makeCard(1, 'triage', 1024), makeCard(2, 'triage', 2048)], last_seq: 1 })
    );
    bridge.moveCard.mockResolvedValue(fullCard(makeCard(2, 'triage', 0)));
    renderWithBoard(<BoardPage projectId='p1' />);

    const handle = await screen.findByRole('button', { name: 'Move TASK-2' });
    handle.focus();
    await press(handle, 'Space');
    expect(await screen.findByText('Picked up TASK-2 from Triage.')).toBeInTheDocument();
    await press(document, 'ArrowUp');
    expect(await screen.findByText('TASK-2 is in Triage, position 1 of 2.')).toBeInTheDocument();
    await press(document, 'Space');

    expect(bridge.moveCard).toHaveBeenCalledWith({
      card_id: 'card-2',
      to_column: 'triage',
      before_id: 'card-1',
      expected_column: 'triage',
    });
  });

  it('cancels with Escape without calling the server', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    const handle = await screen.findByRole('button', { name: 'Move TASK-1' });
    handle.focus();
    await press(handle, 'Space');
    await press(document, 'ArrowRight');
    await press(document, 'Escape');

    expect(bridge.moveCard).not.toHaveBeenCalled();
    expect(within(region(/^Ideas/)).getByText('Card 1')).toBeInTheDocument();
  });
});

describe('move failures', () => {
  it('rolls the card back and shows the translated error on failure', async () => {
    bridge.moveCard.mockRejectedValue(backendError(422, 'board_invalid'));
    renderWithBoard(<BoardPage projectId='p1' />);

    await keyboardMove('Move TASK-1', ['ArrowRight']);

    await waitFor(() => expect(within(region(/^Ideas/)).getByText('Card 1')).toBeInTheDocument());
    expect(notifyError).toHaveBeenCalledWith({
      title: "Couldn't move TASK-1",
      content: 'Some values are invalid or too long.',
    });
    expect(screen.getByTestId('board-live-region')).toHaveTextContent('TASK-1 was put back in Ideas.');
  });

  it('keeps a newer live update of the card when the move then fails, and re-reads the board', async () => {
    const pending = deferred<never>();
    bridge.moveCard.mockReturnValue(pending.promise);
    renderWithBoard(<BoardPage projectId='p1' />);

    await keyboardMove('Move TASK-1', ['ArrowRight']);
    expect(within(region(/^Triage/)).getByText('Card 1')).toBeInTheDocument();

    // While the move is in flight, an agent moves and renames the card (next seq).
    act(() =>
      boardChanged.emit({
        user_id: 'u1',
        project_id: 'p1',
        seq: 2,
        prev_seq: 1,
        event: makeEvent(2, 'card_moved'),
        card: makeCard(1, 'building', 512, { title: 'Card 1 (agent)' }),
      })
    );
    expect(await within(region(/^Building/)).findByText('Card 1 (agent)')).toBeInTheDocument();
    bridge.get.mockResolvedValue(
      makeSnapshot({
        cards: [makeCard(1, 'building', 512, { title: 'Card 1 (agent)' }), makeCard(2, 'triage', 1024)],
        last_seq: 2,
      })
    );

    await act(async () => pending.reject(backendError(409, 'board_version_conflict')));

    // The rollback did not put the card back in Ideas over the newer state.
    expect(within(region(/^Building/)).getByText('Card 1 (agent)')).toBeInTheDocument();
    expect(within(region(/^Ideas/)).queryByText(/Card 1/)).not.toBeInTheDocument();
    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
  });

  it('offers "Move anyway" on a full column and forces the move when chosen', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({
        columns: flowColumns({ triage: { wip_limit: 1 } }),
        cards: [makeCard(1, 'ideas', 1024), makeCard(2, 'triage', 1024)],
        last_seq: 1,
      })
    );
    bridge.moveCard.mockRejectedValueOnce(backendError(409, 'board_wip_limit'));
    bridge.moveCard.mockResolvedValueOnce(fullCard(makeCard(1, 'triage', 0)));
    renderWithBoard(<BoardPage projectId='p1' />);

    await keyboardMove('Move TASK-1', ['ArrowRight']);

    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    const config = notifyWarning.mock.calls[0][0] as {
      content: string;
      btn: React.ReactElement<{ onClick: () => void }>;
    };
    expect(config.content).toBe('Triage is full. Finish or move a card out first.');
    expect(screen.getByTestId('board-live-region')).toHaveTextContent('Triage is at its limit (1 of 1).');

    await act(async () => config.btn.props.onClick());
    expect(bridge.moveCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ card_id: 'card-1', to_column: 'triage', force: true })
    );
    await waitFor(() => expect(within(region(/^Triage/)).getByText('Card 1')).toBeInTheDocument());
  });

  it('reloads the board after a version conflict', async () => {
    bridge.moveCard.mockRejectedValue(backendError(409, 'board_version_conflict'));
    renderWithBoard(<BoardPage projectId='p1' />);

    await keyboardMove('Move TASK-1', ['ArrowRight']);

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'This card was changed somewhere else. The latest version is shown now.' })
      )
    );
    await waitFor(() => expect(bridge.get).toHaveBeenCalledTimes(2));
  });
});

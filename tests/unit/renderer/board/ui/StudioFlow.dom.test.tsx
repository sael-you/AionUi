/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The department (studio) flow on the board page: category groups, gate and
 * final columns, locked cards, exit-rule / gate toasts, Talk to the board and the
 * project identity on the header.
 */

import { Notification } from '@arco-design/web-react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
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
  makeSettings,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  studioColumns,
} from '../boardTestUtils';

const renderPage = () =>
  renderWithBoard(
    <Routes>
      <Route path='/' element={<BoardPage projectId='p1' />} />
      <Route path='/conversation/:id' element={<div>conversation page</div>} />
    </Routes>
  );

const region = (name: RegExp) => screen.getByRole('region', { name });

const tick = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const keyboardMove = async (handleName: string, arrow: string) => {
  const handle = await screen.findByRole('button', { name: handleName });
  handle.focus();
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
  await tick();
  fireEvent.keyDown(document, { code: arrow, key: arrow });
  await tick();
  fireEvent.keyDown(document, { code: 'Space', key: ' ' });
  await tick();
};

let notifyWarning: ReturnType<typeof vi.spyOn>;
let notifyInfo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBridge();
  bridge.get.mockResolvedValue(
    makeSnapshot({
      columns: studioColumns(),
      cards: [
        makeCard(1, 'review', 1024, { title: 'Needs reviews' }),
        makeCard(2, 'decision', 1024, { title: 'Big change', needs_decision: true }),
        makeCard(3, 'decision', 2048, { title: 'Small fix' }),
        makeCard(4, 'parked', 1024, { title: 'Later' }),
      ],
    })
  );
  vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
  notifyWarning = vi.spyOn(Notification, 'warning').mockImplementation(() => undefined as never);
  notifyInfo = vi.spyOn(Notification, 'info').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('studio flow layout', () => {
  it('groups the 15 columns by category, in flow order', async () => {
    renderPage();
    const groups = await screen.findAllByRole('group', { name: / columns$/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Backlog columns',
      'To do columns',
      'In progress columns',
      'Done columns',
    ]);
    expect(
      within(groups[1])
        .getAllByRole('region')
        .map((node) => node.getAttribute('aria-label'))
    ).toEqual(['Triage, 0 cards', 'Review, 1 card', 'Accuracy, 0 cards', 'Decision, 2 cards']);
    expect(screen.getAllByRole('region')).toHaveLength(15);
  });

  it('marks gates (lock + decisions waiting), final columns and default WIP limits in words', async () => {
    renderPage();
    const decision = await screen.findByRole('region', { name: /^Decision/ });
    expect(within(decision).getByText('Gate')).toBeInTheDocument();
    expect(within(decision).getByTestId('board-needs-decision')).toHaveTextContent('1 needs your decision');
    expect(within(region(/^Parked/)).getByText('Final · dropped')).toBeInTheDocument();
    expect(within(region(/^Deployed/)).getByText('Final · completed')).toBeInTheDocument();
    expect(within(region(/^Review/)).getByLabelText('1 of 4 cards, work-in-progress limit')).toBeInTheDocument();
  });

  it('locks a card that waits for a decision: no drag handle, Move to… explains why', async () => {
    renderPage();
    await screen.findByText('Big change');
    expect(screen.queryByRole('button', { name: 'Move TASK-2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move TASK-3' })).toBeInTheDocument();
    expect(within(region(/^Decision/)).getByText('Needs your decision')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for TASK-2' }));
    expect(await screen.findByRole('menuitem', { name: 'Decide in the card to move it' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Planned' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('destination policy: Deploying is entered only by the deploy automation', () => {
  it('disables Deploying in Move to… with the reason', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for TASK-3' }));
    expect(await screen.findByRole('menuitem', { name: 'Deploying (deploy automation only)' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Planned' })).not.toHaveAttribute('aria-disabled');
  });

  it('skips Deploying with the keyboard: → from Ready to deploy lands in Deployed', async () => {
    bridge.get.mockResolvedValue(
      makeSnapshot({ columns: studioColumns(), cards: [makeCard(7, 'ready_to_deploy', 1024, { title: 'Not gated' })] })
    );
    bridge.moveCard.mockResolvedValue(fullCard(makeCard(7, 'deployed', 1024, { title: 'Not gated' })));
    renderPage();

    await keyboardMove('Move TASK-7', 'ArrowRight');

    await waitFor(() =>
      expect(bridge.moveCard).toHaveBeenCalledWith(
        expect.objectContaining({ card_id: 'card-7', to_column: 'deployed' })
      )
    );
  });

  it('offers Deploying as a disabled option in the drawer column field', async () => {
    bridge.getCard.mockResolvedValue(makeDetail(fullCard(makeCard(3, 'decision', 2048, { title: 'Small fix' }))));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Open TASK-3: Small fix' }));
    const dialog = await screen.findByRole('dialog', { name: 'Card TASK-3' });
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Column' }));
    const option = await screen.findByRole('option', { name: 'Deploying (deploy automation only)' });
    expect(option.className).toContain('arco-select-option-disabled');
    fireEvent.click(option);
    expect(bridge.moveCard).not.toHaveBeenCalled();
  });
});

describe('locked move controls', () => {
  it('describe the lock on focus and announce it when the menu opens', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Actions for TASK-2' });
    expect(trigger).toHaveAccessibleDescription('TASK-2 needs your decision before it can leave Decision.');
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByTestId('board-live-region')).toHaveTextContent(
        'TASK-2 needs your decision before it can leave Decision.'
      )
    );
  });
});

describe('studio move errors', () => {
  it('lists what an exit rule misses and lets the owner move anyway', async () => {
    bridge.moveCard.mockRejectedValueOnce(
      backendError(409, 'board_exit_rule', { missing: ['review:technical', 'open_questions'] })
    );
    bridge.moveCard.mockResolvedValueOnce(fullCard(makeCard(1, 'accuracy', 0, { title: 'Needs reviews' })));
    renderPage();

    await keyboardMove('Move TASK-1', 'ArrowRight');

    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    const config = notifyWarning.mock.calls[0][0] as {
      content: string;
      btn: React.ReactElement<{ onClick: () => void }>;
    };
    expect(config.content).toBe(
      "Review can't be left yet. Missing: a review from Technical, answers to open questions."
    );
    await act(async () => config.btn.props.onClick());
    expect(bridge.moveCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ card_id: 'card-1', to_column: 'accuracy', force: true })
    );
  });

  it('asks for a reason before "Move anyway" takes a card out of a gate', async () => {
    bridge.moveCard.mockRejectedValueOnce(backendError(409, 'board_exit_rule', { missing: ['open_questions'] }));
    bridge.moveCard.mockResolvedValueOnce(fullCard(makeCard(3, 'planned', 0, { title: 'Small fix' })));
    renderPage();

    await keyboardMove('Move TASK-3', 'ArrowRight');
    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    const config = notifyWarning.mock.calls[0][0] as { btn: React.ReactElement<{ onClick: () => void }> };
    act(() => config.btn.props.onClick());

    const dialog = await screen.findByRole('dialog', { name: 'Move TASK-3 out of Decision' });
    expect(bridge.moveCard).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move out' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a reason');
    expect(bridge.moveCard).toHaveBeenCalledTimes(1);

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Owner call' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move out' }));
    await waitFor(() =>
      expect(bridge.moveCard).toHaveBeenLastCalledWith({
        card_id: 'card-3',
        to_column: 'planned',
        expected_column: 'decision',
        force: true,
        reason: 'Owner call',
      })
    );
  });

  it('announces a gate refusal and offers to open the decision', async () => {
    bridge.moveCard.mockRejectedValue(backendError(409, 'board_gate_use_decision'));
    bridge.getCard.mockResolvedValue(makeDetail(fullCard(makeCard(3, 'decision', 2048, { title: 'Small fix' }))));
    renderPage();

    await keyboardMove('Move TASK-3', 'ArrowRight');

    await waitFor(() => expect(notifyInfo).toHaveBeenCalled());
    expect(screen.getByTestId('board-live-region')).toHaveTextContent(
      'TASK-3 needs your decision before it can leave Decision.'
    );
    const config = notifyInfo.mock.calls[0][0] as { btn: React.ReactElement<{ onClick: () => void }> };
    act(() => config.btn.props.onClick());
    expect(await screen.findByRole('dialog', { name: 'Card TASK-3' })).toBeInTheDocument();
  });
});

describe('board header', () => {
  it('opens the existing Board Keeper conversation', async () => {
    bridge.get.mockResolvedValue(makeSnapshot({ settings: makeSettings({ keeper_conversation_id: 'keeper-1' }) }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the board' }));
    expect(await screen.findByText('conversation page')).toBeInTheDocument();
    expect(bridge.ensureKeeper).not.toHaveBeenCalled();
  });

  it('creates the keeper conversation when the board has none yet', async () => {
    bridge.ensureKeeper.mockResolvedValue({ conversation_id: 'keeper-2' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to the board' }));
    await waitFor(() => expect(bridge.ensureKeeper).toHaveBeenCalledWith({ project_id: 'p1' }));
    expect(await screen.findByText('conversation page')).toBeInTheDocument();
  });

  it('shows the project chip and accent strip from the project’s workspace', async () => {
    bridge.projectGet.mockResolvedValue({
      project_id: 'p1',
      name: 'Alpha',
      explorer: {
        workspace_pe_id: 'pe1',
        entries: [
          {
            pe_id: 'pe1',
            role: 'workspace',
            display_path: '/root/projects/alpha',
            order_index: 0,
            runtime_status: 'available',
          },
        ],
      },
    });
    const { container } = renderPage();

    expect(await screen.findByText('Project: alpha', { exact: false })).toBeInTheDocument();
    const page = container.querySelector('[data-board-page]');
    expect(page).toHaveAttribute('data-project-surface', 'board');
    expect(page?.getAttribute('style')).toContain('--project-accent');
    expect(container.querySelector('[data-project-header="tint"]')).not.toBeNull();
  });
});

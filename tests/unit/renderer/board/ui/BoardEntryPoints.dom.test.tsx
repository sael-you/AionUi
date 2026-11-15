/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Entry points (D40): the sidebar board button, the Board Keeper badge, and the studio flow at ≤768 px. */

import { Notification } from '@arco-design/web-react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'me' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', username: 'me' } }),
}));

import { BoardKeeperBadge, isBoardKeeperConversation } from '@/renderer/components/board/BoardKeeperBadge';
import { useOpenBoardKeeper } from '@/renderer/components/board/hooks/useBoardDirectory';
import { BOARD_NARROW_QUERY } from '@/renderer/components/board/hooks/useMediaQuery';
import { SidebarBoardButton } from '@/renderer/components/board/SidebarBoardButton';
import { BoardPage } from '@/renderer/pages/board';

import {
  backendError,
  bridge,
  createTestI18n,
  makeCard,
  makeSnapshot,
  removeMatchMedia,
  renderWithBoard,
  resetBridge,
  studioColumns,
  stubMatchMedia,
} from '../boardTestUtils';

const withBoardRoute = (ui: React.ReactElement) => (
  <Routes>
    <Route path='/' element={ui} />
    <Route path='/board/:projectId' element={<div>board page</div>} />
  </Routes>
);

beforeEach(() => resetBridge());
afterEach(() => {
  cleanup();
  removeMatchMedia();
});

describe('sidebar board button (project row actions slot)', () => {
  it('has an accessible name, opens the project board and lets the sidebar close itself', async () => {
    const onNavigate = vi.fn();
    renderWithBoard(withBoardRoute(<SidebarBoardButton projectId='p 1' projectName='Alpha' onNavigate={onNavigate} />));
    fireEvent.click(screen.getByRole('button', { name: 'Open the board of Alpha' }));
    expect(await screen.findByText('board page')).toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('is an Arco button styled like the row buttons and, like them, outside the Tab order', () => {
    renderWithBoard(<SidebarBoardButton projectId='p1' projectName='Alpha' className='row-action' />);
    const button = screen.getByRole('button', { name: 'Open the board of Alpha' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('tabindex', '-1');
    expect(button.className).toContain('row-action');
  });

  it('is labelled in the user’s language (fa-IR)', () => {
    const i18n = createTestI18n('fa-IR');
    renderWithBoard(<SidebarBoardButton projectId='p1' projectName='Alpha' />, { i18n });
    expect(
      screen.getByRole('button', { name: i18n.t('board.sidebar.openBoardOf', { project: 'Alpha' }) })
    ).toBeInTheDocument();
  });
});

const KeeperOpener: React.FC = () => {
  const open = useOpenBoardKeeper();
  return (
    <span role='button' tabIndex={0} onClick={() => void open('p1')}>
      talk
    </span>
  );
};

describe('Talk to the Butler from the sidebar menu', () => {
  const renderOpener = () =>
    renderWithBoard(
      <Routes>
        <Route path='/' element={<KeeperOpener />} />
        <Route path='/conversation/:id' element={<div>keeper conversation</div>} />
      </Routes>
    );

  it('opens (or creates) the keeper conversation', async () => {
    bridge.ensureKeeper.mockResolvedValue({ conversation_id: 'keeper-9' });
    renderOpener();
    fireEvent.click(screen.getByRole('button', { name: 'talk' }));
    expect(await screen.findByText('keeper conversation')).toBeInTheDocument();
    expect(bridge.ensureKeeper).toHaveBeenCalledWith({ project_id: 'p1' });
  });

  it('reports a failure with the translated reason', async () => {
    const notify = vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
    bridge.ensureKeeper.mockRejectedValue(backendError(403, 'board_disabled'));
    renderOpener();
    fireEvent.click(screen.getByRole('button', { name: 'talk' }));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        title: "Couldn't open the Board Butler",
        content: 'The board is turned off.',
      })
    );
    notify.mockRestore();
  });
});

describe('Board Butler badge', () => {
  const keeper = { extra: { board_keeper: true } };

  it('recognises only the conversation the server marks as keeper', () => {
    expect(isBoardKeeperConversation(keeper)).toBe(true);
    expect(isBoardKeeperConversation({ extra: { board_keeper: 'yes' } })).toBe(false);
    expect(isBoardKeeperConversation(null)).toBe(false);
  });

  it('shows a labelled tag in the header and an icon with screen-reader text in the sidebar', () => {
    renderWithBoard(
      <>
        <BoardKeeperBadge conversation={keeper} />
        <BoardKeeperBadge conversation={keeper} compact />
        <BoardKeeperBadge conversation={{ extra: {} }} />
      </>
    );
    const badges = screen.getAllByTestId('board-keeper-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Board Butler');
    expect(within(badges[1]).getByText('Board Butler')).toHaveClass('sr-only');
  });
});

describe('studio flow at ≤768 px', () => {
  it('switches columns through a category-grouped picker; a locked card has no movable target', async () => {
    stubMatchMedia((query) => query === BOARD_NARROW_QUERY);
    bridge.get.mockResolvedValue(
      makeSnapshot({
        columns: studioColumns(),
        cards: [makeCard(2, 'decision', 1024, { title: 'Big change', needs_decision: true })],
      })
    );
    renderWithBoard(<BoardPage projectId='p1' />);

    fireEvent.click(await screen.findByRole('combobox', { name: 'Column' }));
    expect(await screen.findByText('To do')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Decision · 1' }));

    const decision = await screen.findByRole('region', { name: 'Decision, 1 card' });
    expect(within(decision).getByText('Gate')).toBeInTheDocument();
    fireEvent.click(within(decision).getByRole('button', { name: 'Actions for TASK-2' }));
    expect(await screen.findByRole('menuitem', { name: 'Decide in the card to move it' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Planned' })).toHaveAttribute('aria-disabled', 'true');
  });
});

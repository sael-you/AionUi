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
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' } }) }));

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

describe('sidebar board button', () => {
  it('has an accessible name and opens the project board', async () => {
    renderWithBoard(withBoardRoute(<SidebarBoardButton projectId='p 1' projectName='Alpha' touch={false} />));
    fireEvent.click(screen.getByRole('button', { name: 'Open the board of Alpha' }));
    expect(await screen.findByText('board page')).toBeInTheDocument();
  });

  it('works from the keyboard and stays focusable while hidden on pointer devices', async () => {
    renderWithBoard(withBoardRoute(<SidebarBoardButton projectId='p1' projectName='Alpha' touch={false} />));
    const button = screen.getByRole('button', { name: 'Open the board of Alpha' });
    expect(button).toHaveAttribute('tabindex', '0');
    expect(button.className).toContain('opacity-0');
    expect(button.className).toContain('focus:opacity-100');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(await screen.findByText('board page')).toBeInTheDocument();
  });

  it('is always visible on touch', () => {
    renderWithBoard(<SidebarBoardButton projectId='p1' projectName='Alpha' touch />);
    expect(screen.getByRole('button', { name: 'Open the board of Alpha' }).className).not.toContain('opacity-0');
  });

  it('is labelled in the user’s language (fa-IR)', () => {
    const i18n = createTestI18n('fa-IR');
    renderWithBoard(<SidebarBoardButton projectId='p1' projectName='Alpha' touch />, { i18n });
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

describe('Talk to the board from the sidebar menu', () => {
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
        title: "Couldn't open the Board Keeper",
        content: 'The board is turned off.',
      })
    );
    notify.mockRestore();
  });
});

describe('Board Keeper badge', () => {
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
    expect(badges[0]).toHaveTextContent('Board Keeper');
    expect(within(badges[1]).getByText('Board Keeper')).toHaveClass('sr-only');
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

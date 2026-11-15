/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Board Butler progress (C22) on card tiles (wide board, ≤768 px board, Tasks tab) and in the drawer. */

import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'me' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', username: 'me' } }),
}));

import { CardProgressBar } from '@/renderer/components/board/card/CardProgressBar';
import { useBoard } from '@/renderer/components/board/hooks/useBoard';
import { BOARD_NARROW_QUERY } from '@/renderer/components/board/hooks/useMediaQuery';
import { TasksTab } from '@/renderer/components/board/TasksTab';
import { BoardPage } from '@/renderer/pages/board';

import {
  bridge,
  fullCard,
  makeCard,
  makeDetail,
  makeSnapshot,
  removeMatchMedia,
  renderWithBoard,
  resetBridge,
  stubMatchMedia,
} from '../boardTestUtils';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const withProgress = makeCard(1, 'building', 1024, {
  title: 'API',
  metadata: { progress: 45, status_note: 'Wiring the routes', updated_at: Date.now() - 2 * HOUR },
});
const withoutProgress = makeCard(2, 'triage', 1024, { title: 'Login', metadata: { status_note: 'no number' } });

const progressOf = (title: string) => {
  const tile = screen.getByRole('button', { name: new RegExp(`: ${title}$`) }).closest('[data-board-card]');
  return tile as HTMLElement;
};

beforeEach(() => {
  resetBridge();
  bridge.get.mockResolvedValue(makeSnapshot({ cards: [withProgress, withoutProgress] }));
});
afterEach(() => {
  cleanup();
  removeMatchMedia();
});

describe('progress bar component', () => {
  it('renders an accessible progressbar with the percentage, note and age', () => {
    renderWithBoard(
      <CardProgressBar
        card={{
          column_key: 'building',
          metadata: { progress: 45, status_note: 'Halfway', updated_at: NOW - 2 * HOUR },
        }}
        nowMs={NOW}
      />
    );
    const bar = screen.getByRole('progressbar', { name: 'Progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '45%');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('45%');
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('Halfway')).toBeInTheDocument();
    expect(screen.getByText('Updated 2 hours ago')).toBeInTheDocument();
  });

  it('renders nothing without progress, never 0 %', () => {
    const { container } = renderWithBoard(
      <>
        <CardProgressBar card={{ column_key: 'building', metadata: {} }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'building', metadata: undefined }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'building', metadata: { progress: 'x', updated_at: NOW } }} nowMs={NOW} />
      </>
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container).not.toHaveTextContent('0%');
  });

  it('clamps the value to 0–100', () => {
    renderWithBoard(
      <>
        <CardProgressBar card={{ column_key: 'triage', metadata: { progress: 140 } }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'triage', metadata: { progress: -20 } }} nowMs={NOW} />
      </>
    );
    const [high, low] = screen.getAllByRole('progressbar');
    expect(high).toHaveAttribute('aria-valuenow', '100');
    expect((high.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(low).toHaveAttribute('aria-valuenow', '0');
  });

  it('highlights an update older than 24 h in building and local_test only', () => {
    const old = { progress: 60, updated_at: NOW - 30 * HOUR };
    const { container } = renderWithBoard(
      <>
        <CardProgressBar card={{ column_key: 'building', metadata: old }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'local_test', metadata: old }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'triage', metadata: old }} nowMs={NOW} />
        <CardProgressBar card={{ column_key: 'building', metadata: { ...old, updated_at: NOW - HOUR } }} nowMs={NOW} />
      </>
    );
    const rows = Array.from(container.querySelectorAll('[data-board-progress]'));
    expect(rows.map((row) => row.hasAttribute('data-stale'))).toEqual([true, true, false, false]);
    expect(screen.getAllByText('No update for more than 24 hours')).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Updated yesterday')).toHaveClass('text-warning');
  });

  it('labels the drawer variant', () => {
    renderWithBoard(
      <CardProgressBar card={{ column_key: 'building', metadata: { progress: 10 } }} variant='drawer' nowMs={NOW} />
    );
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });
});

describe('progress on the board surfaces', () => {
  it('wide board: the tile shows the bar only for the card with progress', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    await screen.findByText('API');
    expect(within(progressOf('API')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
    expect(within(progressOf('API')).getByText('Wiring the routes')).toBeInTheDocument();
    expect(within(progressOf('Login')).queryByRole('progressbar')).toBeNull();
  });

  it('≤768 px board shows the bar on the tile', async () => {
    stubMatchMedia((query) => query === BOARD_NARROW_QUERY);
    renderWithBoard(<BoardPage projectId='p1' />);
    fireEvent.click(await screen.findByRole('combobox', { name: 'Column' }));
    fireEvent.click(await screen.findByRole('option', { name: /Building/ }));
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('Tasks tab stacked column shows the bar on the tile', async () => {
    const Harness: React.FC = () => <TasksTab board={useBoard('p1')} />;
    renderWithBoard(<Harness />);
    await screen.findByText('API');
    expect(within(progressOf('API')).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('card drawer shows the bar from the full card', async () => {
    bridge.getCard.mockResolvedValue(makeDetail(fullCard(withProgress, { metadata: withProgress.metadata ?? {} })));
    renderWithBoard(<BoardPage projectId='p1' />);
    fireEvent.click(await screen.findByRole('button', { name: /: API$/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '45');
    expect(within(dialog).getByText('Updated 2 hours ago')).toBeInTheDocument();
  });
});

describe('Board Butler labels', () => {
  it('the board header offers "Talk to the Butler"', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);
    expect(await screen.findByRole('button', { name: 'Talk to the Butler' })).toBeInTheDocument();
  });
});

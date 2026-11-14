/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** ≤768 px board: one column at a time, a switcher, no drag, "Move to…"; media-query hooks. */

import { Message, Notification } from '@arco-design/web-react';
import { cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' } }) }));

import {
  BOARD_NARROW_QUERY,
  REDUCED_MOTION_QUERY,
  useBoardNarrow,
  useReducedMotion,
} from '@/renderer/components/board/hooks/useMediaQuery';
import { BoardPage } from '@/renderer/pages/board';

import {
  backendError,
  bridge,
  fullCard,
  makeCard,
  makeSnapshot,
  removeMatchMedia,
  renderWithBoard,
  resetBridge,
  flowColumns,
  stubMatchMedia,
} from '../boardTestUtils';

let notifyWarning: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBridge();
  stubMatchMedia((query) => query === BOARD_NARROW_QUERY);
  bridge.get.mockResolvedValue(
    makeSnapshot({
      columns: flowColumns({ done: { wip_limit: 1 } }),
      cards: [makeCard(1, 'ideas', 1024, { title: 'Idea one' }), makeCard(2, 'done', 1024, { title: 'Shipped' })],
    })
  );
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
  notifyWarning = vi.spyOn(Notification, 'warning').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  removeMatchMedia();
});

describe('narrow board (≤768 px)', () => {
  it('shows one column at a time behind a switcher, without drag handles', async () => {
    renderWithBoard(<BoardPage projectId='p1' />);

    expect(await screen.findByRole('region', { name: 'Ideas, 1 card' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Move TASK-/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Column' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Done · 1' }));
    expect(await screen.findByRole('region', { name: 'Done, 1 card' })).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.queryByText('Idea one')).not.toBeInTheDocument();
  });

  it('moves with "Move to…" and offers "Move anyway" when the target is full', async () => {
    bridge.moveCard.mockRejectedValueOnce(backendError(409, 'board_wip_limit'));
    bridge.moveCard.mockResolvedValueOnce(fullCard(makeCard(1, 'done', 2048, { title: 'Idea one' })));
    renderWithBoard(<BoardPage projectId='p1' />);

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for TASK-1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Done (full)' }));

    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    expect(bridge.moveCard).toHaveBeenCalledWith({
      card_id: 'card-1',
      to_column: 'done',
      after_id: 'card-2',
      expected_column: 'ideas',
    });
    const config = notifyWarning.mock.calls[0][0] as { btn: React.ReactElement<{ onClick: () => void }> };
    config.btn.props.onClick();
    await waitFor(() => expect(bridge.moveCard).toHaveBeenLastCalledWith(expect.objectContaining({ force: true })));
  });
});

describe('media query hooks', () => {
  it('follow matchMedia for the narrow layout and reduced motion', () => {
    stubMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
    expect(renderHook(() => useBoardNarrow()).result.current).toBe(false);
  });

  it('default to false where matchMedia is unavailable', () => {
    removeMatchMedia();
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });
});

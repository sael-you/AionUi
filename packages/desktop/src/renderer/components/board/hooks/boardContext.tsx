/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useRef } from 'react';

import type { BoardController } from './useBoard';

type BoardRef = { readonly current: BoardController | null };

const BoardContext = createContext<BoardRef>({ current: null });

/**
 * Gives card controls the latest board without making it a prop: the context
 * value is a stable ref, so a new snapshot (a live hint, a seq bump) does not
 * re-render every card — only cards whose own props changed.
 */
export const BoardProvider: React.FC<{ board: BoardController; children: React.ReactNode }> = ({ board, children }) => {
  const ref = useRef<BoardController | null>(board);
  ref.current = board;
  return <BoardContext.Provider value={ref}>{children}</BoardContext.Provider>;
};

/** The latest board controller, read when needed (event handlers, menus on open). */
export const useBoardRef = (): BoardRef => useContext(BoardContext);

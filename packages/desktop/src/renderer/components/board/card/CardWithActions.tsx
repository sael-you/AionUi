/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import type { BoardCardSummary } from '@/common/types/board';

import type { MoveLock } from '../utils/boardModel';
import { BoardCardTile } from './BoardCardTile';
import { MoveToMenu } from './MoveToMenu';

/**
 * A card tile with its "Move to…" menu for the drag-free views (Tasks tab,
 * ≤768 px board). Memoised on plain props: it re-renders only when this card
 * (or the board's read-only state / its lock) changed.
 */
export const CardWithActions: React.FC<{
  card: BoardCardSummary;
  onOpen: (cardId: string) => void;
  readOnly: boolean;
  lock: MoveLock;
  columnLabel: string;
}> = React.memo(({ card, onOpen, readOnly, lock, columnLabel }) => (
  <BoardCardTile
    card={card}
    onOpen={onOpen}
    actions={<MoveToMenu card={card} readOnly={readOnly} lock={lock} columnLabel={columnLabel} />}
  />
));

CardWithActions.displayName = 'CardWithActions';

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Virtuoso } from 'react-virtuoso';

import type { BoardCardSummary } from '@/common/types/board';

/** Columns longer than this render through a virtual list (SPEC §8), in every board view. */
export const VIRTUALIZE_THRESHOLD = 100;

/**
 * The cards of one column: a plain list up to {@link VIRTUALIZE_THRESHOLD}
 * cards, a virtual list above it. `height` sizes the virtual list where the
 * parent does not (the stacked Tasks tab scrolls as a whole).
 */
export const CardList: React.FC<{
  cards: BoardCardSummary[];
  renderCard: (card: BoardCardSummary) => React.ReactNode;
  /** Gap between virtual rows (plain lists use the parent's flex gap). */
  rowGapClass?: string;
  height?: string;
  className?: string;
}> = ({ cards, renderCard, rowGapClass = 'pb-8px', height, className }) => {
  if (cards.length <= VIRTUALIZE_THRESHOLD) return <>{cards.map(renderCard)}</>;
  return (
    <div data-virtualized='true' className={className ?? 'flex-1 min-h-200px'} style={height ? { height } : undefined}>
      <Virtuoso
        style={{ height: '100%' }}
        data={cards}
        computeItemKey={(_index, card) => card.id}
        itemContent={(_index, card) => <div className={rowGapClass}>{renderCard(card)}</div>}
      />
    </div>
  );
};

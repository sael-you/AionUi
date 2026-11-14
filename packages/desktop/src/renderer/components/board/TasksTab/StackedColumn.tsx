/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Down, Left, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';
import { isRtlLanguage } from '@/renderer/services/i18n/direction';

import { BoardCardTile } from '../card/BoardCardTile';
import type { BoardController } from '../hooks/useBoard';
import { MoveToMenu } from '../card/MoveToMenu';
import { CardList } from '../column/CardList';
import { ColumnMarks } from '../column/ColumnMarks';
import { QuickAddCard } from '../column/QuickAddCard';
import { WipCounter } from '../column/WipCounter';
import { columnName } from '../utils/boardFormat';
import { activeCardCount } from '../utils/boardModel';

/** One collapsible column of the narrow Tasks tab (stacked layout, no drag — "Move to…" instead). */
export const StackedColumn: React.FC<{
  board: BoardController;
  column: BoardColumn;
  cards: BoardCardSummary[];
  /** Every card of the board (gate "needs your decision" count). */
  allCards: BoardCardSummary[];
  collapsed: boolean;
  onToggle: () => void;
  onOpenCard: (cardId: string) => void;
}> = ({ board, column, cards, allCards, collapsed, onToggle, onOpenCard }) => {
  const { t, i18n } = useTranslation();
  const name = columnName(column, t);
  const headingId = `board-stack-${column.key}`;
  const listId = `${headingId}-list`;
  const count = activeCardCount(cards, column.key);
  const CollapsedIcon = isRtlLanguage(i18n.language) ? Left : Right;

  return (
    <section aria-labelledby={headingId} data-board-column={column.key} className='flex flex-col gap-6px'>
      <div className='flex items-center gap-4px'>
        <Button
          type='text'
          size='mini'
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={t(collapsed ? 'board.column.expand' : 'board.column.collapse', { column: name })}
          icon={
            collapsed ? (
              <CollapsedIcon theme='outline' size='14' fill='currentColor' />
            ) : (
              <Down theme='outline' size='14' fill='currentColor' />
            )
          }
          onClick={onToggle}
        />
        <h4
          id={headingId}
          tabIndex={-1}
          className='m-0 text-13px font-medium text-t-primary flex-1 truncate outline-none'
        >
          {name}
        </h4>
        <WipCounter column={column} count={count} />
      </div>
      <div className='ps-28px'>
        <ColumnMarks column={column} cards={allCards} />
      </div>
      {!collapsed && (
        <div id={listId} className='flex flex-col gap-6px ps-8px'>
          {cards.length === 0 ? (
            <p className='m-0 text-12px text-t-secondary py-4px'>{t('board.states.emptyColumn')}</p>
          ) : (
            <CardList
              cards={cards}
              rowGapClass='pb-6px'
              // The tab scrolls as a whole, so a long column gets its own bounded viewport.
              height='min(60vh, 520px)'
              className='shrink-0'
              renderCard={(card) => (
                <BoardCardTile
                  key={card.id}
                  card={card}
                  onOpen={onOpenCard}
                  actions={<MoveToMenu board={board} card={card} />}
                />
              )}
            />
          )}
          <QuickAddCard board={board} columnKey={column.key} columnLabel={name} />
        </div>
      )}
    </section>
  );
};

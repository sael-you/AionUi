/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Select } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary, BoardColumn } from '@/common/types/board';
import { CardWithActions } from '@/renderer/components/board/card/CardWithActions';
import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import { BoardSelect } from '@/renderer/components/board/BoardSelect';
import { CardList } from '@/renderer/components/board/column/CardList';
import { ColumnMarks } from '@/renderer/components/board/column/ColumnMarks';
import { QuickAddCard } from '@/renderer/components/board/column/QuickAddCard';
import { WipCounter } from '@/renderer/components/board/column/WipCounter';
import { columnName } from '@/renderer/components/board/utils/boardFormat';
import { activeCardCount, groupColumnsByCategory, moveLock } from '@/renderer/components/board/utils/boardModel';

/** ≤768 px: one column at a time behind a switcher (grouped by category); no drag — cards move with "Move to…". */
export const MobileBoard: React.FC<{
  board: BoardController;
  columns: BoardColumn[];
  groups: Record<string, BoardCardSummary[]>;
  onOpenCard: (cardId: string) => void;
}> = ({ board, columns, groups, onOpenCard }) => {
  const { t } = useTranslation();
  const cards = board.snapshot?.cards ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = columns.find((column) => column.key === selected) ?? columns[0];
  if (!current) return null;
  const name = columnName(current, t);
  const visible = groups[current.key] ?? [];

  return (
    <div className='flex-1 min-h-0 flex flex-col gap-8px px-12px pb-12px'>
      <BoardSelect
        ariaLabel={t('board.column.switcher')}
        value={current.key}
        onChange={(value: string) => setSelected(value)}
        className='shrink-0'
      >
        {groupColumnsByCategory(columns).map((group, index) => (
          <Select.OptGroup key={`${group.category}-${index}`} label={t(`board.categories.${group.category}`)}>
            {group.columns.map((column) => (
              <Select.Option key={column.key} value={column.key}>
                {`${columnName(column, t)} · ${activeCardCount(cards, column.key)}`}
              </Select.Option>
            ))}
          </Select.OptGroup>
        ))}
      </BoardSelect>
      <section
        aria-label={t('board.column.region', { column: name, count: activeCardCount(cards, current.key) })}
        data-board-column={current.key}
        className='flex-1 min-h-0 flex flex-col gap-8px'
      >
        <div className='flex items-center gap-8px'>
          <h2 className='m-0 text-15px font-medium text-t-primary flex-1 truncate'>{name}</h2>
          <WipCounter column={current} count={activeCardCount(cards, current.key)} />
        </div>
        <ColumnMarks column={current} cards={cards} />
        <div className='flex-1 min-h-0 overflow-y-auto flex flex-col gap-8px'>
          {visible.length === 0 ? (
            <p className='m-0 text-13px text-t-secondary text-center py-16px'>{t('board.states.emptyColumn')}</p>
          ) : (
            <CardList
              cards={visible}
              renderCard={(card) => (
                <CardWithActions
                  key={card.id}
                  card={card}
                  onOpen={onOpenCard}
                  readOnly={board.readOnly}
                  lock={moveLock(card, current)}
                  columnLabel={name}
                />
              )}
            />
          )}
        </div>
        <QuickAddCard readOnly={board.readOnly} columnKey={current.key} columnLabel={name} />
      </section>
    </div>
  );
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { More } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCardSummary } from '@/common/types/board';

import type { BoardController } from '../hooks/useBoard';
import { columnName } from '../utils/boardFormat';
import { activeCardCount, cardRef, endAnchor, moveLock, visibleColumns, wipState } from '../utils/boardModel';

/** Focus a card's open target after it moved (it may have re-mounted in another column). */
export const focusCard = (cardId: string): void => {
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`[data-board-card-open="${CSS.escape(cardId)}"]`);
    target?.focus();
  });
};

/**
 * Card actions menu with "Move to…" — the drag-free way to move a card (narrow
 * layouts, keyboard and screen-reader users). A full column stays selectable:
 * the server answers `board_wip_limit` and the toast offers "Move anyway".
 */
export const MoveToMenu: React.FC<{ board: BoardController; card: BoardCardSummary }> = ({ board, card }) => {
  const { t } = useTranslation();
  const snapshot = board.snapshot;
  if (!snapshot) return null;
  const ref = cardRef(card.number);
  const disabled = board.readOnly || Boolean(card.archived_at);
  const columns = visibleColumns(snapshot.columns);
  // A card waiting for a decision (or in Deploying) moves only from the drawer:
  // every target is disabled and the menu says why.
  const lock = moveLock(
    card,
    snapshot.columns.find((column) => column.key === card.column_key)
  );

  const droplist = (
    <Menu
      onClickMenuItem={(key) => {
        if (!key.startsWith('move:')) return;
        const toColumn = key.slice('move:'.length);
        void board.moveCard(card.id, toColumn, endAnchor(snapshot.cards, toColumn, card.id)).then(() => {
          focusCard(card.id);
        });
      }}
    >
      <Menu.ItemGroup title={t('board.card.moveTo')}>
        {lock && (
          <Menu.Item key='lock-reason' disabled aria-disabled>
            {t(lock === 'decision' ? 'board.card.moveLocked' : 'board.card.moveAutomated')}
          </Menu.Item>
        )}
        {columns.map((column) => {
          const name = columnName(column, t);
          const current = column.key === card.column_key;
          const wip = wipState(column, activeCardCount(snapshot.cards, column.key));
          const full = !current && (wip === 'full' || wip === 'over');
          return (
            <Menu.Item
              key={`move:${column.key}`}
              disabled={current || Boolean(lock)}
              aria-disabled={current || Boolean(lock) || undefined}
            >
              {current
                ? t('board.card.moveToCurrent', { column: name })
                : full
                  ? t('board.card.moveToFull', { column: name })
                  : name}
            </Menu.Item>
          );
        })}
      </Menu.ItemGroup>
    </Menu>
  );

  return (
    <Dropdown droplist={droplist} trigger='click' position='br' disabled={disabled} unmountOnExit>
      <Button
        type='text'
        size='mini'
        disabled={disabled}
        icon={<More theme='outline' size='14' fill='currentColor' />}
        aria-label={t('board.card.actions', { ref })}
        aria-haspopup='menu'
      />
    </Dropdown>
  );
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tasks tab of the project panel (third tab next to Files / Changes, SPEC §8):
 * the project's board in a narrow, stacked form — column chips with counts,
 * collapsible columns, quick add, the card drawer and "Open full board".
 */

import { Button } from '@arco-design/web-react';
import { ViewGridDetail } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { BoardBanners, BoardDisabledState, BoardErrorState, BoardLiveRegion, BoardSkeleton } from '../BoardStates';
import { CardDrawer } from '../CardDrawer';
import { ForceReasonDialog } from '../card/ForceReasonDialog';
import type { BoardController } from '../hooks/useBoard';
import { BoardProvider } from '../hooks/boardContext';
import { columnName } from '../utils/boardFormat';
import { activeCardCount, groupCardsByColumn, groupColumnsByCategory, visibleColumns } from '../utils/boardModel';
import { StackedColumn } from './StackedColumn';
import { iconLabelButton } from '../utils/boardStyles';

const focusColumnHeading = (columnKey: string): void => {
  requestAnimationFrame(() => {
    const heading = document.getElementById(`board-stack-${columnKey}`);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus();
  });
};

export const TasksTab: React.FC<{ board: BoardController }> = ({ board }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  // null = defaults (terminal "done" columns start collapsed) until the user toggles one.
  const [collapsed, setCollapsed] = useState<Set<string> | null>(null);
  const snapshot = board.snapshot;

  // Keyed on cards / columns (not the snapshot, which a seq bump replaces).
  const snapshotColumns = snapshot?.columns;
  const snapshotCards = snapshot?.cards;
  const columns = useMemo(() => (snapshotColumns ? visibleColumns(snapshotColumns) : []), [snapshotColumns]);
  const groups = useMemo(
    () => (snapshotCards ? groupCardsByColumn(columns, snapshotCards) : {}),
    [snapshotCards, columns]
  );
  const collapsedKeys = collapsed ?? new Set(columns.filter((column) => column.category === 'done').map((c) => c.key));

  const toggle = (key: string) => {
    const next = new Set(collapsedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };

  const expand = (key: string) => {
    if (collapsedKeys.has(key)) toggle(key);
    focusColumnHeading(key);
  };

  let body: React.ReactNode;
  if (!snapshot) {
    body = board.error ? (
      <BoardErrorState error={board.error} onRetry={() => void board.reload()} />
    ) : (
      <BoardSkeleton layout='stacked' />
    );
  } else if (!snapshot.settings.enabled && snapshot.cards.length === 0) {
    body = <BoardDisabledState board={board} />;
  } else {
    body = (
      <>
        <BoardBanners board={board} />
        <div role='list' aria-label={t('board.column.chips')} className='flex flex-wrap gap-6px px-12px pt-8px'>
          {columns.map((column) => {
            const name = columnName(column, t);
            const count = activeCardCount(snapshot.cards, column.key);
            return (
              <span role='listitem' key={column.key}>
                <Button
                  size='mini'
                  shape='round'
                  aria-label={t('board.column.region', { column: name, count })}
                  onClick={() => expand(column.key)}
                >
                  {name} <span className='tabular-nums text-t-secondary'>{count}</span>
                </Button>
              </span>
            );
          })}
        </div>
        <div className='flex-1 min-h-0 overflow-y-auto px-12px py-8px flex flex-col gap-12px'>
          {snapshot.cards.length === 0 && (
            <p className='m-0 text-13px text-t-secondary'>{t('board.states.emptyBoard')}</p>
          )}
          {groupColumnsByCategory(columns).map((group, index) => (
            <div
              key={`${group.category}-${index}`}
              role='group'
              aria-labelledby={`board-stack-group-${index}`}
              className='flex flex-col gap-10px'
            >
              <h3 id={`board-stack-group-${index}`} className='m-0 text-11px font-medium text-t-secondary'>
                {t(`board.categories.${group.category}`)}
              </h3>
              {group.columns.map((column) => (
                <StackedColumn
                  key={column.key}
                  board={board}
                  column={column}
                  cards={groups[column.key] ?? []}
                  allCards={snapshot.cards}
                  collapsed={collapsedKeys.has(column.key)}
                  onToggle={() => toggle(column.key)}
                  onOpenCard={setOpenCardId}
                />
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <BoardProvider board={board}>
      <div className='h-full flex flex-col min-h-0' data-board-tasks-tab>
        <div className='flex items-center gap-8px ps-20px pe-8px py-6px flex-shrink-0'>
          <span className='text-12px text-t-secondary flex-1 truncate'>{t('board.sharedByProject')}</span>
          <Button
            className={iconLabelButton('mini')}
            size='mini'
            type='text'
            icon={<ViewGridDetail theme='outline' size='14' fill='currentColor' />}
            onClick={() => void navigate(`/board/${encodeURIComponent(board.projectId)}`)}
          >
            {t('board.openFullBoard')}
          </Button>
        </div>
        {body}
        <BoardLiveRegion announcement={board.announcement} />
        <CardDrawer board={board} cardId={openCardId} onClose={() => setOpenCardId(null)} />
        <ForceReasonDialog board={board} />
      </div>
    </BoardProvider>
  );
};

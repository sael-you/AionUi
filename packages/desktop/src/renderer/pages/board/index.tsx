/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Full project board, `/board/:projectId` (SPEC §8): columns side by side with
 * horizontal scroll and drag and drop, filter bar, archived toggle, column
 * settings and the card drawer. ≤768 px shows one column at a time.
 */

import { Button, Result } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import {
  BoardBanners,
  BoardDisabledState,
  BoardErrorState,
  BoardLiveRegion,
  BoardSkeleton,
} from '@/renderer/components/board/BoardStates';
import { CardDrawer } from '@/renderer/components/board/CardDrawer';
import { ForceReasonDialog } from '@/renderer/components/board/card/ForceReasonDialog';
import { useBoard } from '@/renderer/components/board/hooks/useBoard';
import { useProjectWorkspace } from '@/renderer/components/board/hooks/useBoardDirectory';
import { useBoardNarrow, useReducedMotion } from '@/renderer/components/board/hooks/useMediaQuery';
import { groupCardsByColumn, visibleColumns } from '@/renderer/components/board/utils/boardModel';
import { useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { useAuth } from '@/renderer/hooks/context/AuthContext';

import { BoardDndArea } from './components/BoardDndArea';
import { BoardHeader } from './components/BoardHeader';
import { ColumnSettingsDialog } from './components/ColumnSettingsDialog';
import { FilterBar } from './components/FilterBar';
import { MobileBoard } from './components/MobileBoard';
import { EMPTY_FILTERS, matchesFilters, type BoardFilters } from './utils/boardFilters';

export const BoardPage: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const narrow = useBoardNarrow();
  const reducedMotion = useReducedMotion();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const board = useBoard(projectId, { includeArchived, onOpenCard: setOpenCardId });
  // The project's colour identity follows its workspace (the sidebar's colour key).
  const project = useProjectTheme(useProjectWorkspace(projectId).workspace);
  const { data: projectDetail } = useSWR(projectId ? ['board-project', projectId] : null, ([, id]: [string, string]) =>
    ipcBridge.project.get.invoke({ project_id: id })
  );

  const snapshot = board.snapshot;
  const columns = useMemo(() => (snapshot ? visibleColumns(snapshot.columns) : []), [snapshot]);
  const userId = user?.id ?? null;
  const visibleCards = useMemo(
    () => (snapshot ? snapshot.cards.filter((card) => matchesFilters(card, filters, userId)) : []),
    [snapshot, filters, userId]
  );
  const groups = useMemo(() => groupCardsByColumn(columns, visibleCards), [columns, visibleCards]);

  const header = (
    <BoardHeader
      board={board}
      projectName={projectDetail?.name ?? null}
      project={project}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  let body: React.ReactNode;
  if (board.unavailable) {
    body = (
      <Result
        status='404'
        title={t('board.states.notFoundTitle')}
        subTitle={t('board.states.notFoundDescription')}
        extra={
          <Button type='primary' onClick={() => void navigate('/guid')}>
            {t('board.states.backToChats')}
          </Button>
        }
      />
    );
  } else if (!snapshot) {
    body = board.error ? (
      <BoardErrorState error={board.error} onRetry={() => void board.reload()} />
    ) : (
      <BoardSkeleton layout={narrow ? 'stacked' : 'columns'} />
    );
  } else if (!snapshot.settings.enabled && snapshot.cards.length === 0 && !includeArchived) {
    body = <BoardDisabledState board={board} />;
  } else {
    body = (
      <>
        <BoardBanners board={board} />
        <FilterBar
          cards={snapshot.cards}
          filters={filters}
          onChange={setFilters}
          includeArchived={includeArchived}
          onIncludeArchivedChange={setIncludeArchived}
          visibleCount={visibleCards.length}
          totalCount={snapshot.cards.length}
        />
        {snapshot.cards.length === 0 && (
          <p className='m-0 px-16px pb-8px text-13px text-t-secondary'>{t('board.states.emptyBoard')}</p>
        )}
        {snapshot.cards.length > 0 && visibleCards.length === 0 && (
          <p className='m-0 px-16px pb-8px text-13px text-t-secondary' role='status'>
            {t('board.states.noMatches')}
          </p>
        )}
        {narrow ? (
          <MobileBoard board={board} columns={columns} groups={groups} onOpenCard={setOpenCardId} />
        ) : (
          <BoardDndArea
            board={board}
            columns={columns}
            groups={groups}
            dragEnabled={!board.readOnly}
            reducedMotion={reducedMotion}
            onOpenCard={setOpenCardId}
          />
        )}
      </>
    );
  }

  return (
    <div
      className='size-full flex flex-col min-h-0 bg-1'
      data-board-page={projectId}
      data-project-surface={project ? 'board' : undefined}
      {...project?.dataAttributes}
      style={project?.style}
    >
      {header}
      {body}
      <BoardLiveRegion announcement={board.announcement} />
      <CardDrawer board={board} cardId={openCardId} onClose={() => setOpenCardId(null)} />
      <ForceReasonDialog board={board} />
      <ColumnSettingsDialog board={board} visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

/** Route element: `/board/:projectId`. */
const BoardRoute: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  // Keyed by project so filters, drawer and drag state never leak between boards.
  return <BoardPage key={projectId} projectId={projectId} />;
};

export default BoardRoute;

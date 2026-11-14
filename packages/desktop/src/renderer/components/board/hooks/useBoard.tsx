/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The board controller: one project's board snapshot (SWR, shared by the Tasks
 * tab and the board page), live hints folded in, and every board-level write
 * with its user feedback — optimistic moves with rollback, code → i18n toasts,
 * "Move anyway" on a full column, and `aria-live` announcements.
 */

import { Button, Message, Notification } from '@arco-design/web-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import {
  BOARD_ERROR_CODES,
  BOARD_LIMITS,
  type BoardCard,
  type BoardCardSummary,
  type BoardColumnInput,
  type BoardSnapshot,
} from '@/common/types/board';

import { boardErrorCode, boardErrorKey, isBoardUnavailableError } from '../utils/boardErrors';
import { columnNameByKey } from '../utils/boardFormat';
import {
  activeCardCount,
  applyBoardChange,
  applyOptimisticMove,
  cardRef,
  isNoopMove,
  restoreCard,
  upsertCard,
  type MoveAnchor,
} from '../utils/boardModel';
import { useBoardLiveFeed } from './useBoardLiveFeed';

type BoardKey = readonly ['board', string, 'all' | 'active'];

/** SWR key of a project's board; the Tasks tab and the board page share it. */
export const boardKey = (projectId: string, includeArchived: boolean): BoardKey =>
  ['board', projectId, includeArchived ? 'all' : 'active'] as const;

const fetchBoard = ([, projectId, scope]: BoardKey): Promise<BoardSnapshot> =>
  ipcBridge.board.get.invoke({ project_id: projectId, include_archived: scope === 'all' });

/**
 * Live hints keep the snapshot fresh; a focus refetch would only race optimistic
 * moves. Toggling "show archived" keeps the previous board on screen while the
 * other slice loads.
 */
const SWR_OPTIONS = { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true } as const;

export type MoveOptions = {
  /** Owner override of the WIP limit ("Move anyway"). */
  force?: boolean;
};

export type BoardAnnouncement = { text: string; id: number };

export type BoardController = {
  projectId: string;
  snapshot: BoardSnapshot | undefined;
  error: unknown;
  isLoading: boolean;
  /** The project has no board (temp project, unknown project). */
  unavailable: boolean;
  includeArchived: boolean;
  /** Archived project → the board is read-only (R: `board_archived`). */
  readOnly: boolean;
  /** Latest polite announcement for the board's `aria-live` region. */
  announcement: BoardAnnouncement | null;
  announce: (text: string) => void;
  reload: () => Promise<void>;
  moveCard: (cardId: string, toColumn: string, anchor: MoveAnchor, options?: MoveOptions) => Promise<boolean>;
  createCard: (columnKey: string, title: string) => Promise<BoardCard | null>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  saveColumns: (columns: BoardColumnInput[]) => Promise<boolean>;
  reactivate: () => Promise<boolean>;
  /** Fold a card returned by another write (drawer PATCH, archive…) into the snapshot. */
  applyCard: (card: BoardCardSummary) => void;
};

/**
 * `projectId` may be empty (no project yet): nothing is fetched or subscribed.
 * `unavailable` is true once the server says the project has no board (temp
 * project → `board_no_project`, unknown project → 404); entry points hide then.
 */
export function useBoard(projectId: string, options: { includeArchived?: boolean } = {}): BoardController {
  const includeArchived = Boolean(options.includeArchived);
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(
    projectId ? boardKey(projectId, includeArchived) : null,
    fetchBoard,
    SWR_OPTIONS
  );

  const snapshotRef = useRef(data);
  snapshotRef.current = data;

  const [announcement, setAnnouncement] = useState<BoardAnnouncement | null>(null);
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, id: (previous?.id ?? 0) + 1 }));
  }, []);

  const reload = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const update = useCallback(
    (fn: (snapshot: BoardSnapshot) => BoardSnapshot) =>
      mutate((current) => (current ? fn(current) : current), { revalidate: false }),
    [mutate]
  );

  const applyCard = useCallback(
    (card: BoardCardSummary) => {
      void update((snapshot) => upsertCard(snapshot, card, includeArchived));
    },
    [update, includeArchived]
  );

  useBoardLiveFeed(projectId || null, {
    onChange: (change) => {
      let needsReload = false;
      void mutate(
        (current) => {
          if (!current) return current;
          const result = applyBoardChange(current, change, includeArchived);
          needsReload = result.reload;
          return result.next;
        },
        { revalidate: false }
      ).then(() => {
        if (needsReload) void mutate();
      });
    },
    onResync: () => {
      void mutate();
    },
  });

  const readOnly = Boolean(data?.settings.archived_at);

  const moveCard = useCallback(
    async (cardId: string, toColumn: string, anchor: MoveAnchor, moveOptions: MoveOptions = {}): Promise<boolean> => {
      const current = snapshotRef.current;
      if (!current || current.settings.archived_at) return false;
      const card = current.cards.find((existing) => existing.id === cardId);
      if (!card || card.archived_at) return false;
      if (isNoopMove(current.cards, card, toColumn, anchor)) return true;

      const ref = cardRef(card.number);
      const fromName = columnNameByKey(current.columns, card.column_key, t);
      const toName = columnNameByKey(current.columns, toColumn, t);

      await update((snapshot) => applyOptimisticMove(snapshot, cardId, toColumn, anchor));
      try {
        const moved = await ipcBridge.board.moveCard.invoke({
          card_id: cardId,
          to_column: toColumn,
          ...anchor,
          expected_column: card.column_key,
          ...(moveOptions.force ? { force: true } : {}),
        });
        await update((snapshot) => upsertCard(snapshot, moved, includeArchived));
        const column = current.columns.find((candidate) => candidate.key === toColumn);
        const count = activeCardCount(snapshotRef.current?.cards ?? [], toColumn);
        let message = t('board.dnd.moved', { ref, column: toName });
        if (column?.wip_limit && count >= column.wip_limit) {
          message = `${message} ${t('board.wip.fullAnnouncement', { column: toName, count, limit: column.wip_limit })}`;
        }
        announce(message);
        return true;
      } catch (moveError) {
        await update((snapshot) => restoreCard(snapshot, card));
        const code = boardErrorCode(moveError);
        const title = t('board.errors.moveFailed', { ref });
        if (code === BOARD_ERROR_CODES.wipLimit) {
          const column = current.columns.find((candidate) => candidate.key === toColumn);
          const limit = column?.wip_limit ?? 0;
          announce(
            `${t('board.dnd.rolledBack', { ref, column: fromName })} ${t('board.wip.fullAnnouncement', {
              column: toName,
              count: activeCardCount(current.cards, toColumn),
              limit,
            })}`
          );
          const id = `board-wip-${cardId}`;
          Notification.warning({
            id,
            title,
            content: t('board.errors.wipLimit', { column: toName }),
            duration: 8000,
            btn: (
              <Button
                type='primary'
                size='small'
                onClick={() => {
                  Notification.remove(id);
                  void moveCard(cardId, toColumn, anchor, { force: true });
                }}
              >
                {t('board.errors.moveAnyway')}
              </Button>
            ),
          });
          return false;
        }
        announce(`${t('board.dnd.rolledBack', { ref, column: fromName })} ${t(boardErrorKey(moveError))}`);
        Notification.error({ title, content: t(boardErrorKey(moveError)) });
        if (code === BOARD_ERROR_CODES.versionConflict || code === BOARD_ERROR_CODES.notFound) void mutate();
        return false;
      }
    },
    [update, includeArchived, t, announce, mutate]
  );

  const createCard = useCallback(
    async (columnKey: string, rawTitle: string): Promise<BoardCard | null> => {
      const title = rawTitle.trim();
      if (!title || readOnly) return null;
      if (title.length > BOARD_LIMITS.title) {
        Message.warning(t('board.quickAdd.titleTooLong', { max: BOARD_LIMITS.title }));
        return null;
      }
      try {
        const created = await ipcBridge.board.createCard.invoke({
          project_id: projectId,
          title,
          column_key: columnKey,
        });
        await update((snapshot) => upsertCard(snapshot, created, includeArchived));
        const text = t('board.quickAdd.created', { ref: cardRef(created.number) });
        Message.success(text);
        announce(text);
        return created;
      } catch (createError) {
        Notification.error({ title: t('board.quickAdd.failed'), content: t(boardErrorKey(createError)) });
        return null;
      }
    },
    [projectId, readOnly, update, includeArchived, t, announce]
  );

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const settings = snapshotRef.current?.settings;
      try {
        await ipcBridge.board.updateSettings.invoke({
          project_id: projectId,
          version: settings?.version ?? 0,
          enabled,
          template: settings?.template ?? 'simple',
        });
        await mutate();
        Message.success(t(enabled ? 'board.states.enabled' : 'board.turnedOff'));
        return true;
      } catch (settingsError) {
        Notification.error({
          title: t(enabled ? 'board.states.enableFailed' : 'board.errors.saveFailed'),
          content: t(boardErrorKey(settingsError)),
        });
        if (boardErrorCode(settingsError) === BOARD_ERROR_CODES.versionConflict) void mutate();
        return false;
      }
    },
    [projectId, mutate, t]
  );

  const saveColumns = useCallback(
    async (columns: BoardColumnInput[]): Promise<boolean> => {
      const settings = snapshotRef.current?.settings;
      if (!settings) return false;
      try {
        await ipcBridge.board.updateColumns.invoke({ project_id: projectId, version: settings.version, columns });
        await mutate();
        Message.success(t('board.settings.saved'));
        return true;
      } catch (columnsError) {
        Notification.error({ title: t('board.settings.saveFailed'), content: t(boardErrorKey(columnsError)) });
        if (boardErrorCode(columnsError) === BOARD_ERROR_CODES.versionConflict) void mutate();
        return false;
      }
    },
    [projectId, mutate, t]
  );

  const reactivate = useCallback(async (): Promise<boolean> => {
    try {
      // Unarchiving the project clears `board_settings.archived_at` (SPEC §6 ProjectBoardPorts).
      await ipcBridge.sidebar.unarchiveProject.invoke({ project_id: projectId });
      await mutate();
      Message.success(t('board.states.reactivated'));
      return true;
    } catch (reactivateError) {
      Notification.error({ title: t('board.states.reactivateFailed'), content: t(boardErrorKey(reactivateError)) });
      return false;
    }
  }, [projectId, mutate, t]);

  return useMemo(
    () => ({
      projectId,
      snapshot: data,
      error,
      isLoading,
      unavailable: !data && Boolean(error) && isBoardUnavailableError(error),
      includeArchived,
      readOnly,
      announcement,
      announce,
      reload,
      moveCard,
      createCard,
      setEnabled,
      saveColumns,
      reactivate,
      applyCard,
    }),
    [
      projectId,
      data,
      error,
      isLoading,
      includeArchived,
      readOnly,
      announcement,
      announce,
      reload,
      moveCard,
      createCard,
      setEnabled,
      saveColumns,
      reactivate,
      applyCard,
    ]
  );
}

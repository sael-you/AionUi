/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One card's detail (fields, dependencies, last events) and its comments, kept
 * live from `board.changed` hints for that card, plus the drawer's writes. Every
 * PATCH carries the version the edit started from; a stale edit (409
 * `board_version_conflict`) reloads the card instead of overwriting.
 */

import { Message, Notification } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import {
  BOARD_ERROR_CODES,
  type BoardAssignRequest,
  type BoardAssignResponse,
  type BoardCard,
  type BoardCardDetail,
  type BoardEvent,
  type BoardGateRequest,
  type UpdateBoardCardRequest,
} from '@/common/types/board';

import { boardErrorCode, boardErrorKey } from '../utils/boardErrors';
import { cardRef } from '../utils/boardModel';

/** Upper bound of comment pages read in one go (100 per page server-side). */
const MAX_COMMENT_PAGES = 20;

const fetchComments = async (cardId: string): Promise<BoardEvent[]> => {
  const items: BoardEvent[] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page += 1) {
    // Cursor paging: each page needs the previous page's cursor, so the reads are sequential.
    // eslint-disable-next-line no-await-in-loop
    const result = await ipcBridge.board.listComments.invoke({ card_id: cardId, after_seq: afterSeq });
    items.push(...(result?.items ?? []));
    if (!result?.has_more || result.next_after_seq === null) break;
    afterSeq = result.next_after_seq;
  }
  return items;
};

export type CardFieldsPatch = Omit<UpdateBoardCardRequest, 'version'>;

/** A random idempotency key; callers keep it for retries of the same request (SPEC §5/§6). */
export const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type AssignInput = Omit<BoardAssignRequest, 'idempotency_key'>;

export type CardDetailController = {
  detail: BoardCardDetail | undefined;
  comments: BoardEvent[] | undefined;
  error: unknown;
  isLoading: boolean;
  reload: () => Promise<void>;
  /** PATCH changed fields. Resolves to the updated card, or null on failure (already reported). */
  updateFields: (patch: CardFieldsPatch) => Promise<BoardCard | null>;
  setBlocked: (blocked: boolean, reason?: string) => Promise<boolean>;
  setArchived: (archived: boolean) => Promise<boolean>;
  addComment: (body: string) => Promise<boolean>;
  addDependency: (dependsOn: string) => Promise<boolean>;
  removeDependency: (dependsOn: string) => Promise<boolean>;
  /** Owner decision on a gate card; `key` is reused when the same decision is retried. */
  decideGate: (decision: BoardGateRequest['decision'], reason: string, key: string) => Promise<boolean>;
  /** Assign (or, with `brainstorm`, brainstorm); `key` is reused for retries and Resend. */
  assign: (input: AssignInput, key: string) => Promise<BoardAssignResponse | null>;
  brainstorm: (assistantId: string | undefined, key: string) => Promise<BoardAssignResponse | null>;
  /** Answer an open question: a comment with `answers` (R6) addressed back to the asking department. */
  answerQuestion: (questionId: string, toDepartment: string, body: string) => Promise<boolean>;
};

export function useCardDetail(cardId: string | null, onCardChanged: (card: BoardCard) => void): CardDetailController {
  const { t } = useTranslation();
  const detailSwr = useSWR(cardId ? ['board-card', cardId] : null, ([, id]: [string, string]) =>
    ipcBridge.board.getCard.invoke({ card_id: id })
  );
  const commentsSwr = useSWR(cardId ? ['board-card-comments', cardId] : null, ([, id]: [string, string]) =>
    fetchComments(id)
  );
  const { mutate: mutateDetail } = detailSwr;
  const { mutate: mutateComments } = commentsSwr;

  useEffect(() => {
    if (!cardId) return;
    const unsubscribers = [
      ipcBridge.board.changed.on((change) => {
        if (change?.event?.card_id !== cardId) return;
        void mutateDetail();
        if (change.event.kind === 'commented') void mutateComments();
      }),
      ipcBridge.realtime.reconnected.on(() => {
        void mutateDetail();
        void mutateComments();
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [cardId, mutateDetail, mutateComments]);

  const reload = useCallback(async () => {
    await Promise.all([mutateDetail(), mutateComments()]);
  }, [mutateDetail, mutateComments]);

  const card = detailSwr.data?.card;

  /** Report a failed write; a stale version reloads the card so the user sees what changed. */
  const reportFailure = useCallback(
    (error: unknown, titleKey: string) => {
      Notification.error({ title: t(titleKey), content: t(boardErrorKey(error)) });
      const code = boardErrorCode(error);
      if (code === BOARD_ERROR_CODES.versionConflict || code === BOARD_ERROR_CODES.notFound) void mutateDetail();
    },
    [t, mutateDetail]
  );

  const applyUpdated = useCallback(
    async (updated: BoardCard) => {
      await mutateDetail((current) => (current ? { ...current, card: updated } : current), { revalidate: true });
      onCardChanged(updated);
    },
    [mutateDetail, onCardChanged]
  );

  const updateFields = useCallback(
    async (patch: CardFieldsPatch): Promise<BoardCard | null> => {
      if (!card) return null;
      try {
        const updated = await ipcBridge.board.updateCard.invoke({ card_id: card.id, version: card.version, ...patch });
        await applyUpdated(updated);
        return updated;
      } catch (error) {
        reportFailure(error, 'board.errors.saveFailed');
        return null;
      }
    },
    [card, applyUpdated, reportFailure]
  );

  const setBlocked = useCallback(
    async (blocked: boolean, reason?: string): Promise<boolean> => {
      if (!card) return false;
      const updated = await updateFields({ blocked, blocked_reason: blocked ? reason?.trim() || null : null });
      if (!updated) return false;
      Message.success(
        t(blocked ? 'board.drawer.blockedToast' : 'board.drawer.unblockedToast', { ref: cardRef(card.number) })
      );
      return true;
    },
    [card, updateFields, t]
  );

  const setArchived = useCallback(
    async (archived: boolean): Promise<boolean> => {
      if (!card) return false;
      try {
        const updated = archived
          ? await ipcBridge.board.archiveCard.invoke({ card_id: card.id })
          : await ipcBridge.board.restoreCard.invoke({ card_id: card.id });
        await applyUpdated(updated);
        Message.success(
          t(archived ? 'board.drawer.archivedToast' : 'board.drawer.restoredToast', { ref: cardRef(card.number) })
        );
        return true;
      } catch (error) {
        reportFailure(error, 'board.errors.saveFailed');
        return false;
      }
    },
    [card, applyUpdated, reportFailure, t]
  );

  const addComment = useCallback(
    async (body: string): Promise<boolean> => {
      if (!card || !body.trim()) return false;
      try {
        const event = await ipcBridge.board.addComment.invoke({ card_id: card.id, body: body.trim() });
        await mutateComments(
          (current) =>
            current && event && !current.some((item) => item.id === event.id) ? [...current, event] : current,
          { revalidate: true }
        );
        return true;
      } catch (error) {
        reportFailure(error, 'board.drawer.commentFailed');
        return false;
      }
    },
    [card, mutateComments, reportFailure]
  );

  const changeDependency = useCallback(
    async (dependsOn: string, add: boolean): Promise<boolean> => {
      if (!card) return false;
      try {
        if (add) await ipcBridge.board.addDependency.invoke({ card_id: card.id, depends_on: dependsOn });
        else await ipcBridge.board.removeDependency.invoke({ card_id: card.id, depends_on: dependsOn });
        const fresh = await mutateDetail();
        if (fresh?.card) onCardChanged(fresh.card);
        return true;
      } catch (error) {
        reportFailure(error, 'board.errors.saveFailed');
        return false;
      }
    },
    [card, mutateDetail, onCardChanged, reportFailure]
  );

  const decideGate = useCallback(
    async (decision: BoardGateRequest['decision'], reason: string, key: string): Promise<boolean> => {
      if (!card) return false;
      try {
        const updated = await ipcBridge.board.decideGate.invoke({
          card_id: card.id,
          decision,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          idempotency_key: key,
        });
        await applyUpdated(updated);
        Message.success(
          t(decision === 'approve' ? 'board.gate.approved' : 'board.gate.rejected', { ref: cardRef(card.number) })
        );
        return true;
      } catch (error) {
        reportFailure(error, 'board.gate.decisionFailed');
        return false;
      }
    },
    [card, applyUpdated, reportFailure, t]
  );

  /** Shared tail of assign / brainstorm: fold the card in, explain a fallback or an undelivered packet. */
  const afterAssign = useCallback(
    async (response: BoardAssignResponse, successKey: string) => {
      await applyUpdated(response.card);
      Message.success(t(successKey, { ref: cardRef(response.card.number) }));
      if (response.parent_fallback) Message.info(t(`board.assign.fallback.${response.parent_fallback}`));
      if (!response.packet_sent) Message.warning(t('board.assign.packetFailed'));
    },
    [applyUpdated, t]
  );

  const assign = useCallback(
    async (input: AssignInput, key: string): Promise<BoardAssignResponse | null> => {
      if (!card) return null;
      try {
        const response = await ipcBridge.board.assign.invoke({ card_id: card.id, ...input, idempotency_key: key });
        await afterAssign(response, 'board.assign.assigned');
        return response;
      } catch (error) {
        reportFailure(error, 'board.assign.failed');
        return null;
      }
    },
    [card, afterAssign, reportFailure]
  );

  const brainstorm = useCallback(
    async (assistantId: string | undefined, key: string): Promise<BoardAssignResponse | null> => {
      if (!card) return null;
      try {
        const response = await ipcBridge.board.brainstorm.invoke({
          card_id: card.id,
          ...(assistantId ? { assistant_id: assistantId } : {}),
          idempotency_key: key,
        });
        await afterAssign(response, 'board.brainstorm.started');
        return response;
      } catch (error) {
        reportFailure(error, 'board.assign.failed');
        return null;
      }
    },
    [card, afterAssign, reportFailure]
  );

  const answerQuestion = useCallback(
    async (questionId: string, toDepartment: string, body: string): Promise<boolean> => {
      if (!card || !body.trim()) return false;
      try {
        await ipcBridge.board.addComment.invoke({
          card_id: card.id,
          body: body.trim(),
          answers: questionId,
          to_department: toDepartment,
        });
        await Promise.all([mutateDetail(), mutateComments()]);
        Message.success(t('board.questions.sent'));
        return true;
      } catch (error) {
        reportFailure(error, 'board.drawer.commentFailed');
        return false;
      }
    },
    [card, mutateDetail, mutateComments, reportFailure, t]
  );

  const addDependency = useCallback((dependsOn: string) => changeDependency(dependsOn, true), [changeDependency]);
  const removeDependency = useCallback((dependsOn: string) => changeDependency(dependsOn, false), [changeDependency]);

  return useMemo(
    () => ({
      detail: detailSwr.data,
      comments: commentsSwr.data,
      error: detailSwr.error,
      isLoading: detailSwr.isLoading,
      reload,
      updateFields,
      setBlocked,
      setArchived,
      addComment,
      addDependency,
      removeDependency,
      decideGate,
      assign,
      brainstorm,
      answerQuestion,
    }),
    [
      detailSwr.data,
      commentsSwr.data,
      detailSwr.error,
      detailSwr.isLoading,
      reload,
      updateFields,
      setBlocked,
      setArchived,
      addComment,
      addDependency,
      removeDependency,
      decideGate,
      assign,
      brainstorm,
      answerQuestion,
    ]
  );
}

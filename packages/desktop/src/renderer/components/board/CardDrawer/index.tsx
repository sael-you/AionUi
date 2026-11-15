/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Card drawer (SPEC §8, S2 scope): title + description (edit in place), fields,
 * reviews, questions, dependencies, linked conversations, comments, activity;
 * actions: the gate decision / owner override, Assign, Brainstorm, Block/Unblock
 * and Archive/Restore. Focus is trapped while open and returns to where it came
 * from (the card) on close.
 */

import { Button, Drawer, Modal, Skeleton, Tag, type DrawerProps } from '@arco-design/web-react';
import { Close, Inbox, Lightning, Lock, Undo, Unlock, UserToUserTransmission } from '@icon-park/react';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardErrorState } from '../BoardStates';
import type { BoardController } from '../hooks/useBoard';
import { useCardDetail, type CardDetailController } from '../hooks/useCardDetail';
import { useBoardNarrow } from '../hooks/useMediaQuery';
import { focusCard } from '../card/MoveToMenu';
import { cardRef } from '../utils/boardModel';
import { AssignDialog } from './actions/AssignDialog';
import { BlockDialog } from './actions/BlockDialog';
import { BrainstormDialog } from './actions/BrainstormDialog';
import { GatePanel } from './actions/GatePanel';
import { CardActivity } from './sections/CardActivity';
import { CardComments } from './sections/CardComments';
import { CardConversations } from './sections/CardConversations';
import { CardDependencies } from './sections/CardDependencies';
import { CardDescription } from './CardDescription';
import { CardFields } from './CardFields';
import { CardQuestions } from './sections/CardQuestions';
import { CardReviews } from './sections/CardReviews';
import { CardTitle } from './CardTitle';
import { iconLabelButton } from '../utils/boardStyles';

const TITLE_ID = 'board-card-drawer-title';

const DrawerBody: React.FC<{ board: BoardController; controller: CardDetailController; onClose: () => void }> = ({
  board,
  controller,
  onClose,
}) => {
  const { t } = useTranslation();
  const detail = controller.detail;

  if (!detail) {
    return controller.error ? (
      <BoardErrorState error={controller.error} onRetry={() => void controller.reload()} />
    ) : (
      <div className='p-16px' role='status' aria-busy='true' aria-label={t('board.states.loading')}>
        <Skeleton animation text={{ rows: 6 }} />
      </div>
    );
  }

  const card = detail.card;
  const ref = cardRef(card.number);
  const archived = Boolean(card.archived_at);
  const editable = !board.readOnly && !archived;

  return (
    <div className='flex flex-col min-h-full'>
      <div className='flex flex-col gap-16px p-16px flex-1'>
        <div className='flex flex-col gap-6px'>
          <div className='flex items-center gap-6px'>
            <span className='text-12px text-t-secondary tabular-nums'>{ref}</span>
            {card.blocked && (
              <Tag size='small' color='red' icon={<Lock theme='outline' size='11' fill='currentColor' aria-hidden />}>
                {t('board.card.blocked')}
              </Tag>
            )}
            {archived && (
              <Tag size='small' icon={<Inbox theme='outline' size='11' fill='currentColor' aria-hidden />}>
                {t('board.card.archived')}
              </Tag>
            )}
            {board.readOnly && <Tag size='small'>{t('board.drawer.readOnly')}</Tag>}
            <Button
              className='ms-auto'
              type='text'
              size='small'
              icon={<Close theme='outline' size='16' fill='currentColor' />}
              aria-label={t('common.close')}
              onClick={onClose}
            />
          </div>
          <CardTitle key={card.id} card={card} editable={editable} controller={controller} titleId={TITLE_ID} />
          {card.blocked && card.blocked_reason && (
            <p className='m-0 text-13px text-danger'>
              {t('board.drawer.blockedReason', { reason: card.blocked_reason })}
            </p>
          )}
          {archived && !board.readOnly && (
            <p className='m-0 text-13px text-t-secondary'>{t('board.drawer.archivedNotice')}</p>
          )}
        </div>
        <GatePanel
          card={card}
          column={board.snapshot?.columns.find((column) => column.key === card.column_key)}
          board={board}
          controller={controller}
        />
        <CardDescription key={`d-${card.id}`} card={card} editable={editable} controller={controller} />
        <CardFields
          card={card}
          editable={editable}
          board={board}
          controller={controller}
          assigneeSkills={detail.assignee_skills}
        />
        <CardReviews card={card} reviews={detail.reviews} />
        <CardQuestions questions={detail.questions} editable={editable} controller={controller} />
        <CardDependencies card={card} editable={editable} board={board} controller={controller} />
        <CardConversations links={detail.links} events={detail.events} editable={editable} controller={controller} />
        <CardComments editable={editable} controller={controller} />
        <CardActivity events={detail.events} columns={board.snapshot?.columns ?? []} />
      </div>
    </div>
  );
};

/**
 * The card's action bar (Assign, Brainstorm, Block/Unblock, Archive/Restore) and
 * its dialogs. Rendered as the Drawer's footer, which Arco lays out below the
 * scrolling content, so the bar never covers the last section at any width.
 */
const DrawerActions: React.FC<{ board: BoardController; controller: CardDetailController }> = ({
  board,
  controller,
}) => {
  const { t } = useTranslation();
  const [blockOpen, setBlockOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const card = controller.detail?.card;
  if (!card || board.readOnly) return null;
  const ref = cardRef(card.number);
  const archived = Boolean(card.archived_at);
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className='flex flex-wrap justify-start gap-8px' data-testid='board-drawer-actions'>
        {!archived && (
          <>
            <Button
              className={iconLabelButton('default')}
              type='primary'
              icon={<UserToUserTransmission theme='outline' size='14' fill='currentColor' />}
              onClick={() => setAssignOpen(true)}
            >
              {t('board.assign.action')}
            </Button>
            <Button
              className={iconLabelButton('default')}
              icon={<Lightning theme='outline' size='14' fill='currentColor' />}
              onClick={() => setBrainstormOpen(true)}
            >
              {t('board.brainstorm.action')}
            </Button>
          </>
        )}
        {!archived &&
          (card.blocked ? (
            <Button
              className={iconLabelButton('default')}
              loading={busy}
              icon={<Unlock theme='outline' size='14' fill='currentColor' />}
              onClick={() => void run(() => controller.setBlocked(false))}
            >
              {t('board.drawer.unblock')}
            </Button>
          ) : (
            <Button
              className={iconLabelButton('default')}
              icon={<Lock theme='outline' size='14' fill='currentColor' />}
              onClick={() => setBlockOpen(true)}
            >
              {t('board.drawer.block')}
            </Button>
          ))}
        {archived ? (
          <Button
            className={iconLabelButton('default')}
            type='primary'
            loading={busy}
            icon={<Undo theme='outline' size='14' fill='currentColor' />}
            onClick={() => void run(() => controller.setArchived(false))}
          >
            {t('board.drawer.restore')}
          </Button>
        ) : (
          <Button
            className={iconLabelButton('default')}
            status='danger'
            icon={<Inbox theme='outline' size='14' fill='currentColor' />}
            onClick={() => {
              Modal.confirm({
                title: t('board.drawer.archiveTitle', { ref }),
                content: t('board.drawer.archiveContent'),
                okText: t('board.drawer.archive'),
                cancelText: t('common.cancel'),
                onOk: async () => {
                  await controller.setArchived(true);
                },
              });
            }}
          >
            {t('board.drawer.archive')}
          </Button>
        )}
      </div>
      <BlockDialog refLabel={ref} visible={blockOpen} onClose={() => setBlockOpen(false)} controller={controller} />
      <AssignDialog card={card} visible={assignOpen} onClose={() => setAssignOpen(false)} controller={controller} />
      <BrainstormDialog
        card={card}
        visible={brainstormOpen}
        onClose={() => setBrainstormOpen(false)}
        controller={controller}
      />
    </>
  );
};

export const CardDrawer: React.FC<{ board: BoardController; cardId: string | null; onClose: () => void }> = ({
  board,
  cardId,
  onClose,
}) => {
  const { t } = useTranslation();
  const narrow = useBoardNarrow();
  // Keep showing the last card while the drawer animates out.
  const [shownId, setShownId] = useState<string | null>(cardId);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!cardId) return;
    if (!shownId) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    setShownId(cardId);
    // shownId is read only to detect the closed → open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const controller = useCardDetail(shownId, board.applyCard);
  const ref = controller.detail ? cardRef(controller.detail.card.number) : '';
  // Arco passes unknown props to the drawer's wrapper element.
  const dialogAttributes = {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('board.drawer.label', { ref }),
    'aria-describedby': controller.detail ? TITLE_ID : undefined,
  };

  return (
    <Drawer
      visible={Boolean(cardId)}
      width={narrow ? '100%' : 480}
      title={null}
      // Arco lays its footer out below the scrolling content (never over it). `null`
      // (not undefined) hides it: undefined would render Arco's default OK/Cancel.
      footer={controller.detail && !board.readOnly ? <DrawerActions board={board} controller={controller} /> : null}
      // The dialog semantics sit on the drawer wrapper so they cover the content and the action bar.
      {...(dialogAttributes as Partial<DrawerProps>)}
      closable={false}
      focusLock
      autoFocus
      escToExit
      maskClosable
      unmountOnExit
      onCancel={onClose}
      bodyStyle={{ padding: 0 }}
      afterClose={() => {
        const previous = returnFocusRef.current;
        const closedId = shownId;
        returnFocusRef.current = null;
        setShownId(null);
        if (previous && document.contains(previous)) previous.focus();
        else if (closedId) focusCard(closedId);
      }}
    >
      <div className='min-h-full'>
        <DrawerBody board={board} controller={controller} onClose={onClose} />
      </div>
    </Drawer>
  );
};

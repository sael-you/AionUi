/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Card drawer (SPEC §8, S2 scope): title + description (edit in place), fields,
 * dependencies, comments, activity, Block/Unblock and Archive/Restore. Focus is
 * trapped while open and returns to where it came from (the card) on close.
 * Assign, Brainstorm, reviews, questions and gate actions arrive with S4.
 */

import { Button, Drawer, Input, Modal, Skeleton, Tag } from '@arco-design/web-react';
import { Close, Inbox, Lock, Undo, Unlock } from '@icon-park/react';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BoardErrorState } from '../BoardStates';
import type { BoardController } from '../hooks/useBoard';
import { useCardDetail, type CardDetailController } from '../hooks/useCardDetail';
import { useBoardNarrow } from '../hooks/useMediaQuery';
import { focusCard } from '../MoveToMenu';
import { cardRef } from '../utils/boardModel';
import { CardActivity } from './CardActivity';
import { CardComments } from './CardComments';
import { CardDependencies } from './CardDependencies';
import { CardDescription } from './CardDescription';
import { CardFields } from './CardFields';
import { CardTitle } from './CardTitle';

const TITLE_ID = 'board-card-drawer-title';

const BlockDialog: React.FC<{
  refLabel: string;
  visible: boolean;
  onClose: () => void;
  controller: CardDetailController;
}> = ({ refLabel, visible, onClose, controller }) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('board.drawer.blockTitle', { ref: refLabel })}
      visible={visible}
      onCancel={onClose}
      afterClose={() => setReason('')}
      okText={t('board.drawer.block')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      autoFocus
      focusLock
      onOk={async () => {
        setBusy(true);
        try {
          if (await controller.setBlocked(true, reason)) onClose();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className='flex flex-col gap-6px text-13px text-t-secondary'>
        {t('board.drawer.blockReason')}
        <Input
          autoFocus
          value={reason}
          onChange={setReason}
          maxLength={500}
          placeholder={t('board.drawer.blockReasonPlaceholder')}
        />
      </label>
    </Modal>
  );
};

const DrawerBody: React.FC<{ board: BoardController; controller: CardDetailController; onClose: () => void }> = ({
  board,
  controller,
  onClose,
}) => {
  const { t } = useTranslation();
  const [blockOpen, setBlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

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
        <CardDescription key={`d-${card.id}`} card={card} editable={editable} controller={controller} />
        <CardFields card={card} editable={editable} board={board} controller={controller} />
        <CardDependencies card={card} editable={editable} board={board} controller={controller} />
        <CardComments editable={editable} controller={controller} />
        <CardActivity events={detail.events} columns={board.snapshot?.columns ?? []} />
      </div>
      {!board.readOnly && (
        <div className='sticky bottom-0 flex flex-wrap gap-8px p-12px border-t border-solid border-[color:var(--border-base)] bg-1'>
          {!archived &&
            (card.blocked ? (
              <Button
                loading={busy}
                icon={<Unlock theme='outline' size='14' fill='currentColor' />}
                onClick={() => void run(() => controller.setBlocked(false))}
              >
                {t('board.drawer.unblock')}
              </Button>
            ) : (
              <Button icon={<Lock theme='outline' size='14' fill='currentColor' />} onClick={() => setBlockOpen(true)}>
                {t('board.drawer.block')}
              </Button>
            ))}
          {archived ? (
            <Button
              type='primary'
              loading={busy}
              icon={<Undo theme='outline' size='14' fill='currentColor' />}
              onClick={() => void run(() => controller.setArchived(false))}
            >
              {t('board.drawer.restore')}
            </Button>
          ) : (
            <Button
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
      )}
      <BlockDialog refLabel={ref} visible={blockOpen} onClose={() => setBlockOpen(false)} controller={controller} />
    </div>
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

  return (
    <Drawer
      visible={Boolean(cardId)}
      width={narrow ? '100%' : 480}
      title={null}
      footer={null}
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
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('board.drawer.label', { ref })}
        aria-describedby={controller.detail ? TITLE_ID : undefined}
        className='min-h-full'
      >
        <DrawerBody board={board} controller={controller} onClose={onClose} />
      </div>
    </Drawer>
  );
};

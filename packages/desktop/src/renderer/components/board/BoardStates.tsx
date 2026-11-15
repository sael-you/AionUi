/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Board states shared by the Tasks tab and the board page: skeleton, error +
 * retry, "Turn on the board", the offline / read-only / disabled banners and the
 * polite live region that announces moves, conflicts and full columns.
 */

import { Alert, Button, Result, Skeleton } from '@arco-design/web-react';
import { ListView } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardAnnouncement, BoardController } from './hooks/useBoard';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { boardErrorKey } from './utils/boardErrors';

/** Placeholder while the first snapshot loads: stacked ghosts (Tasks tab) or side-by-side columns (board page). */
export const BoardSkeleton: React.FC<{ layout: 'stacked' | 'columns' }> = ({ layout }) => {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-live='polite'
      aria-busy='true'
      aria-label={t('board.states.loading')}
      className={layout === 'columns' ? 'flex gap-12px p-16px overflow-hidden' : 'flex flex-col gap-12px p-12px'}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={layout === 'columns' ? 'w-280px shrink-0 rd-8px bg-2 p-12px' : 'rd-8px bg-2 p-12px'}
        >
          <Skeleton animation text={{ rows: 3, width: ['40%', '90%', '70%'] }} />
        </div>
      ))}
    </div>
  );
};

export const BoardErrorState: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => {
  const { t } = useTranslation();
  return (
    <div role='alert' className='p-16px'>
      <Result
        status='error'
        title={t('board.states.errorTitle')}
        subTitle={`${t(boardErrorKey(error))} ${t('board.states.errorDescription')}`}
        extra={
          <Button type='primary' onClick={onRetry}>
            {t('board.states.retry')}
          </Button>
        }
      />
    </div>
  );
};

/**
 * Disabled board without cards: the "Turn on the board" empty state (F-KANBAN-07).
 * Turning it on creates the department (`studio`) flow — the only template (D39).
 */
export const BoardDisabledState: React.FC<{ board: BoardController }> = ({ board }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const online = useOnlineStatus();
  return (
    <div className='flex flex-col items-center text-center gap-12px p-24px max-w-420px mx-auto'>
      <ListView theme='outline' size='32' fill='currentColor' className='text-t-secondary' aria-hidden />
      <h2 className='m-0 text-16px font-medium text-t-primary'>{t('board.states.disabledTitle')}</h2>
      <p className='m-0 text-13px text-t-secondary'>{t('board.states.disabledDescription')}</p>
      <div className='w-full rd-8px bg-2 p-12px flex flex-col gap-4px text-start'>
        <span className='text-14px text-t-primary font-medium'>{t('board.states.flowTitle')}</span>
        <span className='text-12px text-t-secondary'>{t('board.states.flowDescription')}</span>
      </div>
      <Button
        type='primary'
        loading={busy}
        disabled={board.readOnly || !online}
        onClick={async () => {
          setBusy(true);
          try {
            await board.setEnabled(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('board.states.enable')}
      </Button>
    </div>
  );
};

/** Offline, read-only (archived project) and disabled-with-cards banners. */
export const BoardBanners: React.FC<{ board: BoardController }> = ({ board }) => {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState(false);
  const settings = board.snapshot?.settings;
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
      {!online && <Alert type='warning' showIcon banner content={t('board.states.offline')} />}
      {board.readOnly && (
        <Alert
          type='info'
          showIcon
          banner
          title={t('board.states.readOnlyTitle')}
          content={t('board.states.readOnlyDescription')}
          action={
            <Button size='mini' type='primary' loading={busy} onClick={() => void run(board.reactivate)}>
              {t('board.states.reactivate')}
            </Button>
          }
        />
      )}
      {settings && !settings.enabled && !board.readOnly && (
        <Alert
          type='info'
          showIcon
          banner
          content={t('board.states.disabledBanner')}
          action={
            <Button size='mini' type='primary' loading={busy} onClick={() => void run(() => board.setEnabled(true))}>
              {t('board.states.disabledBannerAction')}
            </Button>
          }
        />
      )}
    </>
  );
};

/** Visually hidden polite region for move results, rollbacks and WIP-full notices. */
export const BoardLiveRegion: React.FC<{ announcement: BoardAnnouncement | null }> = ({ announcement }) => (
  <div role='status' aria-live='polite' aria-atomic='true' className='sr-only' data-testid='board-live-region'>
    {/* Alternate a trailing space so an identical message is announced again. */}
    {announcement ? `${announcement.text}${announcement.id % 2 ? '' : ' '}` : ''}
  </div>
);

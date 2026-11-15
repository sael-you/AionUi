/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Timeline } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardColumn, BoardEvent } from '@/common/types/board';

import { describeEvent, formatBoardTime } from '../../utils/boardFormat';

/** The card detail answers with its last 50 events (SPEC §5). */
const DETAIL_EVENT_WINDOW = 50;

/** Activity timeline, newest first. */
export const CardActivity: React.FC<{ events: BoardEvent[]; columns: BoardColumn[] }> = ({ events, columns }) => {
  const { t, i18n } = useTranslation();
  const ordered = events.toSorted((a, b) => b.seq - a.seq);
  return (
    <section aria-labelledby='board-drawer-activity' className='flex flex-col gap-8px'>
      <h3 id='board-drawer-activity' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.drawer.activity')}
      </h3>
      {ordered.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.drawer.noActivity')}</p>
      ) : (
        <Timeline>
          {ordered.map((event) => (
            <Timeline.Item key={event.id} label={formatBoardTime(event.created_at, i18n.language)}>
              <span className='text-13px text-t-primary' data-testid='board-activity-item'>
                {describeEvent(event, columns, t)}
              </span>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
      {events.length >= DETAIL_EVENT_WINDOW && (
        <span className='text-12px text-t-secondary'>
          {t('board.drawer.latestOnly', { count: DETAIL_EVENT_WINDOW })}
        </span>
      )}
    </section>
  );
};

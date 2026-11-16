/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag, Typography } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FollowUpStatus, VoiceFollowUp } from '../core/types';

const STATUS_COLOR: Record<FollowUpStatus, string> = {
  finished: 'green',
  failed: 'red',
  needs_approval: 'orange',
  says: 'arcoblue',
  asks: 'purple',
  sent: 'green',
  queued: 'cyan',
  saved_not_started: 'orange',
  expired: 'gray',
  interrupted: 'orange',
  confirm_rejected: 'gray',
  added: 'green',
  stopped: 'orange',
  silenced: 'gray',
  turn_failed: 'red',
  reply: 'arcoblue',
};

/** Recent follow-ups (plan §3.4); approvals are opened on screen, never given by voice. */
const FollowUpList: React.FC<{ followUps: VoiceFollowUp[]; onOpen: (conversationId: string) => void }> = ({
  followUps,
  onOpen,
}) => {
  const { t } = useTranslation();
  if (followUps.length === 0) return null;
  return (
    <section aria-label={t('voice.followUps.title')}>
      <Typography.Text type='secondary' className='text-12px'>
        {t('voice.followUps.title')}
      </Typography.Text>
      <ul className='list-none m-0 p-0 flex flex-col gap-6px'>
        {followUps.map((f) => (
          <li key={f.id} className='flex items-start gap-8px'>
            <Tag size='small' color={STATUS_COLOR[f.status]}>
              {t(`voice.followUps.status.${f.status}`)}
            </Tag>
            <Typography.Text className='min-w-0 flex-1 break-words' dir='auto'>
              {f.line}
            </Typography.Text>
            <Button
              size='mini'
              type='text'
              icon={<Right theme='outline' size={14} fill='currentColor' className='rtl-mirror' />}
              aria-label={t('voice.followUps.open')}
              title={t('voice.followUps.open')}
              onClick={() => onOpen(f.conversationId)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
};

export default FollowUpList;

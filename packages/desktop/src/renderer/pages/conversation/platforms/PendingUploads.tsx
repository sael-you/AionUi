/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Tag } from '@arco-design/web-react';
import { CloudStorage } from '@icon-park/react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PENDING_UPLOAD_MAX_FILE_BYTES,
  pendingUploadStore,
} from '@/renderer/services/pendingUploads/pendingUploadStore';
import { usePendingUploads } from '@/renderer/services/pendingUploads/usePendingUploads';

/**
 * Files attached without a connection (TASK-127): kept in the browser, listed
 * above the composer and uploaded when the connection returns, or on Retry.
 */
const PendingUploads: React.FC<{ conversation_id: string; onUploaded: (paths: string[]) => void }> = ({
  conversation_id,
  onUploaded,
}) => {
  const { t } = useTranslation();
  const { items, uploading, retry, remove } = usePendingUploads(conversation_id, onUploaded);

  // A file over the size cap cannot be kept: say so, never drop it silently.
  useEffect(
    () =>
      pendingUploadStore.onRejected((rejection) => {
        if (rejection.conversationId !== conversation_id) return;
        Message.warning({
          content: t('conversation.pendingUpload.tooLarge', {
            name: rejection.name,
            max: Math.round(PENDING_UPLOAD_MAX_FILE_BYTES / (1024 * 1024)),
          }),
          duration: 8000,
        });
      }),
    [conversation_id, t]
  );
  if (items.length === 0) return null;
  return (
    <div
      role='status'
      className='flex flex-wrap items-center gap-6px mb-6px px-10px py-6px rd-8px bg-fill-1 text-12px text-t-secondary'
      data-testid='pending-uploads'
    >
      <CloudStorage theme='outline' size='14' className='flex-shrink-0' aria-hidden />
      <span>{t('conversation.pendingUpload.waiting')}</span>
      {items.map((item) => (
        <Tag
          key={item.id}
          size='small'
          closable
          onClose={() => remove(item.id)}
          className='max-w-180px'
          data-testid='pending-upload'
        >
          <span className='truncate'>{item.name}</span>
        </Tag>
      ))}
      <Button size='mini' type='text' loading={uploading} onClick={() => void retry()}>
        {t('conversation.unsent.retry')}
      </Button>
    </div>
  );
};

export default PendingUploads;

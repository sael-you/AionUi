/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Edit one stacked quote (C32): the full quote (read-only) and its reply,
 * typed or dictated; Save, Remove or Cancel. Arco's modal traps focus.
 */

import { Button, Modal } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QuoteReplyField from './QuoteReplyField';
import type { QuoteItem } from './quoteStack';

type QuoteEditModalProps = {
  item: QuoteItem | null;
  onSave: (id: string, reply: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

const QuoteEditModal: React.FC<QuoteEditModalProps> = ({ item, onSave, onRemove, onClose }) => {
  const { t } = useTranslation();
  const [reply, setReply] = useState('');

  useEffect(() => {
    setReply(item?.reply ?? '');
  }, [item]);

  const save = () => {
    if (item) onSave(item.id, reply.trim());
    onClose();
  };

  return (
    <Modal
      visible={item !== null}
      title={t('conversation.quoteReply.editTitle')}
      onCancel={onClose}
      unmountOnExit
      style={{ maxWidth: 'calc(100vw - 32px)', width: 560 }}
      footer={
        <div className='flex justify-between gap-8px'>
          <Button
            status='danger'
            onClick={() => {
              if (item) onRemove(item.id);
              onClose();
            }}
          >
            {t('conversation.quoteReply.remove')}
          </Button>
          <div className='flex gap-8px'>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type='primary' onClick={save}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className='flex flex-col gap-12px' data-testid='quote-edit-modal' data-quote-ui>
        <blockquote
          className='m-0 ps-10px pe-8px py-6px rd-6px bg-fill-1 text-13px text-t-secondary whitespace-pre-wrap break-words max-h-240px overflow-auto'
          style={{ borderInlineStart: '3px solid var(--color-border-3)' }}
        >
          {item?.content}
        </blockquote>
        <QuoteReplyField value={reply} onChange={setReply} onSubmit={save} onCancel={onClose} />
      </div>
    </Modal>
  );
};

export default QuoteEditModal;

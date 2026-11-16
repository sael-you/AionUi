/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reply popover anchored at a selection (C32): the quoted text (two lines),
 * a reply typed or dictated, and Add (Enter) to put it on the conversation's
 * quote stack. An empty reply is allowed (quote only). Esc closes.
 */

import { Button } from '@arco-design/web-react';
import { Quote } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QuoteReplyField from './QuoteReplyField';

export type ReplyPopoverAnchor = { top: number; left: number };

type ReplyPopoverProps = {
  anchor: ReplyPopoverAnchor;
  quote: string;
  autoDictate?: boolean;
  onAdd: (reply: string) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 360;

const ReplyPopover: React.FC<ReplyPopoverProps> = ({ anchor, quote, autoDictate, onAdd, onClose }) => {
  const { t } = useTranslation();
  const [reply, setReply] = useState('');
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left - width / 2, window.innerWidth - width - 8));

  return (
    <div
      role='dialog'
      aria-label={t('conversation.quoteReply.popoverLabel')}
      className='fixed z-9999 flex flex-col gap-8px p-10px rd-10px bg-bg-2 border border-border-2 shadow-lg'
      style={{ top: anchor.top, left, width }}
      data-testid='quote-reply-popover'
      data-quote-ui
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className='flex items-start gap-6px'>
        <Quote theme='outline' size='14' className='flex-shrink-0 mt-2px text-t-secondary' aria-hidden />
        <span className='text-12px text-t-secondary line-clamp-2 break-words'>{quote}</span>
      </div>
      <QuoteReplyField
        value={reply}
        onChange={setReply}
        onSubmit={() => onAdd(reply.trim())}
        onCancel={onClose}
        autoDictate={autoDictate}
      />
      <div className='flex justify-end gap-6px'>
        <Button size='mini' onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button size='mini' type='primary' onClick={() => onAdd(reply.trim())}>
          {t('conversation.quoteReply.add')}
        </Button>
      </div>
    </div>
  );
};

export default ReplyPopover;

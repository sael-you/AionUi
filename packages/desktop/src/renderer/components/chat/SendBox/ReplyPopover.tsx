/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reply card anchored at a selection (C32, TASK-126): the quoted text (two
 * lines, accent bar), a growing reply field with its own mic, subtle Cancel and
 * primary Add (Enter or Ctrl/Cmd+Enter) to put it on the conversation's quote
 * stack. An empty reply is allowed (quote only). Esc closes. On phones it is a
 * bottom sheet over a scrim.
 */

import { Button } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QuoteReplyField from './QuoteReplyField';
import styles from './quoteReply.module.css';

export type ReplyPopoverAnchor = { top: number; left: number };

type ReplyPopoverProps = {
  anchor: ReplyPopoverAnchor;
  quote: string;
  autoDictate?: boolean;
  /** Phones: a bottom sheet instead of a card at the selection. */
  sheet?: boolean;
  onAdd: (reply: string) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 380;

const ReplyPopover: React.FC<ReplyPopoverProps> = ({ anchor, quote, autoDictate, sheet = false, onAdd, onClose }) => {
  const { t } = useTranslation();
  const [reply, setReply] = useState('');
  const add = () => onAdd(reply.trim());

  const body = (
    <>
      {sheet ? <div className={styles.sheetHandle} aria-hidden /> : null}
      <div className={classNames('text-12px leading-18px text-t-secondary line-clamp-2 break-words', styles.quote)}>
        {quote}
      </div>
      <QuoteReplyField
        value={reply}
        onChange={setReply}
        onSubmit={add}
        onCancel={onClose}
        autoDictate={autoDictate}
        actions={
          <>
            <Button size='small' type='text' className='!text-t-secondary' onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size='small' type='primary' aria-keyshortcuts='Enter Control+Enter Meta+Enter' onClick={add}>
              {t('conversation.quoteReply.add')}
            </Button>
          </>
        }
      />
    </>
  );

  const common = {
    role: 'dialog',
    'aria-label': t('conversation.quoteReply.popoverLabel'),
    'data-testid': 'quote-reply-popover',
    'data-quote-ui': true,
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    },
  } as const;

  if (sheet) {
    return (
      <>
        <div
          className={classNames('fixed inset-0 z-9998', styles.scrim)}
          aria-hidden
          data-quote-ui
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
        />
        <div
          {...common}
          className={classNames(
            'fixed inset-x-0 bottom-0 z-9999 flex flex-col gap-10px px-14px pt-8px rd-t-16px bg-base border-t border-t-solid border-3 shadow-lg',
            styles.sheet
          )}
          data-variant='sheet'
        >
          {body}
        </div>
      </>
    );
  }

  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.left - width / 2, window.innerWidth - width - 8));
  return (
    <div
      {...common}
      className={classNames(
        'fixed z-9999 flex flex-col gap-10px p-12px rd-12px bg-base border border-solid border-3 shadow-lg',
        styles.card
      )}
      style={{ top: anchor.top, left, width }}
      data-variant='card'
    >
      {body}
    </div>
  );
};

export default ReplyPopover;

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The quote stack above the composer (C32): one chip per quote in selection
 * order — quoted text (one line), "With reply" when it has one, remove. Click or
 * Enter edits it; drag or Alt+↑/↓ reorders. Selecting text here never opens
 * the selection toolbar (data-quote-ui).
 */

import { Button, Tag } from '@arco-design/web-react';
import { CloseSmall, Quote } from '@icon-park/react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QuoteEditModal from './QuoteEditModal';
import type { QuoteStackApi } from './quoteStack';

const QuoteStack: React.FC<{ stack: QuoteStackApi }> = ({ stack }) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const { items } = stack;

  if (items.length === 0) return null;

  const focusChip = (index: number) => {
    window.requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLElement>('[data-quote-chip]')[index]?.focus();
    });
  };

  return (
    <>
      <ul
        ref={listRef}
        className='m-0 mb-8px p-0 list-none flex flex-col gap-6px max-h-200px overflow-y-auto'
        aria-label={t('conversation.quoteReply.stackLabel', { count: items.length })}
        data-testid='quote-stack'
        data-quote-ui
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragFrom.current !== null) stack.move(dragFrom.current, index);
              dragFrom.current = null;
            }}
            className='flex items-center gap-8px ps-10px pe-4px py-4px rd-10px bg-fill-1 b-1 b-solid b-border-2'
            data-testid='quote-chip'
          >
            <Quote theme='outline' size='14' className='flex-shrink-0 text-t-secondary' aria-hidden />
            <Button
              type='text'
              size='small'
              className='!flex-1 !min-w-0 !h-auto !px-0 !text-start !text-t-primary'
              data-quote-chip
              aria-label={t('conversation.quoteReply.editLabel', { quote: item.content.slice(0, 80) })}
              aria-keyshortcuts='Alt+ArrowUp Alt+ArrowDown'
              onClick={() => setEditingId(item.id)}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
                stack.move(index, to);
                focusChip(Math.max(0, Math.min(items.length - 1, to)));
              }}
            >
              <span className='block truncate text-13px'>“{item.content.replace(/\s+/g, ' ')}”</span>
            </Button>
            {item.reply ? (
              <Tag size='small' bordered className='flex-shrink-0'>
                {t('conversation.quoteReply.withReply')}
              </Tag>
            ) : null}
            <Button
              type='text'
              size='mini'
              icon={<CloseSmall theme='outline' size='14' />}
              aria-label={t('conversation.quoteReply.removeLabel', { quote: item.content.slice(0, 80) })}
              onClick={() => stack.remove(item.id)}
            />
          </li>
        ))}
      </ul>
      <QuoteEditModal
        item={items.find((item) => item.id === editingId) ?? null}
        onSave={stack.updateReply}
        onRemove={stack.remove}
        onClose={() => setEditingId(null)}
      />
    </>
  );
};

export default QuoteStack;

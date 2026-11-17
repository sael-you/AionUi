/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The quote stack above the composer (C32, TASK-126): one chip per quote in
 * selection order — quoted text (one line), "With reply" when it has one. Chips
 * slide in and fade out; hover (or focus) shows edit / remove; the handle drags,
 * Alt+↑/↓ reorders. Click or Enter edits. Selecting text here never opens the
 * selection toolbar (data-quote-ui).
 */

import { Button, Tag, Tooltip } from '@arco-design/web-react';
import { CloseSmall, Drag, Edit, Quote } from '@icon-park/react';
import classNames from 'classnames';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QuoteEditModal from './QuoteEditModal';
import styles from './quoteReply.module.css';
import type { QuoteStackApi } from './quoteStack';

/** Matches the chip fade-out in quoteReply.module.css. */
const LEAVE_MS = 150;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const QuoteStack: React.FC<{ stack: QuoteStackApi }> = ({ stack }) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [dragArmed, setDragArmed] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const { items } = stack;

  if (items.length === 0) return null;

  const remove = (id: string) => {
    if (prefersReducedMotion()) {
      stack.remove(id);
      return;
    }
    setLeaving((current) => new Set(current).add(id));
    window.setTimeout(() => {
      stack.remove(id);
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, LEAVE_MS);
  };

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
            draggable={dragArmed === item.id}
            onDragStart={(event) => {
              dragFrom.current = index;
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (dropIndex !== index) setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragFrom.current !== null) stack.move(dragFrom.current, index);
              dragFrom.current = null;
              setDropIndex(null);
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragArmed(null);
              setDropIndex(null);
            }}
            className={classNames(
              'flex items-center gap-6px ps-4px pe-4px py-3px rd-10px bg-fill-1 border border-solid border-3',
              styles.chip,
              leaving.has(item.id) && styles.chipLeaving,
              dragArmed === item.id && dragFrom.current !== null && styles.chipDragging,
              dropIndex === index && dragFrom.current !== null && dragFrom.current !== index && styles.chipDropTarget
            )}
            data-testid='quote-chip'
          >
            <span
              className={classNames('flex flex-shrink-0 items-center text-t-tertiary', styles.chipHandle)}
              aria-hidden
              data-testid='quote-chip-handle'
              onMouseDown={() => setDragArmed(item.id)}
              onMouseUp={() => setDragArmed(null)}
              onTouchStart={() => setDragArmed(item.id)}
            >
              <Drag theme='outline' size='14' />
            </span>
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
            <span className={classNames('flex flex-shrink-0 items-center', styles.chipActions)}>
              <Tooltip content={t('common.edit')} mini>
                <Button
                  type='text'
                  size='mini'
                  shape='circle'
                  icon={<Edit theme='outline' size='13' />}
                  aria-label={t('conversation.quoteReply.editLabel', { quote: item.content.slice(0, 80) })}
                  tabIndex={-1}
                  onClick={() => setEditingId(item.id)}
                />
              </Tooltip>
              <Tooltip content={t('common.remove')} mini>
                <Button
                  type='text'
                  size='mini'
                  shape='circle'
                  icon={<CloseSmall theme='outline' size='14' />}
                  aria-label={t('conversation.quoteReply.removeLabel', { quote: item.content.slice(0, 80) })}
                  onClick={() => remove(item.id)}
                />
              </Tooltip>
            </span>
          </li>
        ))}
      </ul>
      <QuoteEditModal
        item={items.find((item) => item.id === editingId) ?? null}
        onSave={stack.updateReply}
        onRemove={remove}
        onClose={() => setEditingId(null)}
      />
    </>
  );
};

export default QuoteStack;

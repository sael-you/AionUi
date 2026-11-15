/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Spin } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_LIMITS, type BoardEvent } from '@/common/types/board';
import MarkdownView from '@/renderer/components/Markdown';

import type { CardDetailController } from '../../hooks/useCardDetail';
import { actorName, formatBoardTime } from '../../utils/boardFormat';

const commentBody = (event: BoardEvent): string => {
  const body = event.payload?.body;
  return typeof body === 'string' ? body : '';
};

/** Comments = `commented` events (oldest first) + a composer (Ctrl/⌘+Enter posts). */
export const CardComments: React.FC<{ editable: boolean; controller: CardDetailController }> = ({
  editable,
  controller,
}) => {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const comments = controller.comments;
  const tooLong = draft.length > BOARD_LIMITS.comment;

  const submit = async () => {
    if (!draft.trim() || tooLong || busy) return;
    setBusy(true);
    try {
      if (await controller.addComment(draft)) setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby='board-drawer-comments' className='flex flex-col gap-8px'>
      <h3 id='board-drawer-comments' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.drawer.comments')}
      </h3>
      {comments === undefined ? (
        <Spin size={16} />
      ) : comments.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.drawer.noComments')}</p>
      ) : (
        <ol className='m-0 p-0 list-none flex flex-col gap-8px'>
          {comments.map((comment) => (
            <li key={comment.id} className='rd-6px bg-2 p-8px flex flex-col gap-4px' data-testid='board-comment'>
              <div className='flex items-center gap-8px text-12px text-t-secondary'>
                <span className='font-medium text-t-primary'>
                  {actorName(comment.actor_kind, comment.actor_ref, t)}
                </span>
                <span>{formatBoardTime(comment.created_at, i18n.language)}</span>
              </div>
              <div className='text-13px'>
                <MarkdownView>{commentBody(comment)}</MarkdownView>
              </div>
            </li>
          ))}
        </ol>
      )}
      {editable && (
        <div className='flex flex-col gap-6px'>
          <Input.TextArea
            value={draft}
            onChange={setDraft}
            autoSize={{ minRows: 2, maxRows: 8 }}
            aria-label={t('board.drawer.commentPlaceholder')}
            placeholder={t('board.drawer.commentPlaceholder')}
            status={tooLong ? 'error' : undefined}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {tooLong && (
            <span role='alert' className='text-12px text-danger'>
              {t('board.drawer.commentTooLong', { max: BOARD_LIMITS.comment })}
            </span>
          )}
          <div>
            <Button
              size='small'
              type='primary'
              loading={busy}
              disabled={!draft.trim() || tooLong}
              onClick={() => void submit()}
            >
              {t('board.drawer.addComment')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

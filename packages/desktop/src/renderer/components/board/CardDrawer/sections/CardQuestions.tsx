/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_LIMITS, type BoardQuestion } from '@/common/types/board';
import MarkdownView from '@/renderer/components/Markdown';

import type { CardDetailController } from '../../hooks/useCardDetail';
import { departmentName } from '../../utils/boardFormat';

const QuestionRow: React.FC<{ question: BoardQuestion; editable: boolean; controller: CardDetailController }> = ({
  question,
  editable,
  controller,
}) => {
  const { t } = useTranslation();
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const answered = Boolean(question.answered_by_event);

  const send = async () => {
    setBusy(true);
    try {
      if (await controller.answerQuestion(question.id, question.from_department, draft)) {
        setDraft('');
        setAnswering(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className='rd-6px bg-2 p-8px flex flex-col gap-6px' data-question={question.id}>
      <div className='flex flex-wrap items-center gap-6px text-12px text-t-secondary'>
        <span>
          {t('board.questions.fromTo', {
            from: departmentName(question.from_department, t),
            to: departmentName(question.to_department, t),
          })}
        </span>
        <Tag size='small' color={answered ? 'green' : 'orange'}>
          {t(answered ? 'board.questions.answered' : 'board.questions.open')}
        </Tag>
      </div>
      <div className='text-13px'>
        <MarkdownView>{question.text}</MarkdownView>
      </div>
      {!answered && editable && !answering && (
        <div>
          <Button size='mini' onClick={() => setAnswering(true)}>
            {t('board.questions.answer')}
          </Button>
        </div>
      )}
      {answering && (
        <div className='flex flex-col gap-6px'>
          <Input.TextArea
            autoFocus
            value={draft}
            onChange={setDraft}
            maxLength={BOARD_LIMITS.comment}
            autoSize={{ minRows: 2, maxRows: 8 }}
            aria-label={t('board.questions.answerLabel', { question: question.text.slice(0, 80) })}
            placeholder={t('board.questions.answerPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setAnswering(false);
              }
            }}
          />
          <div className='flex gap-8px'>
            <Button size='small' type='primary' loading={busy} disabled={!draft.trim()} onClick={() => void send()}>
              {t('board.questions.send')}
            </Button>
            <Button size='small' onClick={() => setAnswering(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
};

/** Questions between departments (and to the owner); open first. Answering = a comment with `answers` (R6). */
export const CardQuestions: React.FC<{
  questions: BoardQuestion[];
  editable: boolean;
  controller: CardDetailController;
}> = ({ questions, editable, controller }) => {
  const { t } = useTranslation();
  const ordered = questions.toSorted(
    (a, b) => Number(Boolean(a.answered_by_event)) - Number(Boolean(b.answered_by_event)) || a.created_at - b.created_at
  );
  return (
    <section aria-labelledby='board-drawer-questions' className='flex flex-col gap-6px'>
      <h3 id='board-drawer-questions' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.questions.title')}
      </h3>
      {ordered.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.questions.empty')}</p>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-6px'>
          {ordered.map((question) => (
            <QuestionRow key={question.id} question={question} editable={editable} controller={controller} />
          ))}
        </ul>
      )}
    </section>
  );
};

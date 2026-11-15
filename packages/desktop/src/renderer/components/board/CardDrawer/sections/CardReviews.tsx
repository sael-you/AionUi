/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Edit, Lock, Time } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCard, BoardReview, BoardReviewVerdict } from '@/common/types/board';
import MarkdownView from '@/renderer/components/Markdown';

import { departmentName } from '../../utils/boardFormat';

const VERDICT_LOOK: Record<BoardReviewVerdict, { color: string; Icon: typeof CheckOne }> = {
  pending: { color: 'gray', Icon: Time },
  approve: { color: 'green', Icon: CheckOne },
  change: { color: 'orange', Icon: Edit },
  reject: { color: 'red', Icon: CloseOne },
  blocked: { color: 'red', Icon: Lock },
};

/** Verdict as text + icon (+ colour) — never colour alone. */
export const VerdictChip: React.FC<{ verdict: BoardReviewVerdict }> = ({ verdict }) => {
  const { t } = useTranslation();
  const { color, Icon } = VERDICT_LOOK[verdict] ?? VERDICT_LOOK.pending;
  return (
    <Tag
      size='small'
      color={color}
      icon={<Icon theme='outline' size='11' fill='currentColor' aria-hidden />}
      data-verdict={verdict}
    >
      {t(`board.verdict.${verdict}`)}
    </Tag>
  );
};

const ReviewRow: React.FC<{ department: string; review: BoardReview | undefined }> = ({ department, review }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const name = departmentName(department, t);
  const detailCount = review ? review.findings.length + review.assumptions.length + (review.recommendation ? 1 : 0) : 0;
  const detailsId = `board-review-${department}-details`;

  return (
    <li className='rd-6px bg-2 p-8px flex flex-col gap-6px' data-review-department={department}>
      <div className='flex flex-wrap items-center gap-6px'>
        <span className='text-13px font-medium text-t-primary'>{name}</span>
        {review ? (
          <VerdictChip verdict={review.verdict} />
        ) : (
          <span className='text-12px text-t-secondary'>{t('board.reviews.notReviewed')}</span>
        )}
        {review?.confidence !== null && review?.confidence !== undefined && (
          <span className='text-12px text-t-secondary'>
            {t('board.reviews.confidence', { value: Math.round(review.confidence * 100) })}
          </span>
        )}
        {review && review.tokens_used > 0 && (
          <span className='text-12px text-t-secondary ms-auto'>
            {t('board.reviews.tokens', { count: review.tokens_used })}
          </span>
        )}
      </div>
      {review?.summary && (
        <div className='text-13px'>
          <MarkdownView>{review.summary}</MarkdownView>
        </div>
      )}
      {detailCount > 0 && (
        <div>
          <Button type='text' size='mini' aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
            {open ? t('board.reviews.hideDetails') : t('board.reviews.showDetails', { count: detailCount })}
          </Button>
        </div>
      )}
      {open && review && (
        <div id={detailsId} className='flex flex-col gap-6px text-13px'>
          {review.recommendation && (
            <div>
              <h5 className='m-0 text-12px font-medium text-t-secondary'>{t('board.reviews.recommendation')}</h5>
              <MarkdownView>{review.recommendation}</MarkdownView>
            </div>
          )}
          {review.findings.length > 0 && (
            <div>
              <h5 className='m-0 text-12px font-medium text-t-secondary'>{t('board.reviews.findings')}</h5>
              <ul className='m-0 ps-16px flex flex-col gap-4px'>
                {review.findings.map((finding, index) => (
                  <li key={index} className='text-t-primary'>
                    <Tag size='small' className='me-4px'>
                      {t(`board.severity.${finding.severity}`, { defaultValue: finding.severity })}
                    </Tag>
                    <span className='break-words'>{finding.claim}</span>
                    {finding.evidence && (
                      <div className='text-12px text-t-secondary break-words'>
                        {t('board.reviews.evidence', { evidence: finding.evidence })}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.assumptions.length > 0 && (
            <div>
              <h5 className='m-0 text-12px font-medium text-t-secondary'>{t('board.reviews.assumptions')}</h5>
              <ul className='m-0 ps-16px'>
                {review.assumptions.map((assumption, index) => (
                  <li key={index} className='text-t-primary break-words'>
                    {assumption}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
};

/** Reviews: one row per routed department (plus any department that reviewed anyway). */
export const CardReviews: React.FC<{ card: BoardCard; reviews: BoardReview[] }> = ({ card, reviews }) => {
  const { t } = useTranslation();
  const departments = [...new Set([...card.routing, ...reviews.map((review) => review.department)])];
  return (
    <section aria-labelledby='board-drawer-reviews' className='flex flex-col gap-6px'>
      <h3 id='board-drawer-reviews' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.reviews.title')}
      </h3>
      {departments.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.reviews.empty')}</p>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-6px'>
          {departments.map((department) => (
            <ReviewRow
              key={department}
              department={department}
              review={reviews.find((review) => review.department === department)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

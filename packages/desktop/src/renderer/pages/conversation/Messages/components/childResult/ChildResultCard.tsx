/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Down, Right } from '@icon-park/react';
import { Button } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { ChildResult } from './childResultBlock';

/**
 * Compact collapsible card for a sub-conversation's result returned into its
 * parent's message list, with a link to open the child.
 */
const ChildResultCard: React.FC<{ result: ChildResult }> = ({ result }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const name = result.name || result.childId;

  return (
    <div
      className='w-full min-w-0 rd-8px bg-fill-1 border border-solid border-[var(--color-border-2)] mb-6px'
      data-testid='child-result-card'
    >
      <div className='flex items-center gap-8px px-10px h-32px'>
        <Button
          type='text'
          size='mini'
          aria-expanded={expanded}
          aria-label={t('conversation.hierarchy.resultToggle')}
          icon={expanded ? <Down theme='outline' size='14' /> : <Right theme='outline' size='14' />}
          onClick={() => setExpanded((value) => !value)}
        />
        <span className='text-13px font-[500] text-t-primary truncate min-w-0 flex-1'>
          {t('conversation.hierarchy.resultTitle', { name })}
        </span>
        {result.status && <span className='text-12px text-t-secondary shrink-0'>{result.status}</span>}
        <Button
          type='text'
          size='mini'
          data-testid='child-result-open'
          onClick={() => void navigate(`/conversation/${result.childId}`)}
        >
          {t('conversation.hierarchy.openChild')}
        </Button>
      </div>
      {expanded && (
        <div
          className='px-12px pb-10px text-13px text-t-secondary whitespace-pre-wrap [overflow-wrap:anywhere]'
          data-testid='child-result-body'
        >
          {result.body}
        </div>
      )}
    </div>
  );
};

export default ChildResultCard;

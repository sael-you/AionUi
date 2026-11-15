/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import StatusGlyph from '@/renderer/pages/conversation/components/orchestration/StatusGlyph';
import type { RunState } from '@/renderer/pages/conversation/components/orchestration/runState';
import { Button } from '@arco-design/web-react';
import { Down, Up } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { ChildResult } from './childResultBlock';
import styles from './ChildResultCard.module.css';

/** The report header's status word → the one status language (C21). */
const reportState = (status: string): Extract<RunState, 'done' | 'failed' | 'stopped'> =>
  status === 'error' ? 'failed' : status === 'cancelled' ? 'stopped' : 'done';

/**
 * A sub-conversation's result returned into its parent, as a compact report
 * row (C21): glyph · name (opens the child) · "reported back" / "failed" /
 * "stopped" · Show result. The raw status word is never shown.
 */
const ChildResultCard: React.FC<{ result: ChildResult }> = ({ result }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const name = result.name || result.childId;
  const state = reportState(result.status);

  return (
    <div className={styles.report} data-testid='child-result-card' data-run-state={state}>
      <div className={styles.line}>
        <StatusGlyph state={state} size={14} />
        <Button
          type='text'
          size='mini'
          className={styles.name}
          data-testid='child-result-open'
          aria-label={t('conversation.hierarchy.openChild') + ': ' + name}
          onClick={() => void navigate(`/conversation/${result.childId}`)}
        >
          <span className={styles.nameText}>{name}</span>
        </Button>
        <span className={styles.sub}>{t(`conversation.orchestration.report.${state}`)}</span>
        <Button
          type='text'
          size='mini'
          className={styles.toggle}
          aria-expanded={expanded}
          aria-label={t('conversation.hierarchy.resultToggle')}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('conversation.orchestration.report.hide') : t('conversation.orchestration.report.show')}
          {expanded ? <Up theme='outline' size='12' /> : <Down theme='outline' size='12' />}
        </Button>
      </div>
      {expanded && (
        <div className={styles.body} data-testid='child-result-body'>
          {result.body}
        </div>
      )}
    </div>
  );
};

export default ChildResultCard;

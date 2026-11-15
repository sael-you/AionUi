/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Button } from '@arco-design/web-react';
import React, { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import type { RunState } from '../runState';
import StatusGlyph from '../StatusGlyph';
import { getDelegatedSummary, subscribeDelegatedSummary } from './delegatedWork';
import styles from './RunSummaryPill.module.css';

const PILL_STATES: RunState[] = ['running', 'waiting', 'failed'];
/** Mobile keeps the two counts that ask for action now (C21 §6). */
const MOBILE_PILL_STATES: RunState[] = ['running', 'waiting'];

/**
 * Header run summary (C21): running / needs-you / failed counts across
 * everything this conversation launched, visible when the card scrolls away.
 * Click scrolls to the latest delegated-work card. Hidden when nothing is
 * running, waiting or failed.
 */
const RunSummaryPill: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const isMobile = useLayoutContext()?.isMobile ?? false;
  const summary = useSyncExternalStore(
    subscribeDelegatedSummary,
    () => getDelegatedSummary(conversationId),
    () => getDelegatedSummary(conversationId)
  );
  const scrollToCard = useCallback(() => {
    const id = summary?.latestCardId;
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [summary?.latestCardId]);

  if (!summary) return null;
  const shown = (isMobile ? MOBILE_PILL_STATES : PILL_STATES).filter((state) => summary.counts[state] > 0);
  if (shown.length === 0) return null;
  const label = t('conversation.orchestration.pill.label', {
    summary: shown
      .map((state) => t(`conversation.orchestration.count.${state}`, { count: summary.counts[state] }))
      .join(', '),
  });
  return (
    <Button
      className={styles.pill}
      aria-label={label}
      title={label}
      onClick={scrollToCard}
      data-testid='run-summary-pill'
    >
      {shown.map((state) => (
        <span key={state} className={styles.item} data-testid={`run-summary-${state}`}>
          <StatusGlyph state={state} size={14} label={null} />
          {summary.counts[state]}
        </span>
      ))}
    </Button>
  );
};

export default RunSummaryPill;

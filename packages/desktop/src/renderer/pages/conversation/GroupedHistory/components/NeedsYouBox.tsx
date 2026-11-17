/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import StatusGlyph from '@/renderer/pages/conversation/components/orchestration/StatusGlyph';
import { runStateLabelKey, type RunState } from '@/renderer/pages/conversation/components/orchestration/runState';
import { Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import styles from './NeedsYouBox.module.css';

export type NeedsYouItem = {
  conversation: TChatConversation;
  state: Extract<RunState, 'waiting' | 'failed'>;
  /** Project name, shown trailing (absent outside a project). */
  where?: string;
  /** Waiting because an AionUi restart interrupted its turn (TASK-44). */
  restartInterrupted?: boolean;
};

type NeedsYouBoxProps = {
  items: readonly NeedsYouItem[];
  /** Conversations running right now, across projects. */
  runningCount: number;
  onOpen: (conversation: TChatConversation) => void;
  /** The summary row: reveal the first running conversation. */
  onShowRunning?: () => void;
};

/**
 * One row of the box: a list item holding a link-like control (Enter / Space /
 * click opens it). The box is its own labelled region, outside the sidebar's
 * tree, so it is never a stray group inside role=tree.
 */
const BoxItem: React.FC<{
  label: string;
  className: string;
  onActivate: () => void;
  testId: string;
  children: React.ReactNode;
}> = ({ label, className, onActivate, testId, children }) => (
  <div role='listitem'>
    <div
      className={className}
      role='link'
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </div>
  </div>
);

/**
 * "Needs you" (C21, from direction C): what waits on the user across every
 * project, at the top of the sidebar. Rendered only while something waits or
 * failed; waiting rows first, then failed, each with its project trailing. A
 * summary row counts the conversations running.
 */
const NeedsYouBox: React.FC<NeedsYouBoxProps> = ({ items, runningCount, onOpen, onShowRunning }) => {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const heading = t('conversation.orchestration.needsYou.title');
  const headingId = 'sidebar-needs-you-heading';
  return (
    <section className={styles.box} aria-labelledby={headingId} data-testid='sidebar-needs-you'>
      <h2 className={styles.head} id={headingId}>
        <StatusGlyph state='waiting' size={12} label={null} />
        <span>{heading}</span>
        <span className={styles.count}>{items.length}</span>
      </h2>
      <div role='list'>
        {items.map(({ conversation, state, where, restartInterrupted }) => {
          const name = conversation.name || t('conversation.welcome.newConversation');
          const reason = restartInterrupted
            ? t('conversation.orchestration.restart.title')
            : t(runStateLabelKey(state));
          const label = [name, reason, where].filter(Boolean).join(', ');
          return (
            <BoxItem
              key={conversation.id}
              label={label}
              className={styles.row}
              testId={`sidebar-needs-you-${conversation.id}`}
              onActivate={() => onOpen(conversation)}
            >
              <StatusGlyph state={state} size={14} label={null} />
              <span className={styles.name} title={restartInterrupted ? `${name} · ${reason}` : name}>
                {name}
              </span>
              {where && (
                <span className={styles.where} title={where}>
                  {where}
                </span>
              )}
            </BoxItem>
          );
        })}
        {runningCount > 0 && (
          <BoxItem
            label={t('conversation.orchestration.needsYou.running', { count: runningCount })}
            className={styles.summary}
            testId='sidebar-needs-you-running'
            onActivate={() => onShowRunning?.()}
          >
            <StatusGlyph state='running' size={14} label={null} />
            <span className={styles.summaryText}>
              {t('conversation.orchestration.needsYou.running', { count: runningCount })}
            </span>
            <Right theme='outline' size='12' className={styles.chevron} />
          </BoxItem>
        )}
      </div>
    </section>
  );
};

export default NeedsYouBox;

/** States worth a polite announcement when a conversation enters them. */
const ANNOUNCED: ReadonlySet<RunState> = new Set<RunState>(['waiting', 'failed', 'done']);
const ANNOUNCE_THROTTLE_MS = 1500;

/**
 * Polite live region for the transitions that matter (C21 §8): a conversation
 * starting to need you, failing, or finishing. Throttled, never per second;
 * the first snapshot is silent.
 */
export const RunStateAnnouncer: React.FC<{ states: ReadonlyMap<string, { state: RunState; name: string }> }> = ({
  states,
}) => {
  const { t } = useTranslation();
  const previousRef = React.useRef<ReadonlyMap<string, { state: RunState; name: string }> | null>(null);
  const pendingRef = React.useRef<string[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = states;
    if (!previous) return;
    for (const [id, { state, name }] of states) {
      if (!ANNOUNCED.has(state) || previous.get(id)?.state === state) continue;
      pendingRef.current.push(t(`conversation.orchestration.announce.${state}`, { name }));
    }
    if (pendingRef.current.length === 0 || timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMessage(pendingRef.current.slice(-3).join('. '));
      pendingRef.current = [];
    }, ANNOUNCE_THROTTLE_MS);
  }, [states, t]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return (
    <div className={styles.liveRegion} aria-live='polite' role='status' data-testid='sidebar-run-announcer'>
      {message}
    </div>
  );
};

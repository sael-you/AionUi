/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import { ToolItemDetail } from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { Brain, Checklist, Down, FileCode, NetworkTree, Right, Terminal } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatRunDuration } from './runState';
import StatusGlyph from './StatusGlyph';
import styles from './TurnActivity.module.css';
import {
  ownToolMessages,
  SHORT_THOUGHT_MS,
  summarizeTurnActivity,
  thoughtDurationMs,
  type TurnActivityEntry,
} from './turnActivity';

/** Rows shown in the expanded timeline before "+ N more steps". */
const TIMELINE_PREVIEW_ROWS = 8;

type TimelineRow =
  | { kind: 'thought'; key: string; subject: string; durationMs: number; text: string }
  | { kind: 'step'; key: string; item: NormalizedToolCall };

/** Icon for a step: shell, file, delegation or generic. */
const stepIcon = (name: string): React.ReactNode => {
  const lower = name.toLowerCase();
  if (/^(run|bash|shell|exec)\b/.test(lower) || lower.includes('command'))
    return <Terminal theme='outline' size='14' />;
  if (/^(read|write|edit|create file|update)\b/.test(lower)) return <FileCode theme='outline' size='14' />;
  if (/^(agent|task|message|created?|delegate)\b/.test(lower)) return <NetworkTree theme='outline' size='14' />;
  return <Checklist theme='outline' size='14' />;
};

export const useDurationUnits = () => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      s: t('common.unit.second_short'),
      m: t('common.unit.minute_short'),
      h: t('common.unit.hour_short'),
    }),
    [t]
  );
};

/** Re-render every second while `active` (elapsed timers). */
export const useTicker = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
};

/**
 * Turn activity line (C21): everything between two answers (thinking and
 * steps) folds into "Worked 4m 12s · 14 steps · 3 thoughts". Expanded, it is a
 * vertical timeline; thoughts under 2 s show no duration and fold into
 * "+ N short thoughts". While running it reads "Working · 8m 38s" with the
 * current step, and never auto-expands.
 */
const TurnActivity: React.FC<{
  entries: TurnActivityEntry[];
  endAt?: number;
  /** Subagent names by task id: a SendMessage step reads "Message → <name>", never the id. */
  taskLabels?: ReadonlyMap<string, string>;
}> = ({ entries, endAt, taskLabels }) => {
  const { t } = useTranslation();
  const units = useDurationUnits();
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openThought, setOpenThought] = useState<string | null>(null);
  const probe = summarizeTurnActivity(entries, { endAt, now: Date.now() });
  const now = useTicker(probe.running);
  const summary = summarizeTurnActivity(entries, { endAt, now });
  const elapsed = formatRunDuration(summary.elapsedMs, units, { seconds: true });

  const rows = useMemo<TimelineRow[]>(() => {
    const out: TimelineRow[] = [];
    for (const entry of entries) {
      if (entry.kind === 'thought') {
        out.push({
          kind: 'thought',
          key: entry.message.id,
          subject: entry.message.content.subject || t('conversation.orchestration.activity.thought'),
          durationMs: thoughtDurationMs(entry.message),
          text: entry.message.content.content,
        });
        continue;
      }
      const own = ownToolMessages(entry.messages);
      const renamed = new Map<string, string>();
      for (const message of own) {
        if (message.type !== 'tool_call') continue;
        const task = message.content?.task;
        const label = task && !task.label ? taskLabels?.get(task.id) : undefined;
        if (label)
          renamed.set(message.content.call_id, t('conversation.orchestration.activity.messageTo', { name: label }));
      }
      for (const item of normalizeToolMessages(own)) {
        const name = renamed.get(item.key);
        out.push({
          kind: 'step',
          key: `${entry.id}:${item.key}`,
          item: name ? { ...item, name, description: undefined } : item,
        });
      }
    }
    return out;
  }, [entries, t, taskLabels]);

  const visible = rows.filter((row) => row.kind === 'step' || row.durationMs >= SHORT_THOUGHT_MS);
  const shortThoughts = rows.length - visible.length;
  const shown = showAll ? visible : visible.slice(0, TIMELINE_PREVIEW_ROWS);
  const hiddenSteps = visible.length - shown.length;

  const meta = [
    t('conversation.orchestration.activity.steps', { count: summary.steps }),
    summary.thoughts > 0 ? t('conversation.orchestration.activity.thoughts', { count: summary.thoughts }) : null,
    summary.failed > 0 ? t('conversation.orchestration.activity.failedSteps', { count: summary.failed }) : null,
  ].filter(Boolean);

  return (
    <div className={styles.activity} data-testid='turn-activity'>
      <div
        className={styles.line}
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
      >
        {summary.running ? (
          <StatusGlyph state='running' size={14} label={null} />
        ) : (
          <Checklist theme='outline' size='14' className={styles.icon} />
        )}
        <span className={styles.lead}>
          {summary.running
            ? t('conversation.orchestration.activity.working', { duration: elapsed })
            : t('conversation.orchestration.activity.worked', { duration: elapsed })}
        </span>
        {summary.running && summary.currentStep ? (
          <span className={classNames(styles.meta, styles.ellipsis)}>· {summary.currentStep}</span>
        ) : (
          meta.length > 0 && <span className={styles.meta}>· {meta.join(' · ')}</span>
        )}
        {expanded ? (
          <Down theme='outline' size='12' className={styles.chevron} />
        ) : (
          <Right theme='outline' size='12' className={styles.chevron} />
        )}
      </div>
      {expanded && (
        <div className={styles.timeline} data-testid='turn-activity-timeline'>
          {shown.map((row) =>
            row.kind === 'thought' ? (
              <div key={row.key} className={styles.row}>
                <span className={styles.dot} aria-hidden='true' />
                <div
                  className={styles.thought}
                  role='button'
                  tabIndex={0}
                  aria-expanded={openThought === row.key}
                  onClick={() => setOpenThought((key) => (key === row.key ? null : row.key))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setOpenThought((key) => (key === row.key ? null : row.key));
                    }
                  }}
                >
                  <Brain theme='outline' size='14' className={styles.icon} />
                  <span className={styles.ellipsis}>{row.subject}</span>
                  <span className={styles.meta}>
                    ·{' '}
                    {t('conversation.orchestration.activity.thoughtFor', {
                      duration: formatRunDuration(row.durationMs, units, { seconds: true }),
                    })}
                  </span>
                </div>
                {openThought === row.key && <div className={styles.thoughtText}>{row.text}</div>}
              </div>
            ) : (
              <div key={row.key} className={styles.row}>
                <span className={styles.dot} aria-hidden='true' />
                <div className={styles.step}>
                  <ToolItemDetail
                    item={row.item}
                    monoDescription
                    leading={
                      row.item.status === 'running' ? (
                        <StatusGlyph state='running' size={14} label={null} />
                      ) : row.item.status === 'error' ? (
                        <StatusGlyph state='failed' size={14} />
                      ) : (
                        <span className={styles.icon}>{stepIcon(row.item.name)}</span>
                      )
                    }
                  />
                </div>
              </div>
            )
          )}
          {(hiddenSteps > 0 || shortThoughts > 0) && (
            <div className={styles.row}>
              <span className={styles.dot} aria-hidden='true' />
              <div
                className={classNames(styles.more, { [styles.moreAction]: hiddenSteps > 0 })}
                role={hiddenSteps > 0 ? 'button' : undefined}
                tabIndex={hiddenSteps > 0 ? 0 : undefined}
                onClick={hiddenSteps > 0 ? () => setShowAll(true) : undefined}
                onKeyDown={(event) => {
                  if (hiddenSteps > 0 && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    setShowAll(true);
                  }
                }}
              >
                +{' '}
                {[
                  hiddenSteps > 0 ? t('conversation.orchestration.activity.moreSteps', { count: hiddenSteps }) : null,
                  shortThoughts > 0
                    ? t('conversation.orchestration.activity.shortThoughts', { count: shortThoughts })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TurnActivity;

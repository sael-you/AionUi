/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageToolCall } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { ToolItemDetail } from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { formatRelativeTime } from '@/renderer/utils/chat/relativeTime';
import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import { Button, Drawer } from '@arco-design/web-react';
import { ArrowRight, ArrowRightUp, BranchOne, Down, MessageOne, Right, Robot, Up, ViewList } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { formatRunDuration, runStateLabelKey, type RunState } from '../runState';
import StatusGlyph from '../StatusGlyph';
import { useDurationUnits, useTicker } from '../TurnActivity';
import { countRunStates, latestInnerStep, type DelegatedKind, type DelegatedRow } from './delegatedWork';
import styles from './DelegatedWorkCard.module.css';
import { useLiveSteps } from './liveSteps';

/** Header summary order: what needs attention first. */
const SUMMARY_STATES: RunState[] = ['running', 'waiting', 'failed', 'done'];
const GROUPS: DelegatedKind[] = ['conversation', 'subagent', 'background'];

/** Monochrome agent mark of a conversation (who runs it). */
export const ConversationAgentMark: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const logos = useAgentLogos();
  const { info } = usePresetAssistantInfo(conversation);
  const mark = resolveConversationLeadingMark(conversation, info, logos);
  return (
    <span className={styles.agent} aria-hidden='true'>
      {mark.kind === 'emoji' ? (
        <span className={styles.agentEmoji}>{mark.value}</span>
      ) : mark.kind === 'image' ? (
        <ThemedLogo src={mark.value} alt='' className={styles.agentImage} />
      ) : mark.kind === 'assistant_fallback' ? (
        <Robot theme='outline' size='14' />
      ) : (
        <MessageOne theme='outline' size='14' />
      )}
    </span>
  );
};

type DrawerTarget = { row: DelegatedRow } | null;

export type DelegatedWorkCardProps = {
  /** DOM id (the header pill scrolls here). */
  id: string;
  rows: DelegatedRow[];
  /** The parent conversation (its agent mark stands for its subagents). */
  parent?: TChatConversation;
  /** Every tool call of the parent, for a subagent's inner steps. */
  toolCalls: readonly IMessageToolCall[];
};

/**
 * Delegated work (C21): what this turn launched, grouped into conversations,
 * subagents and background tasks, each row with its state, the live step /
 * question / error, the agent, the duration and a jump (Review when it needs
 * you, open, transcript or output). Finished background tasks fold into
 * "N finished · Show". Keyboard: Tab enters, ↑/↓ move between rows, Enter
 * opens; focus returns to the row when a drawer closes.
 */
const DelegatedWorkCard: React.FC<DelegatedWorkCardProps> = ({ id, rows, parent, toolCalls }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const units = useDurationUnits();
  const liveSteps = useLiveSteps();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [collapsed, setCollapsed] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<DelegatedKind>>(new Set());
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const anyRunning = rows.some((row) => row.state === 'running' || row.state === 'waiting');
  const now = useTicker(anyRunning);
  const counts = useMemo(() => countRunStates(rows), [rows]);

  const grouped = useMemo(() => {
    const map = new Map<DelegatedKind, DelegatedRow[]>(
      GROUPS.map((kind): [DelegatedKind, DelegatedRow[]] => [kind, []])
    );
    for (const row of rows) map.get(row.kind)?.push(row);
    return map;
  }, [rows]);
  const finishedBackground = (grouped.get('background') ?? []).filter((row) => row.state === 'done');

  const open = (row: DelegatedRow, element: HTMLElement | null) => {
    if (row.kind === 'conversation' && row.conversation) {
      void navigate(`/conversation/${row.conversation.id}`);
      return;
    }
    returnFocusRef.current = element;
    setDrawer({ row });
  };

  const secondaryOf = (row: DelegatedRow): { text: string; tone?: 'mono' | 'wait' | 'fail' } => {
    switch (row.state) {
      case 'waiting':
        return { text: t('conversation.orchestration.card.waitingNote'), tone: 'wait' };
      case 'failed':
        return {
          text:
            row.kind === 'conversation'
              ? t('conversation.orchestration.card.failedNote')
              : t('conversation.orchestration.card.taskFailedNote'),
          tone: 'fail',
        };
      case 'queued':
        return { text: t('conversation.orchestration.state.queued') };
      case 'stopped':
        return { text: t('conversation.orchestration.card.stoppedNote') };
      case 'done':
        return row.kind === 'conversation' && row.endedAt
          ? {
              text: t('conversation.orchestration.card.reportedBack', {
                time: formatRelativeTime(row.endedAt, i18n?.language ?? 'en'),
              }),
            }
          : { text: t('conversation.orchestration.state.done') };
      case 'running': {
        const step =
          row.kind === 'conversation' && row.conversation
            ? liveSteps.get(row.conversation.id)
            : row.kind === 'background'
              ? row.command
              : row.callId
                ? latestInnerStep(row.callId, toolCalls)
                : undefined;
        return step ? { text: step, tone: 'mono' } : { text: t('conversation.orchestration.state.running') };
      }
      default:
        return { text: '' };
    }
  };

  const durationOf = (row: DelegatedRow): string => {
    if (!row.startedAt) return '—';
    const end = row.endedAt ?? now;
    return formatRunDuration(end - row.startedAt, units, { seconds: row.kind !== 'conversation' });
  };

  const actionOf = (row: DelegatedRow, element: () => HTMLElement | null) => {
    if (row.state === 'waiting' && row.kind === 'conversation') {
      return (
        <Button
          size='mini'
          className={styles.review}
          data-testid={`delegated-review-${row.key}`}
          onClick={(event) => {
            event.stopPropagation();
            open(row, element());
          }}
        >
          {t('conversation.orchestration.card.review')}
          {!isMobile && <ArrowRight theme='outline' size='12' />}
        </Button>
      );
    }
    if (isMobile) return null;
    const label =
      row.kind === 'conversation'
        ? t('conversation.orchestration.card.open')
        : row.kind === 'subagent'
          ? t('conversation.orchestration.card.transcript')
          : t('conversation.orchestration.card.output');
    return (
      <Button
        type='text'
        size='mini'
        className={styles.go}
        aria-label={`${label}: ${row.name}`}
        tabIndex={-1}
        icon={
          row.kind === 'conversation' ? (
            <ArrowRightUp theme='outline' size='14' />
          ) : row.kind === 'subagent' ? (
            <Right theme='outline' size='14' />
          ) : (
            <ViewList theme='outline' size='14' />
          )
        }
        onClick={(event) => {
          event.stopPropagation();
          open(row, element());
        }}
      />
    );
  };

  const renderRow = (row: DelegatedRow) => {
    const secondary = secondaryOf(row);
    let element: HTMLDivElement | null = null;
    const stateWord = t(runStateLabelKey(row.state));
    return (
      <div
        key={row.key}
        ref={(node) => {
          element = node;
        }}
        className={classNames(styles.row, {
          [styles.waitRow]: row.state === 'waiting',
          [styles.nested]: row.depth > 0,
        })}
        style={{ '--dw-depth': row.depth } as React.CSSProperties}
        role='listitem'
        tabIndex={-1}
        data-dw-row=''
        data-testid={`delegated-row-${row.key}`}
        aria-label={[row.name, stateWord, secondary.text, durationOf(row)].filter(Boolean).join(', ')}
        onClick={() => open(row, element)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && event.key === 'Enter') {
            event.preventDefault();
            open(row, element);
          }
        }}
      >
        {row.depth > 0 && <span className={styles.elbow} aria-hidden='true' />}
        <StatusGlyph state={row.state} size={16} className={styles.glyph} />
        <span className={styles.two}>
          <span className={styles.name} title={row.name}>
            {row.name}
          </span>
          <span
            className={classNames(styles.sub, {
              [styles.mono]: secondary.tone === 'mono',
              [styles.subWait]: secondary.tone === 'wait',
              [styles.subFail]: secondary.tone === 'fail',
            })}
            title={secondary.text}
          >
            {secondary.text}
          </span>
        </span>
        {!isMobile &&
          (row.kind === 'conversation' && row.conversation ? (
            <ConversationAgentMark conversation={row.conversation} />
          ) : row.kind === 'subagent' && parent ? (
            <ConversationAgentMark conversation={parent} />
          ) : (
            <span className={styles.agent} />
          ))}
        {!(isMobile && row.state === 'waiting' && row.kind === 'conversation') && (
          <span className={classNames(styles.duration, { [styles.durationRun]: row.state === 'running' })}>
            {durationOf(row)}
          </span>
        )}
        {actionOf(row, () => element)}
      </div>
    );
  };

  const groupSummary = (list: DelegatedRow[]) => {
    const c = countRunStates(list);
    return SUMMARY_STATES.concat(['stopped', 'queued'])
      .filter((state) => c[state] > 0)
      .map((state) => t(`conversation.orchestration.count.${state}`, { count: c[state] }))
      .join(' · ');
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-dw-row]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    items.forEach((item) => item.setAttribute('tabindex', item === next ? '0' : '-1'));
    next.focus();
  };

  const firstRowKey = GROUPS.flatMap((kind) => grouped.get(kind) ?? [])[0]?.key;
  const drawerRow = drawer?.row;
  const innerSteps = useMemo(
    () =>
      drawerRow?.callId
        ? normalizeToolMessages(toolCalls.filter((message) => message.content?.parent_call_id === drawerRow.callId))
        : [],
    [drawerRow, toolCalls]
  );

  return (
    <section
      id={id}
      className={styles.card}
      aria-label={t('conversation.orchestration.card.title')}
      data-testid='delegated-work-card'
    >
      <div className={styles.head}>
        <span className={styles.title}>
          <BranchOne theme='outline' size='16' className={styles.titleIcon} />
          {t('conversation.orchestration.card.title')}
        </span>
        {!isMobile && (
          <span className={styles.summary}>
            {SUMMARY_STATES.filter((state) => counts[state] > 0).map((state) => (
              <span key={state} className={styles.summaryItem}>
                <StatusGlyph state={state} size={12} label={null} />
                {t(`conversation.orchestration.count.${state}`, { count: counts[state] })}
              </span>
            ))}
          </span>
        )}
        <Button
          type='text'
          size='mini'
          className={styles.collapse}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? t('conversation.orchestration.card.expand') : t('conversation.orchestration.card.collapse')
          }
          icon={collapsed ? <Down theme='outline' size='14' /> : <Up theme='outline' size='14' />}
          onClick={() => setCollapsed((value) => !value)}
        />
      </div>
      {!collapsed && (
        <div ref={listRef} onKeyDown={onListKeyDown}>
          {GROUPS.map((kind, groupIndex) => {
            const list = grouped.get(kind) ?? [];
            if (list.length === 0) return null;
            const groupTitle = t(`conversation.orchestration.card.group.${kind}`);
            // Mobile: subagents and background tasks collapse to one summary row each.
            if (isMobile && kind !== 'conversation' && !openGroups.has(kind)) {
              return (
                <div
                  key={kind}
                  className={styles.collapsedGroup}
                  role='button'
                  tabIndex={0}
                  aria-expanded={false}
                  onClick={() => setOpenGroups((set) => new Set(set).add(kind))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setOpenGroups((set) => new Set(set).add(kind));
                    }
                  }}
                >
                  <StatusGlyph
                    state={list.some((row) => row.state === 'running') ? 'running' : 'done'}
                    size={16}
                    label={null}
                  />
                  <span>{groupTitle}</span>
                  <span className={styles.collapsedSummary}>{groupSummary(list)}</span>
                  <Right theme='outline' size='14' className={styles.chevron} />
                </div>
              );
            }
            const visible = kind === 'background' && !showFinished ? list.filter((row) => row.state !== 'done') : list;
            return (
              <div key={kind} className={classNames(styles.group, { [styles.groupDivided]: groupIndex > 0 })}>
                <div className={styles.groupHead}>
                  {groupTitle} <span className={styles.groupCount}>{list.length}</span>
                </div>
                <div role='list' aria-label={groupTitle}>
                  {visible.map((row) => {
                    const node = renderRow(row);
                    return row.key === firstRowKey ? React.cloneElement(node, { tabIndex: 0 }) : node;
                  })}
                </div>
                {kind === 'background' && finishedBackground.length > 0 && !showFinished && (
                  <div className={styles.foot}>
                    <StatusGlyph state='done' size={12} label={null} />
                    <span>
                      {t('conversation.orchestration.card.finishedHidden', { count: finishedBackground.length })}
                    </span>
                    <Button type='text' size='mini' className={styles.footLink} onClick={() => setShowFinished(true)}>
                      {t('conversation.orchestration.card.show')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Drawer
        visible={drawer !== null}
        title={drawerRow?.name}
        placement={isMobile ? 'bottom' : 'right'}
        width={isMobile ? undefined : 480}
        height={isMobile ? '60%' : undefined}
        footer={null}
        unmountOnExit
        onCancel={() => setDrawer(null)}
        afterClose={() => returnFocusRef.current?.focus()}
      >
        {drawerRow?.kind === 'background' ? (
          <pre className={styles.output} data-testid='delegated-output'>
            {drawerRow.output || t('conversation.orchestration.card.noOutput')}
          </pre>
        ) : (
          <div className={styles.transcript} data-testid='delegated-transcript'>
            {innerSteps.length === 0 ? (
              <div className={styles.empty}>{t('conversation.orchestration.card.noSteps')}</div>
            ) : (
              innerSteps.map((item) => <ToolItemDetail key={item.key} item={item} />)
            )}
          </div>
        )}
      </Drawer>
    </section>
  );
};

export default DelegatedWorkCard;

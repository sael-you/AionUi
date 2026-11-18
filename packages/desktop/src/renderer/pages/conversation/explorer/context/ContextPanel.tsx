/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The conversation's Context panel (C41): how full the agent's context window
 * is and what fills it. One stacked bar, one row per category, the item lists
 * behind three expandable rows, the auto-compact setting and "Compact session".
 *
 * Self-contained: it only needs the conversation id, so the sidebar tab and the
 * mobile sheet render the very same component.
 */

import { Button, Message, Select, Spin, Tooltip } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ContextAutoCompactMode,
  ContextCategory,
  ConversationContextReport,
} from '@/common/types/conversationContext';
import { formatCostAmount, formatTokenCount } from '@/renderer/components/agent/ContextUsageIndicator';
import { useIsConversationGenerating } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import { formatNumber } from '@/renderer/services/i18n/format';

import {
  AUTO_COMPACT_MODES,
  barSegments,
  categoryColor,
  categoryPercent,
  contextLists,
  LIST_CATEGORY,
  type ContextList,
  type ListRow,
  isEmptyReport,
  usedPercent,
  windowSize,
} from './contextModel';
import { useContextReport } from './useContextReport';

export type ContextPanelProps = {
  conversationId: string | null;
  className?: string;
};

const wholePercent = (value: number, locale: string): string =>
  formatNumber(value / 100, locale, { style: 'percent', maximumFractionDigits: 0 });

const rowPercent = (value: number, locale: string): string =>
  formatNumber(value / 100, locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

const ContextPanel: React.FC<ContextPanelProps> = ({ conversationId, className }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const ctx = useContextReport(conversationId);
  const turnRunning = useIsConversationGenerating(conversationId);
  const [openLists, setOpenLists] = useState<Record<string, boolean>>({});

  // `other` is the backend's bucket for a category it does not know: its own
  // name says more than our generic word.
  const categoryLabel = (category: Pick<ContextCategory, 'id' | 'name'>): string =>
    category.id === 'other' && category.name
      ? category.name
      : t(`conversation.context.category.${category.id}`, { defaultValue: category.name || category.id });

  const tokens = (count: number, estimated?: boolean): React.ReactNode => {
    const text = formatTokenCount(count, locale);
    if (!estimated) return text;
    return (
      <Tooltip content={t('conversation.context.estimatedTooltip')} mini>
        <span className='cursor-help' data-estimated='true'>
          ~{text}
        </span>
      </Tooltip>
    );
  };

  if (!conversationId) {
    return <PanelNotice className={className} text={t('conversation.context.empty')} />;
  }
  if (ctx.loading) {
    return (
      <div className={classNames('h-full flex items-center justify-center', className)} data-context-state='loading'>
        <Spin />
      </div>
    );
  }
  if (!ctx.report && ctx.error) {
    return (
      <PanelNotice
        className={className}
        state='error'
        text={t('conversation.context.loadFailed')}
        action={
          <Button size='small' onClick={() => void ctx.reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }
  if (isEmptyReport(ctx.report)) {
    return <PanelNotice className={className} text={t('conversation.context.empty')} />;
  }

  const report = ctx.report as ConversationContextReport;
  const size = windowSize(report);
  const percent = usedPercent(report);
  const segments = barSegments(report);
  const loaded = report.categories.filter((c) => !c.deferred);
  const deferred = report.categories.filter((c) => c.deferred);
  const autoCompact = report.auto_compact?.supported ? report.auto_compact : null;
  const lists = contextLists(report.items);
  const untilTokens = autoCompact?.until_tokens;

  const modeLabel = (mode: ContextAutoCompactMode): string => {
    if (mode === 'auto') return t('conversation.context.mode.auto');
    if (mode === 'off') return t('conversation.context.mode.off');
    return wholePercent(Number(mode), locale);
  };

  const handleModeChange = async (mode: ContextAutoCompactMode): Promise<void> => {
    if (!(await ctx.setAutoCompact(mode))) Message.error(t('conversation.context.autoCompactSaveFailed'));
  };

  const handleCompact = async (): Promise<void> => {
    const outcome = await ctx.compact();
    if (outcome === 'turn_running') Message.warning(t('conversation.context.compactTurnRunning'));
    else if (outcome === 'unsupported') Message.warning(t('conversation.context.compactUnsupported'));
    else if (outcome === 'failed') Message.error(t('conversation.context.compactFailed'));
  };

  const categoryRow = (category: ContextCategory): React.ReactNode => {
    const share = categoryPercent(category, size);
    return (
      <li
        key={category.id}
        className={classNames('flex items-center gap-8px min-h-24px', category.deferred && 'opacity-60')}
        data-category={category.id}
        data-deferred={category.deferred ? 'true' : undefined}
      >
        <span
          aria-hidden='true'
          className='w-8px h-8px rd-2px flex-shrink-0'
          style={{ background: categoryColor(category) }}
        />
        <span className='flex-1 min-w-0 truncate text-t-primary'>{categoryLabel(category)}</span>
        <span className='text-t-secondary tabular-nums'>{tokens(category.tokens, category.estimated)}</span>
        <span className='w-48px text-end text-t-secondary tabular-nums'>
          {share === null ? '—' : rowPercent(share, locale)}
        </span>
      </li>
    );
  };

  const itemRow = (row: ListRow): React.ReactNode => (
    <li key={row.key} className='flex items-center gap-8px min-h-22px ps-22px'>
      <span className='flex-1 min-w-0 truncate text-t-secondary' title={row.name}>
        {row.name}
      </span>
      <span className='text-t-tertiary tabular-nums'>{formatTokenCount(row.tokens, locale)}</span>
    </li>
  );

  const listSection = (list: ContextList): React.ReactNode => {
    const open = Boolean(openLists[list.key]);
    const label = categoryLabel({ id: LIST_CATEGORY[list.key], name: '' });
    return (
      <div key={list.key} data-context-list={list.key}>
        <Button
          type='text'
          size='mini'
          long
          className='!h-26px !px-0 !bg-transparent !text-t-secondary hover:!text-t-primary'
          aria-expanded={open}
          onClick={() => setOpenLists((prev) => ({ ...prev, [list.key]: !open }))}
        >
          <span className='flex items-center gap-6px w-full text-13px'>
            {open ? <Down theme='outline' size='12' /> : <Right theme='outline' size='12' />}
            <span className='flex-1 min-w-0 truncate text-start'>{label}</span>
            <span className='text-t-tertiary tabular-nums'>{formatNumber(list.count, locale)}</span>
          </span>
        </Button>
        {open && (
          <ul className='m-0 p-0 list-none pb-4px'>
            {list.groups.map((group) =>
              list.key === 'mcp_tools' ? (
                <li key={group.name ?? ''} className='list-none'>
                  <div className='flex items-center gap-8px min-h-22px ps-22px text-t-primary'>
                    <span className='flex-1 min-w-0 truncate font-medium'>
                      {group.name ?? t('conversation.context.otherServer')}
                    </span>
                    <span className='text-t-secondary tabular-nums'>{formatTokenCount(group.tokens, locale)}</span>
                  </div>
                  <ul className='m-0 p-0 list-none ps-10px'>{group.rows.map(itemRow)}</ul>
                </li>
              ) : (
                group.rows.map(itemRow)
              )
            )}
          </ul>
        )}
      </div>
    );
  };

  const compactDisabled = turnRunning && !ctx.compacting;
  const compactButton = (
    <Button
      size='small'
      type='secondary'
      loading={ctx.compacting}
      disabled={compactDisabled}
      onClick={() => void handleCompact()}
      data-context-compact
    >
      {ctx.compacting ? t('conversation.context.compacting') : t('conversation.context.compact')}
    </Button>
  );

  return (
    <div
      className={classNames('h-full overflow-y-auto px-12px py-12px text-13px', className)}
      data-context-state={ctx.compacting ? 'compacting' : 'ready'}
      data-context-source={report.source}
    >
      <div className='flex items-baseline justify-between gap-8px'>
        <span className='text-14px font-medium text-t-primary'>
          {percent === null
            ? t('conversation.contextUsage.tokensUsed', { tokens: formatTokenCount(report.used, locale) })
            : t('conversation.context.used', { percent: wholePercent(percent, locale) })}
        </span>
        <span className='text-t-secondary tabular-nums'>
          {size > 0
            ? `${formatTokenCount(report.used, locale)} / ${formatTokenCount(size, locale, true)}`
            : t('conversation.contextUsage.windowUnknown')}
        </span>
      </div>

      <div
        role='progressbar'
        aria-label={t('conversation.explorer.tabs.context')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
        className='mt-8px h-6px rd-full bg-fill-2 overflow-hidden flex gap-1px'
      >
        {segments.map((segment) => (
          <span
            key={segment.id}
            data-segment={segment.id}
            className='h-full flex-shrink-0'
            style={{ width: `${segment.widthPercent}%`, background: segment.color }}
          />
        ))}
      </div>

      {autoCompact && (
        <div className='mt-12px' data-context-auto-compact>
          <div className='flex items-center justify-between gap-8px'>
            <span className='text-t-primary'>{t('conversation.context.autoCompactAt')}</span>
            <Select
              size='small'
              bordered={false}
              triggerProps={{ autoAlignPopupWidth: false, position: 'br' }}
              className='!w-auto min-w-84px'
              value={autoCompact.mode}
              loading={ctx.savingAutoCompact}
              disabled={ctx.savingAutoCompact}
              aria-label={t('conversation.context.autoCompactAt')}
              onChange={(mode: ContextAutoCompactMode) => void handleModeChange(mode)}
            >
              {AUTO_COMPACT_MODES.map((mode) => (
                <Select.Option key={String(mode)} value={mode}>
                  {modeLabel(mode)}
                </Select.Option>
              ))}
            </Select>
          </div>
          <p className='m-0 mt-2px text-12px leading-18px text-t-secondary'>
            {t('conversation.context.autoCompactHint')}
          </p>
          {ctx.autoCompactPending && (
            <p className='m-0 mt-4px text-12px leading-18px text-t-secondary' data-context-next-start>
              {t('conversation.context.autoCompactNextStart')}
            </p>
          )}
        </div>
      )}

      <ul className='m-0 p-0 list-none mt-12px'>{loaded.map(categoryRow)}</ul>
      {deferred.length > 0 && <ul className='m-0 p-0 list-none mt-6px'>{deferred.map(categoryRow)}</ul>}

      {lists.length > 0 && <div className='mt-8px'>{lists.map(listSection)}</div>}

      {report.cost && (
        <div className='mt-8px text-12px text-t-secondary' data-context-cost>
          {t('conversation.contextUsage.sessionCost')} ≈ {formatCostAmount(report.cost, locale)}
        </div>
      )}

      <div className='mt-12px pt-10px border-t border-[var(--bg-3)] flex items-center justify-between gap-8px flex-wrap'>
        <span className='text-t-secondary'>
          {typeof untilTokens === 'number' && untilTokens > 0
            ? t('conversation.context.untilAutoCompact', { tokens: formatTokenCount(untilTokens, locale) })
            : ''}
        </span>
        {compactDisabled ? (
          <Tooltip content={t('conversation.context.compactTurnRunning')} mini position='tr'>
            <span className='inline-flex'>{compactButton}</span>
          </Tooltip>
        ) : (
          compactButton
        )}
      </div>
    </div>
  );
};

const PanelNotice: React.FC<{
  text: string;
  className?: string;
  state?: 'empty' | 'error';
  action?: React.ReactNode;
}> = ({ text, className, state = 'empty', action }) => (
  <div
    className={classNames('h-full flex flex-col items-center justify-center gap-10px px-16px text-center', className)}
    data-context-state={state}
  >
    <span className='text-13px text-t-secondary'>{text}</span>
    {action}
  </div>
);

export default ContextPanel;

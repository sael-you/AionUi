/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token usage of a project (C42): per day for 7 / 30 / 90 days (stacked bars or
 * the same numbers as a table), the ten conversations that used most, and the
 * split by model. Cost is shown only where a backend reported it. Recording
 * started with this release: "since <date>" says what the numbers cover.
 */

import { Link, Radio, Switch } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { USAGE_RANGES, type UsageRangeDays, type UsageTotals } from '@/common/types/platform/projectPage';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel, SizeBar, StatTile } from './ProjectParts';
import UsageChart, { UsageLegend } from './UsageChart';
import { USAGE_SERIES, formatCost, formatDay, formatTokens, percentOf, tokensOf } from './projectModel';
import { useProjectUsage } from './useProjectPage';

/** One ranked row: name, tokens (and cost), and a bar relative to the largest row. */
const RankRow: React.FC<{
  name: React.ReactNode;
  totals: UsageTotals;
  largest: number;
  note?: string;
}> = ({ name, totals, largest, note }) => {
  const { i18n } = useTranslation();
  const tokens = tokensOf(totals);
  return (
    <li
      className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10px gap-y-4px py-6px'
      data-testid='usage-rank-row'
    >
      <span className='flex items-baseline gap-6px min-w-0 text-13px text-t-primary'>
        <span className='truncate'>{name}</span>
        {note ? <span className='shrink-0 text-12px text-t-tertiary'>{note}</span> : null}
      </span>
      <span className='text-12px text-t-secondary tabular-nums whitespace-nowrap'>
        {formatTokens(tokens, i18n.language)}
        {totals.cost_micro_usd !== undefined ? ` · ${formatCost(totals.cost_micro_usd, i18n.language)}` : ''}
      </span>
      <span className='col-span-2'>
        <SizeBar percent={percentOf(tokens, largest)} />
      </span>
    </li>
  );
};

const UsageTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [days, setDays] = useState<UsageRangeDays>(30);
  const [asTable, setAsTable] = useState(false);
  const { usage, error, isLoading, reload } = useProjectUsage(projectId, days);

  const range = (
    <Radio.Group
      type='button'
      size='small'
      value={days}
      onChange={(value: UsageRangeDays) => setDays(value)}
      aria-label={t('conversation.projectPage.usage.range')}
      data-testid='usage-range'
    >
      {USAGE_RANGES.map((value) => (
        <Radio key={value} value={value}>
          {t('conversation.projectPage.usage.rangeDays', { count: value })}
        </Radio>
      ))}
    </Radio.Group>
  );

  if (error) {
    return (
      <div className='flex flex-col gap-12px'>
        {range}
        <ErrorBlock error={error} onRetry={() => void reload()} />
      </div>
    );
  }
  if (isLoading && !usage) return <LoadingBlock rows={6} />;
  if (!usage) return null;

  const total = tokensOf(usage.totals);
  const recorded = usage.since !== undefined && total > 0;
  const topConversation = Math.max(0, ...usage.by_conversation.map(tokensOf));
  const topModel = Math.max(0, ...usage.by_model.map(tokensOf));

  return (
    <div className='flex flex-col gap-12px' data-testid='project-usage'>
      <div className='flex flex-wrap items-center gap-8px'>
        {range}
        <span className='flex-1' />
        {usage.since !== undefined ? (
          <span className='text-12px text-t-tertiary' data-testid='usage-since'>
            {t('conversation.projectPage.usage.since', {
              date: new Date(usage.since).toLocaleDateString(i18n.language),
            })}
          </span>
        ) : null}
      </div>

      {!recorded ? (
        <Panel>
          <EmptyBlock text={t('conversation.projectPage.usage.none')} />
        </Panel>
      ) : (
        <>
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-10px'>
            <StatTile
              testId='usage-tile-total'
              label={t('conversation.projectPage.usage.totalTokens')}
              value={formatTokens(total, i18n.language)}
              sub={t('conversation.projectPage.overview.turns', { count: usage.totals.turns })}
            />
            <StatTile
              label={t('conversation.projectPage.usage.series.input')}
              value={formatTokens(usage.totals.input, i18n.language)}
            />
            <StatTile
              label={t('conversation.projectPage.usage.series.output')}
              value={formatTokens(usage.totals.output, i18n.language)}
            />
            {usage.totals.cost_micro_usd !== undefined ? (
              <StatTile
                testId='usage-tile-cost'
                label={t('conversation.projectPage.usage.cost')}
                value={formatCost(usage.totals.cost_micro_usd, i18n.language)}
              />
            ) : (
              <StatTile
                label={t('conversation.projectPage.usage.cache')}
                value={formatTokens(usage.totals.cache_read + usage.totals.cache_write, i18n.language)}
              />
            )}
          </div>

          <Panel
            title={t('conversation.projectPage.usage.perDay')}
            testId='usage-per-day'
            actions={
              <label className='flex items-center gap-6px text-12px text-t-secondary'>
                <Switch size='small' checked={asTable} onChange={setAsTable} data-testid='usage-table-switch' />
                {t('conversation.projectPage.usage.showTable')}
              </label>
            }
          >
            <UsageLegend />
            {asTable ? (
              <div className='max-h-360px overflow-auto'>
                <table className='w-full border-collapse text-12px' data-testid='usage-table'>
                  <thead>
                    <tr className='text-t-secondary'>
                      <th scope='col' className='text-start font-500 py-4px pe-8px'>
                        {t('conversation.projectPage.usage.day')}
                      </th>
                      {USAGE_SERIES.map((series) => (
                        <th key={series} scope='col' className='text-end font-500 py-4px ps-8px'>
                          {t(`conversation.projectPage.usage.series.${series}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usage.days.toReversed().map((day) => (
                      <tr key={day.day} className='border-0 border-t border-solid border-3 text-t-primary'>
                        <th scope='row' className='text-start font-400 py-4px pe-8px whitespace-nowrap'>
                          {formatDay(day.day, i18n.language)}
                        </th>
                        {USAGE_SERIES.map((series) => (
                          <td key={series} className='text-end tabular-nums py-4px ps-8px'>
                            {day[series].toLocaleString(i18n.language)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <UsageChart days={usage.days} />
            )}
            <span className='text-12px text-t-tertiary'>{t('conversation.projectPage.usage.utc')}</span>
          </Panel>

          <div className='grid gap-12px lg:grid-cols-2'>
            <Panel title={t('conversation.projectPage.usage.byConversation')} testId='usage-by-conversation'>
              <ul className='m-0 p-0 list-none'>
                {usage.by_conversation.map((row) => (
                  <RankRow
                    key={row.conversation_id}
                    totals={row}
                    largest={topConversation}
                    name={
                      row.name ? (
                        <Link
                          className='!p-0 !text-13px !text-t-primary hover:underline'
                          onClick={() => void navigate(`/conversation/${encodeURIComponent(row.conversation_id)}`)}
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className='text-t-tertiary'>
                          {t('conversation.projectPage.usage.deletedConversation')}
                        </span>
                      )
                    }
                  />
                ))}
              </ul>
            </Panel>
            <Panel title={t('conversation.projectPage.usage.byModel')} testId='usage-by-model'>
              <ul className='m-0 p-0 list-none'>
                {usage.by_model.map((row) => (
                  <RankRow
                    key={`${row.backend}:${row.model}`}
                    totals={row}
                    largest={topModel}
                    name={row.model || t('conversation.projectPage.usage.unknownModel')}
                    note={row.backend || undefined}
                  />
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
};

export default UsageTab;

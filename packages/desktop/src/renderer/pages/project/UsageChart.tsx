/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tokens per day as stacked bars (C42), plain SVG: no chart library in the
 * bundle. One axis; four series in a fixed order and colour (input, output,
 * cache read, cache write) with a legend; a 2 px gap between touching marks;
 * hover or the arrow keys read one day in a tooltip. The same numbers are
 * available as a table (UsageTab), so colour is never the only carrier.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageDay } from '@/common/types/platform/projectPage';
import { useContainerWidth } from '@/renderer/pages/conversation/hooks/useContainerWidth';
import { USAGE_SERIES, formatDay, formatTokens, layoutUsageChart, tokensOf, type UsageSeries } from './projectModel';

/** Series → its colour token (styles/themes: selected per theme, validated as a set). */
export const SERIES_COLOR: Record<UsageSeries, string> = {
  input: 'var(--chart-series-1)',
  output: 'var(--chart-series-2)',
  cache_read: 'var(--chart-series-3)',
  cache_write: 'var(--chart-series-4)',
};

const HEIGHT = 240;

export const UsageLegend: React.FC = () => {
  const { t } = useTranslation();
  return (
    <ul className='m-0 p-0 list-none flex flex-wrap gap-x-14px gap-y-4px' data-testid='usage-legend'>
      {USAGE_SERIES.map((series) => (
        <li key={series} className='flex items-center gap-6px text-12px text-t-secondary'>
          <span className='size-10px rd-2px shrink-0' style={{ background: SERIES_COLOR[series] }} aria-hidden='true' />
          {t(`conversation.projectPage.usage.series.${series}`)}
        </li>
      ))}
    </ul>
  );
};

const UsageChart: React.FC<{ days: UsageDay[] }> = ({ days }) => {
  const { t, i18n } = useTranslation();
  const { containerRef, containerWidth } = useContainerWidth();
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(240, Math.round(containerWidth) || 640);
  const layout = layoutUsageChart(days, { width, height: HEIGHT });
  const slot = days.length > 0 ? layout.plot.width / days.length : 0;
  const activeDay = active === null ? null : (days[active] ?? null);
  const activeBar = active === null ? null : (layout.bars[active] ?? null);

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (days.length === 0) return;
    const last = days.length - 1;
    const current = active ?? last;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(last, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const describe = (day: UsageDay): string =>
    [
      formatDay(day.day, i18n.language, true),
      ...USAGE_SERIES.map(
        (series) =>
          `${t(`conversation.projectPage.usage.series.${series}`)} ${formatTokens(day[series], i18n.language)}`
      ),
    ].join(', ');

  return (
    <div ref={containerRef} className='relative w-full min-w-0' data-testid='usage-chart'>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className='block max-w-full outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--primary)] rd-6px'
        role='img'
        tabIndex={0}
        aria-label={t('conversation.projectPage.usage.chartLabel')}
        aria-describedby={activeDay ? 'usage-chart-active' : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        {layout.ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={layout.plot.left}
              x2={layout.plot.left + layout.plot.width}
              y1={tick.y}
              y2={tick.y}
              stroke='var(--color-border-2)'
              strokeWidth={1}
            />
            <text
              x={layout.plot.left - 8}
              y={tick.y}
              textAnchor='end'
              dominantBaseline='middle'
              fontSize={11}
              fill='var(--color-text-3)'
            >
              {formatTokens(tick.value, i18n.language)}
            </text>
          </g>
        ))}
        {layout.bars.map((bar, index) => (
          <g
            key={bar.day}
            data-testid='usage-bar'
            data-day={bar.day}
            opacity={active === null || active === index ? 1 : 0.55}
          >
            {bar.segments.map((segment) => (
              <rect
                key={segment.series}
                x={bar.x}
                y={segment.y}
                width={bar.width}
                height={segment.height}
                rx={Math.min(2, bar.width / 2)}
                fill={SERIES_COLOR[segment.series]}
                data-series={segment.series}
              />
            ))}
            {layout.labelled.includes(index) ? (
              <text
                // The last label is right-aligned to its bar so it cannot run out of the plot.
                x={index === layout.bars.length - 1 ? bar.x + bar.width : bar.x + bar.width / 2}
                y={layout.plot.top + layout.plot.height + 15}
                textAnchor={index === layout.bars.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill='var(--color-text-3)'
              >
                {formatDay(bar.day, i18n.language)}
              </text>
            ) : null}
            {/* The hit target is the whole column, wider and taller than the mark. */}
            <rect
              x={layout.plot.left + slot * index}
              y={layout.plot.top}
              width={slot}
              height={layout.plot.height}
              fill='transparent'
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive(index)}
            />
          </g>
        ))}
      </svg>
      {activeDay && activeBar ? (
        <div
          id='usage-chart-active'
          role='status'
          className='pointer-events-none absolute top-0 z-1 min-w-150px rd-8px border border-solid border-3 bg-base p-8px shadow-md flex flex-col gap-2px'
          style={
            activeBar.x + activeBar.width / 2 > width / 2
              ? { right: Math.max(0, width - activeBar.x + 6) }
              : { left: activeBar.x + activeBar.width + 6 }
          }
          data-testid='usage-tooltip'
        >
          <span className='sr-only'>{describe(activeDay)}</span>
          <span className='text-12px font-600 text-t-primary' aria-hidden='true'>
            {formatDay(activeDay.day, i18n.language, true)}
          </span>
          {USAGE_SERIES.toReversed().map((series) => (
            <span key={series} className='flex items-center gap-6px text-12px text-t-secondary' aria-hidden='true'>
              <span className='size-8px rd-2px shrink-0' style={{ background: SERIES_COLOR[series] }} />
              <span className='flex-1'>{t(`conversation.projectPage.usage.series.${series}`)}</span>
              <span className='tabular-nums text-t-primary'>{formatTokens(activeDay[series], i18n.language)}</span>
            </span>
          ))}
          <span
            className='flex items-center gap-6px border-0 border-t border-solid border-3 pt-2px text-12px text-t-secondary'
            aria-hidden='true'
          >
            <span className='flex-1'>{t('conversation.projectPage.usage.total')}</span>
            <span className='tabular-nums font-600 text-t-primary'>
              {formatTokens(tokensOf(activeDay), i18n.language)}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default UsageChart;

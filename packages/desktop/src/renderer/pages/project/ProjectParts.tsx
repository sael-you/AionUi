/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Small shared pieces of the project page (C42): panel, stat tile, size bar, states. */

import { Alert, Button, Skeleton } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

type TFn = (key: string, options?: Record<string, unknown>) => string;

export const describeProjectError = (t: TFn, error: unknown): string => {
  if (isBackendHttpError(error)) {
    if (error.code === 'project_not_found') return t('conversation.projectPage.errors.notFound');
    return error.backendMessage.trim() || t('conversation.projectPage.errors.generic');
  }
  return error instanceof Error && error.message ? error.message : t('conversation.projectPage.errors.generic');
};

export const Panel: React.FC<{
  title?: string;
  actions?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, actions, testId, children }) => (
  <section
    className='rd-12px border border-solid border-3 bg-base p-14px flex flex-col gap-10px min-w-0'
    data-testid={testId}
  >
    {title || actions ? (
      <div className='flex flex-wrap items-center gap-8px'>
        {title ? <h2 className='m-0 flex-1 min-w-0 text-13px font-600 text-t-primary'>{title}</h2> : null}
        {actions}
      </div>
    ) : null}
    {children}
  </section>
);

/** One number with its label: the label names it, so the tile needs no chart. */
export const StatTile: React.FC<{
  label: string;
  value: string;
  sub?: React.ReactNode;
  testId?: string;
}> = ({ label, value, sub, testId }) => (
  <div
    className='rd-12px border border-solid border-3 bg-base p-14px flex flex-col gap-4px min-w-0'
    data-testid={testId}
  >
    <span className='text-12px text-t-secondary truncate'>{label}</span>
    <span className='text-22px font-600 leading-28px text-t-primary truncate'>{value}</span>
    {sub ? <span className='text-12px text-t-tertiary min-h-18px'>{sub}</span> : null}
  </div>
);

/**
 * A thin magnitude bar (one hue): `percent` of the track. The value is always
 * printed next to it by the caller; the bar itself is decoration for a reader.
 */
export const SizeBar: React.FC<{ percent: number; color?: string }> = ({ percent, color }) => (
  <span className='block h-6px w-full rd-full bg-fill-2 overflow-hidden' aria-hidden='true'>
    <span
      className='block h-full rd-full'
      style={{
        width: `${Math.max(percent > 0 ? 1 : 0, Math.min(100, percent))}%`,
        background: color ?? 'var(--chart-series-1)',
      }}
    />
  </span>
);

export const LoadingBlock: React.FC<{ rows?: number; label?: string }> = ({ rows = 4, label }) => {
  const { t } = useTranslation();
  return (
    <div role='status' aria-busy='true' aria-label={label ?? t('conversation.projectPage.loading')}>
      <Skeleton animation text={{ rows }} />
    </div>
  );
};

export const ErrorBlock: React.FC<{ error: unknown; onRetry?: () => void }> = ({ error, onRetry }) => {
  const { t } = useTranslation();
  return (
    <Alert
      type='error'
      content={describeProjectError(t, error)}
      action={
        onRetry ? (
          <Button size='small' onClick={onRetry}>
            {t('conversation.projectPage.retry')}
          </Button>
        ) : undefined
      }
      data-testid='project-error'
    />
  );
};

export const EmptyBlock: React.FC<{ text: string; children?: React.ReactNode }> = ({ text, children }) => (
  <div className='flex flex-col items-start gap-8px py-6px' data-testid='project-empty'>
    <span className='text-13px text-t-tertiary'>{text}</span>
    {children}
  </div>
);

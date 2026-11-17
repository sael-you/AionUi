/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The latest audited commands of one server (C36): when, from which channel,
 * the decision and its reason, the redacted command, exit code and duration.
 * No output is ever stored.
 */

import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useServerAudit } from './useServers';

const DECISION_COLORS: Record<string, string> = {
  ran: 'green',
  failed: 'orange',
  needs_approval: 'arcoblue',
  refused: 'red',
};

const ServerAuditList: React.FC<{ serverId: string }> = ({ serverId }) => {
  const { t, i18n } = useTranslation();
  const { rows, isLoading, error } = useServerAudit(serverId);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  if (isLoading) return null;
  if (error) return <span className='text-12px text-t-tertiary'>{t('settings.servers.audit.loadFailed')}</span>;
  if (rows.length === 0) return <span className='text-12px text-t-tertiary'>{t('settings.servers.audit.empty')}</span>;

  return (
    <ul className='m-0 p-0 list-none flex flex-col gap-8px' data-testid='server-audit'>
      {rows.map((row) => (
        <li key={row.id} className='flex flex-col gap-2px min-w-0' data-testid='server-audit-row'>
          <div className='flex flex-wrap items-center gap-6px text-12px text-t-tertiary'>
            <span>{time.format(row.created_at)}</span>
            <Tag size='small' color={DECISION_COLORS[row.decision]}>
              {t(`settings.servers.audit.decision.${row.decision}`, { defaultValue: row.decision })}
            </Tag>
            {row.channel === 'crucial' ? (
              <Tag size='small' color='red'>
                {t('settings.servers.audit.crucial')}
              </Tag>
            ) : null}
            {row.exit_code !== undefined ? (
              <span>{t('settings.servers.audit.exitCode', { code: row.exit_code })}</span>
            ) : null}
            {row.duration_ms !== undefined ? (
              <span>{t('settings.servers.audit.duration', { seconds: (row.duration_ms / 1000).toFixed(1) })}</span>
            ) : null}
          </div>
          <code className='block text-12px text-t-primary bg-fill-1 rd-6px px-8px py-4px break-all whitespace-pre-wrap'>
            {row.command}
          </code>
          {row.reason ? <span className='text-12px text-t-secondary'>{row.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
};

export default ServerAuditList;

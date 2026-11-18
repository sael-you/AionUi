/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Overview of a project (C42): four tiles (conversations, tokens today, disk,
 * open board cards) and what its conversations get, each row leading to the
 * tab or page that shows it. One request; the disk tile reads the cached scan.
 */

import { Link } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, LoadingBlock, Panel, StatTile } from './ProjectParts';
import { formatBytes, formatTokens, percentOf, tokensOf, type ProjectTab } from './projectModel';
import { useProjectOverview } from './useProjectPage';

const OverviewTab: React.FC<{
  projectId: string;
  onTab: (tab: ProjectTab) => void;
  onOpenMemory: () => void;
}> = ({ projectId, onTab, onOpenMemory }) => {
  const { t, i18n } = useTranslation();
  const { overview, error, isLoading, reload } = useProjectOverview(projectId);

  if (error) return <ErrorBlock error={error} onRetry={() => void reload()} />;
  if (isLoading || !overview) return <LoadingBlock rows={5} />;

  const storage = overview.storage;
  const diskShare = storage?.disk ? percentOf(storage.total_bytes, storage.disk.total_bytes) : null;
  const rows: Array<{ key: string; count: number | undefined; onOpen: () => void }> = [
    { key: 'skills', count: overview.kit.skills, onOpen: () => onTab('kit') },
    { key: 'mcps', count: overview.kit.mcps, onOpen: () => onTab('kit') },
    { key: 'rules', count: overview.kit.rules, onOpen: () => onTab('kit') },
    { key: 'servers', count: overview.kit.servers, onOpen: () => onTab('kit') },
    { key: 'memory', count: overview.memory_files, onOpen: onOpenMemory },
  ];

  return (
    <div className='flex flex-col gap-12px' data-testid='project-overview'>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-10px'>
        <StatTile
          testId='project-tile-conversations'
          label={t('conversation.projectPage.overview.conversations')}
          value={String(overview.conversations.active)}
          sub={t('conversation.projectPage.overview.conversationsSub', { total: overview.conversations.total })}
        />
        <StatTile
          testId='project-tile-tokens'
          label={t('conversation.projectPage.overview.tokensToday')}
          value={formatTokens(tokensOf(overview.tokens_today), i18n.language)}
          sub={
            <Link className='!p-0 !text-12px' onClick={() => onTab('usage')}>
              {t('conversation.projectPage.overview.turns', { count: overview.tokens_today.turns })}
            </Link>
          }
        />
        <StatTile
          testId='project-tile-disk'
          label={t('conversation.projectPage.overview.disk')}
          value={storage ? formatBytes(storage.total_bytes) : '—'}
          sub={
            <Link className='!p-0 !text-12px' onClick={() => onTab('storage')}>
              {!storage
                ? t('conversation.projectPage.overview.diskNotScanned')
                : diskShare === null
                  ? t('conversation.projectPage.tabs.storage')
                  : t('conversation.projectPage.overview.diskShare', { percent: diskShare.toFixed(1) })}
            </Link>
          }
        />
        <StatTile
          testId='project-tile-cards'
          label={t('conversation.projectPage.overview.openCards')}
          value={String(overview.open_cards)}
          sub={t('conversation.projectPage.overview.openCardsSub')}
        />
      </div>

      <Panel title={t('conversation.projectPage.overview.getsTitle')} testId='project-gets'>
        <ul className='m-0 p-0 list-none flex flex-col'>
          {rows.map((row) =>
            row.count === undefined ? null : (
              <li key={row.key} className='border-0 border-b border-solid border-3 last:border-b-0'>
                <Link
                  className='!flex items-center gap-8px !px-4px !py-8px w-full !text-t-primary hover:!bg-fill-1 rd-6px'
                  onClick={row.onOpen}
                  data-testid={`project-gets-${row.key}`}
                >
                  <span className='flex-1 min-w-0 truncate text-13px'>
                    {t(`conversation.projectPage.overview.gets.${row.key}`)}
                  </span>
                  <span className='text-13px font-600 tabular-nums'>{row.count}</span>
                  <Right theme='outline' size='12' className='text-t-tertiary rtl:rotate-180' />
                </Link>
              </li>
            )
          )}
        </ul>
      </Panel>
    </div>
  );
};

export default OverviewTab;

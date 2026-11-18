/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/project/:projectId` (C42): one project at a glance, opened from its name in
 * the sidebar. Tabs: Overview (tiles + what its conversations get), Kit (the
 * effective set, read-only), Storage (disk usage) and Usage (tokens). The tab
 * lives in `?tab=` so a link can point at one. Only the open tab loads its data.
 */

import { Button, Tabs } from '@arco-design/web-react';
import { Brain, Plus, ViewGridDetail } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { useProjectWorkspace } from '@/renderer/components/board/hooks/useBoardDirectory';
import { useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import KitTab from './KitTab';
import styles from './ProjectPage.module.css';
import OverviewTab from './OverviewTab';
import { ErrorBlock } from './ProjectParts';
import StorageTab from './StorageTab';
import UsageTab from './UsageTab';
import { PROJECT_TABS, projectTabOf, type ProjectTab } from './projectModel';

const ProjectPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = projectTabOf(searchParams.get('tab'));
  const { workspace } = useProjectWorkspace(projectId);
  // Same SWR key as useProjectWorkspace: one request for name and workspace.
  const { data: project, error } = useSWR(
    projectId ? ['board-project', projectId] : null,
    ([, id]: [string, string]) => ipcBridge.project.get.invoke({ project_id: id }),
    { shouldRetryOnError: false }
  );
  const theme = useProjectTheme(workspace);

  const setTab = (next: ProjectTab) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true });
  const openMemory = (): void => {
    void navigate(`/memory/${encodeURIComponent(projectId)}`);
  };

  return (
    <main
      className='flex h-full min-h-0 flex-col bg-1'
      style={theme?.style}
      {...theme?.dataAttributes}
      data-testid='project-page'
    >
      <header className='flex flex-wrap items-center gap-8px border-0 border-b border-solid border-3 bg-base px-16px py-10px'>
        <h1 className='m-0 flex min-w-0 basis-full items-center gap-8px text-16px font-600 text-t-primary md:basis-0 md:flex-1'>
          <span
            className='size-10px shrink-0 rd-full'
            style={{ background: 'var(--project-accent, var(--primary))' }}
            aria-hidden='true'
          />
          <span className='truncate'>{project?.name ?? t('conversation.projectPage.title')}</span>
        </h1>
        <Button
          size='small'
          icon={<ViewGridDetail theme='outline' size='14' fill='currentColor' className='me-6px' />}
          onClick={() => void navigate(`/board/${encodeURIComponent(projectId)}`)}
          data-testid='project-open-board'
        >
          {t('board.openBoard')}
        </Button>
        <Button
          size='small'
          icon={<Brain theme='outline' size='14' fill='currentColor' className='me-6px' />}
          onClick={openMemory}
          data-testid='project-open-memory'
        >
          {t('memory.openMemory')}
        </Button>
        <Button
          size='small'
          type='primary'
          disabled={!workspace}
          icon={<Plus theme='outline' size='14' fill='currentColor' className='me-6px' />}
          onClick={() => void navigate('/guid', { state: { workspace } })}
          data-testid='project-new-conversation'
        >
          {t('conversation.history.newConversationInProject')}
        </Button>
      </header>

      <div className='bg-base px-16px'>
        <Tabs
          activeTab={tab}
          onChange={(key) => setTab(projectTabOf(key))}
          type='line'
          scrollPosition='center'
          className={styles.tabs}
          aria-label={t('conversation.projectPage.tabsLabel')}
        >
          {PROJECT_TABS.map((key) => (
            <Tabs.TabPane
              key={key}
              title={<span data-testid={`project-tab-${key}`}>{t(`conversation.projectPage.tabs.${key}`)}</span>}
            />
          ))}
        </Tabs>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-12px py-12px md:px-16px'>
        <div className='mx-auto w-full max-w-1100px'>
          {error ? (
            <ErrorBlock error={error} />
          ) : tab === 'overview' ? (
            <OverviewTab projectId={projectId} onTab={setTab} onOpenMemory={openMemory} />
          ) : tab === 'kit' ? (
            <KitTab projectId={projectId} />
          ) : tab === 'storage' ? (
            <StorageTab projectId={projectId} />
          ) : (
            <UsageTab projectId={projectId} />
          )}
        </div>
      </div>
    </main>
  );
};

export default ProjectPage;

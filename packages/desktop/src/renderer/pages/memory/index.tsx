/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** `/memory/:projectId`: the project's Claude memory review (C29 §3), opened from the project menu. */

import { Button } from '@arco-design/web-react';
import { ViewGridDetail } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import { useProjectWorkspace } from '@/renderer/components/board/hooks/useBoardDirectory';

import { MemoryPanel } from './MemoryPanel';

const MemoryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { workspace } = useProjectWorkspace(projectId);
  // Same SWR key as useProjectWorkspace: one request for name and workspace.
  const { data: project } = useSWR(projectId ? ['board-project', projectId] : null, ([, id]: [string, string]) =>
    ipcBridge.project.get.invoke({ project_id: id })
  );
  return (
    <main className='flex h-full min-h-0 flex-col bg-base'>
      <header className='flex items-center gap-8px border-0 border-b border-solid border-arco-2 px-16px py-10px'>
        <h1 className='m-0 min-w-0 flex-1 truncate text-16px font-600 text-t-primary'>
          {t('memory.pageTitle', { project: project?.name ?? '' })}
        </h1>
        <Button
          size='small'
          icon={<ViewGridDetail />}
          onClick={() => void navigate(`/board/${encodeURIComponent(projectId)}`)}
        >
          {t('board.openBoard')}
        </Button>
      </header>
      <MemoryPanel projectId={projectId} workspace={workspace} />
    </main>
  );
};

export default MemoryPage;

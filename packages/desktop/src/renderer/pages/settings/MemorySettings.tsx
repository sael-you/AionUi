/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Settings → Memory: pick a project, review its Claude memory (C29 §3). */

import { Empty, Select } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import { MemoryPanel } from '@/renderer/pages/memory/MemoryPanel';

import SettingsPageWrapper from './components/SettingsPageWrapper';

/** Real projects of the sidebar, in sidebar order. */
const useProjects = () => {
  const { data } = useSWR('memory.projects', () => ipcBridge.sidebar.get.invoke({ limit: 1 }));
  return useMemo(
    () =>
      (data?.groups ?? []).flatMap((group) =>
        group.scope.type === 'project'
          ? [{ id: group.scope.project_id, name: group.scope.name, workspace: group.scope.workspace ?? null }]
          : []
      ),
    [data]
  );
};

const MemorySettings: React.FC = () => {
  const { t } = useTranslation();
  const projects = useProjects();
  const [picked, setPicked] = useState<string | null>(null);
  const project = projects.find((p) => p.id === picked) ?? projects[0] ?? null;
  return (
    <SettingsPageWrapper>
      <div className='flex min-h-0 flex-1 flex-col gap-12px'>
        <div className='flex flex-wrap items-center gap-8px'>
          <span className='text-14px font-600 text-t-primary'>{t('memory.title')}</span>
          <Select
            className='w-full max-w-320px'
            aria-label={t('memory.projectPicker')}
            placeholder={t('memory.projectPicker')}
            value={project?.id}
            onChange={setPicked}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
        {project ? (
          <MemoryPanel key={project.id} projectId={project.id} workspace={project.workspace} />
        ) : (
          <Empty description={t('memory.noProjects')} />
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default MemorySettings;

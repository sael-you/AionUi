/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skills page, "By kit" tab (C28): the one library grouped as Global (the
 * Global kit and any global single skills), This project's kit (when the page
 * was opened from a project, `?project=<id>`), Shared kits and Not in any kit.
 * A skill shows in every group it belongs to; filter chips narrow to one group.
 * Each skill opens its detail page.
 */

import { Button, Radio, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { describeKitError } from '@/renderer/hooks/mcp/market/kitModel';
import { groupSkillsByKit, type SkillGroupKey } from '@/renderer/hooks/mcp/market/kitGroups';
import { useKitAttachments, useKitList } from '@/renderer/hooks/mcp/market/useKits';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import { MarketErrorNotice } from '../ToolsSettings/market/shared';

type Filter = 'all' | SkillGroupKey;

const GLOBAL_QUERY = { level: 'global' as const, target_id: '' };

const SkillButtons: React.FC<{ names: readonly string[] }> = ({ names }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (names.length === 0) return <span className='text-12px text-t-tertiary'>{t('mcp.kits.none')}</span>;
  return (
    <div className='flex flex-wrap gap-6px'>
      {names.map((name) => (
        <Button
          key={name}
          size='mini'
          type='secondary'
          aria-label={t('mcp.kits.skillGroups.openSkill', { name })}
          onClick={() => navigate(`/settings/skills/detail/${encodeURIComponent(name)}`)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
};

const GroupSection: React.FC<{ id: string; title: string; count: number; children: React.ReactNode }> = ({
  id,
  title,
  count,
  children,
}) => {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={id}
      className='flex flex-col gap-8px rd-12px border border-border-2 bg-2 px-12px py-12px md:px-16px'
    >
      <h3 id={`${id}-title`} className='m-0 text-14px font-medium text-t-primary'>
        {title}{' '}
        <span className='text-12px font-normal text-t-secondary'>{t('mcp.kits.skillGroups.count', { count })}</span>
      </h3>
      {children}
    </section>
  );
};

const SkillsByKitPane: React.FC<{ skillNames: readonly string[]; projectId: string | null }> = ({
  skillNames,
  projectId,
}) => {
  const { t } = useTranslation();
  const { kits, error, isLoading, reload } = useKitList();
  const { attachments } = useKitAttachments(GLOBAL_QUERY);
  const projects = useStandardProjects(null);
  const [filter, setFilter] = useState<Filter>(projectId ? 'project' : 'all');

  const groups = useMemo(
    () => groupSkillsByKit({ skills: skillNames, kits, attachments, projectId }),
    [skillNames, kits, attachments, projectId]
  );
  const projectName = projects.find((project) => project.project_id === projectId)?.name ?? projectId ?? '';
  const sharedCount = new Set(groups.shared.flatMap((group) => group.skills)).size;
  const show = (key: SkillGroupKey) => filter === 'all' || filter === key;

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: t('mcp.kits.skillGroups.all') },
    { key: 'global', label: t('mcp.kits.skillGroups.global') },
    ...(projectId ? [{ key: 'project' as const, label: t('mcp.kits.skillGroups.project') }] : []),
    { key: 'shared', label: t('mcp.kits.skillGroups.shared') },
    { key: 'ungrouped', label: t('mcp.kits.skillGroups.ungrouped') },
  ];

  return (
    <div className='flex flex-col gap-12px' data-testid='skills-by-kit'>
      <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.skillGroups.hint')}</p>
      <Radio.Group
        type='button'
        size='small'
        value={filter}
        aria-label={t('mcp.kits.skillGroups.filterLabel')}
        className='flex flex-wrap'
        onChange={(value: Filter) => setFilter(value)}
      >
        {filters.map((entry) => (
          <Radio key={entry.key} value={entry.key}>
            {entry.label}
          </Radio>
        ))}
      </Radio.Group>
      {error ? <MarketErrorNotice message={describeKitError(t, error)} onRetry={() => void reload()} /> : null}
      {isLoading ? <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div> : null}
      {!isLoading && show('global') ? (
        <GroupSection id='skills-group-global' title={t('mcp.kits.skillGroups.global')} count={groups.global.length}>
          <SkillButtons names={groups.global} />
        </GroupSection>
      ) : null}
      {!isLoading && projectId && show('project') ? (
        <GroupSection
          id='skills-group-project'
          title={t('mcp.kits.skillGroups.projectOf', { name: projectName })}
          count={groups.project?.skills.length ?? 0}
        >
          {groups.project ? (
            <SkillButtons names={groups.project.skills} />
          ) : (
            <span className='text-12px text-t-secondary'>{t('mcp.kits.skillGroups.noProjectKit')}</span>
          )}
        </GroupSection>
      ) : null}
      {!isLoading && show('shared') ? (
        <GroupSection id='skills-group-shared' title={t('mcp.kits.skillGroups.shared')} count={sharedCount}>
          {groups.shared.length === 0 ? <span className='text-12px text-t-tertiary'>{t('mcp.kits.none')}</span> : null}
          {groups.shared.map((group) => (
            <div key={group.kit.id} className='flex flex-col gap-6px' data-testid='skills-group-shared-kit'>
              <div className='flex flex-wrap items-center gap-6px'>
                <span className='text-13px text-t-primary font-medium'>{group.kit.name}</span>
                {group.kit.builtin_key ? (
                  <Tag size='small' color='arcoblue'>
                    {t('mcp.kits.builtin', { key: group.kit.builtin_key })}
                  </Tag>
                ) : null}
              </div>
              <SkillButtons names={group.skills} />
            </div>
          ))}
        </GroupSection>
      ) : null}
      {!isLoading && show('ungrouped') ? (
        <GroupSection
          id='skills-group-ungrouped'
          title={t('mcp.kits.skillGroups.ungrouped')}
          count={groups.ungrouped.length}
        >
          <SkillButtons names={groups.ungrouped} />
        </GroupSection>
      ) : null}
    </div>
  );
};

export default SkillsByKitPane;

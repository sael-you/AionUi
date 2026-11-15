/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP market view of the Tools page (card C15): every MCP in one list — the
 * existing (legacy) servers, the market instances and the template catalogue —
 * grouped by Global, by project (the sidebar's projects, in their colours) and
 * Unassigned, with search and status filters. Legacy servers keep their
 * existing item (edit, test, OAuth, delete) through `renderLegacyServer`.
 */

import { Button, Collapse, Input, Radio, Skeleton } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMcpServer, McpMarketInstance } from '@/common/config/storage';
import {
  describeMarketError,
  groupMarketInstances,
  instanceMatches,
  legacyServerMatches,
  templateMatches,
  withoutMarketRows,
  type MarketStatusFilter,
} from '@/renderer/hooks/mcp/market/marketModel';
import { useMcpMarket } from '@/renderer/hooks/mcp/market/useMcpMarket';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import AttachModal, { type AttachTarget } from './AttachModal';
import CreateInstanceModal, { type CreateInstanceTarget } from './CreateInstanceModal';
import InstanceCard from './InstanceCard';
import InstanceDrawer from './InstanceDrawer';
import ProjectGroupHeader from './ProjectGroupHeader';
import TemplateList from './TemplateList';
import { MarketErrorNotice, touchClass, useIsMobileLayout } from './shared';

type McpMarketViewProps = {
  /** Existing user/builtin servers (market rows are removed here). */
  legacyServers: IMcpServer[];
  /** Read-only extension servers (catalogue templates are removed upstream). */
  extensionServers: IMcpServer[];
  renderLegacyServer: (server: IMcpServer, readOnly: boolean) => React.ReactNode;
};

const STATUS_FILTERS: MarketStatusFilter[] = ['all', 'active', 'dormant', 'revoked', 'missing'];

const EmptyLine: React.FC<{ text: string }> = ({ text }) => (
  <div className='py-12px text-center text-12px text-t-secondary border border-dashed border-border-2 rd-8px'>
    {text}
  </div>
);

const McpMarketView: React.FC<McpMarketViewProps> = ({ legacyServers, extensionServers, renderLegacyServer }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const market = useMcpMarket();
  const projects = useStandardProjects(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MarketStatusFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateInstanceTarget | null>(null);
  const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
  const [activeGroups, setActiveGroups] = useState<string[] | null>(null);

  const templatesById = useMemo(() => new Map(market.templates.map((tpl) => [tpl.id, tpl])), [market.templates]);
  const legacy = useMemo(() => withoutMarketRows(legacyServers, market.instances), [legacyServers, market.instances]);
  const extensions = useMemo(
    () => withoutMarketRows(extensionServers, market.instances),
    [extensionServers, market.instances]
  );
  const visibleInstances = useMemo(
    () => market.instances.filter((i) => instanceMatches(i, query, statusFilter, templatesById.get(i.template_id))),
    [market.instances, query, statusFilter, templatesById]
  );
  const groups = useMemo(
    () => groupMarketInstances(visibleInstances, market.assignments, projects),
    [visibleInstances, market.assignments, projects]
  );
  const visibleLegacy = legacy.filter((s) => legacyServerMatches(s, query, statusFilter));
  const visibleExtensions = extensions.filter((s) => legacyServerMatches(s, query, statusFilter));
  const visibleTemplates = market.templates.filter((tpl) => templateMatches(tpl, query));
  const filtering = query.trim() !== '' || statusFilter !== 'all';
  const projectGroups = filtering ? groups.projects.filter((g) => g.instances.length > 0) : groups.projects;
  const takenNames = useMemo(
    () => [...market.instances.map((i) => i.name), ...legacyServers.map((s) => s.name)],
    [market.instances, legacyServers]
  );
  const openInstance = market.instances.find((i) => i.id === openId) ?? null;

  const nothingAtAll =
    !market.loading && !market.error && legacy.length === 0 && extensions.length === 0 && market.instances.length === 0;

  const defaultGroups = isMobile
    ? [nothingAtAll ? 'templates' : 'global']
    : ['global', ...groups.projects.map((g) => `project:${g.projectId}`), 'unassigned', 'templates'];
  const expanded = activeGroups ?? defaultGroups;

  const renderInstances = (list: McpMarketInstance[], emptyText: string) =>
    list.length === 0 ? (
      <EmptyLine text={emptyText} />
    ) : (
      <div className='flex flex-col gap-8px'>
        {list.map((instance) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            template={templatesById.get(instance.template_id)}
            health={market.health[instance.id]}
            assignments={market.assignments}
            projects={projects}
            assistants={market.assistants}
            onOpen={(i) => setOpenId(i.id)}
          />
        ))}
      </div>
    );

  const globalCount = visibleLegacy.length + visibleExtensions.length + groups.global.length;

  return (
    <div className='flex flex-col gap-12px min-w-0' data-testid='mcp-market'>
      <div className='flex flex-col md:flex-row md:items-center gap-8px'>
        <Input.Search
          allowClear
          value={query}
          onChange={setQuery}
          placeholder={t('mcp.market.search')}
          aria-label={t('mcp.market.search')}
          className={`md:max-w-320px ${touchClass(isMobile)}`}
        />
        <Radio.Group
          type='button'
          size={isMobile ? 'large' : 'small'}
          value={statusFilter}
          onChange={(v: MarketStatusFilter) => setStatusFilter(v)}
          className='flex flex-wrap'
          aria-label={t('mcp.market.filter.label')}
        >
          {STATUS_FILTERS.map((f) => (
            <Radio key={f} value={f}>
              {t(`mcp.market.filter.${f}`)}
            </Radio>
          ))}
        </Radio.Group>
      </div>

      {market.error ? (
        <MarketErrorNotice
          message={t('mcp.market.loadFailed', { detail: describeMarketError(t, market.error) })}
          onRetry={() => void market.reload()}
        />
      ) : null}

      {market.loading ? (
        <div role='status' aria-busy='true' aria-label={t('mcp.market.loading')}>
          <Skeleton animation text={{ rows: 5 }} />
        </div>
      ) : (
        <>
          {nothingAtAll && (
            <div className='flex flex-col items-center gap-8px py-16px text-center border border-dashed border-border-2 rd-12px'>
              <span className='text-14px text-t-secondary'>{t('mcp.market.empty')}</span>
              {market.templates.length > 0 && (
                <Button
                  type='primary'
                  size='small'
                  onClick={() => setActiveGroups(['templates'])}
                  className={touchClass(isMobile)}
                >
                  {t('mcp.market.browseTemplates')}
                </Button>
              )}
            </div>
          )}
          <Collapse
            activeKey={expanded}
            onChange={(_key, keys) => setActiveGroups(keys)}
            bordered={false}
            className='[&_.arco-collapse-item-header-title]:flex-1 [&_.arco-collapse-item-header]:min-h-44px'
          >
            <Collapse.Item
              name='global'
              header={<ProjectGroupHeader label={t('mcp.market.group.global')} count={globalCount} />}
            >
              <div className='flex flex-col gap-8px' data-testid='mcp-market-group-global'>
                <span className='text-12px text-t-secondary'>{t('mcp.market.group.globalHint')}</span>
                {visibleLegacy.map((server) => (
                  <React.Fragment key={server.id}>{renderLegacyServer(server, false)}</React.Fragment>
                ))}
                {visibleExtensions.map((server) => (
                  <React.Fragment key={server.id}>{renderLegacyServer(server, true)}</React.Fragment>
                ))}
                {groups.global.length > 0 && renderInstances(groups.global, '')}
                {globalCount === 0 && <EmptyLine text={t('mcp.market.group.globalEmpty')} />}
              </div>
            </Collapse.Item>

            {projectGroups.map((group) => (
              <Collapse.Item
                key={group.projectId}
                name={`project:${group.projectId}`}
                header={
                  <ProjectGroupHeader
                    project={group}
                    count={group.instances.length}
                    actionLabel={market.instances.length > 0 ? t('mcp.market.actions.attach') : undefined}
                    onAction={() => setAttachTarget({ projectId: group.projectId })}
                  />
                }
              >
                <div data-testid='mcp-market-group-project' data-project-id={group.projectId}>
                  {renderInstances(group.instances, t('mcp.market.group.projectEmpty'))}
                </div>
              </Collapse.Item>
            ))}

            <Collapse.Item
              name='unassigned'
              header={<ProjectGroupHeader label={t('mcp.market.group.unassigned')} count={groups.unassigned.length} />}
            >
              <div data-testid='mcp-market-group-unassigned'>
                {renderInstances(groups.unassigned, t('mcp.market.group.unassignedEmpty'))}
              </div>
            </Collapse.Item>

            <Collapse.Item
              name='templates'
              header={<ProjectGroupHeader label={t('mcp.market.group.templates')} count={visibleTemplates.length} />}
            >
              {market.templatesError ? (
                <MarketErrorNotice
                  message={describeMarketError(t, market.templatesError)}
                  onRetry={() => void market.reload()}
                />
              ) : visibleTemplates.length === 0 ? (
                <EmptyLine text={t('mcp.market.group.templatesEmpty')} />
              ) : (
                <TemplateList
                  templates={visibleTemplates}
                  onAdd={(template) => setCreateTarget({ kind: 'template', template })}
                />
              )}
            </Collapse.Item>
          </Collapse>
        </>
      )}

      {openInstance && (
        <InstanceDrawer
          instance={openInstance}
          template={templatesById.get(openInstance.template_id)}
          health={market.health[openInstance.id]}
          assignments={market.assignments}
          projects={projects}
          assistants={market.assistants}
          market={market}
          onClose={() => setOpenId(null)}
          onAttach={(instance) => setAttachTarget({ instance })}
          onDuplicate={(source) => setCreateTarget({ kind: 'duplicate', source })}
        />
      )}

      <CreateInstanceModal
        target={createTarget}
        takenNames={takenNames}
        market={market}
        onClose={() => setCreateTarget(null)}
        onCreated={(instance) => {
          setCreateTarget(null);
          setOpenId(instance.id);
        }}
      />

      <AttachModal
        target={attachTarget}
        instances={market.instances}
        projects={projects}
        assistants={market.assistants}
        assignments={market.assignments}
        market={market}
        onClose={() => setAttachTarget(null)}
      />
    </div>
  );
};

export default McpMarketView;

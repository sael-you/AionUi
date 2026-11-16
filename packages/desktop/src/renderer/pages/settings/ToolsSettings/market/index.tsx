/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Tools page in the shared library layout (C33, TASK-119; market C15).
 *
 * Scope (rail): Global or a project, default the project the settings were
 * opened from. Tabs:
 * - **Active**: what the scope gets, by where it comes from — attached here,
 *   each kit, From Global (projects), and for Global the owner's own servers
 *   (existing editable rows), extension servers and instances attached
 *   nowhere.
 * - **Market**: the template catalogue as compact cards by category; details
 *   (keys, read-only enforcement, install mode) in a drawer; Add opens the
 *   add-from-template flow.
 * - **Kits**: the existing kit management.
 * Instance cards open the existing instance drawer; attaching goes through the
 * existing attach dialog (R2/R3 checks), detaching through the market actions.
 */

import { Button, Message, Modal, Skeleton, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMcpServer, McpMarketInstance, McpMarketTemplate } from '@/common/config/storage';
import { CategoryIcon, mcpCategoryVisualId } from '@/renderer/components/settings/SettingsModal/library/categoryVisual';
import LibraryCard from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import LibraryLayout from '@/renderer/components/settings/SettingsModal/library/LibraryLayout';
import {
  DrawerBlock,
  LibraryDrawer,
  LibraryEmpty,
  LibraryScopeName,
} from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import LibrarySection from '@/renderer/components/settings/SettingsModal/library/LibrarySection';
import {
  ALL_CATEGORY_KEY,
  GLOBAL_SCOPE_KEY,
  matchesQuery,
  projectIdOfScope,
  projectScopeKey,
  splitRailScopes,
  type RailCategory,
} from '@/renderer/components/settings/SettingsModal/library/libraryModel';
import { useOriginProjectId } from '@/renderer/components/settings/SettingsModal/library/useOriginProjectId';
import {
  MCP_SOURCE_FILTERS,
  assignmentsIn,
  buildMcpActiveGroups,
  instanceCategory,
  mcpSource,
  projectMcpCount,
  type McpActiveGroup,
  type McpSourceFilter,
} from '@/renderer/hooks/mcp/market/mcpLibraryModel';
import {
  MCP_TEMPLATE_CATEGORIES,
  defaultTemplateTier,
  describeMarketError,
  requiredSecretKeys,
  templateCategory,
  templateMatches,
  templateReadEnforcement,
  withoutMarketRows,
  type McpTemplateCategory,
} from '@/renderer/hooks/mcp/market/marketModel';
import { useKitAttachments, useKitEffective, useKitList } from '@/renderer/hooks/mcp/market/useKits';
import { useMcpMarket } from '@/renderer/hooks/mcp/market/useMcpMarket';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import KitsSection from '../kits/KitsSection';
import AttachModal, { type AttachTarget } from './AttachModal';
import CreateInstanceModal, { type CreateInstanceTarget } from './CreateInstanceModal';
import InstanceDrawer from './InstanceDrawer';
import { MarketErrorNotice, MarketStatusTag, TemplateUpdateBadge, useIsMobileLayout } from './shared';

type McpMarketViewProps = {
  /** Existing user/builtin servers (market rows are removed here). */
  legacyServers: IMcpServer[];
  /** Read-only extension servers (catalogue templates are removed upstream). */
  extensionServers: IMcpServer[];
  renderLegacyServer: (server: IMcpServer, readOnly: boolean) => React.ReactNode;
  /** Page actions next to the search (Add MCP server). */
  headerActions?: React.ReactNode;
};

type ToolsTab = 'active' | 'market' | 'kits';

const ALL = {};

const McpMarketView: React.FC<McpMarketViewProps> = ({
  legacyServers,
  extensionServers,
  renderLegacyServer,
  headerActions,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const market = useMcpMarket();
  const projects = useStandardProjects(null);
  const originProjectId = useOriginProjectId(null);
  const { kits } = useKitList();
  const { attachments } = useKitAttachments(ALL);
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const scopeKey = chosenScope ?? (originProjectId ? projectScopeKey(originProjectId) : GLOBAL_SCOPE_KEY);
  const projectId = projectIdOfScope(scopeKey);
  const effective = useKitEffective(projectId ? { project_id: projectId } : ALL);
  const [tab, setTab] = useState<ToolsTab>('market');
  const [tabChosen, setTabChosen] = useState(false);
  const [category, setCategory] = useState(ALL_CATEGORY_KEY);
  const [source, setSource] = useState<McpSourceFilter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateInstanceTarget | null>(null);
  const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);

  const templatesById = useMemo(() => new Map(market.templates.map((tpl) => [tpl.id, tpl])), [market.templates]);
  const instanceById = useMemo(() => new Map(market.instances.map((i) => [i.id, i])), [market.instances]);
  const legacy = useMemo(() => withoutMarketRows(legacyServers, market.instances), [legacyServers, market.instances]);
  const extensions = useMemo(
    () => withoutMarketRows(extensionServers, market.instances),
    [extensionServers, market.instances]
  );
  const scopeProject = projects.find((project) => project.project_id === projectId) ?? null;
  const scopeLabel = projectId ? (scopeProject?.name ?? projectId) : t('settings.library.scopeGlobal');
  const takenNames = useMemo(
    () => [...market.instances.map((i) => i.name), ...legacyServers.map((s) => s.name)],
    [market.instances, legacyServers]
  );

  // ---- Active groups ----
  const groups = useMemo(
    () =>
      buildMcpActiveGroups({
        instances: market.instances,
        assignments: market.assignments,
        effective: effective.effective?.mcps ?? [],
        projectId,
      }),
    [market.instances, market.assignments, effective.effective, projectId]
  );
  const activeIds = new Set(groups.filter((g) => g.kind !== 'unassigned').flatMap((g) => g.instanceIds));
  const fromGlobalCount =
    (groups.find((g) => g.kind === 'fromGlobal')?.instanceIds.length ?? 0) + (projectId ? legacy.length : 0);
  const kitGroups = groups.filter((g) => g.kind === 'kit').length;
  const activeCount = activeIds.size + legacy.length + extensions.length;

  // Market by default when nothing is set up yet; Active once the owner has something.
  const effectiveTab: ToolsTab = tabChosen ? tab : activeCount > 0 ? 'active' : 'market';

  // ---- rail ----
  const railScopes = useMemo(() => {
    const globalCount =
      new Set(market.assignments.filter((row) => !row.project_id).map((row) => row.instance_id)).size +
      legacy.length +
      extensions.length;
    const seen = new Set<string>();
    const list = projects
      .filter((project) => project.project_id && !seen.has(project.project_id) && seen.add(project.project_id))
      .map((project) => ({
        key: projectScopeKey(project.project_id ?? ''),
        label: project.name,
        workspace: project.workspace,
        count: projectMcpCount(market.assignments, kits, attachments, project.project_id ?? ''),
      }));
    return splitRailScopes(
      { key: GLOBAL_SCOPE_KEY, label: t('settings.library.scopeGlobal'), count: globalCount },
      list,
      scopeKey
    );
  }, [market.assignments, legacy.length, extensions.length, projects, kits, attachments, scopeKey, t]);

  // ---- filters ----
  const instanceVisible = (id: string): boolean => {
    const instance = instanceById.get(id);
    if (!instance) return false;
    const template = templatesById.get(instance.template_id);
    if (source !== 'all' && mcpSource(template) !== source) return false;
    if (category !== ALL_CATEGORY_KEY && instanceCategory(template) !== category) return false;
    return matchesQuery(query, instance.name, instance.description, template?.name, template?.vendor);
  };
  const serverVisible = (server: IMcpServer): boolean =>
    (source === 'all' || source === 'custom') &&
    (category === ALL_CATEGORY_KEY || category === 'other') &&
    matchesQuery(query, server.name, server.description);
  const templateVisible = (template: McpMarketTemplate): boolean =>
    (source === 'all' || mcpSource(template) === source) &&
    (category === ALL_CATEGORY_KEY || templateCategory(template) === category) &&
    templateMatches(template, query);

  const categoryCounts = (keys: McpTemplateCategory[]): RailCategory[] => {
    const counts = new Map<string, number>();
    keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
    return [
      { key: ALL_CATEGORY_KEY, label: t('settings.library.allCategories'), count: keys.length },
      ...MCP_TEMPLATE_CATEGORIES.filter((key) => (counts.get(key) ?? 0) > 0 || key === category).map((key) => ({
        key,
        label: t(`mcp.market.library.category.${key}`),
        count: counts.get(key) ?? 0,
      })),
    ];
  };
  const activeCategoryKeys: McpTemplateCategory[] = [
    ...[...activeIds].map((id) => instanceCategory(templatesById.get(instanceById.get(id)?.template_id ?? ''))),
    ...(projectId ? [] : [...legacy, ...extensions].map(() => 'other' as const)),
  ];
  const railCategories =
    effectiveTab === 'market'
      ? categoryCounts(
          market.templates.filter((tpl) => source === 'all' || mcpSource(tpl) === source).map(templateCategory)
        )
      : categoryCounts(activeCategoryKeys);

  // ---- writes ----
  const detachFromScope = (instance: McpMarketInstance) => {
    const rows = assignmentsIn(market.assignments, instance.id, projectId);
    if (rows.length === 0) return;
    Modal.confirm({
      title: t('settings.toolsLibrary.detachTitle', { name: instance.name, scope: scopeLabel }),
      content: t('settings.toolsLibrary.detachBody', { name: instance.name, scope: scopeLabel }),
      okText: t('mcp.market.actions.detach'),
      okButtonProps: { status: 'warning' },
      onOk: async () => {
        try {
          await market.detach(rows.map((row) => row.id));
          Message.success(t('settings.library.turnedOff', { name: instance.name, scope: scopeLabel }));
        } catch (error) {
          Message.error(describeMarketError(t, error, 'attach'));
        }
      },
    });
  };

  // ---- cards ----
  const instanceCard = (id: string, group: McpActiveGroup) => {
    const instance = instanceById.get(id);
    if (!instance) return null;
    const template = templatesById.get(instance.template_id);
    const here = assignmentsIn(market.assignments, instance.id, projectId).length > 0;
    const toggleable = group.kind === 'attached' || group.kind === 'unassigned';
    return (
      <LibraryCard
        key={id}
        id={id}
        name={instance.name}
        description={instance.description || template?.summary || template?.description}
        visual={mcpCategoryVisualId(instanceCategory(template))}
        chips={
          <>
            <MarketStatusTag status={instance.status} />
            <TemplateUpdateBadge instance={instance} />
            {instance.missing.length > 0 ? (
              <Tag size='small' color='orange'>
                {t('settings.toolsLibrary.needsKey')}
              </Tag>
            ) : null}
            <Tag size='small'>{t(`mcp.market.tier.${instance.tier}`, { defaultValue: instance.tier })}</Tag>
            <Tag size='small' color={instance.environment === 'production' ? 'red' : undefined}>
              {t(`mcp.market.environment.${instance.environment}`, { defaultValue: instance.environment })}
            </Tag>
          </>
        }
        toggle={
          toggleable
            ? {
                checked: here,
                label: t('settings.library.onIn', { scope: scopeLabel }),
                onChange: (on) =>
                  on ? setAttachTarget(projectId ? { instance, projectId } : { instance }) : detachFromScope(instance),
              }
            : group.kind === 'kit'
              ? {
                  checked: true,
                  disabled: true,
                  label: t('settings.toolsLibrary.viaKit', { name: group.kitName ?? '' }),
                  onChange: () => undefined,
                }
              : null
        }
        menu={[
          { key: 'details', label: t('settings.library.menu.details'), onClick: () => setOpenId(id) },
          {
            key: 'attach',
            label: t('settings.toolsLibrary.attachElsewhere'),
            onClick: () => setAttachTarget({ instance }),
          },
          {
            key: 'duplicate',
            label: t('mcp.market.actions.duplicate'),
            onClick: () => setCreateTarget({ kind: 'duplicate', source: instance }),
          },
          ...(here
            ? [
                {
                  key: 'remove',
                  label: t('settings.library.menu.removeFrom', { scope: scopeLabel }),
                  onClick: () => detachFromScope(instance),
                },
              ]
            : []),
        ]}
        onOpen={() => setOpenId(id)}
      />
    );
  };

  const templateCard = (template: McpMarketTemplate) => {
    const keys = requiredSecretKeys(template);
    const inUse = market.instances.some((instance) => instance.template_id === template.id);
    return (
      <LibraryCard
        key={template.id}
        id={template.id}
        name={template.name}
        description={template.summary ?? template.description}
        visual={mcpCategoryVisualId(templateCategory(template))}
        chips={
          <>
            {template.vendor ? <span className='text-12px text-t-secondary'>{template.vendor}</span> : null}
            <Tag size='small' color={template.official ? 'green' : 'gray'}>
              {t(template.official ? 'mcp.market.library.official' : 'mcp.market.library.community')}
            </Tag>
            <Tag size='small' color={keys.length > 0 ? 'orange' : undefined} data-testid='mcp-template-key-chip'>
              {keys.length > 0 ? t('settings.toolsLibrary.needsKey') : t('settings.toolsLibrary.noKey')}
            </Tag>
            {inUse ? (
              <Tag size='small' color='arcoblue'>
                {t('settings.toolsLibrary.added')}
              </Tag>
            ) : null}
          </>
        }
        action={
          <Button
            size='mini'
            onClick={() => setCreateTarget({ kind: 'template', template })}
            aria-label={t('mcp.market.library.addNamed', { name: template.name })}
            data-testid='mcp-template-add'
          >
            {t('mcp.market.actions.add')}
          </Button>
        }
        menu={[
          { key: 'details', label: t('settings.library.menu.details'), onClick: () => setOpenTemplateId(template.id) },
        ]}
        onOpen={() => setOpenTemplateId(template.id)}
      />
    );
  };

  const noMatch = <LibraryEmpty text={t('settings.library.noMatch')} />;
  const toMarket = () => {
    setTab('market');
    setTabChosen(true);
  };

  // ---- Active tab ----
  const groupTitle = (group: McpActiveGroup): string => {
    switch (group.kind) {
      case 'attached':
        return t('settings.toolsLibrary.group.attached', { scope: scopeLabel });
      case 'kit':
        return t('settings.library.group.kit', { name: group.kitName ?? '' });
      case 'fromGlobal':
        return t('settings.library.group.fromGlobal');
      default:
        return t('settings.toolsLibrary.group.unassigned');
    }
  };
  const visibleLegacy = projectId ? [] : legacy.filter(serverVisible);
  const visibleExtensions = projectId ? [] : extensions.filter(serverVisible);

  const activePanel = (
    <>
      {groups.map((group) => {
        const shown = group.instanceIds.filter(instanceVisible);
        if (group.kind !== 'attached' && group.instanceIds.length === 0) return null;
        return (
          <LibrarySection
            key={group.key}
            sectionKey={group.key}
            title={groupTitle(group)}
            count={shown.length}
            hint={
              group.kind === 'fromGlobal'
                ? t('settings.library.fromGlobalHint')
                : group.kind === 'unassigned'
                  ? t('settings.toolsLibrary.unassignedHint')
                  : undefined
            }
            visual={group.kind === 'fromGlobal' ? 'global' : undefined}
            defaultExpanded={group.kind !== 'unassigned'}
            actions={
              group.kind === 'fromGlobal' ? (
                <Button size='mini' onClick={() => setChosenScope(GLOBAL_SCOPE_KEY)}>
                  {t('settings.library.manageInGlobal')}
                </Button>
              ) : group.kind === 'attached' && market.instances.length > 0 ? (
                <Button
                  size='mini'
                  onClick={() => setAttachTarget(projectId ? { projectId } : {})}
                  data-testid='mcp-attach-to-scope'
                >
                  {t('mcp.market.actions.attach')}
                </Button>
              ) : null
            }
          >
            {shown.length > 0 ? (
              shown.map((id) => instanceCard(id, group))
            ) : group.instanceIds.length > 0 ? (
              noMatch
            ) : (
              <LibraryEmpty
                text={t('settings.toolsLibrary.nothingAttached', { scope: scopeLabel })}
                actionLabel={t('settings.toolsLibrary.browseMarket')}
                onAction={toMarket}
              />
            )}
          </LibrarySection>
        );
      })}
      {!projectId && legacy.length > 0 ? (
        <LibrarySection
          sectionKey='custom'
          title={t('settings.toolsLibrary.group.custom')}
          count={visibleLegacy.length}
          hint={t('mcp.market.group.globalHint')}
          layout='list'
        >
          {visibleLegacy.length > 0
            ? visibleLegacy.map((server) => (
                <React.Fragment key={server.id}>{renderLegacyServer(server, false)}</React.Fragment>
              ))
            : noMatch}
        </LibrarySection>
      ) : null}
      {!projectId && extensions.length > 0 ? (
        <LibrarySection
          sectionKey='extensions'
          title={t('settings.toolsLibrary.group.extensions')}
          count={visibleExtensions.length}
          layout='list'
        >
          {visibleExtensions.length > 0
            ? visibleExtensions.map((server) => (
                <React.Fragment key={server.id}>{renderLegacyServer(server, true)}</React.Fragment>
              ))
            : noMatch}
        </LibrarySection>
      ) : null}
    </>
  );

  // ---- Market tab ----
  const visibleTemplates = market.templates.filter(templateVisible);
  const searching = query.trim() !== '';
  const marketPanel = market.templatesError ? (
    <MarketErrorNotice message={describeMarketError(t, market.templatesError)} onRetry={() => void market.reload()} />
  ) : market.templates.length === 0 ? (
    <LibraryEmpty text={t('mcp.market.group.templatesEmpty')} />
  ) : searching ? (
    <LibrarySection sectionKey='results' title={t('settings.library.results')} count={visibleTemplates.length}>
      {visibleTemplates.length > 0 ? visibleTemplates.map(templateCard) : noMatch}
    </LibrarySection>
  ) : (
    <>
      {MCP_TEMPLATE_CATEGORIES.map((key) => {
        const list = visibleTemplates
          .filter((tpl) => templateCategory(tpl) === key)
          .toSorted(
            (a, b) => Number(a.optional === true) - Number(b.optional === true) || a.name.localeCompare(b.name)
          );
        if (list.length === 0) return null;
        return (
          <LibrarySection
            key={key}
            sectionKey={key}
            title={t(`mcp.market.library.category.${key}`)}
            count={list.length}
            visual={mcpCategoryVisualId(key)}
          >
            {list.map(templateCard)}
          </LibrarySection>
        );
      })}
      {visibleTemplates.length === 0 ? noMatch : null}
    </>
  );

  // ---- template drawer ----
  const openTemplate = openTemplateId ? templatesById.get(openTemplateId) : undefined;
  const templateDrawer = (
    <LibraryDrawer
      visible={Boolean(openTemplate)}
      isMobile={isMobile}
      onClose={() => setOpenTemplateId(null)}
      testId='mcp-template-drawer'
      title={
        openTemplate ? (
          <span className='inline-flex items-center gap-8px min-w-0'>
            <CategoryIcon visual={mcpCategoryVisualId(templateCategory(openTemplate))} size='small' />
            <span className='truncate'>{openTemplate.name}</span>
          </span>
        ) : null
      }
      footer={
        openTemplate ? (
          <Button
            type='primary'
            onClick={() => {
              setOpenTemplateId(null);
              setCreateTarget({ kind: 'template', template: openTemplate });
            }}
          >
            {t('mcp.market.actions.add')}
          </Button>
        ) : null
      }
    >
      {openTemplate ? (
        <>
          <div className='flex flex-wrap items-center gap-6px'>
            {openTemplate.vendor ? <span className='text-13px text-t-secondary'>{openTemplate.vendor}</span> : null}
            <Tag size='small' color={openTemplate.official ? 'green' : 'gray'}>
              {t(openTemplate.official ? 'mcp.market.library.official' : 'mcp.market.library.community')}
            </Tag>
            {openTemplate.optional ? <Tag size='small'>{t('mcp.market.library.optional')}</Tag> : null}
            {openTemplate.billing === 'metered' ? (
              <Tag size='small' color='orange'>
                {t('mcp.market.library.metered')}
              </Tag>
            ) : null}
          </div>
          <p className='m-0 text-13px leading-relaxed text-t-secondary'>
            {openTemplate.description || openTemplate.summary}
          </p>
          <DrawerBlock title={t('mcp.market.library.keysLabel')}>
            <span className='text-13px text-t-primary break-all' data-testid='mcp-market-template-keys'>
              {requiredSecretKeys(openTemplate).length > 0
                ? t('mcp.market.library.needsKey', { keys: requiredSecretKeys(openTemplate).join(', ') })
                : t('mcp.market.library.noKey')}
            </span>
          </DrawerBlock>
          <DrawerBlock title={t('mcp.market.library.readOnlyLabel')}>
            <span className='text-13px text-t-primary' data-testid='mcp-market-template-enforcement'>
              {t(`mcp.market.library.enforcement.${templateReadEnforcement(openTemplate)}`)}
            </span>
          </DrawerBlock>
          <DrawerBlock title={t('mcp.market.library.modeLabel')}>
            <span className='text-13px text-t-primary' data-testid='mcp-market-template-mode'>
              {t(
                defaultTemplateTier(openTemplate) === 'write'
                  ? 'mcp.market.library.modeFull'
                  : 'mcp.market.library.modeReadOnly'
              )}
            </span>
          </DrawerBlock>
          <DrawerBlock title={t('settings.library.usedIn')}>
            <div className='flex flex-wrap gap-6px'>
              {market.instances.filter((instance) => instance.template_id === openTemplate.id).length === 0 ? (
                <span className='text-12px text-t-tertiary'>{t('settings.library.usedNowhere')}</span>
              ) : (
                market.instances
                  .filter((instance) => instance.template_id === openTemplate.id)
                  .map((instance) => (
                    <Button
                      key={instance.id}
                      size='mini'
                      onClick={() => {
                        setOpenTemplateId(null);
                        setOpenId(instance.id);
                      }}
                    >
                      {instance.name}
                    </Button>
                  ))
              )}
            </div>
          </DrawerBlock>
        </>
      ) : null}
    </LibraryDrawer>
  );

  const openInstance = openId ? (instanceById.get(openId) ?? null) : null;
  const summaryText = [
    t('settings.library.summary.active', {
      count: projectId ? activeIds.size + legacy.length : activeCount,
    }),
    ...(projectId ? [t('settings.library.summary.fromGlobal', { count: fromGlobalCount })] : []),
    t('settings.library.summary.kits', { count: kitGroups }),
  ].join(' · ');

  return (
    <>
      <LibraryLayout
        testId='mcp-market'
        title={t('settings.tools', { defaultValue: 'Tools' })}
        description={t('settings.toolsLibrary.description')}
        headerActions={headerActions}
        search={{ value: query, onChange: setQuery, placeholder: t('mcp.market.search') }}
        rail={{
          scopes: railScopes,
          selectedScope: scopeKey,
          onScope: (key) => {
            setChosenScope(key);
            setCategory(ALL_CATEGORY_KEY);
          },
          categories: railCategories,
          selectedCategory: category,
          onCategory: setCategory,
        }}
        scopeTitle={<LibraryScopeName workspace={scopeProject?.workspace} label={scopeLabel} />}
        summary={market.loading ? undefined : summaryText}
        tabs={[
          {
            key: 'active',
            label: t('settings.library.tabActive'),
            count: projectId ? activeIds.size + legacy.length : activeCount,
          },
          { key: 'market', label: t('settings.toolsLibrary.tabMarket'), count: market.templates.length },
          { key: 'kits', label: t('settings.toolsLibrary.tabKits') },
        ]}
        activeTab={effectiveTab}
        onTab={(key) => {
          setTab(key as ToolsTab);
          setTabChosen(true);
          setCategory(ALL_CATEGORY_KEY);
        }}
        tabsLabel={t('settings.library.tabsLabel')}
        sources={
          effectiveTab === 'kits'
            ? undefined
            : MCP_SOURCE_FILTERS.map((key) => ({ key, label: t(`settings.toolsLibrary.filter.${key}`) }))
        }
        source={source}
        onSource={(key) => setSource(key as McpSourceFilter)}
        sourcesLabel={t('settings.library.sourcesLabel')}
        isMobile={isMobile}
      >
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
        ) : effectiveTab === 'active' ? (
          activePanel
        ) : effectiveTab === 'market' ? (
          marketPanel
        ) : (
          <KitsSection />
        )}
      </LibraryLayout>

      {templateDrawer}

      {openInstance ? (
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
          onDuplicate={(sourceInstance) => setCreateTarget({ kind: 'duplicate', source: sourceInstance })}
        />
      ) : null}

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
    </>
  );
};

export default McpMarketView;

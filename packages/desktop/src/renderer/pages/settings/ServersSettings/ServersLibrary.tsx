/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Servers (C36, TASK-130) in the shared library layout (C33).
 *
 * Rail: SCOPE (Global or a project; default the project the settings were
 * opened from) and the owner's labels. Tabs:
 * - **Active**: what conversations in this scope get — on here, from Global
 *   (projects), and Global servers turned off here.
 * - **Library**: every server, by environment, each with "On in <scope>".
 * A card opens the drawer (fields, write-only key, host key, Test connection,
 * "Used in", latest audited commands). Agents reach a server only through an
 * attachment; the tier is guidance, crucial commands on production-write
 * servers always ask the owner.
 */

import { Button, Message, Skeleton, Tag } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { SERVER_ENVIRONMENTS, type ServerResponse } from '@/common/types/platform/serverPools';
import LibraryCard from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import LibraryLayout from '@/renderer/components/settings/SettingsModal/library/LibraryLayout';
import { LibraryEmpty, LibraryScopeName } from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
import LibrarySection from '@/renderer/components/settings/SettingsModal/library/LibrarySection';
import {
  ALL_CATEGORY_KEY,
  GLOBAL_SCOPE_KEY,
  projectIdOfScope,
  projectScopeKey,
  splitRailScopes,
  type RailCategory,
} from '@/renderer/components/settings/SettingsModal/library/libraryModel';
import { useOriginProjectId } from '@/renderer/components/settings/SettingsModal/library/useOriginProjectId';
import { useKitAttachments } from '@/renderer/hooks/mcp/market/useKits';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import { MarketErrorNotice, useIsMobileLayout } from '../ToolsSettings/market/shared';
import ServerDrawer, { type ServerDrawerTarget } from './ServerDrawer';
import {
  UNLABELLED,
  describeServerError,
  projectServerCount,
  scopeServers,
  scopeToggleAction,
  serverAddress,
  serverCategories,
  serverMatches,
} from './serverModel';
import { useServerActions, useServerList } from './useServers';

type ServersTab = 'active' | 'library';

const ALL = {};

/** The chips every server card shows. */
export const ServerChips: React.FC<{ server: ServerResponse }> = ({ server }) => {
  const { t } = useTranslation();
  return (
    <>
      {!server.enabled ? (
        <Tag size='small' color='gray'>
          {t('settings.servers.chips.off')}
        </Tag>
      ) : null}
      <Tag
        size='small'
        color={server.environment === 'production' ? 'red' : server.environment === 'staging' ? 'orange' : undefined}
      >
        {t(`mcp.market.environment.${server.environment}`, { defaultValue: server.environment })}
      </Tag>
      <Tag size='small'>{t(`mcp.market.tier.${server.tier}`, { defaultValue: server.tier })}</Tag>
      <Tag size='small' color={server.has_key ? 'green' : 'orange'}>
        {t(server.has_key ? 'settings.servers.chips.keyStored' : 'settings.servers.chips.noKey')}
      </Tag>
      {!server.host_key ? (
        <Tag size='small' color='orange'>
          {t('settings.servers.chips.noHostKey')}
        </Tag>
      ) : null}
      {server.crucial_commands_ask ? (
        <Tag size='small' color='arcoblue'>
          {t('settings.servers.chips.asks')}
        </Tag>
      ) : null}
    </>
  );
};

const ServersLibrary: React.FC = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const { servers, error, isLoading, reload } = useServerList();
  const { attachments } = useKitAttachments(ALL);
  const projects = useStandardProjects(null);
  // `?project=<id>`: open on that project (the project page's Manage links).
  const [searchParams] = useSearchParams();
  const originProjectId = useOriginProjectId(searchParams.get('project'));
  const actions = useServerActions();
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const scopeKey = chosenScope ?? (originProjectId ? projectScopeKey(originProjectId) : GLOBAL_SCOPE_KEY);
  const projectId = projectIdOfScope(scopeKey);
  const [tab, setTab] = useState<ServersTab>('active');
  const [tabChosen, setTabChosen] = useState(false);
  const [category, setCategory] = useState(ALL_CATEGORY_KEY);
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<ServerDrawerTarget>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const byId = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const scopeProject = projects.find((project) => project.project_id === projectId) ?? null;
  const scopeLabel = projectId ? (scopeProject?.name ?? projectId) : t('settings.library.scopeGlobal');
  const scope = useMemo(() => scopeServers(attachments, projectId), [attachments, projectId]);
  const onIds = new Set([...scope.here, ...scope.fromGlobal]);
  const activeCount = [...onIds].filter((id) => byId.has(id)).length;
  // Library first when nothing is set up yet; Active once a server is on somewhere.
  const effectiveTab: ServersTab = tabChosen ? tab : activeCount > 0 || servers.length === 0 ? 'active' : 'library';
  const allLabels = useMemo(() => [...new Set(servers.flatMap((server) => server.labels))].toSorted(), [servers]);

  // ---- rail ----
  const railScopes = useMemo(() => {
    const seen = new Set<string>();
    const list = projects
      .filter((project) => project.project_id && !seen.has(project.project_id) && seen.add(project.project_id))
      .map((project) => ({
        key: projectScopeKey(project.project_id ?? ''),
        label: project.name,
        workspace: project.workspace,
        count: projectServerCount(attachments, project.project_id ?? ''),
      }));
    return splitRailScopes(
      {
        key: GLOBAL_SCOPE_KEY,
        label: t('settings.library.scopeGlobal'),
        count: scopeServers(attachments, null).here.length,
      },
      list,
      scopeKey
    );
  }, [attachments, projects, scopeKey, t]);

  const tabServers =
    effectiveTab === 'active'
      ? [...scope.here, ...scope.fromGlobal, ...scope.offHere].flatMap((id): ServerResponse[] => {
          const server = byId.get(id);
          return server ? [server] : [];
        })
      : servers;
  const railCategories: RailCategory[] = useMemo(() => {
    const counts = new Map<string, number>();
    tabServers.forEach((server) =>
      serverCategories(server).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1))
    );
    const keys = [...counts.keys()].toSorted((a, b) =>
      a === UNLABELLED ? 1 : b === UNLABELLED ? -1 : a.localeCompare(b)
    );
    return [
      { key: ALL_CATEGORY_KEY, label: t('settings.library.allCategories'), count: tabServers.length },
      ...keys.map((key) => ({
        key,
        label: key === UNLABELLED ? t('settings.servers.unlabelled') : key,
        count: counts.get(key) ?? 0,
      })),
    ];
  }, [tabServers, t]);

  const visible = (server: ServerResponse): boolean =>
    (category === ALL_CATEGORY_KEY || serverCategories(server).includes(category)) && serverMatches(server, query);

  // ---- writes ----
  const toggle = async (server: ServerResponse, on: boolean) => {
    const action = scopeToggleAction(attachments, server.id, projectId, on);
    if (action.kind === 'none') return;
    setBusy(server.id);
    try {
      if (action.kind === 'attach') {
        await actions.attach(server.id, projectId ? 'project' : 'global', projectId ?? '', action.op);
      } else {
        await actions.detach(action.attachmentId);
      }
      Message.success(
        t(on ? 'settings.library.turnedOn' : 'settings.library.turnedOff', { name: server.name, scope: scopeLabel })
      );
    } catch (writeError) {
      Message.error(describeServerError(t, writeError));
    } finally {
      setBusy(null);
    }
  };

  const setEnabled = async (server: ServerResponse, enabled: boolean) => {
    setBusy(server.id);
    try {
      await actions.update(server.id, { enabled });
    } catch (writeError) {
      Message.error(describeServerError(t, writeError));
    } finally {
      setBusy(null);
    }
  };

  // ---- cards ----
  const card = (server: ServerResponse) => {
    const on = onIds.has(server.id);
    return (
      <LibraryCard
        key={server.id}
        id={server.id}
        name={server.name}
        description={[serverAddress(server), server.notes].filter(Boolean).join(' · ')}
        visual='backend'
        chips={<ServerChips server={server} />}
        toggle={{
          checked: on,
          label: server.enabled ? t('settings.library.onIn', { scope: scopeLabel }) : t('settings.servers.switchedOff'),
          disabled: !server.enabled,
          loading: busy === server.id,
          onChange: (next) => void toggle(server, next),
        }}
        menu={[
          { key: 'details', label: t('settings.library.menu.details'), onClick: () => setDrawer(server) },
          {
            key: 'enabled',
            label: server.enabled ? t('settings.servers.menu.switchOff') : t('settings.servers.menu.switchOn'),
            onClick: () => void setEnabled(server, !server.enabled),
          },
        ]}
        onOpen={() => setDrawer(server)}
      />
    );
  };

  const noMatch = <LibraryEmpty text={t('settings.library.noMatch')} />;
  const toLibrary = () => {
    setTab('library');
    setTabChosen(true);
  };
  const addServer = () => setDrawer('new');

  const section = (key: string, title: string, ids: string[], hint?: string, empty?: React.ReactNode) => {
    const list = ids.flatMap((id): ServerResponse[] => {
      const server = byId.get(id);
      return server ? [server] : [];
    });
    const shown = list.filter(visible);
    if (list.length === 0 && !empty) return null;
    return (
      <LibrarySection
        key={key}
        sectionKey={key}
        title={title}
        count={shown.length}
        hint={hint}
        visual={key === 'fromGlobal' ? 'global' : undefined}
        actions={
          key === 'fromGlobal' ? (
            <Button size='mini' onClick={() => setChosenScope(GLOBAL_SCOPE_KEY)}>
              {t('settings.library.manageInGlobal')}
            </Button>
          ) : undefined
        }
      >
        {shown.length > 0 ? shown.map(card) : list.length > 0 ? noMatch : empty}
      </LibrarySection>
    );
  };

  const activePanel =
    servers.length === 0 ? (
      <LibraryEmpty text={t('settings.servers.empty')} actionLabel={t('settings.servers.add')} onAction={addServer} />
    ) : (
      <>
        {section(
          'here',
          t('settings.servers.group.here', { scope: scopeLabel }),
          scope.here,
          undefined,
          <LibraryEmpty
            text={t('settings.servers.nothingOn', { scope: scopeLabel })}
            actionLabel={t('settings.servers.browseLibrary')}
            onAction={toLibrary}
          />
        )}
        {projectId
          ? section(
              'fromGlobal',
              t('settings.library.group.fromGlobal'),
              scope.fromGlobal,
              t('settings.library.fromGlobalHint')
            )
          : null}
        {projectId
          ? section('offHere', t('settings.servers.group.offHere'), scope.offHere, t('settings.servers.offHereHint'))
          : null}
      </>
    );

  const libraryPanel =
    servers.length === 0 ? (
      <LibraryEmpty text={t('settings.servers.empty')} actionLabel={t('settings.servers.add')} onAction={addServer} />
    ) : (
      <>
        {SERVER_ENVIRONMENTS.map((environment) =>
          section(
            environment,
            t(`mcp.market.environment.${environment}`, { defaultValue: environment }),
            servers.filter((server) => server.environment === environment).map((server) => server.id)
          )
        )}
        {section(
          'other',
          t('settings.servers.group.otherEnvironment'),
          servers
            .filter((server) => !(SERVER_ENVIRONMENTS as readonly string[]).includes(server.environment))
            .map((server) => server.id)
        )}
      </>
    );

  // The open server as it is now (after a save, a switch or a reload), not as it was when opened.
  const drawerTarget: ServerDrawerTarget = drawer && drawer !== 'new' ? (byId.get(drawer.id) ?? drawer) : drawer;

  const summary = [
    t('settings.servers.summary.on', { count: activeCount }),
    ...(projectId ? [t('settings.servers.summary.fromGlobal', { count: scope.fromGlobal.length })] : []),
    t('settings.servers.summary.total', { count: servers.length }),
  ].join(' · ');

  return (
    <>
      <LibraryLayout
        testId='servers-library'
        title={t('settings.servers.title')}
        description={t('settings.servers.description')}
        headerActions={
          <Button
            type='primary'
            icon={<Plus theme='outline' size='14' fill='currentColor' className='me-6px' />}
            onClick={addServer}
            data-testid='server-add'
          >
            {t('settings.servers.add')}
          </Button>
        }
        search={{ value: query, onChange: setQuery, placeholder: t('settings.servers.search') }}
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
        summary={isLoading ? undefined : summary}
        tabs={[
          { key: 'active', label: t('settings.library.tabActive'), count: activeCount },
          { key: 'library', label: t('settings.library.tabLibrary'), count: servers.length },
        ]}
        activeTab={effectiveTab}
        onTab={(key) => {
          setTab(key as ServersTab);
          setTabChosen(true);
          setCategory(ALL_CATEGORY_KEY);
        }}
        tabsLabel={t('settings.library.tabsLabel')}
        isMobile={isMobile}
      >
        {error ? (
          <MarketErrorNotice message={describeServerError(t, error)} onRetry={() => void reload()} />
        ) : isLoading ? (
          <div role='status' aria-busy='true' aria-label={t('settings.servers.loading')}>
            <Skeleton animation text={{ rows: 5 }} />
          </div>
        ) : effectiveTab === 'active' ? (
          activePanel
        ) : (
          libraryPanel
        )}
      </LibraryLayout>

      <ServerDrawer
        target={drawerTarget}
        projects={projects}
        labels={allLabels}
        isMobile={isMobile}
        onClose={() => setDrawer(null)}
        onSaved={(server) => setDrawer(server)}
      />
    </>
  );
};

export default ServersLibrary;

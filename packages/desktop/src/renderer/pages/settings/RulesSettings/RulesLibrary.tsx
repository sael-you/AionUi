/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Rules (C37, TASK-131) in the shared library layout (C33).
 *
 * Rail: SCOPE (Global or a project; default the project the settings were
 * opened from) and the source (mine / imported). Tabs:
 * - **Active**: "What <scope> gets" (meter against the 24 KB cap, the exact
 *   text), then the rules on here, the Global ones a project inherits
 *   (read-only here, "Manage in Global") and Global ones turned off here.
 * - **Library**: every rule, each with "On in <scope>".
 * A card opens the editor drawer. Rules are always applied, from a
 * conversation's next session start; Import brings in existing AGENTS.md files.
 */

import { Button, Message, Skeleton, Tag } from '@arco-design/web-react';
import { FileAddition, Plus } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RULES_EFFECTIVE_MAX_BYTES, type RuleResponse } from '@/common/types/platform/rules';
import LibraryCard from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import LibraryLayout from '@/renderer/components/settings/SettingsModal/library/LibraryLayout';
import {
  DrawerBlock,
  LibraryEmpty,
  LibraryScopeName,
} from '@/renderer/components/settings/SettingsModal/library/LibraryParts';
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
import { attachRequest } from '@/renderer/hooks/mcp/market/kitModel';
import { projectItemCount, scopeItems, scopeToggle } from '@/renderer/hooks/mcp/market/kitScope';
import { useKitActions, useKitAttachments } from '@/renderer/hooks/mcp/market/useKits';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import { MarketErrorNotice, useIsMobileLayout } from '../ToolsSettings/market/shared';
import RuleDrawer, { type RuleDrawerTarget } from './RuleDrawer';
import RuleImportModal from './RuleImportModal';
import RulesEffectivePanel from './RulesEffectivePanel';
import { RULE_SOURCES, describeRuleError, formatBytes, ruleMatches, ruleSource, utf8Bytes } from './ruleModel';
import { useRuleActions, useRuleList } from './useRules';

type RulesTab = 'active' | 'library';

const ALL = {};

const RulesLibrary: React.FC = () => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const { rules, error, isLoading, reload } = useRuleList();
  const { attachments } = useKitAttachments(ALL);
  const projects = useStandardProjects(null);
  const originProjectId = useOriginProjectId(null);
  const kitActions = useKitActions();
  const ruleActions = useRuleActions();
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const scopeKey = chosenScope ?? (originProjectId ? projectScopeKey(originProjectId) : GLOBAL_SCOPE_KEY);
  const projectId = projectIdOfScope(scopeKey);
  const [tab, setTab] = useState<RulesTab>('active');
  const [tabChosen, setTabChosen] = useState(false);
  const [category, setCategory] = useState(ALL_CATEGORY_KEY);
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<RuleDrawerTarget>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const byId = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  const scopeProject = projects.find((project) => project.project_id === projectId) ?? null;
  const scopeLabel = projectId ? (scopeProject?.name ?? projectId) : t('settings.library.scopeGlobal');
  const scope = useMemo(() => scopeItems(attachments, 'rule', projectId), [attachments, projectId]);
  const onIds = new Set([...scope.here, ...scope.fromGlobal]);
  const activeCount = [...onIds].filter((id) => byId.has(id)).length;
  const effectiveTab: RulesTab = tabChosen ? tab : activeCount > 0 || rules.length === 0 ? 'active' : 'library';
  const lookup = (ids: string[]): RuleResponse[] =>
    ids.flatMap((id): RuleResponse[] => {
      const rule = byId.get(id);
      return rule ? [rule] : [];
    });

  // ---- rail ----
  const railScopes = useMemo(() => {
    const seen = new Set<string>();
    const list = projects
      .filter((project) => project.project_id && !seen.has(project.project_id) && seen.add(project.project_id))
      .map((project) => ({
        key: projectScopeKey(project.project_id ?? ''),
        label: project.name,
        workspace: project.workspace,
        count: projectItemCount(attachments, 'rule', project.project_id ?? ''),
      }));
    return splitRailScopes(
      {
        key: GLOBAL_SCOPE_KEY,
        label: t('settings.library.scopeGlobal'),
        count: scopeItems(attachments, 'rule', null).here.length,
      },
      list,
      scopeKey
    );
  }, [attachments, projects, scopeKey, t]);

  const tabRules = effectiveTab === 'active' ? lookup([...scope.here, ...scope.fromGlobal, ...scope.offHere]) : rules;
  const railCategories: RailCategory[] = [
    { key: ALL_CATEGORY_KEY, label: t('settings.library.allCategories'), count: tabRules.length },
    ...RULE_SOURCES.map((key) => ({
      key,
      label: t(`settings.rules.source.${key}`),
      count: tabRules.filter((rule) => ruleSource(rule) === key).length,
    })),
  ];
  const visible = (rule: RuleResponse): boolean =>
    (category === ALL_CATEGORY_KEY || ruleSource(rule) === category) && ruleMatches(rule, query);

  // ---- writes ----
  const toggle = async (rule: RuleResponse, on: boolean) => {
    const action = scopeToggle(attachments, 'rule', rule.id, projectId, on);
    if (action.kind === 'none') return;
    setBusy(rule.id);
    try {
      if (action.kind === 'attach') {
        await kitActions.attach(
          attachRequest(projectId ? 'project' : 'global', projectId ?? '', 'rule', rule.id, action.op)
        );
      } else {
        await kitActions.detach(action.attachmentId);
      }
      Message.success(
        t(on ? 'settings.library.turnedOn' : 'settings.library.turnedOff', { name: rule.name, scope: scopeLabel })
      );
    } catch (writeError) {
      Message.error(describeRuleError(t, writeError));
    } finally {
      setBusy(null);
    }
  };

  const setEnabled = async (rule: RuleResponse, enabled: boolean) => {
    setBusy(rule.id);
    try {
      await ruleActions.update(rule.id, { enabled, expected_updated_at: rule.updated_at });
    } catch (writeError) {
      Message.error(describeRuleError(t, writeError));
    } finally {
      setBusy(null);
    }
  };

  // ---- cards ----
  const card = (rule: RuleResponse, inherited: boolean) => {
    const on = onIds.has(rule.id);
    return (
      <LibraryCard
        key={rule.id}
        id={rule.id}
        name={rule.name}
        description={rule.description || rule.body.slice(0, 200)}
        visual='docs'
        chips={
          <>
            {!rule.enabled ? (
              <Tag size='small' color='gray'>
                {t('settings.rules.chips.off')}
              </Tag>
            ) : null}
            <Tag size='small' color={ruleSource(rule) === 'imported' ? 'arcoblue' : undefined}>
              {t(`settings.rules.source.${ruleSource(rule)}`)}
            </Tag>
            <Tag size='small'>{formatBytes(utf8Bytes(rule.body))}</Tag>
          </>
        }
        toggle={
          inherited
            ? {
                checked: true,
                disabled: true,
                label: t('settings.rules.fromGlobalToggle'),
                onChange: () => undefined,
              }
            : {
                checked: on,
                label: rule.enabled
                  ? t('settings.library.onIn', { scope: scopeLabel })
                  : t('settings.rules.switchedOff'),
                disabled: !rule.enabled,
                loading: busy === rule.id,
                onChange: (next) => void toggle(rule, next),
              }
        }
        menu={[
          { key: 'edit', label: t('settings.rules.menu.edit'), onClick: () => setDrawer(rule) },
          {
            key: 'enabled',
            label: rule.enabled ? t('settings.rules.menu.switchOff') : t('settings.rules.menu.switchOn'),
            onClick: () => void setEnabled(rule, !rule.enabled),
          },
        ]}
        onOpen={() => setDrawer(rule)}
      />
    );
  };

  const noMatch = <LibraryEmpty text={t('settings.library.noMatch')} />;
  const addRule = () => setDrawer('new');
  const emptyLibrary = (
    <LibraryEmpty text={t('settings.rules.empty')} actionLabel={t('settings.rules.add')} onAction={addRule} />
  );

  const section = (
    key: string,
    title: string,
    list: RuleResponse[],
    options: { hint?: string; inherited?: boolean; empty?: React.ReactNode } = {}
  ) => {
    const shown = list.filter(visible);
    if (list.length === 0 && !options.empty) return null;
    return (
      <LibrarySection
        key={key}
        sectionKey={key}
        title={title}
        count={shown.length}
        hint={options.hint}
        visual={key === 'fromGlobal' ? 'global' : undefined}
        actions={
          key === 'fromGlobal' ? (
            <Button size='mini' onClick={() => setChosenScope(GLOBAL_SCOPE_KEY)}>
              {t('settings.library.manageInGlobal')}
            </Button>
          ) : undefined
        }
      >
        {shown.length > 0
          ? shown.map((rule) => card(rule, Boolean(options.inherited)))
          : list.length > 0
            ? noMatch
            : options.empty}
      </LibrarySection>
    );
  };

  const activePanel =
    rules.length === 0 ? (
      emptyLibrary
    ) : (
      <>
        <div className='rd-12px border border-solid border-3 p-12px' data-testid='rules-scope-gets'>
          <DrawerBlock title={t('settings.rules.effective.title', { scope: scopeLabel })}>
            <RulesEffectivePanel
              query={projectId ? { project_id: projectId } : {}}
              onOpenRule={(id) => {
                const rule = byId.get(id);
                if (rule) setDrawer(rule);
              }}
            />
          </DrawerBlock>
        </div>
        {section('here', t('settings.rules.group.here', { scope: scopeLabel }), lookup(scope.here), {
          empty: (
            <LibraryEmpty
              text={t('settings.rules.nothingOn', { scope: scopeLabel })}
              actionLabel={t('settings.rules.browseLibrary')}
              onAction={() => {
                setTab('library');
                setTabChosen(true);
              }}
            />
          ),
        })}
        {projectId
          ? section('fromGlobal', t('settings.library.group.fromGlobal'), lookup(scope.fromGlobal), {
              hint: t('settings.rules.fromGlobalHint'),
              inherited: true,
            })
          : null}
        {projectId
          ? section('offHere', t('settings.rules.group.offHere'), lookup(scope.offHere), {
              hint: t('settings.rules.offHereHint'),
            })
          : null}
      </>
    );

  const libraryPanel =
    rules.length === 0 ? (
      emptyLibrary
    ) : (
      <>
        {RULE_SOURCES.map((key) =>
          section(
            key,
            t(`settings.rules.source.${key}`),
            rules.filter((rule) => ruleSource(rule) === key)
          )
        )}
      </>
    );

  const summary = [
    t('settings.rules.summary.on', { count: activeCount }),
    ...(projectId ? [t('settings.rules.summary.fromGlobal', { count: scope.fromGlobal.length })] : []),
    t('settings.rules.summary.cap', { max: formatBytes(RULES_EFFECTIVE_MAX_BYTES) }),
  ].join(' · ');

  const drawerTarget: RuleDrawerTarget = drawer && drawer !== 'new' ? (byId.get(drawer.id) ?? drawer) : drawer;

  return (
    <>
      <LibraryLayout
        testId='rules-library'
        title={t('settings.rules.title')}
        description={t('settings.rules.description')}
        headerActions={
          <>
            <Button
              icon={<FileAddition theme='outline' size='14' fill='currentColor' className='me-6px' />}
              onClick={() => setImporting(true)}
              data-testid='rule-import-open'
            >
              {t('settings.rules.import.open')}
            </Button>
            <Button
              type='primary'
              icon={<Plus theme='outline' size='14' fill='currentColor' className='me-6px' />}
              onClick={addRule}
              data-testid='rule-add'
            >
              {t('settings.rules.add')}
            </Button>
          </>
        }
        search={{ value: query, onChange: setQuery, placeholder: t('settings.rules.search') }}
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
          { key: 'library', label: t('settings.library.tabLibrary'), count: rules.length },
        ]}
        activeTab={effectiveTab}
        onTab={(key) => {
          setTab(key as RulesTab);
          setTabChosen(true);
          setCategory(ALL_CATEGORY_KEY);
        }}
        tabsLabel={t('settings.library.tabsLabel')}
        isMobile={isMobile}
      >
        {error ? (
          <MarketErrorNotice message={describeRuleError(t, error)} onRetry={() => void reload()} />
        ) : isLoading ? (
          <div role='status' aria-busy='true' aria-label={t('settings.rules.loading')}>
            <Skeleton animation text={{ rows: 5 }} />
          </div>
        ) : effectiveTab === 'active' ? (
          activePanel
        ) : (
          libraryPanel
        )}
      </LibraryLayout>

      <RuleDrawer
        target={drawerTarget}
        projects={projects}
        scope={{ projectId, label: scopeLabel }}
        isMobile={isMobile}
        onClose={() => setDrawer(null)}
        onSaved={(rule) => setDrawer(rule)}
        onStale={() => void reload()}
      />
      <RuleImportModal
        visible={importing}
        projects={projects}
        initialProjectId={projectId}
        onClose={() => setImporting(false)}
      />
    </>
  );
};

export default RulesLibrary;

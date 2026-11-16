/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Skills page in the shared library layout (C33, TASK-119).
 *
 * Scope (rail): Global or a project — default the project of the conversation
 * the settings were opened from (`?project=` wins), else Global.
 * Tabs: **Active** = what the scope delivers, grouped by where it comes from
 * (this project's kit, added here, each shared kit, From Global, turned off
 * here); **Library** = every skill grouped by category (its shared kits,
 * Built-in, Other), each card with "On in <scope>" and each kit category with
 * "Add whole category" (attach that kit to the scope).
 * Writes go through the existing kit actions (httpBridge, CSRF) only.
 */

import { Button, Message, Modal, Switch, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { KitResponse } from '@/common/config/storage';
import {
  CategoryIcon,
  kitVisualId,
  type CategoryVisualId,
} from '@/renderer/components/settings/SettingsModal/library/categoryVisual';
import LibraryCard from '@/renderer/components/settings/SettingsModal/library/LibraryCard';
import LibraryLayout from '@/renderer/components/settings/SettingsModal/library/LibraryLayout';
import {
  DrawerBlock,
  LibraryBatchBar,
  LibraryDrawer,
  LibraryEmpty,
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
import { ProjectChip, useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { describeKitError, kitFormFromKit } from '@/renderer/hooks/mcp/market/kitModel';
import { GLOBAL_KIT_KEY } from '@/renderer/hooks/mcp/market/kitGroups';
import { useKitActions, useKitAttachments, useKitEffective, useKitList } from '@/renderer/hooks/mcp/market/useKits';
import { useStandardProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useStandardProjects';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import KitEditModal from '../ToolsSettings/kits/KitEditModal';
import SkillFileBrowser from './SkillFileBrowser';
import SkillUsedByStack, { getAssistantsUsingSkill } from './SkillUsedByStack';
import {
  SKILL_SOURCE_FILTERS,
  attachKitRequest,
  buildActiveGroups,
  buildSkillCategories,
  conversationIdOfPath,
  isAlwaysOn,
  kitAttachmentIn,
  planSkillToggle,
  projectKitOf,
  resolveSkills,
  scopeOwnCount,
  skillMatchesSource,
  type ActiveGroup,
  type LibrarySkill,
  type SkillCategory,
  type SkillSourceFilter,
  type SkillWrite,
} from './skillLibraryModel';

export type SkillsLibrarySkill = LibrarySkill & { location: string };

export type SkillsLibraryProps = {
  skills: SkillsLibrarySkill[];
  loading: boolean;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  query: string;
  onQuery: (value: string) => void;
  /** `?project=<id>`: open on that project. */
  initialProjectId: string | null;
  /** `?highlight=<name>`: scroll to and highlight that skill once. */
  highlightName: string | null;
  onHighlightDone: () => void;
  /** Confirmed deletes of the owner's skills. */
  onDelete: (name: string) => void;
  onBatchDelete: (names: string[], done: () => void) => void;
  isMobile: boolean;
};

type SkillsTab = 'active' | 'library';

const ALL_ATTACHMENTS = {};
const LAST_PATH_KEY = 'aion:last-non-settings-path';

const readLastPath = (): string | null => {
  try {
    return sessionStorage.getItem(LAST_PATH_KEY);
  } catch {
    return null;
  }
};

/** The project of the conversation the settings were opened from (null while unknown or none). */
const useOriginProjectId = (explicit: string | null): string | null => {
  const conversationId = explicit ? null : conversationIdOfPath(readLastPath());
  const { data } = useSWR(conversationId ? `conversation/${conversationId}` : null, () =>
    getConversationOrNull(conversationId ?? '')
  );
  return explicit ?? data?.project_id ?? null;
};

const ScopeName: React.FC<{ workspace?: string; label: string }> = ({ workspace, label }) => {
  const theme = useProjectTheme(workspace);
  return theme ? <ProjectChip project={theme} /> : <span>{label}</span>;
};

const categoryVisual = (category: SkillCategory): CategoryVisualId | null => {
  if (category.kind === 'project') return 'project';
  if (category.kind === 'builtin') return 'builtin';
  if (category.kind === 'other') return 'other';
  return kitVisualId(category.kit?.builtin_key);
};

const SkillsLibrary: React.FC<SkillsLibraryProps> = ({
  skills,
  loading,
  description,
  headerActions,
  query,
  onQuery,
  initialProjectId,
  highlightName,
  onHighlightDone,
  onDelete,
  onBatchDelete,
  isMobile,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useStandardProjects(null);
  const originProjectId = useOriginProjectId(initialProjectId);
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const scopeKey = chosenScope ?? (originProjectId ? projectScopeKey(originProjectId) : GLOBAL_SCOPE_KEY);
  const projectId = projectIdOfScope(scopeKey);
  const [tab, setTab] = useState<SkillsTab>('active');
  const [category, setCategory] = useState(ALL_CATEGORY_KEY);
  const [source, setSource] = useState<SkillSourceFilter>('all');
  const [openName, setOpenName] = useState<string | null>(null);
  const [batch, setBatch] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [editKit, setEditKit] = useState<KitResponse | null>(null);

  const { kits, error: kitsError, reload } = useKitList();
  const { attachments } = useKitAttachments(ALL_ATTACHMENTS);
  const effective = useKitEffective(projectId ? { project_id: projectId } : ALL_ATTACHMENTS);
  const actions = useKitActions();
  const { data: assistants } = useSWR<Assistant[]>('assistants.list', () => ipcBridge.assistants.list.invoke());

  const skillByName = useMemo(() => new Map(skills.map((skill) => [skill.name, skill])), [skills]);
  const projectKit = projectKitOf(kits, projectId);
  const scopeProject = projects.find((project) => project.project_id === projectId) ?? null;
  const scopeLabel = projectId ? (scopeProject?.name ?? projectId) : t('settings.library.scopeGlobal');

  // ---- rail ----
  const railScopes = useMemo(() => {
    const global = {
      key: GLOBAL_SCOPE_KEY,
      label: t('settings.library.scopeGlobal'),
      count: scopeOwnCount(resolveSkills(kits, attachments, null), null),
    };
    const seen = new Set<string>();
    const list = projects
      .filter((project) => project.project_id && !seen.has(project.project_id) && seen.add(project.project_id))
      .map((project) => ({
        key: projectScopeKey(project.project_id ?? ''),
        label: project.name,
        workspace: project.workspace,
        count: scopeOwnCount(resolveSkills(kits, attachments, project.project_id ?? null), project.project_id ?? null),
      }));
    return splitRailScopes(global, list, scopeKey);
  }, [kits, attachments, projects, scopeKey, t]);

  // ---- categories ----
  const categories = useMemo(() => buildSkillCategories(skills, kits, projectId), [skills, kits, projectId]);
  const categoriesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of categories) {
      for (const name of entry.skills) map.set(name, [...(map.get(name) ?? []), entry.key]);
    }
    return map;
  }, [categories]);
  const visualOf = (name: string): { visual: CategoryVisualId | null; key: string } => {
    const key = (categoriesOf.get(name) ?? []).find((entry) => entry !== 'project') ?? 'other';
    const entry = categories.find((c) => c.key === key);
    return { visual: entry ? categoryVisual(entry) : 'other', key };
  };
  const categoryLabel = (entry: SkillCategory): string => {
    if (entry.kind === 'project') return t('settings.skillsLibrary.category.project');
    if (entry.kind === 'builtin') return t('settings.skillsLibrary.category.builtin');
    if (entry.kind === 'other') return t('settings.skillsLibrary.category.other');
    return entry.kit?.name ?? entry.key;
  };

  // ---- effective / active ----
  const effectiveSkills = effective.effective?.skills ?? [];
  const effectiveByName = useMemo(
    () => new Map(effectiveSkills.map((item) => [item.item_ref, item])),
    [effectiveSkills]
  );
  const isOn = (name: string): boolean => {
    const skill = skillByName.get(name);
    if (skill && isAlwaysOn(skill)) return true;
    return effectiveByName.get(name)?.included === true;
  };
  const { groups, summary } = useMemo(
    () => buildActiveGroups({ effective: effectiveSkills, kits, attachments, projectId }),
    [effectiveSkills, kits, attachments, projectId]
  );

  // ---- filters ----
  const visible = useCallback(
    (name: string): boolean => {
      const skill = skillByName.get(name);
      if (!skill) return false;
      if (!skillMatchesSource(skill, source)) return false;
      if (category !== ALL_CATEGORY_KEY && !(categoriesOf.get(name) ?? []).includes(category)) return false;
      return matchesQuery(query, skill.name, skill.description);
    },
    [skillByName, source, category, categoriesOf, query]
  );

  const pool = tab === 'active' ? skills.filter((skill) => isOn(skill.name)) : skills;
  const sourced = pool.filter((skill) => skillMatchesSource(skill, source));
  const railCategories: RailCategory[] = [
    { key: ALL_CATEGORY_KEY, label: t('settings.library.allCategories'), count: sourced.length },
    ...categories
      .map((entry) => ({
        key: entry.key,
        label: categoryLabel(entry),
        count: entry.skills.filter((name) => sourced.some((skill) => skill.name === name)).length,
      }))
      .filter((entry) => entry.count > 0 || entry.key === category),
  ];

  // ---- deep link highlight ----
  useEffect(() => {
    if (!highlightName || loading || !skillByName.has(highlightName)) return;
    setTab('library');
    setCategory(ALL_CATEGORY_KEY);
    setSource('all');
    setHighlighted(highlightName);
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="library-card"][data-card-id="${CSS.escape(highlightName)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const timer = setTimeout(() => setHighlighted(null), 2000);
    onHighlightDone();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [highlightName, loading, skillByName, onHighlightDone]);

  // ---- writes ----
  const runWrites = async (writes: SkillWrite[]) => {
    for (const write of writes) {
      if (write.type === 'attach') await actions.attach(write.request);
      else if (write.type === 'detach') await actions.detach(write.attachmentId);
      else await actions.patchKit(write.kit, { skills: write.skills });
    }
    await effective.reload?.();
  };

  const withBusy = async (names: string[], work: () => Promise<void>, success: string) => {
    setBusy((prev) => new Set([...prev, ...names]));
    try {
      await work();
      Message.success(success);
    } catch (error) {
      Message.error(describeKitError(t, error));
    } finally {
      setBusy((prev) => new Set([...prev].filter((name) => !names.includes(name))));
    }
  };

  const toggle = (name: string, on: boolean) =>
    withBusy(
      [name],
      () => runWrites(planSkillToggle({ name, on, projectId, kits, attachments })),
      on
        ? t('settings.library.turnedOn', { name, scope: scopeLabel })
        : t('settings.library.turnedOff', { name, scope: scopeLabel })
    );

  /** One plan for many skills: the project kit is patched once with the final list. */
  const toggleMany = (names: string[], on: boolean) =>
    withBusy(
      names,
      async () => {
        let currentKits = kits;
        const writes: SkillWrite[] = [];
        let kitWrite: Extract<SkillWrite, { type: 'setProjectKitSkills' }> | null = null;
        for (const name of names) {
          if (isOn(name) === on) continue;
          for (const write of planSkillToggle({ name, on, projectId, kits: currentKits, attachments })) {
            if (write.type === 'setProjectKitSkills') {
              kitWrite = { ...write, kit: kitWrite?.kit ?? write.kit };
              currentKits = currentKits.map((kit) =>
                kit.id === write.kit.id ? { ...kit, skills: write.skills } : kit
              );
            } else {
              writes.push(write);
            }
          }
        }
        await runWrites(kitWrite ? [...writes, kitWrite] : writes);
      },
      t('settings.library.batchDone', { count: names.length, scope: scopeLabel })
    );

  const attachKit = (kit: KitResponse) =>
    withBusy(
      [],
      async () => {
        await actions.attach(attachKitRequest(kit.id, projectId));
        await effective.reload?.();
      },
      t('settings.library.kitAttached', { name: kit.name, scope: scopeLabel })
    );

  const detachKit = (kit: KitResponse | undefined, attachmentId: string) =>
    Modal.confirm({
      title: t('settings.library.detachKitTitle', { name: kit?.name ?? '' }),
      content: t('settings.library.detachKitBody', { name: kit?.name ?? '', scope: scopeLabel }),
      okText: t('settings.library.detachKit'),
      okButtonProps: { status: 'warning' },
      onOk: () =>
        withBusy(
          [],
          async () => {
            await actions.detach(attachmentId);
            await effective.reload?.();
          },
          t('settings.library.kitDetached', { name: kit?.name ?? '', scope: scopeLabel })
        ),
    });

  const createProjectKit = () =>
    withBusy(
      [],
      async () => {
        if (!projectId) return;
        await actions.createKit({ ...kitFormFromKit(null), name: scopeLabel }, projectId);
        await effective.reload?.();
      },
      t('mcp.kits.projectKit.created')
    );

  // ---- cards ----
  const sourceChip = (skill: LibrarySkill) => {
    if (isAlwaysOn(skill)) {
      return (
        <Tag size='small' color='green'>
          {t('settings.skillsLibrary.source.alwaysOn')}
        </Tag>
      );
    }
    const key = skill.source === 'builtin' ? 'official' : skill.source === 'extension' ? 'imported' : 'mine';
    return <Tag size='small'>{t(`settings.skillsLibrary.source.${key}`)}</Tag>;
  };

  const renderCard = (name: string) => {
    const skill = skillByName.get(name);
    if (!skill) return null;
    const on = isOn(name);
    const alwaysOn = isAlwaysOn(skill);
    const visual = visualOf(name);
    const deletable = skill.source === 'custom';
    return (
      <LibraryCard
        key={name}
        id={name}
        name={name}
        description={skill.description}
        visual={visual.visual}
        visualKey={visual.key}
        chips={sourceChip(skill)}
        highlighted={highlighted === name}
        toggle={{
          checked: on,
          label: alwaysOn
            ? t('settings.skillsLibrary.source.alwaysOn')
            : t('settings.library.onIn', { scope: scopeLabel }),
          disabled: alwaysOn || busy.has(name),
          loading: busy.has(name),
          onChange: (value) => void toggle(name, value),
        }}
        menu={[
          { key: 'details', label: t('settings.library.menu.details'), onClick: () => setOpenName(name) },
          {
            key: 'page',
            label: t('settings.skillsLibrary.openPage'),
            onClick: () => {
              void navigate(`/settings/skills/detail/${encodeURIComponent(name)}`);
            },
          },
          ...(on && !alwaysOn
            ? [
                {
                  key: 'remove',
                  label: t('settings.library.menu.removeFrom', { scope: scopeLabel }),
                  onClick: () => {
                    void toggle(name, false);
                  },
                },
              ]
            : []),
          ...(deletable
            ? [{ key: 'delete', label: t('settings.library.menu.delete'), danger: true, onClick: () => onDelete(name) }]
            : []),
        ]}
        batch={
          batch
            ? {
                selected: batch.has(name),
                onChange: (selected) =>
                  setBatch((prev) => {
                    const next = new Set(prev ?? []);
                    if (selected) next.add(name);
                    else next.delete(name);
                    return next;
                  }),
              }
            : null
        }
        onOpen={() => setOpenName(name)}
      />
    );
  };

  const cards = (names: readonly string[], empty: React.ReactNode) => {
    const shown = names.filter(visible);
    return shown.length > 0 ? shown.map(renderCard) : empty;
  };

  const toLibrary = () => setTab('library');
  const noMatch = <LibraryEmpty text={t('settings.library.noMatch')} />;

  // ---- Active tab ----
  const activeGroupTitle = (group: ActiveGroup): string => {
    switch (group.kind) {
      case 'projectKit':
        return t('settings.library.group.projectKit');
      case 'single':
        return t('settings.library.group.single', { scope: scopeLabel });
      case 'fromGlobal':
        return t('settings.library.group.fromGlobal');
      case 'removed':
        return t('settings.library.group.removed');
      default:
        return group.kit?.builtin_key === GLOBAL_KIT_KEY
          ? t('settings.library.group.globalKit')
          : t('settings.library.group.kit', { name: group.kit?.name ?? '' });
    }
  };

  const activeGroupActions = (group: ActiveGroup) => {
    if (group.kind === 'projectKit' && group.kit) {
      return (
        <Button size='mini' onClick={() => setEditKit(group.kit ?? null)} data-testid='library-edit-kit'>
          {t('settings.library.editKit')}
        </Button>
      );
    }
    if (group.kind === 'kit' && group.attachmentId) {
      const attachmentId = group.attachmentId;
      return (
        <Button size='mini' onClick={() => detachKit(group.kit, attachmentId)} data-testid='library-detach-kit'>
          {t('settings.library.detachKit')}
        </Button>
      );
    }
    if (group.kind === 'fromGlobal') {
      return (
        <Button size='mini' onClick={() => setChosenScope(GLOBAL_SCOPE_KEY)} data-testid='library-manage-global'>
          {t('settings.library.manageInGlobal')}
        </Button>
      );
    }
    return null;
  };

  const activePanel = (
    <>
      {projectId && !projectKit ? (
        <LibrarySection
          sectionKey='projectKit'
          title={t('settings.library.group.projectKit')}
          count={0}
          visual='project'
        >
          <LibraryEmpty
            text={t('settings.library.noProjectKit', { name: scopeLabel })}
            actionLabel={t('mcp.kits.projectKit.create')}
            onAction={() => void createProjectKit()}
          />
        </LibrarySection>
      ) : null}
      {groups.map((group) => (
        <LibrarySection
          key={group.key}
          sectionKey={group.key}
          title={activeGroupTitle(group)}
          count={group.skills.filter(visible).length}
          hint={group.kind === 'fromGlobal' ? t('settings.library.fromGlobalHint') : undefined}
          visual={
            group.kind === 'projectKit'
              ? 'project'
              : group.kind === 'fromGlobal'
                ? 'global'
                : group.kind === 'kit'
                  ? kitVisualId(group.kit?.builtin_key)
                  : undefined
          }
          actions={activeGroupActions(group)}
        >
          {cards(
            group.skills,
            group.skills.length === 0 ? (
              <LibraryEmpty
                text={t('settings.library.emptyGroup')}
                actionLabel={t('settings.library.browseLibrary')}
                onAction={toLibrary}
              />
            ) : (
              noMatch
            )
          )}
        </LibrarySection>
      ))}
      {groups.length === 0 && !(projectId && !projectKit) ? (
        <LibraryEmpty
          text={t('settings.library.emptyActive')}
          actionLabel={t('settings.library.browseLibrary')}
          onAction={toLibrary}
        />
      ) : null}
    </>
  );

  // ---- Library tab ----
  const categoryActions = (entry: SkillCategory) => {
    if (entry.kind === 'project' && entry.kit) {
      return (
        <Button size='mini' onClick={() => setEditKit(entry.kit ?? null)}>
          {t('settings.library.editKit')}
        </Button>
      );
    }
    if (entry.kind !== 'kit' || !entry.kit) return null;
    const kit = entry.kit;
    const attachment = kitAttachmentIn(attachments, kit.id, projectId);
    return attachment ? (
      <Button size='mini' onClick={() => detachKit(kit, attachment.id)} data-testid='library-category-detach'>
        {t('settings.library.detachKit')}
      </Button>
    ) : (
      <Button size='mini' type='primary' onClick={() => void attachKit(kit)} data-testid='library-category-add'>
        {t('settings.library.addCategory', { scope: scopeLabel })}
      </Button>
    );
  };

  const searching = query.trim() !== '';
  const results = skills.map((skill) => skill.name).filter(visible);
  const libraryPanel = searching ? (
    <LibrarySection sectionKey='results' title={t('settings.library.results')} count={results.length}>
      {results.length > 0 ? results.map(renderCard) : noMatch}
    </LibrarySection>
  ) : (
    <>
      {categories
        .filter((entry) => category === ALL_CATEGORY_KEY || entry.key === category)
        .map((entry) => (
          <LibrarySection
            key={entry.key}
            sectionKey={entry.key}
            title={categoryLabel(entry)}
            count={entry.skills.filter(visible).length}
            visual={categoryVisual(entry)}
            actions={categoryActions(entry)}
          >
            {cards(entry.skills, noMatch)}
          </LibrarySection>
        ))}
      {categories.length === 0 ? (
        <LibraryEmpty text={loading ? t('common.loading') : t('settings.skillsHub.noSkills')} />
      ) : null}
    </>
  );

  // ---- drawer ----
  const openSkill = openName ? skillByName.get(openName) : undefined;
  const usedIn = useMemo(() => {
    if (!openName) return [];
    const scopes: Array<{ key: string; label: string }> = [];
    if (resolveSkills(kits, attachments, null).get(openName)?.included) {
      scopes.push({ key: GLOBAL_SCOPE_KEY, label: t('settings.library.scopeGlobal') });
    }
    for (const project of projects) {
      if (!project.project_id) continue;
      const decision = resolveSkills(kits, attachments, project.project_id).get(openName);
      if (decision?.included && decision.level === 'project') {
        scopes.push({ key: projectScopeKey(project.project_id), label: project.name });
      }
    }
    return scopes;
  }, [openName, kits, attachments, projects, t]);
  const kitsWithOpen = openName ? kits.filter((kit) => kit.skills.includes(openName)) : [];

  const drawer = (
    <LibraryDrawer
      visible={Boolean(openSkill)}
      isMobile={isMobile}
      onClose={() => setOpenName(null)}
      title={
        openSkill ? (
          <span className='inline-flex items-center gap-8px min-w-0'>
            <CategoryIcon
              visual={visualOf(openSkill.name).visual}
              fallbackKey={visualOf(openSkill.name).key}
              size='small'
            />
            <span className='truncate'>{openSkill.name}</span>
          </span>
        ) : null
      }
      testId='skill-drawer'
    >
      {openSkill ? (
        <>
          <div className='flex flex-wrap items-center gap-8px'>
            {sourceChip(openSkill)}
            {(categoriesOf.get(openSkill.name) ?? []).map((key) => {
              const entry = categories.find((c) => c.key === key);
              return entry ? (
                <Tag key={key} size='small'>
                  {categoryLabel(entry)}
                </Tag>
              ) : null;
            })}
          </div>
          {openSkill.description ? (
            <p className='m-0 text-13px leading-relaxed text-t-secondary'>{openSkill.description}</p>
          ) : null}
          <label className='flex items-center gap-8px text-13px text-t-primary'>
            <Switch
              size='small'
              checked={isOn(openSkill.name)}
              disabled={isAlwaysOn(openSkill) || busy.has(openSkill.name)}
              loading={busy.has(openSkill.name)}
              aria-label={t('settings.library.onIn', { scope: scopeLabel })}
              onChange={(value: boolean) => void toggle(openSkill.name, value)}
            />
            <span aria-hidden='true'>{t('settings.library.onIn', { scope: scopeLabel })}</span>
          </label>
          <DrawerBlock title={t('settings.library.usedIn')}>
            <div className='flex flex-wrap gap-6px' data-testid='skill-drawer-used-in'>
              {usedIn.length === 0 && kitsWithOpen.length === 0 ? (
                <span className='text-12px text-t-tertiary'>{t('settings.library.usedNowhere')}</span>
              ) : null}
              {usedIn.map((scope) => (
                <Button
                  key={scope.key}
                  size='mini'
                  onClick={() => {
                    setChosenScope(scope.key);
                    setOpenName(null);
                  }}
                >
                  {scope.label}
                </Button>
              ))}
              {kitsWithOpen.map((kit) => (
                <Tag key={kit.id} size='small' color='arcoblue'>
                  {t('settings.library.inKit', { name: kit.name })}
                </Tag>
              ))}
            </div>
            <SkillUsedByStack assistants={getAssistantsUsingSkill(openSkill.name, assistants ?? [])} />
          </DrawerBlock>
          <DrawerBlock title={t('settings.skillsLibrary.skillFile')}>
            <SkillFileBrowser skill={{ location: openSkill.location }} />
          </DrawerBlock>
          <div className='flex flex-wrap gap-8px'>
            <Button
              size='small'
              onClick={() => void navigate(`/settings/skills/detail/${encodeURIComponent(openSkill.name)}`)}
            >
              {t('settings.skillsLibrary.openPage')}
            </Button>
            {openSkill.source === 'custom' ? (
              <Button
                size='small'
                status='danger'
                onClick={() => {
                  setOpenName(null);
                  onDelete(openSkill.name);
                }}
              >
                {t('settings.library.menu.delete')}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </LibraryDrawer>
  );

  // ---- batch ----
  const selected = batch ? [...batch] : [];
  const selectedCustom = selected.filter((name) => skillByName.get(name)?.source === 'custom');
  const batchBar = batch ? (
    <LibraryBatchBar
      selected={selected.length}
      onCancel={() => setBatch(null)}
      actions={[
        {
          key: 'add',
          label: t('settings.library.batchAdd', { scope: scopeLabel }),
          onClick: () => void toggleMany(selected, true).then(() => setBatch(null)),
        },
        {
          key: 'remove',
          label: t('settings.library.batchRemove', { scope: scopeLabel }),
          onClick: () => void toggleMany(selected, false).then(() => setBatch(null)),
        },
        {
          key: 'delete',
          label: t('settings.library.batchDelete', { count: selectedCustom.length }),
          danger: true,
          disabled: selectedCustom.length === 0,
          onClick: () => onBatchDelete(selectedCustom, () => setBatch(null)),
        },
      ]}
    />
  ) : null;

  const summaryText = [
    t('settings.library.summary.active', { count: summary.active }),
    ...(projectId ? [t('settings.library.summary.fromGlobal', { count: summary.fromGlobal })] : []),
    t('settings.library.summary.kits', { count: summary.kits }),
  ].join(' · ');

  return (
    <>
      <LibraryLayout
        testId='skills-library'
        title={t('settings.skills', { defaultValue: 'Skills' })}
        description={description}
        headerActions={headerActions}
        search={{ value: query, onChange: onQuery, placeholder: t('settings.skillsHub.searchPlaceholder') }}
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
        scopeTitle={<ScopeName workspace={scopeProject?.workspace} label={scopeLabel} />}
        summary={effective.isLoading ? undefined : summaryText}
        tabs={[
          { key: 'active', label: t('settings.library.tabActive'), count: summary.active },
          { key: 'library', label: t('settings.library.tabLibrary'), count: skills.length },
        ]}
        activeTab={tab}
        onTab={(key) => {
          setTab(key as SkillsTab);
          setCategory(ALL_CATEGORY_KEY);
        }}
        tabsLabel={t('settings.library.tabsLabel')}
        sources={SKILL_SOURCE_FILTERS.map((key) => ({ key, label: t(`settings.skillsLibrary.filter.${key}`) }))}
        source={source}
        onSource={(key) => setSource(key as SkillSourceFilter)}
        sourcesLabel={t('settings.library.sourcesLabel')}
        toolbar={
          batch ? null : (
            <Button size='small' type='text' onClick={() => setBatch(new Set())} data-testid='library-batch-start'>
              {t('settings.library.select')}
            </Button>
          )
        }
        batchBar={batchBar}
        isMobile={isMobile}
      >
        {kitsError ? (
          <LibraryEmpty
            text={describeKitError(t, kitsError)}
            actionLabel={t('mcp.market.actions.retry')}
            onAction={() => void reload()}
          />
        ) : null}
        {tab === 'active' ? activePanel : libraryPanel}
      </LibraryLayout>
      {drawer}
      <KitEditModal kit={editKit} visible={editKit !== null} onClose={() => setEditKit(null)} />
    </>
  );
};

export default SkillsLibrary;

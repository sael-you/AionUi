/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { addRecentWorkspace } from '@/renderer/components/workspace/recentWorkspaces';
import { useOpenBoardKeeper } from '@/renderer/components/board/hooks/useBoardDirectory';
import AionModal from '@/renderer/components/base/AionModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
import { useRovingTree } from '@/renderer/hooks/ui/useRovingTree';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Input, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { Box, Brain, Comment, FolderClose, MoreOne, Plus, ViewGridDetail } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import ConversationChildren from './components/ConversationChildren';
import MoveUnderModal from './components/MoveUnderModal';
import KitLevelModal from '@/renderer/pages/settings/ToolsSettings/kits/KitLevelModal';
import NeedsYouBox, { RunStateAnnouncer, type NeedsYouItem } from './components/NeedsYouBox';
import ProjectGroup from './components/ProjectGroup';
import SectionHeader, { sectionGroupId } from './components/SectionHeader';
import sidebarTreeStyles from './components/SidebarTree.module.css';
import ConversationRow from './ConversationRow';
import SortableConversationRow from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { resolveBatchArchiveSelection, useConversationActions } from './hooks/useConversationActions';
import { useConversationHierarchyActions } from './hooks/useConversationHierarchyActions';
import { useConversationTreeExpansion } from './hooks/useConversationTreeExpansion';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import {
  PROJECT_COLORS,
  isProjectColorId,
  projectAccent,
  resolveProjectColor,
  useCurrentProjectIdentity,
  useProjectColors,
} from '@/renderer/components/workspace/ProjectIdentity';
import { normalizeWorkspace } from '@/renderer/utils/workspace/workspace';
import type { ConversationRowProps, TreeItemPosition, WorkspaceGroupedHistoryProps } from './types';
import {
  buildConversationTree,
  collectDescendantIds,
  computeConversationRollup,
  findAncestorIds,
  type ConversationTreeNode,
} from './utils/conversationTree';
import { buildTreesByRoot } from './utils/conversationTreeIndex';
import { filterConversations, filterProjectGroup, normalizeSidebarQuery } from './utils/sidebarFilter';
import {
  conversationRunState,
  isOutcomeSeen,
  isRestartWaiting,
  readLastOutcome,
  type RunState,
} from '@/renderer/pages/conversation/components/orchestration/runState';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
  afterPinnedContent,
  filterQuery,
  projectActions,
  conversationBadge,
  isProjectLeadConversation,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openBoardKeeper = useOpenBoardKeeper();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { theme } = useThemeContext();
  const { overrides: projectColorOverrides, setProjectColor } = useProjectColors();
  /** Accent of a project (user choice or automatic), for the active theme. */
  const projectAccentOf = useCallback(
    (workspace: string) =>
      projectAccent(resolveProjectColor(normalizeWorkspace(workspace), projectColorOverrides), theme),
    [projectColorOverrides, theme]
  );
  // The project shown in the main area: its group is highlighted with the same accent.
  const currentProjectWorkspace = useCurrentProjectIdentity()?.workspace ?? null;
  const filterQueryNormalized = normalizeSidebarQuery(filterQuery);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const rovingTree = useRovingTree(treeRef);
  // Which project's menu is open (keeps its actions visible while open).
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);
  // Project whose Kits modal is open (C27).
  const [kitsProject, setKitsProject] = useState<{ projectId: string; name: string } | null>(null);
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();

  const {
    conversations,
    isConversationGenerating,
    isConversationWaitingConfirmation,
    hasCompletionUnread,
    hasBackgroundActive,
    outcomeSeenAt,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    expandedWorkspaces,
    pinnedConversations,
    timelineSections,
    descendantsByRoot,
    handleToggleWorkspace,
    collapsedSections,
    toggleSection,
  } = useConversations();

  /** One status language (C21): the state every row, chip, project and the Needs-you box show. */
  const runStateOf = useCallback(
    (conversation: TChatConversation): RunState =>
      conversationRunState({
        // A turn a restart interrupted waits for Continue just like a pending approval (TASK-44).
        waiting: isConversationWaitingConfirmation(conversation.id) || isRestartWaiting(conversation.extra),
        generating: isConversationGenerating(conversation.id),
        backgroundActive: hasBackgroundActive(conversation.id),
        doneUnread: hasCompletionUnread(conversation.id),
        notStarted: conversation.status === 'pending',
        lastOutcome: readLastOutcome(conversation.extra),
        outcomeSeen: isOutcomeSeen(conversation.extra, outcomeSeenAt(conversation.id)),
      }),
    [
      hasBackgroundActive,
      hasCompletionUnread,
      isConversationGenerating,
      isConversationWaitingConfirmation,
      outcomeSeenAt,
    ]
  );

  // --- Hierarchy (sub-conversations) ---
  const treeExpansion = useConversationTreeExpansion();
  const { isExpanded: isTreeExpanded, toggle: toggleTreeNode, expand: expandTreeNodes } = treeExpansion;

  // Every root conversation (pinned + unpinned), in display order.
  const allRoots = useMemo(() => {
    const roots: TChatConversation[] = [...pinnedConversations];
    for (const section of timelineSections) {
      for (const item of section.items) {
        if (item.type === 'conversation' && item.conversation) roots.push(item.conversation);
        else if (item.type === 'workspace' && item.workspaceGroup) roots.push(...item.workspaceGroup.conversations);
      }
    }
    return roots;
  }, [pinnedConversations, timelineSections]);

  // Trees only for roots that have descendants (the common case stays empty).
  const treesByRoot = useMemo(() => buildTreesByRoot(allRoots, descendantsByRoot), [allRoots, descendantsByRoot]);

  // Lookup for any node (root or descendant) → its tree node, parent and descendants.
  const hierarchyIndex = useMemo(() => {
    const nodeById = new Map<string, ConversationTreeNode>();
    const parentById = new Map<string, string>();
    const visit = (node: ConversationTreeNode, parentId?: string) => {
      nodeById.set(node.conversation.id, node);
      if (parentId) parentById.set(node.conversation.id, parentId);
      node.children.forEach((child) => visit(child, node.conversation.id));
    };
    treesByRoot.forEach((tree) => visit(tree));
    return { nodeById, parentById };
  }, [treesByRoot]);

  const hierarchyLookup = useMemo(
    () => ({
      getParentId: (conversationId: string) => hierarchyIndex.parentById.get(conversationId),
      getDescendantIds: (conversationId: string) => {
        const node = hierarchyIndex.nodeById.get(conversationId);
        return node ? collectDescendantIds(node) : [];
      },
    }),
    [hierarchyIndex]
  );

  // Auto-expand the branch containing the active conversation (once per id).
  const revealedBranchRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!id) {
      revealedBranchRef.current = null;
      return;
    }
    if (revealedBranchRef.current === id) return;
    for (const tree of treesByRoot.values()) {
      const ancestors = findAncestorIds(tree, id);
      if (ancestors.length > 0) {
        revealedBranchRef.current = id;
        expandTreeNodes(ancestors);
        return;
      }
    }
  }, [id, treesByRoot, expandTreeNodes]);

  // Batch selection / select-all stays root-only: sub-conversations ride with their parent.
  const batchConversations = useMemo(() => {
    const childIds = new Set<string>();
    descendantsByRoot.forEach((list) => list.forEach((c) => childIds.add(c.id)));
    return childIds.size === 0 ? conversations : conversations.filter((c) => !childIds.has(c.id));
  }, [conversations, descendantsByRoot]);

  // While filtering every section and project with a match is shown open.
  const filtering = filterQueryNormalized.length > 0;
  const isSectionExpanded = useCallback(
    (sectionKey: string) => filtering || !collapsedSections.has(sectionKey),
    [collapsedSections, filtering]
  );
  // A plain render function (not a component) so a header keeps its DOM node,
  // and its keyboard focus, when its section toggles.
  const renderSectionLabel = (sectionKey: string, label: string, count?: number, trailing?: React.ReactNode) => (
    <SectionHeader
      sectionKey={sectionKey}
      label={label}
      count={count}
      expanded={isSectionExpanded(sectionKey)}
      onToggle={() => toggleSection(sectionKey)}
      trailing={trailing}
      groupId={sectionGroupId(sectionKey)}
    />
  );
  /** The group of a section's rows, owned by its header (no header, no group, in the icon rail). */
  const sectionGroupProps = (sectionKey: string) =>
    collapsed ? {} : { id: sectionGroupId(sectionKey), role: 'group' as const };

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, batchConversations);

  // Selecting a parent implies its subtree, so the shown count includes descendants.
  const effectiveSelectedCount = useMemo(
    () =>
      batchMode ? resolveBatchArchiveSelection(selectedConversationIds, hierarchyLookup).totalCount : selectedCount,
    [batchMode, hierarchyLookup, selectedConversationIds, selectedCount]
  );

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleArchive,
    handleBatchArchive,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleToggleManualUnread,
    handleCreateCronTask,
    handleArchiveProject,
    archiveProjectTarget,
    archiveProjectLoading,
    handleArchiveProjectCancel,
    handleArchiveProjectConfirm,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
    markManualUnread,
    clearManualUnread,
    isManualUnread,
    hierarchy: hierarchyLookup,
  });

  const {
    handleCreateChild,
    handleDetach,
    moveTarget,
    moveLoading,
    handleMoveUnderStart,
    handleMoveUnderCancel,
    handleMoveUnderConfirm,
  } = useConversationHierarchyActions({
    expand: expandTreeNodes,
    onBeforeNavigate: () => handleMenuVisibleChange('', false),
    onSessionClick,
  });

  // Tree nodes for the move-under picker: every root, including childless ones.
  const moveRootNodes = useMemo(
    () => (moveTarget ? allRoots.map((root) => treesByRoot.get(root.id) ?? buildConversationTree(root)) : []),
    [allRoots, moveTarget, treesByRoot]
  );

  const { sensors, handleDragEnd, isDragEnabled } = useDragAndDrop({
    pinnedConversations,
    batchMode,
    collapsed,
  });

  // Fork-lineage badge support: resolve a parent conversation's display name
  // from the already-loaded sidebar list (no extra fetch; unresolved = the
  // parent was deleted or not loaded → the badge falls back to a generic tip).
  const conversationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conversation of conversations) {
      map.set(conversation.id, conversation.name);
    }
    return map;
  }, [conversations]);
  const resolveConversationName = useCallback(
    (conversationId: string) => conversationNameById.get(conversationId),
    [conversationNameById]
  );

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      isWaitingConfirmation: isConversationWaitingConfirmation(conversation.id),
      hasUnread: hasCompletionUnread(conversation.id) || isManualUnread(conversation.id),
      runState: runStateOf(conversation),
      isManualUnread: isManualUnread(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId !== null && dropdownVisibleId === conversation.id,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onCreateCronTask: handleCreateCronTask,
      onArchive: handleArchive,
      onTogglePin: handleTogglePin,
      onToggleManualUnread: handleToggleManualUnread,
      getJobStatus,
      resolveConversationName,
      onCreateChild: handleCreateChild,
      onDetach: handleDetach,
      onMoveUnder: handleMoveUnderStart,
    }),
    [
      handleCreateChild,
      handleDetach,
      handleMoveUnderStart,
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      isConversationWaitingConfirmation,
      hasCompletionUnread,
      runStateOf,
      isManualUnread,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleCreateCronTask,
      handleArchive,
      handleTogglePin,
      handleToggleManualUnread,
      getJobStatus,
      resolveConversationName,
    ]
  );

  // Row props for a node of the hierarchy (depth, rollup, expand toggle, connectors).
  const getTreeRowProps = (
    node: ConversationTreeNode,
    position: { posinset?: number; setsize?: number } = {}
  ): ConversationRowProps => {
    const base = {
      ...getConversationRowProps(node.conversation),
      treePosition:
        position.posinset !== undefined && position.setsize !== undefined
          ? { posinset: position.posinset, setsize: position.setsize }
          : undefined,
    };
    if (node.children.length === 0 && node.depth === 0) return base;
    const descendantCount = collectDescendantIds(node).length;
    const expanded = filtering || isTreeExpanded(node.conversation.id);
    return {
      ...base,
      depth: node.depth,
      descendantCount,
      treeInfo:
        node.children.length > 0
          ? {
              expanded,
              childCount: node.children.length,
              rollup: computeConversationRollup(node, runStateOf),
              onToggle: () => toggleTreeNode(node.conversation.id),
            }
          : undefined,
    };
  };

  // Render a root row; when it has sub-conversations, wrap it with its (expandable)
  // subtree. `treeLevel` is the row's level in the sidebar tree (2 under a
  // section, 3 inside a project); sub-conversations add their depth.
  const renderConversationRow = (
    conversation: TChatConversation,
    treeLevel: number,
    sortable: boolean,
    treePosition?: TreeItemPosition
  ) => {
    const badge = conversationBadge?.(conversation);
    const tree = treesByRoot.get(conversation.id);
    if (!tree) {
      const rowProps = { ...getConversationRowProps(conversation), treeLevel, badge, treePosition };
      return sortable ? (
        <SortableConversationRow key={conversation.id} {...rowProps} />
      ) : (
        <ConversationRow key={conversation.id} {...rowProps} />
      );
    }
    const rootProps = { ...getTreeRowProps(tree), treeLevel, badge, treePosition };
    const showChildren = !collapsed && (filtering || isTreeExpanded(conversation.id));
    return (
      <div key={conversation.id} className='min-w-0'>
        {sortable ? <SortableConversationRow {...rootProps} /> : <ConversationRow {...rootProps} />}
        {showChildren && (
          <ConversationChildren
            nodes={tree.children}
            isExpanded={(conversationId) => filtering || isTreeExpanded(conversationId)}
            renderRow={(node, position) => (
              <ConversationRow
                key={node.conversation.id}
                {...getTreeRowProps(node, position)}
                treeLevel={treeLevel}
                badge={conversationBadge?.(node.conversation)}
              />
            )}
          />
        )}
      </div>
    );
  };

  const renderConversation = (conversation: TChatConversation, treeLevel = 2, treePosition?: TreeItemPosition) =>
    renderConversationRow(conversation, treeLevel, false, treePosition);

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  // Codex-style split: project folders (workspaces) on top, free conversations below.
  // Projects section: collect all workspace groups across timeline sections, ordered by recency.
  const projectGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: Array<{
      workspace: string;
      displayName: string;
      conversations: TChatConversation[];
      /** Backend project id: known for listed projects, else carried by the group's conversations. */
      projectId: string | null;
    }> = [];
    for (const section of timelineSections) {
      for (const item of section.items) {
        if (item.type === 'workspace' && item.workspaceGroup && !seen.has(item.workspaceGroup.workspace)) {
          seen.add(item.workspaceGroup.workspace);
          groups.push({
            workspace: item.workspaceGroup.workspace,
            displayName: item.workspaceGroup.display_name,
            conversations: item.workspaceGroup.conversations,
            projectId:
              item.workspaceGroup.project_id ??
              item.workspaceGroup.conversations.find((conversation) => conversation.project_id)?.project_id ??
              null,
          });
        }
      }
    }
    return groups;
  }, [timelineSections]);

  // Conversations section: keep timeline grouping (today/yesterday/...) but only show non-workspace conversations.
  const conversationOnlySections = useMemo(
    () =>
      timelineSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => item.type === 'conversation' && item.conversation),
        }))
        .filter((section) => section.items.length > 0),
    [timelineSections]
  );

  // --- Name filter (sidebar filter field) ---
  const descendantsOf = useCallback(
    (conversationId: string) => descendantsByRoot.get(conversationId),
    [descendantsByRoot]
  );
  const visiblePinned = useMemo(
    () => filterConversations(pinnedConversations, filterQueryNormalized, descendantsOf),
    [descendantsOf, filterQueryNormalized, pinnedConversations]
  );
  const visibleProjectGroups = useMemo(
    () =>
      projectGroups
        .map((group) => {
          const shown = filterProjectGroup(group, filterQueryNormalized, descendantsOf);
          // `shown.conversations` is only what the filter lets through; `source`
          // is the whole project, used for its count, its status and every
          // project action (archive, colour, board, bulk actions).
          return shown ? { ...shown, source: group } : null;
        })
        .filter((group): group is NonNullable<typeof group> => group !== null),
    [descendantsOf, filterQueryNormalized, projectGroups]
  );
  const visibleConversationSections = useMemo(
    () =>
      conversationOnlySections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) =>
              item.conversation &&
              filterConversations([item.conversation], filterQueryNormalized, descendantsOf).length > 0
          ),
        }))
        .filter((section) => section.items.length > 0),
    [conversationOnlySections, descendantsOf, filterQueryNormalized]
  );
  // Position of every loose conversation across the timeline sub-sections (one tree set).
  const looseConversationIndex = useMemo(() => {
    const index = new Map<string, number>();
    for (const section of visibleConversationSections) {
      for (const item of section.items) {
        if (item.type === 'conversation' && item.conversation) index.set(item.conversation.id, index.size);
      }
    }
    return index;
  }, [visibleConversationSections]);
  const hasFilterResults =
    visiblePinned.length > 0 || visibleProjectGroups.length > 0 || visibleConversationSections.length > 0;

  /** Running / needs-you over a project's conversations and their sub-conversations. */
  const projectStatusOf = (projectConversations: readonly TChatConversation[]) => {
    let running = false;
    let needsYou = 0;
    let failed = 0;
    for (const root of projectConversations) {
      for (const conversation of [root, ...(descendantsByRoot.get(root.id) ?? [])]) {
        const state = runStateOf(conversation);
        if (state === 'waiting') needsYou += 1;
        else if (state === 'failed') failed += 1;
        else if (state === 'running') running = true;
      }
    }
    return { running, needsYou, failed };
  };

  /** Lead conversations (e.g. the Board Keeper) first, then newest first as grouped. */
  const orderProjectConversations = (projectConversations: readonly TChatConversation[]) =>
    isProjectLeadConversation
      ? [
          ...projectConversations.filter((conversation) => isProjectLeadConversation(conversation)),
          ...projectConversations.filter((conversation) => !isProjectLeadConversation(conversation)),
        ]
      : [...projectConversations];

  /** "+" in the Projects header: pick a folder, then start a conversation in it (a new project). */
  const handleAddProject = async () => {
    try {
      const folders = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      const folder = folders?.[0];
      if (!folder) return;
      addRecentWorkspace(folder);
      void navigate('/guid', { state: { workspace: folder } });
      onSessionClick?.();
    } catch (error) {
      console.error('[sidebar] could not open the folder picker:', error);
    }
  };

  // --- Cross-project attention (C21): the Needs-you box and the live announcer ---
  const runStates = useMemo(() => {
    const map = new Map<string, { state: RunState; name: string }>();
    for (const conversation of conversations) {
      map.set(conversation.id, { state: runStateOf(conversation), name: conversation.name });
    }
    return map;
  }, [conversations, runStateOf]);
  const attention = useMemo(() => {
    const projectNameById = new Map<string, string>();
    for (const group of projectGroups) {
      for (const root of group.conversations) {
        for (const conversation of [root, ...(descendantsByRoot.get(root.id) ?? [])]) {
          projectNameById.set(conversation.id, group.displayName);
        }
      }
    }
    const waiting: NeedsYouItem[] = [];
    const failed: NeedsYouItem[] = [];
    const running: TChatConversation[] = [];
    const byRecent = (a: TChatConversation, b: TChatConversation) => (b.modified_at ?? 0) - (a.modified_at ?? 0);
    for (const conversation of [...conversations].toSorted(byRecent)) {
      const state = runStates.get(conversation.id)?.state;
      const where = projectNameById.get(conversation.id);
      if (state === 'waiting') {
        waiting.push({ conversation, state, where, restartInterrupted: isRestartWaiting(conversation.extra) });
      } else if (state === 'failed') failed.push({ conversation, state, where });
      else if (state === 'running') running.push(conversation);
    }
    return { items: [...waiting, ...failed], running };
  }, [conversations, descendantsByRoot, projectGroups, runStates]);

  const hasHistory = timelineSections.length > 0 || pinnedConversations.length > 0;
  // Tree levels: section headers are level 1. In the icon rail (collapsed
  // sidebar) there are no section or project headers, so rows are level 1.
  const sectionRowLevel = collapsed ? 1 : 2;
  const projectRowLevel = collapsed ? 1 : 3;

  return (
    <>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <KitLevelModal
        target={kitsProject ? { level: 'project', ...kitsProject } : null}
        onClose={() => setKitsProject(null)}
      />

      <MoveUnderModal
        target={moveTarget}
        targetNode={
          moveTarget ? (hierarchyIndex.nodeById.get(moveTarget.id) ?? buildConversationTree(moveTarget)) : null
        }
        rootNodes={moveRootNodes}
        loading={moveLoading}
        onCancel={handleMoveUnderCancel}
        onConfirm={(parentId) => void handleMoveUnderConfirm(parentId)}
      />

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px pt-2px sticky top-0 z-20 bg-[var(--bg-2)]'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>
              {t('conversation.history.selectedCount', { count: effectiveSelectedCount })}
            </div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleToggleSelectAll}
              >
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='primary'
                onClick={handleBatchArchive}
              >
                {t('conversation.history.batchArchive')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 归档项目确认弹窗 — 使用项目自家 AionModal + 圆角线框按钮（归档为非危险态，用主色） */}
      <AionModal
        visible={archiveProjectTarget !== null}
        style={{ width: '400px' }}
        header={{
          title: t('conversation.history.archiveProjectTitle'),
          showClose: true,
          style: { borderBottom: 'none' },
        }}
        onCancel={handleArchiveProjectCancel}
        footer={
          <div className='flex justify-end gap-12px pt-16px'>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
                cursor: archiveProjectLoading ? 'not-allowed' : 'pointer',
                opacity: archiveProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!archiveProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                if (!archiveProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={handleArchiveProjectCancel}
              disabled={archiveProjectLoading}
            >
              {t('common.cancel')}
            </button>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid rgb(var(--primary-6))',
                backgroundColor: 'transparent',
                color: 'rgb(var(--primary-6))',
                cursor: archiveProjectLoading ? 'not-allowed' : 'pointer',
                opacity: archiveProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!archiveProjectLoading) {
                  event.currentTarget.style.backgroundColor = 'rgba(var(--primary-6), 0.08)';
                }
              }}
              onMouseLeave={(event) => {
                if (!archiveProjectLoading) event.currentTarget.style.backgroundColor = 'transparent';
              }}
              onClick={() => void handleArchiveProjectConfirm()}
              disabled={archiveProjectLoading}
            >
              {archiveProjectLoading ? t('conversation.history.archiving') : t('conversation.history.archiveProject')}
            </button>
          </div>
        }
      >
        <div className='text-14px leading-22px text-t-secondary'>
          {t('conversation.history.archiveProjectConfirm', {
            name: archiveProjectTarget?.name ?? '',
            count: archiveProjectTarget?.conversations.length ?? 0,
          })}
        </div>
      </AionModal>

      {/* Cross-project "Needs you" (C21): only while something waits or failed. */}
      {!collapsed && !batchMode && !filtering && (
        <NeedsYouBox
          items={attention.items}
          runningCount={attention.running.length}
          onOpen={handleConversationClick}
          onShowRunning={() => {
            const first = attention.running[0];
            if (first) handleConversationClick(first);
          }}
        />
      )}
      {/* The sidebar tree (WAI-ARIA tree, roving tabindex): sections → teams /
          projects → conversations → sub-conversations. */}
      <div
        ref={treeRef}
        role='tree'
        aria-label={t('conversation.sidebar.treeLabel')}
        data-testid='sider-tree'
        onKeyDown={rovingTree.onKeyDown}
        onFocus={rovingTree.onFocus}
      >
        {/* L1: Pinned section */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          {visiblePinned.length > 0 && (
            <div className='min-w-0'>
              {!collapsed && renderSectionLabel('pinned', t('conversation.history.pinnedSection'))}
              {(collapsed || isSectionExpanded('pinned')) && (
                <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                  <div className='min-w-0' {...sectionGroupProps('pinned')}>
                    {visiblePinned.map((conversation, index) =>
                      renderConversationRow(conversation, sectionRowLevel, isDragEnabled && !filtering, {
                        posinset: index + 1,
                        setsize: visiblePinned.length,
                      })
                    )}
                  </div>
                </SortableContext>
              )}
            </div>
          )}
        </DndContext>

        {/* Slot filled by the Sider (Teams), after Pinned and before Projects. */}
        {afterPinnedContent}

        {/* L1: Projects section — the hierarchy anchors, peer to conversations */}
        {/* Shown even without projects, so its "+" can add the first one. */}
        {(visibleProjectGroups.length > 0 || (!filtering && !collapsed)) && (
          <div className='min-w-0'>
            {!collapsed &&
              renderSectionLabel(
                'projects',
                t('conversation.history.projectsSection'),
                projectGroups.length,
                <Tooltip content={t('conversation.sidebar.project.add')} position='top'>
                  <Button
                    type='text'
                    size='mini'
                    className={sidebarTreeStyles.actionButton}
                    icon={<Plus theme='outline' size='14' fill='currentColor' />}
                    aria-label={t('conversation.sidebar.project.add')}
                    data-testid='projects-add'
                    onClick={() => void handleAddProject()}
                  />
                </Tooltip>
              )}
            {(collapsed || isSectionExpanded('projects')) && (
              <div className='min-w-0' {...sectionGroupProps('projects')}>
                {visibleProjectGroups.map((group, projectIndex) => {
                  const accent = projectAccentOf(group.workspace);
                  const colorKey = normalizeWorkspace(group.workspace);
                  const chosenColor = projectColorOverrides[colorKey];
                  const isCurrentProject = colorKey === currentProjectWorkspace;
                  const startConversation = (): void => {
                    void navigate('/guid', { state: { workspace: group.workspace } });
                    onSessionClick?.();
                  };
                  const status = projectStatusOf(group.source.conversations);
                  const projectMenu = (
                    <Menu
                      onClickMenuItem={(key) => {
                        if (key === 'new') {
                          startConversation();
                        } else if (key === 'board' && group.source.projectId) {
                          void navigate(`/board/${encodeURIComponent(group.source.projectId)}`);
                          onSessionClick?.();
                        } else if (key === 'memory' && group.source.projectId) {
                          void navigate(`/memory/${encodeURIComponent(group.source.projectId)}`);
                          onSessionClick?.();
                        } else if (key === 'keeper' && group.source.projectId) {
                          void openBoardKeeper(group.source.projectId);
                          onSessionClick?.();
                        } else if (key === 'kits' && group.source.projectId) {
                          setKitsProject({ projectId: group.source.projectId, name: group.displayName });
                        } else if (key === 'archive') {
                          handleArchiveProject(group.displayName, group.source.conversations);
                        } else if (key === 'color:auto') {
                          setProjectColor(colorKey, null);
                        } else if (key.startsWith('color:')) {
                          const colorId = key.slice('color:'.length);
                          if (isProjectColorId(colorId)) setProjectColor(colorKey, colorId);
                        }
                      }}
                    >
                      <Menu.Item key='new'>
                        <span className='flex items-center gap-8px'>
                          <Plus theme='outline' size='14' />
                          {t('conversation.history.newConversationInProject')}
                        </span>
                      </Menu.Item>
                      {/* The project board (D40). Also the keyboard path: row buttons are out of the Tab order. */}
                      <Menu.Item key='board' disabled={!group.source.projectId}>
                        <span className='flex items-center gap-8px'>
                          <ViewGridDetail theme='outline' size='14' />
                          {t('board.openBoard')}
                        </span>
                      </Menu.Item>
                      {/* Claude memory review of the project (C29). */}
                      <Menu.Item key='memory' disabled={!group.source.projectId}>
                        <span className='flex items-center gap-8px'>
                          <Brain theme='outline' size='14' />
                          {t('memory.openMemory')}
                        </span>
                      </Menu.Item>
                      <Menu.Item key='keeper' disabled={!group.source.projectId}>
                        <span className='flex items-center gap-8px'>
                          <Comment theme='outline' size='14' />
                          {t('board.keeper.talk')}
                        </span>
                      </Menu.Item>
                      <Menu.Item key='kits' disabled={!group.source.projectId}>
                        <span className='flex items-center gap-8px'>
                          <Box theme='outline' size='14' />
                          {t('mcp.kits.projectMenu')}
                        </span>
                      </Menu.Item>
                      <Menu.SubMenu
                        key='color'
                        title={
                          <span className='flex items-center gap-8px'>
                            <span className='size-10px rd-full shrink-0' style={{ background: accent }} />
                            {t('conversation.history.projectColor')}
                          </span>
                        }
                      >
                        <Menu.Item key='color:auto'>
                          <span className='flex items-center gap-8px'>
                            <span className='size-10px rd-full shrink-0 border border-solid border-[var(--color-border-3)]' />
                            {t('conversation.history.projectColorAuto')}
                            {!chosenColor && <span className='ms-auto text-t-secondary'>✓</span>}
                          </span>
                        </Menu.Item>
                        {PROJECT_COLORS.map((color) => (
                          <Menu.Item key={`color:${color.id}`}>
                            <span className='flex items-center gap-8px'>
                              <span
                                className='size-10px rd-full shrink-0'
                                style={{ background: projectAccent(color, theme) }}
                              />
                              {t(`conversation.history.projectColors.${color.id}`)}
                              {chosenColor === color.id && <span className='ms-auto text-t-secondary'>✓</span>}
                            </span>
                          </Menu.Item>
                        ))}
                      </Menu.SubMenu>
                      {/* A folder with no visible conversation has nothing to archive here. */}
                      <Menu.Item key='archive' disabled={group.source.conversations.length === 0}>
                        <span className='flex items-center gap-8px'>
                          <FolderClose theme='outline' size='14' />
                          {t('conversation.history.archiveProject')}
                        </span>
                      </Menu.Item>
                    </Menu>
                  );
                  const menuOpen = openProjectMenu === group.workspace;
                  const actions = (
                    <>
                      {/* Slot for project-level actions supplied by the Sider (e.g. the Board button). */}
                      {projectActions?.({
                        workspace: group.workspace,
                        name: group.displayName,
                        projectId: group.source.projectId,
                        buttonClassName: classNames(sidebarTreeStyles.actionButton, 'sider-action-btn'),
                      })}
                      {!isMobile && (
                        <Tooltip content={t('conversation.history.newConversationInProject')} position='top'>
                          {/* Pointer shortcut; keyboard users get the same action in the menu. */}
                          <Button
                            type='text'
                            size='mini'
                            tabIndex={-1}
                            aria-label={t('conversation.history.newConversationInProject')}
                            className={classNames(sidebarTreeStyles.actionButton, 'sider-action-btn')}
                            data-testid={`project-new-conversation-${group.workspace}`}
                            icon={<Plus theme='outline' size='14' fill='currentColor' />}
                            onClick={startConversation}
                          />
                        </Tooltip>
                      )}
                      <Dropdown
                        droplist={projectMenu}
                        trigger='click'
                        position='br'
                        popupVisible={menuOpen}
                        onVisibleChange={(visible) => setOpenProjectMenu(visible ? group.workspace : null)}
                        getPopupContainer={() => document.body}
                        unmountOnExit={false}
                      >
                        {/* Keyboard: Shift+F10 / the context-menu key on the project row opens it. */}
                        <Button
                          type='text'
                          size='mini'
                          tabIndex={-1}
                          aria-label={t('conversation.sidebar.project.actions', { name: group.displayName })}
                          aria-haspopup='menu'
                          aria-expanded={menuOpen}
                          data-project-menu-trigger=''
                          data-testid={`project-menu-${group.workspace}`}
                          className={classNames(sidebarTreeStyles.actionButton, 'sider-action-btn')}
                          icon={<MoreOne theme='outline' size='14' fill='currentColor' />}
                        />
                      </Dropdown>
                    </>
                  );
                  const ordered = orderProjectConversations(group.conversations);
                  const rows = ordered.map((conversation, index) =>
                    renderConversation(conversation, projectRowLevel, { posinset: index + 1, setsize: ordered.length })
                  );
                  return (
                    <ProjectGroup
                      key={group.workspace}
                      workspace={group.workspace}
                      name={group.displayName}
                      expanded={filtering || expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => handleToggleWorkspace(group.workspace)}
                      active={isCurrentProject}
                      count={group.source.conversations.length}
                      running={status.running}
                      needsYou={status.needsYou}
                      failed={status.failed}
                      actions={actions}
                      actionsVisible={isMobile || menuOpen}
                      onStartConversation={startConversation}
                      siderCollapsed={collapsed}
                      level={2}
                      treePosition={{ posinset: projectIndex + 1, setsize: visibleProjectGroups.length }}
                    >
                      {rows}
                    </ProjectGroup>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* L1: Conversations section — peer to projects, internally split by timeline */}
        {visibleConversationSections.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && renderSectionLabel('conversations', t('conversation.history.conversationsSection'))}
            {(collapsed || isSectionExpanded('conversations')) && (
              <div className='min-w-0' {...sectionGroupProps('conversations')}>
                {visibleConversationSections.map((section) => (
                  <div key={section.timeline} className='min-w-0'>
                    {!collapsed && visibleConversationSections.length > 1 && (
                      <div className='flex items-center ps-8px h-24px select-none' aria-hidden='true'>
                        <span className='text-11px text-t-tertiary font-[500] leading-none'>{section.timeline}</span>
                      </div>
                    )}
                    {section.items.map((item) =>
                      item.type === 'conversation' && item.conversation
                        ? renderConversation(item.conversation, sectionRowLevel, {
                            posinset: (looseConversationIndex.get(item.conversation.id) ?? 0) + 1,
                            setsize: looseConversationIndex.size,
                          })
                        : null
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <RunStateAnnouncer states={runStates} />
      {!hasHistory && !collapsed && (
        <div className='px-8px py-12px text-12px leading-18px text-t-tertiary' role='status'>
          {t('conversation.history.noHistory')}
        </div>
      )}
      {filtering && hasHistory && !hasFilterResults && (
        <div className='px-8px py-16px text-12px text-t-tertiary text-center' role='status'>
          {t('conversation.sidebar.filter.noResults')}
        </div>
      )}
    </>
  );
};

export default WorkspaceGroupedHistory;

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { addRecentWorkspace } from '@/renderer/components/workspace/recentWorkspaces';
import AionModal from '@/renderer/components/base/AionModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Input, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { FolderClose, MoreOne, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import ConversationChildren from './components/ConversationChildren';
import MoveUnderModal from './components/MoveUnderModal';
import ProjectGroup from './components/ProjectGroup';
import SectionHeader from './components/SectionHeader';
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
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';
import {
  buildConversationTree,
  collectDescendantIds,
  computeConversationRollup,
  findAncestorIds,
  type ConversationTreeNode,
} from './utils/conversationTree';
import { buildTreesByRoot } from './utils/conversationTreeIndex';
import { filterConversations, filterProjectGroup, normalizeSidebarQuery } from './utils/sidebarFilter';

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
  // Which project's menu is open (keeps its actions visible while open).
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();

  const {
    conversations,
    isConversationGenerating,
    isConversationWaitingConfirmation,
    hasCompletionUnread,
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
    />
  );

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

  // Row props for a node of the hierarchy (depth, rollup, expand toggle).
  const getTreeRowProps = (node: ConversationTreeNode): ConversationRowProps => {
    const base = getConversationRowProps(node.conversation);
    if (node.children.length === 0 && node.depth === 0) return base;
    const descendantCount = collectDescendantIds(node).length;
    return {
      ...base,
      depth: node.depth,
      descendantCount,
      treeInfo:
        node.children.length > 0
          ? {
              expanded: isTreeExpanded(node.conversation.id),
              childCount: node.children.length,
              rollup: computeConversationRollup(node, {
                isRunning: (c) => isConversationGenerating(c.id),
                pendingConfirmations: (c) =>
                  c.runtime?.pending_confirmations ?? (isConversationWaitingConfirmation(c.id) ? 1 : 0),
              }),
              onToggle: () => toggleTreeNode(node.conversation.id),
            }
          : undefined,
    };
  };

  // Render a root row; when it has sub-conversations, wrap it with its (expandable)
  // subtree. `treeLevel` is the row's level in the sidebar tree (2 under a
  // section, 3 inside a project); sub-conversations add their depth.
  const renderConversationRow = (conversation: TChatConversation, treeLevel: number, sortable: boolean) => {
    const badge = conversationBadge?.(conversation);
    const tree = treesByRoot.get(conversation.id);
    if (!tree) {
      const rowProps = { ...getConversationRowProps(conversation), treeLevel, badge };
      return sortable ? (
        <SortableConversationRow key={conversation.id} {...rowProps} />
      ) : (
        <ConversationRow key={conversation.id} {...rowProps} />
      );
    }
    const rootProps = { ...getTreeRowProps(tree), treeLevel, badge };
    const showChildren = !collapsed && (filtering || isTreeExpanded(conversation.id));
    return (
      <div key={conversation.id} className='min-w-0'>
        {sortable ? <SortableConversationRow {...rootProps} /> : <ConversationRow {...rootProps} />}
        {showChildren && (
          <ConversationChildren
            nodes={tree.children}
            isExpanded={(conversationId) => filtering || isTreeExpanded(conversationId)}
            renderRow={(node) => (
              <ConversationRow
                key={node.conversation.id}
                {...getTreeRowProps(node)}
                treeLevel={treeLevel}
                badge={conversationBadge?.(node.conversation)}
              />
            )}
          />
        )}
      </div>
    );
  };

  const renderConversation = (conversation: TChatConversation, treeLevel = 2) =>
    renderConversationRow(conversation, treeLevel, false);

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
    }> = [];
    for (const section of timelineSections) {
      for (const item of section.items) {
        if (item.type === 'workspace' && item.workspaceGroup && !seen.has(item.workspaceGroup.workspace)) {
          seen.add(item.workspaceGroup.workspace);
          groups.push({
            workspace: item.workspaceGroup.workspace,
            displayName: item.workspaceGroup.display_name,
            conversations: item.workspaceGroup.conversations,
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
          // The count stays the project's own, also while filtering.
          return shown ? { ...shown, totalCount: group.conversations.length } : null;
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
  const hasFilterResults =
    visiblePinned.length > 0 || visibleProjectGroups.length > 0 || visibleConversationSections.length > 0;

  /** Running / needs-you over a project's conversations and their sub-conversations. */
  const projectStatusOf = (projectConversations: readonly TChatConversation[]) => {
    let running = false;
    let needsYou = 0;
    for (const root of projectConversations) {
      for (const conversation of [root, ...(descendantsByRoot.get(root.id) ?? [])]) {
        if (isConversationWaitingConfirmation(conversation.id)) needsYou += 1;
        else if (isConversationGenerating(conversation.id)) running = true;
      }
    }
    return { running, needsYou };
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

  if (timelineSections.length === 0 && pinnedConversations.length === 0) {
    return (
      <>
        {afterPinnedContent}
        {!collapsed && (
          <div className='px-8px py-12px text-12px leading-18px text-t-tertiary' role='status'>
            {t('conversation.history.noHistory')}
          </div>
        )}
      </>
    );
  }

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

      <div>
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
                  <div className='min-w-0' role='group'>
                    {visiblePinned.map((conversation) =>
                      renderConversationRow(conversation, 2, isDragEnabled && !filtering)
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
        {visibleProjectGroups.length > 0 && (
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
              <div className='min-w-0' role='group'>
                {visibleProjectGroups.map((group) => {
                  const accent = projectAccentOf(group.workspace);
                  const colorKey = normalizeWorkspace(group.workspace);
                  const chosenColor = projectColorOverrides[colorKey];
                  const isCurrentProject = colorKey === currentProjectWorkspace;
                  const startConversation = (): void => {
                    void navigate('/guid', { state: { workspace: group.workspace } });
                    onSessionClick?.();
                  };
                  const status = projectStatusOf(group.conversations);
                  const projectMenu = (
                    <Menu
                      onClickMenuItem={(key) => {
                        if (key === 'new') {
                          startConversation();
                        } else if (key === 'archive') {
                          handleArchiveProject(group.displayName, group.conversations);
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
                      <Menu.Item key='archive' disabled={group.conversations.length === 0}>
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
                      {projectActions?.({ workspace: group.workspace, name: group.displayName })}
                      {!isMobile && (
                        <Tooltip content={t('conversation.history.newConversationInProject')} position='top'>
                          <span
                            role='button'
                            tabIndex={-1}
                            aria-label={t('conversation.history.newConversationInProject')}
                            className={classNames(sidebarTreeStyles.actionButton, 'sider-action-btn')}
                            data-testid={`project-new-conversation-${group.workspace}`}
                            onClick={startConversation}
                          >
                            <Plus theme='outline' size='14' fill='currentColor' className='block leading-none' />
                          </span>
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
                        <span
                          role='button'
                          tabIndex={-1}
                          aria-label={t('conversation.sidebar.project.actions', { name: group.displayName })}
                          aria-haspopup='menu'
                          aria-expanded={menuOpen}
                          data-project-menu-trigger=''
                          data-testid={`project-menu-${group.workspace}`}
                          className={classNames(sidebarTreeStyles.actionButton, 'sider-action-btn')}
                        >
                          <MoreOne theme='outline' size='14' fill='currentColor' className='block leading-none' />
                        </span>
                      </Dropdown>
                    </>
                  );
                  const rows = orderProjectConversations(group.conversations).map((conversation) =>
                    renderConversation(conversation, 3)
                  );
                  return (
                    <ProjectGroup
                      key={group.workspace}
                      workspace={group.workspace}
                      name={group.displayName}
                      expanded={filtering || expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => handleToggleWorkspace(group.workspace)}
                      active={isCurrentProject}
                      count={group.totalCount}
                      running={status.running}
                      needsYou={status.needsYou}
                      actions={actions}
                      actionsVisible={isMobile || menuOpen}
                      onStartConversation={startConversation}
                      siderCollapsed={collapsed}
                      stickyTop={24}
                      level={2}
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
              <div className='min-w-0' role='group'>
                {visibleConversationSections.map((section) => (
                  <div key={section.timeline} className='min-w-0'>
                    {!collapsed && visibleConversationSections.length > 1 && (
                      <div className='flex items-center ps-8px h-24px select-none' aria-hidden='true'>
                        <span className='text-11px text-t-tertiary font-[500] leading-none'>{section.timeline}</span>
                      </div>
                    )}
                    {section.items.map((item) =>
                      item.type === 'conversation' && item.conversation ? renderConversation(item.conversation) : null
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {filtering && !hasFilterResults && (
          <div className='px-8px py-16px text-12px text-t-tertiary text-center' role='status'>
            {t('conversation.sidebar.filter.noResults')}
          </div>
        )}
      </div>
    </>
  );
};

export default WorkspaceGroupedHistory;

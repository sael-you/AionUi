/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { projectSurfaceClasses, useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { treeArrowIntent } from '@/renderer/hooks/ui/useRovingTree';
import { Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SidebarTree.module.css';

/**
 * A tree row that runs an action (empty-state "Start one", "Show N more"): a
 * tree item like the conversations around it, so the arrows reach it and the
 * tree holds no stray buttons. Enter / Space / click activate it.
 */
const ActionTreeItem: React.FC<{
  className: string;
  level: number;
  treeKey: string;
  testId: string;
  label?: string;
  onActivate?: () => void;
  children: React.ReactNode;
}> = ({ className, level, treeKey, testId, label, onActivate, children }) => (
  <div
    className={classNames(className, { [styles.actionItem]: Boolean(onActivate) })}
    role='treeitem'
    tabIndex={-1}
    aria-level={level}
    aria-label={label}
    data-tree-item=''
    data-tree-level={level}
    data-tree-key={treeKey}
    data-testid={testId}
    onClick={onActivate}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || !onActivate) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    }}
  >
    {children}
  </div>
);

/** Conversations shown before "Show N more". */
export const PROJECT_VISIBLE_LIMIT = 8;

export type ProjectGroupProps = {
  workspace: string;
  name: string;
  expanded: boolean;
  onToggle: () => void;
  /** Open the project page (C42): the name is its link; the rest of the row still folds. */
  onOpen?: () => void;
  /** The project shown in the main area (C8): tint + accent bar on this row. */
  active?: boolean;
  /** Root conversations in the project. */
  count: number;
  /** Any conversation of the project (or a sub-conversation) is running. */
  running?: boolean;
  /** Conversations waiting for the user (pending approvals). */
  needsYou?: number;
  /** Conversations whose last turn failed and that were not opened since. */
  failed?: number;
  /**
   * Actions slot, shown on hover / focus (always on touch): the Board button
   * (Kanban) and the project menu. Mark the menu trigger `data-project-menu-trigger`
   * so the context-menu key / Shift+F10 can open it.
   */
  actions?: React.ReactNode;
  /** Always show the actions (touch, or while a menu is open). */
  actionsVisible?: boolean;
  /** Start a conversation in this project (empty-state link). */
  onStartConversation?: () => void;
  /** Sidebar collapsed to icons: no header, rows only. */
  siderCollapsed?: boolean;
  /** Offset of the sticky header from the scroll top; defaults to below the section header (CSS). */
  stickyTop?: number;
  /** Tree level of the project row. */
  level?: number;
  /** Position among the projects (aria-posinset / aria-setsize). */
  treePosition?: { posinset: number; setsize: number };
  /** The project's conversation rows, newest first. */
  children?: React.ReactNode;
};

/**
 * A project in the sidebar: the hierarchy anchor. Chevron (remembered per
 * project), name, then a "needs you" pill, a running glyph and (collapsed
 * only) the conversation count, and the actions slot. Its conversations sit
 * under it with root titles aligned to the project name and are drawn smaller
 * than the project row (see ConversationRow.module.css); more than eight show
 * the most recent eight and a "Show N more" toggle.
 */
const ProjectGroup: React.FC<ProjectGroupProps> = ({
  workspace,
  name,
  expanded,
  onToggle,
  onOpen,
  active = false,
  count,
  running = false,
  needsYou = 0,
  failed = 0,
  actions,
  actionsVisible = false,
  onStartConversation,
  siderCollapsed = false,
  stickyTop,
  level = 2,
  treePosition,
  children,
}) => {
  const { t } = useTranslation();
  const project = useProjectTheme(workspace);
  const [showAll, setShowAll] = useState(false);
  const rows = React.Children.toArray(children);
  const visibleRows = showAll ? rows : rows.slice(0, PROJECT_VISIBLE_LIMIT);
  const hiddenCount = rows.length - visibleRows.length;
  const showChildren = siderCollapsed || expanded;
  const childrenId = `project-children-${encodeURIComponent(workspace)}`;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const trigger = event.currentTarget.querySelector<HTMLElement>('[data-project-menu-trigger]');
      if (trigger) {
        event.preventDefault();
        trigger.click();
      }
      return;
    }
    const intent = treeArrowIntent(event);
    if ((intent === 'expand' && !expanded) || (intent === 'collapse' && expanded)) {
      event.preventDefault();
      onToggle();
    }
  };

  const projectDot = needsYou > 0 ? 'waiting' : failed > 0 ? 'failed' : running ? 'running' : null;
  const statusLabel = [
    t('conversation.sidebar.project.count', { count }),
    running ? t('conversation.sidebar.status.running') : null,
    needsYou > 0 ? t('conversation.sidebar.project.needsYou', { count: needsYou }) : null,
    failed > 0 ? t('conversation.orchestration.state.failed') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={styles.group} style={project?.style} {...project?.dataAttributes}>
      {!siderCollapsed && (
        <div
          className={classNames(expanded && styles.groupHeaderSticky)}
          style={expanded && stickyTop !== undefined ? { top: stickyTop } : undefined}
        >
          <div
            className={classNames(styles.projectRow, 'group', {
              [styles.projectEmpty]: count === 0,
              [projectSurfaceClasses.activeGroup]: active,
            })}
            role='treeitem'
            tabIndex={-1}
            aria-level={level}
            aria-posinset={treePosition?.posinset}
            aria-setsize={treePosition?.setsize}
            aria-expanded={expanded}
            aria-owns={expanded ? childrenId : undefined}
            aria-label={`${name}, ${statusLabel}`}
            data-tree-item=''
            data-tree-level={level}
            data-tree-key={`project:${workspace}`}
            data-active-project={active ? 'true' : undefined}
            data-testid={`project-row-${workspace}`}
            onClick={onToggle}
            onKeyDown={handleKeyDown}
          >
            {/* C24: a quiet label, the chevron AFTER the name, no count; one dot for
                the most urgent state inside (needs you › failed › running). */}
            <span
              className={classNames(styles.projectName, { [styles.projectNameLink]: Boolean(onOpen) })}
              title={name}
              data-testid={onOpen ? `project-open-${workspace}` : undefined}
              onClick={
                onOpen
                  ? (event) => {
                      event.stopPropagation();
                      onOpen();
                    }
                  : undefined
              }
            >
              {name}
            </span>
            <span className={styles.chevron} aria-hidden='true'>
              <Right
                theme='outline'
                size={12}
                className={classNames(styles.chevronIcon, { [styles.chevronExpanded]: expanded })}
              />
            </span>
            <span className={styles.projectSpacer} />
            {projectDot && (
              <span
                className={classNames(styles.projectDot, styles[`projectDot_${projectDot}`])}
                data-testid={
                  projectDot === 'waiting' ? `project-needs-you-${workspace}` : `project-${projectDot}-${workspace}`
                }
                data-count={projectDot === 'waiting' ? needsYou : undefined}
                aria-hidden='true'
              />
            )}
            {actions && (
              <span
                className={classNames(styles.actions, { [styles.actionsVisible]: actionsVisible })}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                data-testid={`project-actions-${workspace}`}
              >
                {actions}
              </span>
            )}
          </div>
        </div>
      )}
      {showChildren && (
        <div
          id={siderCollapsed ? undefined : childrenId}
          role={siderCollapsed ? undefined : 'group'}
          className={classNames(siderCollapsed ? 'min-w-0' : styles.children)}
          data-testid={`project-children-${workspace}`}
          data-project-children={siderCollapsed ? undefined : ''}
        >
          {visibleRows.slice(0, PROJECT_VISIBLE_LIMIT)}
          {visibleRows.length > PROJECT_VISIBLE_LIMIT && (
            // Past the 8 most recent: long idle, slightly muted (C24).
            <div className='min-w-0' data-older-rows=''>
              {visibleRows.slice(PROJECT_VISIBLE_LIMIT)}
            </div>
          )}
          {!siderCollapsed && rows.length === 0 && (
            <ActionTreeItem
              className={styles.emptyHint}
              level={level + 1}
              treeKey={`project-empty:${workspace}`}
              testId={`project-empty-${workspace}`}
              label={`${t('conversation.sidebar.project.empty')} ${t('conversation.sidebar.project.startOne')}`}
              onActivate={onStartConversation}
            >
              <span>{t('conversation.sidebar.project.empty')}</span>
              {onStartConversation && <span className={styles.link}>{t('conversation.sidebar.project.startOne')}</span>}
            </ActionTreeItem>
          )}
          {!siderCollapsed && (hiddenCount > 0 || (showAll && rows.length > PROJECT_VISIBLE_LIMIT)) && (
            <ActionTreeItem
              className={styles.showMore}
              level={level + 1}
              treeKey={`project-more:${workspace}`}
              testId={`project-show-more-${workspace}`}
              onActivate={() => setShowAll((value) => !value)}
            >
              <span className={styles.link}>
                {hiddenCount > 0
                  ? t('conversation.sidebar.project.showMore', { count: hiddenCount })
                  : t('conversation.sidebar.project.showLess')}
              </span>
            </ActionTreeItem>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectGroup;

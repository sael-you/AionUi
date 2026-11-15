/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { CronJobIndicator } from '@/renderer/pages/cron';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Button, Checkbox, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import {
  EditOne,
  Export,
  FolderClose,
  Inbox,
  MessageOne,
  MoreOne,
  Plus,
  Pushpin,
  Right,
  Robot,
  Timer,
  Unlink,
  MoveOne,
} from '@icon-park/react';
import ForkBranchIcon from '@renderer/components/base/ForkBranchIcon';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@/renderer/utils/chat/relativeTime';
import { treeArrowIntent } from '@/renderer/hooks/ui/useRovingTree';
import { getActivityTime } from '@/renderer/utils/chat/timeline';

import ConversationStatusMark, { type ConversationStatus } from './components/ConversationStatusMark';
import styles from './ConversationRow.module.css';
import type { ConversationRowProps } from './types';
import { MAX_CONVERSATION_DEPTH } from './utils/conversationTree';
import { isConversationPinned } from './utils/groupingHelpers';

/** Horizontal indent added per nesting level, in px (one guide step). */
export const DEPTH_INDENT_PX = 16;
/** Base start padding of a row. Project children get their indent from the group container. */
const BASE_PADDING_PX = 8;

const ConversationRow: React.FC<ConversationRowProps> = (props) => {
  const {
    conversation,
    isGenerating,
    isWaitingConfirmation,
    hasUnread,
    collapsed,
    tooltipEnabled,
    batchMode,
    checked,
    selected,
    menuVisible,
    dragHandle,
    badge,
    treeLevel,
    depth = 0,
    treeInfo,
    onCreateChild,
    onDetach,
    onMoveUnder,
  } = props;
  const isChild = depth > 0;
  const rowPaddingStart = BASE_PADDING_PX + depth * DEPTH_INDENT_PX;
  // Depth limit (root = 0, max 3): a row already at the limit cannot take children.
  const canCreateChild = Boolean(onCreateChild) && (conversation.depth ?? depth) < MAX_CONVERSATION_DEPTH;
  const canDetach = Boolean(onDetach) && Boolean(conversation.parent_conversation_id);
  const logos = useAgentLogos();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const {
    onToggleChecked,
    onConversationClick,
    onOpenMenu,
    onMenuVisibleChange,
    onEditStart,
    onCreateCronTask,
    onArchive,
    onExport,
    onTogglePin,
    onToggleManualUnread,
    isManualUnread,
    getJobStatus,
  } = props;
  const { t, i18n } = useTranslation();
  const { info: assistantInfo } = usePresetAssistantInfo(conversation);
  // Pin is root-only: a sub-conversation never renders as pinned.
  const isPinned = !isChild && isConversationPinned(conversation);
  // Fork-lineage badge: present only on forked conversations (extra.fork is
  // server-minted by the fork API). Parent name resolves from the loaded
  // sidebar list; a deleted/unloaded parent degrades to the generic tip.
  const forkLineage = (conversation.extra as { fork?: { parent_conversation_id?: string } } | undefined)?.fork;
  const forkParentName = forkLineage?.parent_conversation_id
    ? props.resolveConversationName?.(forkLineage.parent_conversation_id)
    : undefined;
  const cronStatus = getJobStatus(conversation.id);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const inlineNameTooltipEnabled = !collapsed && !isMobile && !!conversation.name;

  const renderLeadingIcon = () => {
    if (cronStatus !== 'none') {
      return (
        <CronJobIndicator status={cronStatus} size={16} className={classNames('flex-shrink-0', styles.leadingIcon)} />
      );
    }

    // When the row is pinned, hovering reveals an overlay on the leading icon —
    // the drag handle when the row is sortable, otherwise a pushpin marker.
    // We dim the resting icon on hover so the overlay reads cleanly.
    const pinnedHoverFade = isPinned ? 'group-hover:opacity-0 transition-opacity' : '';
    const composedClass = classNames(pinnedHoverFade);

    const leadingMark = resolveConversationLeadingMark(conversation, assistantInfo, logos);
    if (leadingMark.kind === 'emoji') {
      return <span className={classNames('leading-none flex-shrink-0', composedClass)}>{leadingMark.value}</span>;
    }
    if (leadingMark.kind === 'image') {
      return (
        <ThemedLogo
          src={leadingMark.value}
          alt={leadingMark.label}
          className={classNames('w-16px h-16px rounded-50% flex-shrink-0', styles.leadingIcon, composedClass)}
        />
      );
    }
    if (leadingMark.kind === 'assistant_fallback') {
      return (
        <Robot
          theme='outline'
          size='16'
          className={classNames('line-height-0 flex-shrink-0 text-t-secondary', styles.leadingIcon, composedClass)}
        />
      );
    }

    return (
      <MessageOne
        theme='outline'
        size='16'
        className={classNames('line-height-0 flex-shrink-0 text-t-secondary', styles.leadingIcon, composedClass)}
      />
    );
  };

  const handleRowClick = () => {
    cleanupSiderTooltips();
    if (batchMode) {
      onToggleChecked(conversation);
      return;
    }
    onConversationClick(conversation);
  };

  // Keyboard support for the row itself (moving between rows is the tree's job,
  // see useRovingTree): Enter opens, the context-menu key / Shift+F10 opens the
  // menu, → expands and ← collapses a row with sub-conversations (mirrored in RTL).
  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      handleRowClick();
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (!batchMode) onOpenMenu(conversation);
      return;
    }
    if (!treeInfo) return;
    const intent = treeArrowIntent(event);
    if ((intent === 'expand' && !treeInfo.expanded) || (intent === 'collapse' && treeInfo.expanded)) {
      event.preventDefault();
      treeInfo.onToggle();
    }
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupSiderTooltips();
    if (batchMode) {
      return;
    }
    onOpenMenu(conversation);
  };

  // One status vocabulary for every row: the agent icon stays, a small dot on
  // it carries the state. Waiting on the user takes precedence over running: a
  // paused turn still streams frames that mark it "generating".
  const status: ConversationStatus = batchMode
    ? 'idle'
    : isWaitingConfirmation
      ? 'needsYou'
      : isGenerating
        ? 'running'
        : 'idle';
  const activityTime = getActivityTime(conversation);
  const timeAgo = activityTime ? formatRelativeTime(activityTime, i18n?.language ?? 'en') : '';

  const showUnread = !batchMode && hasUnread && !isGenerating && !isWaitingConfirmation;

  return (
    <Tooltip
      key={conversation.id}
      {...siderTooltipProps}
      content={conversation.name || t('conversation.welcome.newConversation')}
      position='right'
    >
      <div
        id={'c-' + conversation.id}
        className={classNames(
          'chat-history__item group conversation-item',
          styles.row,
          collapsed ? 'justify-center px-0' : 'justify-start gap-6px pe-8px',
          isChild && !collapsed && styles.childRow,
          {
            [styles.rowHover]: !batchMode && !selected,
            [styles.rowSelected]: selected,
            'bg-[rgba(var(--primary-6),0.08)]': batchMode && checked,
          }
        )}
        style={
          collapsed
            ? undefined
            : ({
                paddingInlineStart: rowPaddingStart,
                '--conversation-connector-x': `${rowPaddingStart - DEPTH_INDENT_PX / 2}px`,
              } as React.CSSProperties)
        }
        // Roving tabindex: the sidebar tree navigation gives one row tabIndex 0.
        tabIndex={-1}
        role='treeitem'
        aria-level={(treeLevel ?? 1) + depth}
        aria-expanded={treeInfo ? treeInfo.expanded : undefined}
        aria-selected={selected}
        aria-current={selected ? 'page' : undefined}
        data-tree-item=''
        data-tree-level={(treeLevel ?? 1) + depth}
        data-conversation-status={status}
        onKeyDown={handleTreeKeyDown}
        onClick={handleRowClick}
        onContextMenu={handleRowContextMenu}
      >
        {batchMode && (
          <span
            className='me-8px flex-center'
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked(conversation);
            }}
          >
            <Checkbox checked={checked} />
          </span>
        )}
        {treeInfo && !collapsed && !batchMode && (
          // Pointer shortcut; keyboard users expand / collapse with the arrows on the row.
          <Button
            type='text'
            size='mini'
            tabIndex={-1}
            className={styles.chevron}
            aria-label={treeInfo.expanded ? t('conversation.hierarchy.collapse') : t('conversation.hierarchy.expand')}
            aria-expanded={treeInfo.expanded}
            data-testid={`conversation-tree-toggle-${conversation.id}`}
            icon={
              <Right
                theme='outline'
                size='12'
                className={classNames(styles.chevronIcon, { [styles.chevronIconExpanded]: treeInfo.expanded })}
              />
            }
            onClick={(event) => {
              event.stopPropagation();
              treeInfo.onToggle();
            }}
          />
        )}
        <span className={classNames('size-20px flex items-center justify-center shrink-0 relative', styles.leading)}>
          <ConversationStatusMark conversationId={conversation.id} status={status}>
            {renderLeadingIcon()}
          </ConversationStatusMark>
          {/* Hover overlay on the leading icon: drag handle for sortable pinned rows, pushpin marker otherwise */}
          {!batchMode &&
            isPinned &&
            !isMobile &&
            status === 'idle' &&
            (dragHandle ?? (
              <span
                className='absolute inset-0 flex-center text-t-secondary pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity'
                style={{ lineHeight: 0 }}
              >
                <Pushpin theme='outline' size='14' />
              </span>
            ))}
        </span>
        <FlexFullContainer className='h-20px min-w-0 flex-1 collapsed-hidden'>
          <Tooltip
            content={conversation.name}
            disabled={!inlineNameTooltipEnabled}
            trigger='hover'
            popupVisible={inlineNameTooltipEnabled ? undefined : false}
            unmountOnExit
            popupHoverStay={false}
            position='top'
          >
            <div className={classNames('chat-history__item-name', styles.name, isChild && styles.childName)}>
              <span className='block overflow-hidden text-ellipsis whitespace-nowrap min-w-0'>{conversation.name}</span>
              {treeInfo && !treeInfo.expanded && (
                <span
                  className={styles.rollupBadge}
                  data-testid={`conversation-rollup-${conversation.id}`}
                  aria-label={t('conversation.hierarchy.rollupLabel', { count: treeInfo.rollup.total })}
                >
                  {treeInfo.rollup.pendingConfirmations > 0 ? (
                    <span
                      className={classNames(styles.rollupDot, styles.rollupDotNeedsYou)}
                      data-testid={`conversation-rollup-attention-${conversation.id}`}
                    />
                  ) : (
                    treeInfo.rollup.running > 0 && (
                      <span
                        className={classNames(styles.rollupDot, styles.rollupDotRunning)}
                        data-testid={`conversation-rollup-running-${conversation.id}`}
                      />
                    )
                  )}
                  <span className={styles.rollupCount}>{treeInfo.childCount}</span>
                </span>
              )}
              {forkLineage && (
                <Tooltip
                  content={
                    forkParentName
                      ? t('conversation.history.forkedFrom', { name: forkParentName })
                      : t('conversation.history.forkedConversation')
                  }
                  position='top'
                >
                  <span className='flex-shrink-0 line-height-0 text-t-tertiary' data-testid='conversation-fork-badge'>
                    <ForkBranchIcon size={12} />
                  </span>
                </Tooltip>
              )}
              {/* Badge slot (e.g. the Board Keeper badge), after the title. */}
              {badge && (
                <span className='flex-shrink-0 line-height-0' data-testid={`conversation-badge-${conversation.id}`}>
                  {badge}
                </span>
              )}
            </div>
          </Tooltip>
        </FlexFullContainer>

        {!collapsed && showUnread && (
          <span
            className={styles.unreadDot}
            data-testid={`conversation-unread-${conversation.id}`}
            aria-label={t('conversation.sidebar.status.unread')}
            role='img'
          />
        )}
        {!collapsed && !batchMode && !isMobile && timeAgo && (
          <span className={styles.timeAgo} data-testid={`conversation-time-${conversation.id}`}>
            {timeAgo}
          </span>
        )}
        {!batchMode && (
          <div
            className={classNames(styles.rowActions, '!collapsed-hidden', {
              [styles.rowActionsVisible]: isMobile || menuVisible,
            })}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Dropdown
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    if (key === 'pin') {
                      onTogglePin(conversation);
                      return;
                    }
                    if (key === 'toggleManualUnread') {
                      onToggleManualUnread(conversation);
                      return;
                    }
                    if (key === 'rename') {
                      onEditStart(conversation);
                      return;
                    }
                    if (key === 'createCronTask') {
                      onCreateCronTask(conversation);
                      return;
                    }
                    if (key === 'export') {
                      onExport?.(conversation);
                      return;
                    }
                    if (key === 'createChild') {
                      onCreateChild?.(conversation);
                      return;
                    }
                    if (key === 'detach') {
                      onDetach?.(conversation);
                      return;
                    }
                    if (key === 'moveUnder') {
                      onMoveUnder?.(conversation);
                      return;
                    }
                    if (key === 'archive') {
                      onArchive(conversation);
                    }
                  }}
                >
                  {/* Pin is root-only: sub-conversations live under their parent */}
                  {!isChild && (
                    <Menu.Item key='pin'>
                      <div className='flex items-center gap-8px'>
                        <Pushpin theme='outline' size='14' />
                        <span>{isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  {canCreateChild && (
                    <Menu.Item key='createChild'>
                      <div className='flex items-center gap-8px'>
                        <Plus theme='outline' size='14' />
                        <span>{t('conversation.hierarchy.newSubConversation')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  {onMoveUnder && (
                    <Menu.Item key='moveUnder'>
                      <div className='flex items-center gap-8px'>
                        <MoveOne theme='outline' size='14' />
                        <span>{t('conversation.hierarchy.moveUnder')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  {canDetach && (
                    <Menu.Item key='detach'>
                      <div className='flex items-center gap-8px'>
                        <Unlink theme='outline' size='14' />
                        <span>{t('conversation.hierarchy.detach')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  <Menu.Item key='toggleManualUnread'>
                    <div className='flex items-center gap-8px'>
                      <Inbox theme='outline' size='14' />
                      <span>
                        {isManualUnread ? t('conversation.history.markAsRead') : t('conversation.history.markAsUnread')}
                      </span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='rename'>
                    <div className='flex items-center gap-8px'>
                      <EditOne theme='outline' size='14' />
                      <span>{t('conversation.history.rename')}</span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='createCronTask'>
                    <div className='flex items-center gap-8px'>
                      <Timer theme='outline' size='14' />
                      <span>{t('conversation.history.createCronTask')}</span>
                    </div>
                  </Menu.Item>
                  {onExport && (
                    <Menu.Item key='export'>
                      <div className='flex items-center gap-8px'>
                        <Export theme='outline' size='14' />
                        <span>{t('conversation.history.export')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  <Menu.Item key='archive'>
                    <div className='flex items-center gap-8px'>
                      <FolderClose theme='outline' size='14' />
                      <span>{t('conversation.history.archive')}</span>
                    </div>
                  </Menu.Item>
                </Menu>
              }
              trigger='click'
              position='br'
              popupVisible={menuVisible}
              onVisibleChange={(visible) => onMenuVisibleChange(conversation.id, visible)}
              getPopupContainer={() => document.body}
              unmountOnExit={false}
            >
              {/* Keyboard: Shift+F10 / the context-menu key on the row opens it. */}
              <Button
                type='text'
                size='mini'
                tabIndex={-1}
                aria-label={t('conversation.sidebar.conversationActions', { name: conversation.name })}
                aria-haspopup='menu'
                aria-expanded={menuVisible}
                data-testid={`conversation-row-menu-${conversation.id}`}
                className={classNames('sider-action-btn', styles.actionButton)}
                icon={<MoreOne theme='outline' size='14' fill='currentColor' />}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMenu(conversation);
                }}
              />
            </Dropdown>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default ConversationRow;

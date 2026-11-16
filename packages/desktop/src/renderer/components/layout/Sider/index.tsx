import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Peoples } from '@icon-park/react';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { isPrimaryApplicationShortcut } from '@renderer/utils/ui/keyboardShortcuts';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import {
  SiderToolbar,
  SiderSearchEntry,
  SiderScheduledEntry,
  SiderAssistantEntry,
  SiderFilterInput,
  SiderNavItem,
} from './SiderNav';
import SiderFooter from './SiderFooter';
import { useInAppBrowserLauncher } from '@renderer/pages/conversation/Preview/browser/useInAppBrowserLauncher';
import TeamSiderSection from './TeamSiderSection';
import siderStyles from './Sider.module.css';
import type { TChatConversation } from '@/common/config/storage';
import { BoardKeeperBadge, isBoardKeeperConversation } from '@renderer/components/board/BoardKeeperBadge';
import { SidebarBoardButton } from '@renderer/components/board/SidebarBoardButton';
import type { WorkspaceGroupedHistoryProps } from '@renderer/pages/conversation/GroupedHistory/types';

type SidebarProjectSlot = Parameters<NonNullable<WorkspaceGroupedHistoryProps['projectActions']>>[0];

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

/** Session key of the list's scroll position (restored after a reload). */
export const SIDER_SCROLL_STORAGE_KEY = 'aionui_sider_scroll_top';

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const { t } = useTranslation();
  const browserLauncher = useInAppBrowserLauncher();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;

  const navigate = useNavigate();
  const { closePreview, clearPreviewForScope } = usePreviewContext();
  const { logout, status, user } = useAuth();
  const { teams } = useTeamList();
  const [createTeamVisible, setCreateTeamVisible] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const filterInputRef = useRef<RefInputType | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const { theme, setTheme } = useThemeContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');
  const showLogout =
    typeof window !== 'undefined' && !(window as { electronAPI?: unknown }).electronAPI && status === 'authenticated';

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/guid', { state: { resetAssistant: true } })).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/agent')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    // Do NOT call closePreview() here. conversation/index.tsx calls
    // closePreviewIfScopeChanged() once the conversation data loads, which
    // keeps the preview open when switching between conversations of the same
    // scope and closes it only when the scope (today = workspace) actually changes.
    setIsBatchMode(false);
  };

  const handleScheduledClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/scheduled')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleAssistantClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/assistants')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleQuickThemeToggle = () => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleLogout = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    // Hide the panel now so the UI responds immediately; the tabs themselves are
    // discarded after logout resolves, below.
    closePreview();
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      return; // logout 失败时不执行后续操作
    }
    // Discard this account's tabs from memory.
    //
    // `clearAuthCache` (inside logout) already deletes the stored `preview-ui:`
    // keys, but PreviewProvider is mounted at the app root and does not unmount on
    // logout, so its state survives. The persist effect depends on [tabs,
    // activeTabId, isOpen] and is still live — so the next change of any of those
    // would write this account's tabs straight back to disk, undoing the very
    // cleanup that ran moments earlier and showing them to whoever logs in next.
    //
    // Done after `await logout()` rather than before: discarding first would throw
    // the tabs away even on a path that left the user signed in. `logout()` handles
    // its own request failure and clears auth in a `finally`, so reaching this line
    // means the account really is signed out.
    clearPreviewForScope();
    if (onSessionClick) {
      onSessionClick();
    }
  }, [closePreview, clearPreviewForScope, logout, onSessionClick]);

  useEffect(() => {
    if (!showLogout) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleLogout, showLogout]);

  // Ctrl/Cmd+K focuses the filter (opening the sidebar first when it is collapsed).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPrimaryApplicationShortcut(event, { key: 'k', targetGuard: 'embedded-editor' })) return;
      event.preventDefault();
      const wasCollapsed = Boolean(layout?.siderCollapsed);
      if (wasCollapsed) layout?.setSiderCollapsed?.(false);
      // An opening sidebar mounts the field on its next render.
      requestAnimationFrame(() => {
        if (filterInputRef.current) filterInputRef.current.focus();
        else window.setTimeout(() => filterInputRef.current?.focus(), 60);
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layout]);

  // Keep the list's scroll position across reloads.
  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    let frame = 0;
    const restore = () => {
      const stored = Number(sessionStorage.getItem(SIDER_SCROLL_STORAGE_KEY) ?? '');
      if (Number.isFinite(stored) && stored > 0) element.scrollTop = stored;
    };
    // The list loads lazily: restore once now and once its content has rendered.
    restore();
    frame = requestAnimationFrame(restore);
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try {
          sessionStorage.setItem(SIDER_SCROLL_STORAGE_KEY, String(Math.round(element.scrollTop)));
        } catch {
          // Storage unavailable: the position is simply not kept.
        }
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll);
    };
  }, [isSettings]);

  const focusFirstTreeItem = () => {
    const first = treeRef.current?.querySelector<HTMLElement>('[data-tree-item][tabindex="0"], [data-tree-item]');
    first?.focus();
  };

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
    filterQuery,
    // Row slots for project-level features (Kanban, D40): the Board button on the
    // project row, the Board Keeper badge on its conversation, which is listed first.
    projectActions: ({ projectId, name, buttonClassName }: SidebarProjectSlot) =>
      projectId ? (
        <SidebarBoardButton
          projectId={projectId}
          projectName={name}
          className={buttonClassName}
          onNavigate={onSessionClick}
        />
      ) : null,
    conversationBadge: (conversation: TChatConversation) => <BoardKeeperBadge conversation={conversation} compact />,
    isProjectLeadConversation: isBoardKeeperConversation,
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col'>
            {/* Compact top block: New chat, the top list, the filter. */}
            <div className={siderStyles.topBlock}>
              <SiderToolbar
                isMobile={isMobile}
                isBatchMode={isBatchMode}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onNewChat={handleNewChat}
                onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
              />
              <nav aria-label={t('conversation.sidebar.navLabel')} className='flex flex-col gap-1px'>
                {/* Search entry — desktop moves this into the titlebar toolbar;
                    mobile keeps it here in the sidebar. */}
                {isMobile && (
                  <SiderSearchEntry
                    isMobile={isMobile}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    onConversationSelect={handleConversationSelect}
                    onSessionClick={onSessionClick}
                  />
                )}
                <SiderAssistantEntry
                  isActive={pathname.startsWith('/assistants')}
                  collapsed={collapsed}
                  siderTooltipProps={siderTooltipProps}
                  onClick={handleAssistantClick}
                />
                <SiderScheduledEntry
                  isActive={pathname === '/scheduled'}
                  collapsed={collapsed}
                  siderTooltipProps={siderTooltipProps}
                  onClick={handleScheduledClick}
                />
                {/* No teams yet: a subtle entry instead of an empty Teams section. */}
                {teams.length === 0 && (
                  <SiderNavItem
                    icon={<Peoples theme='outline' size='16' fill='currentColor' />}
                    label={t('team.sider.createTeam')}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    onClick={() => setCreateTeamVisible(true)}
                    testId='team-create-btn'
                  />
                )}
              </nav>
              {!collapsed && (
                <SiderFilterInput
                  value={filterQuery}
                  onChange={setFilterQuery}
                  inputRef={filterInputRef}
                  onFocusList={focusFirstTreeItem}
                />
              )}
            </div>
            {/* The tree: pinned → teams → projects → conversations. Fills the
                remaining height; the footer stays pinned below it. */}
            <div
              ref={treeRef}
              data-testid='sider-scroll'
              className={classNames('flex-1 min-h-0 overflow-y-auto mt-4px', siderStyles.scrollArea)}
            >
              <Suspense fallback={null}>
                <WorkspaceGroupedHistory
                  {...workspaceHistoryProps}
                  afterPinnedContent={
                    <TeamSiderSection
                      collapsed={collapsed}
                      pathname={pathname}
                      siderTooltipProps={siderTooltipProps}
                      onSessionClick={onSessionClick}
                      filterQuery={filterQuery}
                      createVisible={createTeamVisible}
                      onCreateVisibleChange={setCreateTeamVisible}
                    />
                  }
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <SiderFooter
        isMobile={isMobile}
        isSettings={isSettings}
        collapsed={collapsed}
        theme={theme}
        siderTooltipProps={siderTooltipProps}
        userName={user?.username}
        onSettingsClick={handleSettingsClick}
        onThemeToggle={handleQuickThemeToggle}
        showLogout={showLogout}
        onLogoutClick={handleLogout}
        onBrowserClick={browserLauncher.open}
        browserAvailable={browserLauncher.available}
      />
    </div>
  );
};

export default Sider;

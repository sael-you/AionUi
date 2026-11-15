/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EditOne, FolderClose, Peoples, Plus, Pushpin } from '@icon-park/react';
import { Button, Input, Message, Modal, Spin, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { iconColors } from '@renderer/styles/colors';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { useSiderTeamBadges } from '@renderer/pages/team/hooks/useSiderTeamBadges';
import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';
import { ipcBridge } from '@/common';
import SectionHeader, { sectionGroupId } from '@renderer/pages/conversation/GroupedHistory/components/SectionHeader';
import {
  matchesSidebarQuery,
  normalizeSidebarQuery,
} from '@renderer/pages/conversation/GroupedHistory/utils/sidebarFilter';
import SiderItem from './SiderItem';
import type { SiderMenuItem } from './SiderItem';
import { useSiderTeamRunning } from './useSiderTeamRunning';

const TEAM_PINNED_KEY = 'team-pinned-ids';

type SiderTooltipProps = React.ComponentProps<typeof Tooltip>;

interface TeamSiderSectionProps {
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: Partial<SiderTooltipProps>;
  onSessionClick?: () => void;
  /** Sidebar name filter. */
  filterQuery?: string;
  /** Controlled "create team" dialog (the top list's "New team" entry opens it when there are no teams). */
  createVisible?: boolean;
  onCreateVisibleChange?: (visible: boolean) => void;
}

const TeamSiderSection: React.FC<TeamSiderSectionProps> = ({
  collapsed,
  pathname,
  siderTooltipProps,
  onSessionClick,
  filterQuery,
  createVisible,
  onCreateVisibleChange,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, mutate: refreshTeams } = useTeamList();
  const teamBadgeCounts = useSiderTeamBadges(teams);
  const isTeamRunning = useSiderTeamRunning(teams);
  const { mutate: globalMutate } = useSWRConfig();

  const [ownCreateVisible, setOwnCreateVisible] = useState(false);
  const createTeamVisible = createVisible ?? ownCreateVisible;
  const setCreateTeamVisible = useCallback(
    (visible: boolean) => (onCreateVisibleChange ?? setOwnCreateVisible)(visible),
    [onCreateVisibleChange]
  );
  const [expanded, setExpanded] = useState<boolean>(() => localStorage.getItem('team-section-expanded') === 'true');
  useEffect(() => {
    localStorage.setItem('team-section-expanded', String(expanded));
  }, [expanded]);

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_PINNED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(TEAM_PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameId || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });
      await refreshTeams();
      await globalMutate(`team/${renameId}`);
      Message.success(t('team.sider.renameSuccess'));
      setRenameVisible(false);
      setRenameId(null);
      setRenameName('');
    } catch (err) {
      console.error('Failed to rename team:', err);
      Message.error(t('team.sider.rename'));
    } finally {
      setRenameLoading(false);
    }
  }, [globalMutate, refreshTeams, renameId, renameName, t]);

  const normalizedQuery = normalizeSidebarQuery(filterQuery);
  const sortedTeams = useMemo(() => {
    const shown = teams.filter((team) => matchesSidebarQuery(team.name, normalizedQuery));
    const pinned = shown.filter((team) => pinnedIds.includes(team.id));
    const unpinned = shown.filter((team) => !pinnedIds.includes(team.id));
    return [...pinned, ...unpinned];
  }, [teams, pinnedIds, normalizedQuery]);
  const sectionExpanded = expanded || normalizedQuery !== '';

  const handleTeamClick = useCallback(
    (team_id: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(`/team/${team_id}`)).catch(console.error);
      if (onSessionClick) onSessionClick();
    },
    [navigate, onSessionClick]
  );

  // Archive-first: teams are archived (not hard-deleted) from the sider. The
  // backend team list excludes archived rows, so the refresh drops it here;
  // the archive page in Settings picks it up for restore or permanent delete.
  const handleArchiveTeam = useCallback(
    async (team_id: string) => {
      try {
        await ipcBridge.sidebar.archive.invoke({ item_type: 'team', item_id: team_id });
        await refreshTeams();
        Message.success(t('team.sider.archiveSuccess'));
        if (window.location.hash.includes(`/team/${team_id}`)) {
          window.location.hash = '#/';
        }
      } catch (err) {
        console.error('Failed to archive team:', err);
        Message.error(t('team.sider.archiveFailed'));
      }
    },
    [refreshTeams, t]
  );

  return (
    <>
      {collapsed
        ? sortedTeams.length > 0 && (
            <div className='shrink-0 flex flex-col gap-2px'>
              {sortedTeams.map((team) => {
                const isActive = pathname.startsWith(`/team/${team.id}`);
                const isRunning = isTeamRunning(team.id);
                return (
                  <Tooltip key={team.id} {...siderTooltipProps} content={team.name} position='right'>
                    <div
                      data-testid={`collapsed-team-item-${team.id}`}
                      role='treeitem'
                      tabIndex={-1}
                      aria-level={1}
                      aria-label={team.name}
                      aria-current={isActive ? 'page' : undefined}
                      data-tree-item=''
                      data-tree-level={1}
                      data-tree-key={`team:${team.id}`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleTeamClick(team.id);
                        }
                      }}
                      className={classNames(
                        'relative w-full h-40px flex items-center justify-center cursor-pointer transition-colors rd-8px',
                        isActive ? '!bg-active' : 'hover:bg-fill-3 active:bg-fill-4'
                      )}
                      onClick={() => handleTeamClick(team.id)}
                    >
                      {isRunning ? (
                        <span
                          data-testid={`collapsed-team-spinner-${team.id}`}
                          className='flex items-center justify-center'
                        >
                          <Spin size={16} />
                        </span>
                      ) : (
                        <Peoples
                          data-testid={`collapsed-team-icon-${team.id}`}
                          data-icon-fill={iconColors.primary}
                          theme='outline'
                          size='16'
                          fill={iconColors.primary}
                          style={{ lineHeight: 0 }}
                        />
                      )}
                      {(teamBadgeCounts.get(team.id) ?? 0) > 0 && (
                        <span
                          className='absolute top-4px end-4px w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center leading-none bg-danger-6 text-white'
                          style={{ lineHeight: 1 }}
                        >
                          {(teamBadgeCounts.get(team.id) ?? 0) > 99 ? '99+' : teamBadgeCounts.get(team.id)}
                        </span>
                      )}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )
        : // No teams: no section at all (the top list offers "New team" instead).
          sortedTeams.length > 0 && (
            <div className='shrink-0 flex flex-col'>
              <SectionHeader
                sectionKey='teams'
                testId='team-section-toggle'
                label={t('team.sider.title')}
                count={teams.length}
                expanded={sectionExpanded}
                onToggle={() => setExpanded((v) => !v)}
                groupId={sectionGroupId('teams')}
                trailing={
                  /* [E2E SYNC] data-testid="team-create-btn" is the E2E entry selector; keep it
                 (tests/e2e/cases/teams/team-create.e2e.ts). */
                  <Tooltip content={t('team.sider.createTeam')} position='top'>
                    <Button
                      type='text'
                      size='mini'
                      aria-label={t('team.sider.createTeam')}
                      data-testid='team-create-btn'
                      className='!size-22px !p-0 !rd-4px shrink-0 !text-t-secondary hover:!text-t-primary hover:!bg-fill-4'
                      icon={<Plus theme='outline' size='14' fill='currentColor' />}
                      onClick={() => setCreateTeamVisible(true)}
                    />
                  </Tooltip>
                }
              />
              <div id={sectionGroupId('teams')} role='group' className='min-w-0'>
                {sectionExpanded &&
                  sortedTeams.map((team) => {
                    const isPinned = pinnedIds.includes(team.id);
                    const menuItems: SiderMenuItem[] = [
                      {
                        key: 'pin',
                        icon: <Pushpin theme='outline' size='14' />,
                        label: isPinned ? t('team.sider.unpin') : t('team.sider.pin'),
                      },
                      {
                        key: 'rename',
                        icon: <EditOne theme='outline' size='14' />,
                        label: t('team.sider.rename'),
                      },
                      {
                        key: 'archive',
                        icon: <FolderClose theme='outline' size='14' />,
                        label: t('team.sider.archive'),
                      },
                    ];
                    const teamBadge = teamBadgeCounts.get(team.id) ?? 0;
                    const isRunning = isTeamRunning(team.id);
                    return (
                      <div key={team.id} className='relative group'>
                        <SiderItem
                          icon={
                            isRunning ? (
                              <span
                                data-testid={`team-spinner-${team.id}`}
                                className='flex items-center justify-center'
                              >
                                <Spin size={16} />
                              </span>
                            ) : (
                              <Peoples
                                data-testid={`team-icon-${team.id}`}
                                theme='outline'
                                size='16'
                                fill='currentColor'
                                style={{ lineHeight: 0 }}
                              />
                            )
                          }
                          name={team.name}
                          selected={pathname.startsWith(`/team/${team.id}`)}
                          pinned={isPinned && !isRunning}
                          menuItems={menuItems}
                          onMenuAction={(key) => {
                            if (key === 'pin') {
                              togglePin(team.id);
                            } else if (key === 'rename') {
                              setRenameId(team.id);
                              setRenameName(team.name);
                              setRenameVisible(true);
                            } else if (key === 'archive') {
                              void handleArchiveTeam(team.id);
                            }
                          }}
                          onClick={() => handleTeamClick(team.id)}
                          treeKey={`team:${team.id}`}
                        />
                        {teamBadge > 0 && (
                          <span
                            className='absolute end-11px top-1/2 -translate-y-1/2 w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center pointer-events-none z-10 group-hover:hidden bg-danger-6 text-white'
                            style={{ lineHeight: 1 }}
                          >
                            {teamBadge > 99 ? '99+' : teamBadge}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
      <TeamCreateModal
        visible={createTeamVisible}
        onClose={() => setCreateTeamVisible(false)}
        onCreated={(team) => {
          void refreshTeams();
          Promise.resolve(navigate(`/team/${team.id}`)).catch(console.error);
        }}
      />
      <Modal
        title={t('team.sider.renameTitle')}
        visible={renameVisible}
        onOk={() => void handleRenameConfirm()}
        onCancel={() => {
          setRenameVisible(false);
          setRenameId(null);
          setRenameName('');
        }}
        okText={t('team.sider.renameOk')}
        cancelText={t('team.sider.renameCancel')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameName}
          onChange={setRenameName}
          onPressEnter={() => void handleRenameConfirm()}
          placeholder={t('team.sider.renamePlaceholder')}
          allowClear
        />
      </Modal>
    </>
  );
};

export default TeamSiderSection;

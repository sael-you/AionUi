/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { Comment, More, Refresh, SettingTwo } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import {
  ProjectChip,
  projectSurfaceClasses,
  type ProjectThemeView,
} from '@/renderer/components/workspace/ProjectIdentity';
import { iconLabelButton } from '@/renderer/components/board/utils/boardStyles';

export type BoardHeaderProps = {
  board: BoardController;
  projectName: string | null;
  /**
   * The project's colour identity (ProjectIdentity): the header shows the project
   * chip on the project tint; the board itself stays on semantic tokens.
   */
  project: ProjectThemeView | null;
  onOpenSettings: () => void;
};

export const BoardHeader: React.FC<BoardHeaderProps> = ({ board, projectName, project, onOpenSettings }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [openingKeeper, setOpeningKeeper] = useState(false);
  const settings = board.snapshot?.settings;
  const canConfigure = Boolean(settings?.enabled) && !board.readOnly;

  const talkToBoard = async () => {
    setOpeningKeeper(true);
    try {
      const conversationId = await board.keeperConversation();
      if (conversationId) void navigate(`/conversation/${encodeURIComponent(conversationId)}`);
    } finally {
      setOpeningKeeper(false);
    }
  };

  const confirmTurnOff = () => {
    Modal.confirm({
      title: t('board.turnOffTitle'),
      content: t('board.turnOffContent'),
      okText: t('board.turnOff'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        await board.setEnabled(false);
      },
    });
  };

  return (
    <header
      className={classNames(
        'flex flex-wrap items-center gap-8px px-16px pt-12px pb-4px',
        project && projectSurfaceClasses.headerTint
      )}
      data-project-header={project ? 'tint' : undefined}
    >
      <h1 className='m-0 text-18px font-medium text-t-primary truncate'>
        {projectName ? t('board.pageTitle', { project: projectName }) : t('board.title')}
      </h1>
      {project && <ProjectChip project={project} />}
      <span className='flex-1' />
      {settings?.enabled && (
        <Tooltip content={t('board.keeper.tooltip')} mini>
          <Button
            className={iconLabelButton('small')}
            size='small'
            loading={openingKeeper}
            icon={<Comment theme='outline' size='14' fill='currentColor' />}
            onClick={() => void talkToBoard()}
          >
            {t('board.keeper.talk')}
          </Button>
        </Tooltip>
      )}
      <Tooltip content={t('board.refresh')} mini>
        <Button
          type='text'
          size='small'
          icon={<Refresh theme='outline' size='16' fill='currentColor' />}
          aria-label={t('board.refresh')}
          onClick={() => void board.reload()}
        />
      </Tooltip>
      {canConfigure && (
        <>
          <Button
            className={iconLabelButton('small')}
            size='small'
            icon={<SettingTwo theme='outline' size='14' fill='currentColor' />}
            onClick={onOpenSettings}
          >
            {t('board.columnSettings')}
          </Button>
          <Dropdown
            trigger='click'
            position='br'
            droplist={
              <Menu onClickMenuItem={(key) => key === 'turn-off' && confirmTurnOff()}>
                <Menu.Item key='turn-off'>{t('board.turnOff')}</Menu.Item>
              </Menu>
            }
          >
            <Button
              type='text'
              size='small'
              icon={<More theme='outline' size='16' fill='currentColor' />}
              aria-label={t('board.boardMenu')}
              aria-haspopup='menu'
            />
          </Dropdown>
        </>
      )}
    </header>
  );
};

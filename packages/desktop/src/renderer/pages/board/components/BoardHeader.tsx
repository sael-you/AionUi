/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { More, Refresh, SettingTwo } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardController } from '@/renderer/components/board/hooks/useBoard';

export type BoardHeaderProps = {
  board: BoardController;
  projectName: string | null;
  /**
   * Accent colour of the project (CSS colour value). This is the single hook point
   * for project colours: when set, the header shows the accent bar; the board
   * itself stays on semantic tokens.
   */
  projectColor?: string;
  onOpenSettings: () => void;
};

export const BoardHeader: React.FC<BoardHeaderProps> = ({ board, projectName, projectColor, onOpenSettings }) => {
  const { t } = useTranslation();
  const settings = board.snapshot?.settings;
  const canConfigure = Boolean(settings?.enabled) && !board.readOnly;

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
    <header className='flex items-center gap-8px px-16px pt-12px pb-4px' data-project-color={projectColor}>
      {projectColor && (
        <span aria-hidden className='w-4px h-20px rd-full shrink-0' style={{ backgroundColor: projectColor }} />
      )}
      <h1 className='m-0 text-18px font-medium text-t-primary truncate flex-1'>
        {projectName ? t('board.pageTitle', { project: projectName }) : t('board.title')}
      </h1>
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

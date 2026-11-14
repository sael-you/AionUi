/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { ViewGridDetail } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * Direct "open board" button on a sidebar project item (D40), next to the
 * project menu. On pointer devices it appears on hover, and on keyboard focus
 * (it stays focusable while transparent); on touch it is always visible.
 */
export const SidebarBoardButton: React.FC<{ projectId: string; projectName: string; touch: boolean }> = ({
  projectId,
  projectName,
  touch,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const open = (): void => {
    void navigate(`/board/${encodeURIComponent(projectId)}`);
  };
  return (
    <Tooltip content={t('board.openBoard')} position='top'>
      <span
        role='button'
        tabIndex={0}
        aria-label={t('board.sidebar.openBoardOf', { project: projectName })}
        data-sidebar-board-button={projectId}
        className={classNames(
          'flex flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
          !touch && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            open();
          }
        }}
      >
        <ViewGridDetail theme='outline' size='14' fill='currentColor' className='block leading-none' />
      </span>
    </Tooltip>
  );
};

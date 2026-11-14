/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tooltip } from '@arco-design/web-react';
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
      <Button
        type='text'
        size='mini'
        aria-label={t('board.sidebar.openBoardOf', { project: projectName })}
        data-sidebar-board-button={projectId}
        icon={<ViewGridDetail theme='outline' size='14' fill='currentColor' className='block leading-none' />}
        className={classNames(
          '!flex !items-center !justify-center !p-0 !size-20px !min-w-0 !rd-4px !text-t-secondary hover:!text-t-primary transition-colors sider-action-btn',
          !touch && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
        // The row header toggles on Enter/Space; the button's own activation must not reach it.
        onKeyDown={(event) => event.stopPropagation()}
      />
    </Tooltip>
  );
};

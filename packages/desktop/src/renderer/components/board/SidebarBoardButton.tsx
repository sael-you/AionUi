/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tooltip } from '@arco-design/web-react';
import { ViewGridDetail } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * Direct "open board" button for the sidebar project row (D40), rendered in the
 * row's actions slot. The row shows its actions on hover / focus and always on
 * touch; like the row's other icon buttons it stays out of the Tab order — the
 * keyboard path is the project menu's "Open board".
 */
export const SidebarBoardButton: React.FC<{
  projectId: string;
  projectName: string;
  /** The row's icon-button class (size, colours) from the sidebar. */
  className?: string;
  /** Called after navigating (the mobile sidebar closes itself). */
  onNavigate?: () => void;
}> = ({ projectId, projectName, className, onNavigate }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tooltip content={t('board.openBoard')} position='top'>
      <Button
        type='text'
        size='mini'
        tabIndex={-1}
        aria-label={t('board.sidebar.openBoardOf', { project: projectName })}
        data-sidebar-board-button={projectId}
        className={className}
        icon={<ViewGridDetail theme='outline' size='14' fill='currentColor' />}
        onClick={(event) => {
          event.stopPropagation();
          void navigate(`/board/${encodeURIComponent(projectId)}`);
          onNavigate?.();
        }}
      />
    </Tooltip>
  );
};

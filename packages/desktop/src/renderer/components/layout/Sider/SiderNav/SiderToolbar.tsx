/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@arco-design/web-react';
import { ListCheckbox, Plus } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import styles from '../Sider.module.css';

interface SiderToolbarProps {
  isMobile: boolean;
  isBatchMode: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onNewChat: () => void;
  onToggleBatchMode: () => void;
}

/** Full-width primary "New chat" button, with the batch-select toggle beside it. */
const SiderToolbar: React.FC<SiderToolbarProps> = ({
  isMobile,
  isBatchMode,
  collapsed,
  siderTooltipProps,
  onNewChat,
  onToggleBatchMode,
}) => {
  const { t } = useTranslation();
  const newChatLabel = t('conversation.welcome.newConversation');
  const batchLabel = isBatchMode ? t('conversation.history.batchModeExit') : t('conversation.history.batchManage');
  const height = isMobile ? '!h-40px' : '!h-32px';

  if (collapsed) {
    return (
      <div className='shrink-0 flex flex-col items-center w-full'>
        <Tooltip {...siderTooltipProps} content={newChatLabel} position='right'>
          <Button
            type='primary'
            long
            aria-label={newChatLabel}
            data-testid='sider-new-chat'
            className={classNames(styles.newChatTrigger, height, '!rd-6px !px-0')}
            icon={<Plus theme='outline' size='16' fill='currentColor' className={styles.newChatIcon} />}
            onClick={onNewChat}
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={styles.newChatRow}>
      <Button
        type='primary'
        data-testid='sider-new-chat'
        className={classNames(styles.newChatTrigger, styles.newChatButton, height, '!rd-6px')}
        icon={<Plus theme='outline' size='14' fill='currentColor' className={styles.newChatIcon} />}
        onClick={onNewChat}
      >
        {newChatLabel}
      </Button>
      <Tooltip {...siderTooltipProps} content={batchLabel} position='right'>
        <Button
          type={isBatchMode ? 'secondary' : 'text'}
          aria-label={batchLabel}
          aria-pressed={isBatchMode}
          data-testid='sider-batch-toggle'
          className={classNames(isMobile ? '!w-40px !h-40px' : '!w-32px !h-32px', '!rd-6px !px-0 shrink-0', {
            '!text-primary': isBatchMode,
          })}
          icon={<ListCheckbox theme='outline' size='14' fill='currentColor' />}
          onClick={onToggleBatchMode}
        />
      </Tooltip>
    </div>
  );
};

export default SiderToolbar;

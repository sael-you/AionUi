/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Context panel as a sheet (C41), for the places that have no project
 * sidebar to host the tab: phones (full-height, full-width) and conversations
 * without a project (a side sheet). Opened from the ring beside the composer.
 */

import { Drawer } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import ContextPanel from './ContextPanel';

export type ContextSheetProps = {
  conversationId: string;
  visible: boolean;
  /** Phone layout: the sheet covers the whole viewport. */
  fullScreen: boolean;
  onClose: () => void;
};

const SIDE_SHEET_WIDTH_PX = 380;

const ContextSheet: React.FC<ContextSheetProps> = ({ conversationId, visible, fullScreen, onClose }) => {
  const { t } = useTranslation();
  return (
    <Drawer
      title={t('conversation.explorer.tabs.context')}
      visible={visible}
      placement='right'
      width={fullScreen ? '100%' : SIDE_SHEET_WIDTH_PX}
      footer={null}
      onCancel={onClose}
      unmountOnExit
      focusLock
      autoFocus={false}
      bodyStyle={{ padding: 0 }}
    >
      <ContextPanel conversationId={conversationId} />
    </Drawer>
  );
};

export default ContextSheet;

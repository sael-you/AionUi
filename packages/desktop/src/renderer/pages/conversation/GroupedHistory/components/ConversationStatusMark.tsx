/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SidebarTree.module.css';

/** What a conversation is doing, as shown in the sidebar. */
export type ConversationStatus = 'idle' | 'running' | 'needsYou';

type ConversationStatusMarkProps = {
  conversationId: string;
  status: ConversationStatus;
  /** The agent icon (Claude / Codex / Gemini / assistant), always shown. */
  children: React.ReactNode;
};

/**
 * The agent icon with a small status dot on its corner: running (primary, a
 * gentle pulse unless reduced motion is requested), needs you (project accent,
 * warning outside a project), idle (no dot). One vocabulary for every row
 * instead of icons swapping for spinners. The state is also announced.
 */
const ConversationStatusMark: React.FC<ConversationStatusMarkProps> = ({ conversationId, status, children }) => {
  const { t } = useTranslation();
  return (
    <span className={styles.statusMark}>
      {children}
      {status === 'running' && (
        <span
          className={classNames(styles.statusDot, styles.statusRunning)}
          data-testid={`conversation-running-${conversationId}`}
          role='img'
          aria-label={t('conversation.sidebar.status.running')}
        />
      )}
      {status === 'needsYou' && (
        <span
          className={classNames(styles.statusDot, styles.statusNeedsYou)}
          data-testid={`conversation-waiting-confirmation-${conversationId}`}
          role='img'
          aria-label={t('conversation.sidebar.status.needsYou')}
        />
      )}
    </span>
  );
};

export default ConversationStatusMark;

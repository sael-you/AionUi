/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Small shared pieces of the library layout (C33): empty state, details drawer, batch bar. */

import { Button, Drawer } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Library.module.css';

/** "Nothing here yet — browse the Library": one line and one clear action. */
export const LibraryEmpty: React.FC<{ text: string; actionLabel?: string; onAction?: () => void }> = ({
  text,
  actionLabel,
  onAction,
}) => (
  <div className={styles.empty} data-testid='library-empty'>
    <span>{text}</span>
    {actionLabel && onAction ? (
      <Button type='primary' size='small' onClick={onAction} data-testid='library-empty-action'>
        {actionLabel}
      </Button>
    ) : null}
  </div>
);

export type LibraryDrawerProps = {
  visible: boolean;
  title: React.ReactNode;
  isMobile: boolean;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
};

/** Details drawer: 480 px on the right, a full-screen sheet on phones; Esc closes. */
export const LibraryDrawer: React.FC<LibraryDrawerProps> = ({
  visible,
  title,
  isMobile,
  onClose,
  footer,
  children,
  testId = 'library-drawer',
}) => (
  <Drawer
    visible={visible}
    placement={isMobile ? 'bottom' : 'right'}
    width={isMobile ? undefined : 480}
    height={isMobile ? '100%' : undefined}
    title={title}
    footer={footer ?? null}
    onCancel={onClose}
    escToExit
    maskClosable
    unmountOnExit
    className={styles.drawer}
  >
    <div className={styles.drawerBody} data-testid={testId}>
      {children}
    </div>
  </Drawer>
);

/** A labelled block inside the drawer. */
export const DrawerBlock: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className={styles.drawerBlock}>
    <h3 className={styles.drawerBlockTitle}>{title}</h3>
    {children}
  </section>
);

export type LibraryBatchAction = {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** Sticky bottom bar while cards are being selected. */
export const LibraryBatchBar: React.FC<{
  selected: number;
  actions: LibraryBatchAction[];
  onCancel: () => void;
}> = ({ selected, actions, onCancel }) => {
  const { t } = useTranslation();
  return (
    <div
      className={styles.batchBar}
      role='region'
      aria-label={t('settings.library.batchLabel')}
      data-testid='library-batch-bar'
    >
      <span className={styles.batchCount} aria-live='polite'>
        {t('settings.library.selected', { count: selected })}
      </span>
      <div className={styles.batchActions}>
        {actions.map((action) => (
          <Button
            key={action.key}
            size='small'
            status={action.danger ? 'danger' : undefined}
            type={action.danger ? 'secondary' : 'primary'}
            disabled={action.disabled || selected === 0}
            onClick={action.onClick}
            data-testid={`library-batch-${action.key}`}
          >
            {action.label}
          </Button>
        ))}
        <Button size='small' type='text' onClick={onCancel} data-testid='library-batch-cancel'>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};

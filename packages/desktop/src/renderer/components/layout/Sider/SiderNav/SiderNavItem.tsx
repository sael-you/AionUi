/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import styles from '../Sider.module.css';

export type SiderNavItemProps = {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
  testId?: string;
};

/** Compact icon + label row of the sidebar's top list (30px, 40px on touch); icon only when collapsed. */
const SiderNavItem: React.FC<SiderNavItemProps> = ({
  icon,
  label,
  isActive = false,
  collapsed,
  siderTooltipProps,
  onClick,
  testId,
}) => (
  <Tooltip {...siderTooltipProps} content={label} position='right'>
    <div
      role='button'
      tabIndex={0}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      data-testid={testId}
      className={classNames(styles.navItem, {
        [styles.navItemActive]: isActive,
        [styles.navItemCollapsed]: collapsed,
      })}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span className={styles.navIcon} aria-hidden='true'>
        {icon}
      </span>
      {!collapsed && <span className={classNames(styles.navLabel, 'collapsed-hidden')}>{label}</span>}
    </div>
  </Tooltip>
);

export default SiderNavItem;

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { ArrowCircleLeft, Logout, Moon, MoreOne, SettingTwo, SunOne } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import styles from './Sider.module.css';

interface SiderFooterProps {
  isMobile: boolean;
  isSettings: boolean;
  collapsed?: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  /** Signed-in user name; `undefined` for the local desktop user. */
  userName?: string;
  onSettingsClick: () => void;
  onThemeToggle: () => void;
  showLogout?: boolean;
  onLogoutClick?: () => void;
}

/**
 * One compact footer row: the user (avatar + name) opens Settings (or goes back
 * from Settings), and a menu button holds Settings, the light/dark switch and
 * Logout.
 */
const SiderFooter: React.FC<SiderFooterProps> = ({
  isMobile,
  isSettings,
  collapsed = false,
  theme,
  siderTooltipProps,
  userName,
  onSettingsClick,
  onThemeToggle,
  showLogout = false,
  onLogoutClick,
}) => {
  const { t } = useTranslation();
  const [menuVisible, setMenuVisible] = useState(false);
  const displayName = userName?.trim() || t('conversation.sidebar.footer.localUser');
  const initial = displayName.charAt(0).toLocaleUpperCase();
  const primaryLabel = isSettings ? t('common.back') : t('common.settings');
  const themeLabel = theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode');

  const menu = (
    <Menu
      onClickMenuItem={(key) => {
        setMenuVisible(false);
        if (key === 'settings') onSettingsClick();
        else if (key === 'theme') onThemeToggle();
        else if (key === 'logout') onLogoutClick?.();
      }}
    >
      <Menu.Item key='settings'>
        <span className='flex items-center gap-8px'>
          {isSettings ? <ArrowCircleLeft theme='outline' size='14' /> : <SettingTwo theme='outline' size='14' />}
          {primaryLabel}
        </span>
      </Menu.Item>
      <Menu.Item key='theme' data-testid='theme-toggle'>
        <span className='flex items-center gap-8px'>
          {theme === 'dark' ? <SunOne theme='outline' size='14' /> : <Moon theme='outline' size='14' />}
          {themeLabel}
        </span>
      </Menu.Item>
      {showLogout && onLogoutClick && (
        <Menu.Item key='logout'>
          <span className='flex items-center gap-8px'>
            <Logout theme='outline' size='14' />
            {t('settings.googleLogout')}
          </span>
        </Menu.Item>
      )}
    </Menu>
  );

  return (
    <div className={classNames('shrink-0 sider-footer', styles.footer)}>
      <div className={classNames(styles.footerRow, collapsed && styles.footerRowCollapsed)}>
        <Tooltip {...siderTooltipProps} content={primaryLabel} position='right'>
          <Button
            type='text'
            aria-label={`${displayName} — ${primaryLabel}`}
            data-testid='sider-footer-user'
            onClick={onSettingsClick}
            className={classNames(styles.footerUser, isMobile && 'sider-footer-btn-mobile', {
              [styles.footerUserActive]: isSettings,
              [styles.footerUserCollapsed]: collapsed,
            })}
          >
            <span className={styles.avatar} aria-hidden='true'>
              {isSettings ? <ArrowCircleLeft theme='outline' size='14' fill='currentColor' /> : initial}
            </span>
            {!collapsed && (
              <span className={styles.footerText}>
                <span className={styles.footerName}>{displayName}</span>
                <span className={styles.footerHint}>{primaryLabel}</span>
              </span>
            )}
          </Button>
        </Tooltip>
        {/* The account menu stays available in the icon rail too. */}
        <Dropdown
          droplist={menu}
          trigger='click'
          position={collapsed ? 'tl' : 'tr'}
          popupVisible={menuVisible}
          onVisibleChange={setMenuVisible}
          getPopupContainer={() => document.body}
        >
          <Button
            type='text'
            aria-label={t('conversation.sidebar.footer.menu')}
            aria-haspopup='menu'
            aria-expanded={menuVisible}
            data-testid='sider-footer-menu'
            className={classNames(styles.footerMenuButton, isMobile && 'sider-action-icon-btn-mobile')}
            icon={<MoreOne theme='outline' size='16' fill='currentColor' />}
          />
        </Dropdown>
      </div>
    </div>
  );
};

export default SiderFooter;

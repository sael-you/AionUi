/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { MoreOne, Pushpin } from '@icon-park/react';
import classNames from 'classnames';
import React, { useState } from 'react';

export type SiderMenuItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
};

export type SiderItemProps = {
  icon: React.ReactNode;
  name: string;
  selected?: boolean;
  pinned?: boolean;
  menuItems?: SiderMenuItem[];
  onMenuAction?: (key: string) => void;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Stable key for the sidebar tree's keyboard navigation. */
  treeKey?: string;
  /** Tree level (sidebar keyboard navigation). */
  treeLevel?: number;
};

const SiderItem: React.FC<SiderItemProps> = ({
  icon,
  name,
  selected,
  pinned,
  menuItems,
  onMenuAction,
  onClick,
  onContextMenu,
  treeKey,
  treeLevel = 2,
}) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;

  const hasMenu = menuItems && menuItems.length > 0;

  return (
    <Tooltip
      content={name}
      disabled={!name}
      trigger='hover'
      popupVisible={name ? undefined : false}
      unmountOnExit
      popupHoverStay={false}
      position='top'
    >
      <div
        className={classNames(
          'h-30px max-md:h-40px rd-6px flex items-center gap-6px ps-8px pe-8px cursor-pointer relative overflow-hidden shrink-0 group min-w-0 transition-colors outline-none focus-visible:shadow-[inset_0_0_0_2px_rgb(var(--primary-6))]',
          {
            'hover:bg-fill-3': !selected,
            '!bg-fill-3': selected,
          }
        )}
        role='treeitem'
        tabIndex={-1}
        aria-level={treeLevel}
        aria-selected={Boolean(selected)}
        aria-current={selected ? 'page' : undefined}
        data-tree-item=''
        data-tree-level={treeLevel}
        data-tree-key={treeKey}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onClick?.();
          } else if (hasMenu && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            setMenuVisible(true);
          }
        }}
      >
        {/* Leading icon — pushpin overlays this slot on hover when row is pinned */}
        <span className='size-20px flex items-center justify-center shrink-0 line-height-0 text-t-primary relative'>
          <span
            className={classNames('flex items-center justify-center', {
              'group-hover:opacity-0 transition-opacity': hasMenu && pinned,
            })}
          >
            {icon}
          </span>
          {hasMenu && pinned && (
            <span
              className='absolute inset-0 flex-center text-t-secondary pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity'
              style={{ lineHeight: 0 }}
            >
              <Pushpin theme='outline' size='14' />
            </span>
          )}
        </span>

        {/* Name with truncation — reserve room for the hover three-dot menu */}
        <div className='h-20px min-w-0 flex-1 overflow-hidden pe-12px'>
          <div className='overflow-hidden text-ellipsis block w-full text-13px max-md:text-15px font-[500] lh-20px whitespace-nowrap min-w-0 text-t-primary'>
            <span className='block overflow-hidden text-ellipsis whitespace-nowrap'>{name}</span>
          </div>
        </div>

        {/* Hover/active actions: three-dot menu */}
        {hasMenu && (
          <div
            className={classNames('absolute end-8px top-1/2 -translate-y-1/2 items-center justify-end', {
              flex: isMobile || menuVisible,
              'hidden group-hover:flex': !isMobile && !menuVisible,
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <Dropdown
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    setMenuVisible(false);
                    onMenuAction?.(key);
                  }}
                >
                  {menuItems.map((item) => (
                    <Menu.Item key={item.key}>
                      <div
                        className={classNames('flex items-center gap-8px', {
                          'text-[rgb(var(--warning-6))]': item.danger,
                        })}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </div>
                    </Menu.Item>
                  ))}
                </Menu>
              }
              trigger='click'
              position='br'
              popupVisible={menuVisible}
              onVisibleChange={setMenuVisible}
              getPopupContainer={() => document.body}
              unmountOnExit={false}
            >
              <span
                role='button'
                tabIndex={-1}
                aria-label={name}
                aria-haspopup='menu'
                data-testid='sider-item-menu-trigger'
                className={classNames(
                  'flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
                  {
                    flex: isMobile || menuVisible,
                    'hidden group-hover:flex': !isMobile && !menuVisible,
                  }
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuVisible(true);
                }}
              >
                <MoreOne theme='outline' size='14' fill='currentColor' className='block leading-none' />
              </span>
            </Dropdown>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default SiderItem;

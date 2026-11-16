/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One library card (C33): category tile, name, two-line description, chips,
 * the "On in <scope>" switch and a ⋯ menu. The name is the card's focusable
 * control (Enter opens the drawer; the arrow keys move between cards); a click
 * anywhere else on the card opens the drawer too. In batch mode the tile turns
 * into a checkbox and a click selects.
 */

import { Button, Checkbox, Dropdown, Menu, Switch } from '@arco-design/web-react';
import { More } from '@icon-park/react';
import classNames from 'classnames';
import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryIcon, type CategoryVisualId } from './categoryVisual';
import styles from './Library.module.css';

export type LibraryCardMenuItem = {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type LibraryCardToggle = {
  checked: boolean;
  /** "On in TB-test" — also the switch's accessible name. */
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (checked: boolean) => void;
};

export type LibraryCardProps = {
  /** Stable id (skill name, instance id, template id) for test ids. */
  id: string;
  name: string;
  description?: string;
  visual: CategoryVisualId | null;
  visualKey?: string;
  /** Source / status chips. */
  chips?: React.ReactNode;
  /** A primary action instead of (or next to) the switch, e.g. "Add" in the market. */
  action?: React.ReactNode;
  toggle?: LibraryCardToggle | null;
  menu?: LibraryCardMenuItem[];
  batch?: { selected: boolean; onChange: (selected: boolean) => void } | null;
  highlighted?: boolean;
  onOpen: () => void;
};

const LibraryCard: React.FC<LibraryCardProps> = ({
  id,
  name,
  description,
  visual,
  visualKey,
  chips,
  action,
  toggle,
  menu,
  batch,
  highlighted,
  onOpen,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const activate = () => (batch ? batch.onChange(!batch.selected) : onOpen());

  return (
    <article
      className={classNames(styles.card, highlighted && styles.cardHighlighted, batch?.selected && styles.cardSelected)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-testid='library-card'
      data-card-id={id}
      onClick={activate}
    >
      <div className={styles.cardTop}>
        {batch ? (
          <span className={styles.cardCheck} onClick={(event) => event.stopPropagation()}>
            <Checkbox
              checked={batch.selected}
              onChange={(checked: boolean) => batch.onChange(checked)}
              aria-label={t('settings.library.selectNamed', { name })}
              data-testid='library-card-select'
            />
          </span>
        ) : (
          <CategoryIcon visual={visual} fallbackKey={visualKey} />
        )}
        <div className={styles.cardHeading}>
          <Button
            type='text'
            id={titleId}
            className={styles.cardName}
            data-library-card-focus=''
            aria-pressed={batch ? batch.selected : undefined}
            onClick={(event) => {
              event.stopPropagation();
              activate();
            }}
            data-testid='library-card-open'
          >
            {name}
          </Button>
        </div>
        {menu && menu.length > 0 && !batch ? (
          <span onClick={(event) => event.stopPropagation()}>
            <Dropdown
              trigger='click'
              position='br'
              droplist={
                <Menu
                  onClickMenuItem={(key) => menu.find((item) => item.key === key)?.onClick()}
                  data-testid='library-card-menu'
                >
                  {menu.map((item) => (
                    <Menu.Item
                      key={item.key}
                      disabled={item.disabled}
                      className={item.danger ? styles.menuDanger : undefined}
                    >
                      {item.label}
                    </Menu.Item>
                  ))}
                </Menu>
              }
            >
              <Button
                type='text'
                size='small'
                icon={<More theme='outline' size={16} />}
                aria-label={t('settings.library.moreActions', { name })}
                aria-haspopup='menu'
                data-testid='library-card-more'
              />
            </Dropdown>
          </span>
        ) : null}
      </div>
      {chips ? <div className={styles.cardChips}>{chips}</div> : null}
      {description ? (
        <p id={descriptionId} className={styles.cardDescription} title={description}>
          {description}
        </p>
      ) : null}
      {(toggle || action) && !batch ? (
        <div className={styles.cardFooter} onClick={(event) => event.stopPropagation()}>
          {toggle ? (
            <label className={styles.cardToggle}>
              <Switch
                size='small'
                checked={toggle.checked}
                disabled={toggle.disabled}
                loading={toggle.loading}
                aria-label={toggle.label}
                onChange={toggle.onChange}
                data-testid='library-card-toggle'
              />
              <span aria-hidden='true'>{toggle.label}</span>
            </label>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
    </article>
  );
};

export default LibraryCard;

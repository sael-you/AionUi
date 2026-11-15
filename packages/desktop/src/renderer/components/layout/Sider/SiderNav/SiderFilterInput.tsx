/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Search } from '@icon-park/react';
import { isMacOS } from '@renderer/utils/platform';
import styles from '../Sider.module.css';

type SiderFilterInputProps = {
  value: string;
  onChange: (value: string) => void;
  inputRef: React.Ref<RefInputType>;
  /** Move focus into the list (↓ from the field). */
  onFocusList?: () => void;
};

/** Filters projects and conversations by name. Ctrl/Cmd+K focuses it; Escape clears it. */
const SiderFilterInput: React.FC<SiderFilterInputProps> = ({ value, onChange, inputRef, onFocusList }) => {
  const { t } = useTranslation();
  const shortcut = isMacOS() ? '⌘K' : 'Ctrl K';
  return (
    <div className={styles.filterRow}>
      <Input
        ref={inputRef}
        size='small'
        value={value}
        onChange={onChange}
        allowClear
        placeholder={t('conversation.sidebar.filter.placeholder')}
        aria-label={t('conversation.sidebar.filter.label')}
        data-testid='sider-filter'
        prefix={<Search theme='outline' size='14' fill='currentColor' />}
        suffix={value ? undefined : <span className={styles.filterShortcut}>{shortcut}</span>}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange('');
          } else if (event.key === 'ArrowDown' && onFocusList) {
            event.preventDefault();
            onFocusList();
          }
        }}
      />
    </div>
  );
};

export default SiderFilterInput;

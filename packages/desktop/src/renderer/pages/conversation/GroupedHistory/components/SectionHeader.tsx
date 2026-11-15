/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { treeArrowIntent } from '@/renderer/hooks/ui/useRovingTree';
import { Right } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import styles from './SidebarTree.module.css';

type SectionHeaderProps = {
  /** Stable key, used for the tree and tests (`section-header-<key>`). */
  sectionKey: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Number shown after the label (e.g. projects). */
  count?: number;
  /** Trailing actions (e.g. "+"); clicks do not toggle the section. */
  trailing?: React.ReactNode;
  className?: string;
  /** Test id (default `section-header-<sectionKey>`). */
  testId?: string;
  /** Id of the section's `role="group"` (owned by this header while expanded). */
  groupId?: string;
};

/** Id of a sidebar section's row group. */
export const sectionGroupId = (sectionKey: string) => `sider-section-${sectionKey}`;

/**
 * Sidebar section header (Pinned, Teams, Projects, Conversations): 24px,
 * small uppercase, muted; a top-level tree node that collapses its section.
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({
  sectionKey,
  label,
  expanded,
  onToggle,
  count,
  trailing,
  className,
  testId,
  groupId,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
      return;
    }
    const intent = treeArrowIntent(event);
    if ((intent === 'expand' && !expanded) || (intent === 'collapse' && expanded)) {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className={classNames(styles.sectionHeader, 'sider-section-label', className)}
      role='treeitem'
      tabIndex={-1}
      aria-level={1}
      aria-expanded={expanded}
      aria-owns={expanded && groupId ? groupId : undefined}
      aria-label={count === undefined ? label : `${label} (${count})`}
      data-tree-item=''
      data-tree-level={1}
      data-tree-key={`section:${sectionKey}`}
      data-testid={testId ?? `section-header-${sectionKey}`}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
    >
      <span className={styles.chevron} aria-hidden='true'>
        <Right
          theme='outline'
          size={10}
          className={classNames(styles.chevronIcon, { [styles.chevronExpanded]: expanded })}
        />
      </span>
      <span className={classNames(styles.sectionTitle, 'sider-section-title')}>{label}</span>
      {count !== undefined && (
        <span className={styles.sectionCount} aria-hidden='true'>
          {count}
        </span>
      )}
      {trailing && (
        <span
          className={styles.sectionTrailing}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {trailing}
        </span>
      )}
    </div>
  );
};

export default SectionHeader;

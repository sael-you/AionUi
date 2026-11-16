/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A collapsible group of cards (C33): a source group on the Active tab ("This
 * project's kit", "From Global", a shared kit) or a category on the Library /
 * Market tab. The header toggles the group (aria-expanded) and carries the
 * group's actions; the body is the card grid, where the arrow keys move focus
 * between cards (Home / End to the first / last).
 */

import { Button } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryIcon, type CategoryVisualId } from './categoryVisual';
import { gridMove } from './libraryModel';
import styles from './Library.module.css';

export type LibrarySectionProps = {
  /** Stable key, for test ids. */
  sectionKey: string;
  title: string;
  count: number;
  /** One quiet line under the title ("Read-only here — manage it in Global"). */
  hint?: string;
  visual?: CategoryVisualId | null;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  /** `list` for full-width rows (e.g. the editable custom MCP servers) instead of the card grid. */
  layout?: 'grid' | 'list';
  children: React.ReactNode;
};

/** Columns the grid renders right now (read from the computed style; 1 in jsdom). */
const renderedColumns = (grid: HTMLElement): number => {
  const template = typeof window !== 'undefined' ? window.getComputedStyle(grid).gridTemplateColumns : '';
  const columns = template ? template.split(' ').filter(Boolean).length : 1;
  return Math.max(1, columns);
};

/** Arrow-key focus movement between the cards of one grid. */
export const onGridKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
  const grid = event.currentTarget;
  const targets = [...grid.querySelectorAll<HTMLElement>('[data-library-card-focus]')];
  const index = targets.findIndex((el) => el === document.activeElement);
  if (index < 0) return;
  const next = gridMove(index, event.key, renderedColumns(grid), targets.length);
  if (next === null) return;
  event.preventDefault();
  targets[next].focus();
};

const LibrarySection: React.FC<LibrarySectionProps> = ({
  sectionKey,
  title,
  count,
  hint,
  visual,
  actions,
  defaultExpanded = true,
  layout = 'grid',
  children,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();
  const titleId = useId();

  return (
    <section
      className={styles.section}
      aria-labelledby={titleId}
      data-testid='library-section'
      data-section-key={sectionKey}
    >
      <div className={styles.sectionHeader}>
        <Button
          type='text'
          className={styles.sectionToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          data-testid='library-section-toggle'
        >
          {expanded ? <Down theme='outline' size={14} /> : <Right theme='outline' size={14} className='rtl-mirror' />}
          {visual !== undefined ? <CategoryIcon visual={visual} fallbackKey={sectionKey} size='small' /> : null}
          <span id={titleId} className={styles.sectionTitle}>
            {title}
          </span>
          <span className={styles.sectionCount} aria-label={t('settings.library.count', { count })}>
            {count}
          </span>
        </Button>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </div>
      {hint ? <p className={styles.sectionHint}>{hint}</p> : null}
      <div id={bodyId} hidden={!expanded}>
        {expanded ? (
          <div
            className={layout === 'list' ? styles.list : styles.grid}
            onKeyDown={onGridKeyDown}
            data-testid='library-grid'
          >
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default LibrarySection;

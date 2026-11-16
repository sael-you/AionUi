/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one "library" layout of the Skills and Tools pages (C33, TASK-119):
 *
 *   header: title · search ("/" focuses it) · page actions
 *   rail:   SCOPE + CATEGORIES (two chips with bottom sheets on phones)
 *   main:   scope name + one-line summary, tabs (Active · Library / Market),
 *           source filter chips, then the page's sections of cards.
 *
 * The page owns the data; this component owns layout, tabs semantics and
 * keyboard entry points.
 */

import { Button, Radio } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useEffect, useId, useRef } from 'react';
import { AionSearchInput } from '@/renderer/components/base';
import SettingsPageHeader from '@/renderer/pages/settings/components/SettingsPageHeader';
import LibraryRail, { type LibraryRailProps } from './LibraryRail';
import styles from './Library.module.css';

export type LibraryTab = { key: string; label: string; count?: number };
export type LibrarySource = { key: string; label: string };

export type LibraryLayoutProps = {
  testId: string;
  title: string;
  description?: React.ReactNode;
  /** Page actions next to the search (Add, Import history, …). */
  headerActions?: React.ReactNode;
  search: { value: string; onChange: (value: string) => void; placeholder: string };
  rail: Omit<LibraryRailProps, 'isMobile'>;
  /** Scope name (a project chip or "Global"). */
  scopeTitle: React.ReactNode;
  /** "14 active · 3 from Global · 2 kits". */
  summary?: string;
  tabs: LibraryTab[];
  activeTab: string;
  onTab: (key: string) => void;
  tabsLabel: string;
  sources?: LibrarySource[];
  source?: string;
  onSource?: (key: string) => void;
  sourcesLabel?: string;
  /** Extra controls on the tabs row (e.g. "Select"). */
  toolbar?: React.ReactNode;
  /** Sticky bottom bar (batch mode). */
  batchBar?: React.ReactNode;
  isMobile: boolean;
  children: React.ReactNode;
};

/** True when a key press should not be taken over (typing in a field). */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

const LibraryTabs: React.FC<{
  tabs: LibraryTab[];
  activeTab: string;
  onTab: (key: string) => void;
  label: string;
  idPrefix: string;
}> = ({ tabs, activeTab, onTab, label, idPrefix }) => {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.key === activeTab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : step
            ? (index + step + tabs.length) % tabs.length
            : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = tabs[target];
    onTab(next.key);
    refs.current[next.key]?.focus();
  };
  return (
    <div role='tablist' aria-label={label} className={styles.tabs} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.key === activeTab;
        return (
          <Button
            key={tab.key}
            ref={(el: HTMLButtonElement | null) => {
              refs.current[tab.key] = el;
            }}
            type='text'
            role='tab'
            id={`${idPrefix}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            className={classNames(styles.tab, selected && styles.tabSelected)}
            onClick={() => onTab(tab.key)}
            data-testid={`library-tab-${tab.key}`}
          >
            {tab.label}
            {typeof tab.count === 'number' ? <span className={styles.tabCount}>{tab.count}</span> : null}
          </Button>
        );
      })}
    </div>
  );
};

const LibraryLayout: React.FC<LibraryLayoutProps> = ({
  testId,
  title,
  description,
  headerActions,
  search,
  rail,
  scopeTitle,
  summary,
  tabs,
  activeTab,
  onTab,
  tabsLabel,
  sources,
  source,
  onSource,
  sourcesLabel,
  toolbar,
  batchBar,
  isMobile,
  children,
}) => {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const idPrefix = `library-${useId().replace(/:/g, '')}`;

  // "/" focuses the search, unless the owner is typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchBox = (
    <AionSearchInput
      ref={searchRef}
      value={search.value}
      onChange={search.onChange}
      placeholder={search.placeholder}
      className={isMobile ? styles.searchMobile : styles.search}
      data-testid='library-search'
      inputProps={{ 'aria-label': search.placeholder, 'aria-keyshortcuts': '/' }}
    />
  );

  return (
    <div className={styles.page} data-testid={testId}>
      <SettingsPageHeader
        title={title}
        description={description}
        actions={
          <>
            {isMobile ? null : searchBox}
            {headerActions}
          </>
        }
      />
      <div className={styles.body}>
        {isMobile ? null : <LibraryRail {...rail} isMobile={false} />}
        <main className={styles.main} aria-labelledby={`${idPrefix}-scope`}>
          {isMobile ? (
            <>
              {searchBox}
              <LibraryRail {...rail} isMobile />
            </>
          ) : null}
          <div className={styles.scopeLine}>
            <h2 id={`${idPrefix}-scope`} className={styles.scopeTitle} data-testid='library-scope-title'>
              {scopeTitle}
            </h2>
            {summary ? (
              <span className={styles.summary} data-testid='library-summary'>
                {summary}
              </span>
            ) : null}
          </div>
          <div className={styles.tabsRow}>
            <LibraryTabs tabs={tabs} activeTab={activeTab} onTab={onTab} label={tabsLabel} idPrefix={idPrefix} />
            <div className={styles.tabsTools}>
              {sources && sources.length > 0 && onSource ? (
                <Radio.Group
                  type='button'
                  size='small'
                  value={source}
                  onChange={(value: string) => onSource(value)}
                  aria-label={sourcesLabel}
                  className={styles.sources}
                  data-testid='library-sources'
                >
                  {sources.map((entry) => (
                    <Radio key={entry.key} value={entry.key}>
                      {entry.label}
                    </Radio>
                  ))}
                </Radio.Group>
              ) : null}
              {toolbar}
            </div>
          </div>
          <div
            role='tabpanel'
            id={`${idPrefix}-panel`}
            aria-labelledby={`${idPrefix}-tab-${activeTab}`}
            className={styles.panel}
            data-testid='library-panel'
          >
            {children}
          </div>
          {batchBar}
        </main>
      </div>
    </div>
  );
};

export default LibraryLayout;

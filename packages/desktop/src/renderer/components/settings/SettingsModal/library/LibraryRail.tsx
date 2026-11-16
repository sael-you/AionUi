/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The library rail (C33): SCOPE (Global, projects with something — each in its
 * sidebar colour —, empty projects folded into "N empty ▸") and CATEGORIES
 * with counts. On phones it becomes two chips (Scope ▾, Category ▾) that open
 * bottom sheets with the same lists.
 */

import { Button, Drawer } from '@arco-design/web-react';
import { Down, Earth, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import type { RailCategory, RailScope, RailScopes } from './libraryModel';
import { GLOBAL_SCOPE_KEY } from './libraryModel';
import styles from './Library.module.css';

export type LibraryRailProps = {
  scopes: RailScopes;
  selectedScope: string;
  onScope: (key: string) => void;
  categories: RailCategory[];
  selectedCategory: string;
  onCategory: (key: string) => void;
  isMobile: boolean;
};

/** The scope's marker: the project's sidebar colour, or a globe for Global. */
const ScopeMarker: React.FC<{ scope: RailScope }> = ({ scope }) => {
  const theme = useProjectTheme(scope.workspace);
  if (scope.key === GLOBAL_SCOPE_KEY) return <Earth theme='outline' size={14} aria-hidden='true' />;
  return (
    <span
      className={styles.scopeDot}
      style={theme?.style}
      data-project-color={theme?.colorId}
      aria-hidden='true'
      data-testid='library-scope-dot'
    />
  );
};

const RailItem: React.FC<{
  label: string;
  count: number;
  selected: boolean;
  marker?: React.ReactNode;
  onClick: () => void;
  testId: string;
  itemKey: string;
}> = ({ label, count, selected, marker, onClick, testId, itemKey }) => {
  const { t } = useTranslation();
  return (
    <li>
      <Button
        type='text'
        long
        className={classNames(styles.railItem, selected && styles.railItemSelected)}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${label}, ${t('settings.library.count', { count })}`}
        onClick={onClick}
        data-testid={testId}
        data-key={itemKey}
      >
        {marker}
        <span className={styles.railLabel}>{label}</span>
        <span className={styles.railCount} aria-hidden='true'>
          {count}
        </span>
      </Button>
    </li>
  );
};

const ScopeList: React.FC<Pick<LibraryRailProps, 'scopes' | 'selectedScope' | 'onScope'>> = ({
  scopes,
  selectedScope,
  onScope,
}) => {
  const { t } = useTranslation();
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyId = useId();
  return (
    <>
      <ul className={styles.railList}>
        {scopes.shown.map((scope) => (
          <RailItem
            key={scope.key}
            itemKey={scope.key}
            label={scope.label}
            count={scope.count}
            selected={scope.key === selectedScope}
            marker={<ScopeMarker scope={scope} />}
            onClick={() => onScope(scope.key)}
            testId='library-rail-scope'
          />
        ))}
      </ul>
      {scopes.empty.length > 0 ? (
        <>
          <Button
            type='text'
            long
            className={styles.railFold}
            aria-expanded={showEmpty}
            aria-controls={emptyId}
            onClick={() => setShowEmpty((value) => !value)}
            data-testid='library-rail-empty-toggle'
          >
            {showEmpty ? (
              <Down theme='outline' size={12} />
            ) : (
              <Right theme='outline' size={12} className='rtl-mirror' />
            )}
            <span>{t('settings.library.emptyProjects', { count: scopes.empty.length })}</span>
          </Button>
          <ul id={emptyId} className={styles.railList} hidden={!showEmpty} data-testid='library-rail-empty-list'>
            {showEmpty
              ? scopes.empty.map((scope) => (
                  <RailItem
                    key={scope.key}
                    itemKey={scope.key}
                    label={scope.label}
                    count={scope.count}
                    selected={false}
                    marker={<ScopeMarker scope={scope} />}
                    onClick={() => onScope(scope.key)}
                    testId='library-rail-scope'
                  />
                ))
              : null}
          </ul>
        </>
      ) : null}
    </>
  );
};

const CategoryList: React.FC<Pick<LibraryRailProps, 'categories' | 'selectedCategory' | 'onCategory'>> = ({
  categories,
  selectedCategory,
  onCategory,
}) => (
  <ul className={styles.railList}>
    {categories.map((category) => (
      <RailItem
        key={category.key}
        itemKey={category.key}
        label={category.label}
        count={category.count}
        selected={category.key === selectedCategory}
        onClick={() => onCategory(category.key)}
        testId='library-rail-category'
      />
    ))}
  </ul>
);

const LibraryRail: React.FC<LibraryRailProps> = (props) => {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'scope' | 'category' | null>(null);
  const scopeHeadingId = useId();
  const categoryHeadingId = useId();
  const { scopes, selectedScope, categories, selectedCategory, isMobile } = props;

  if (isMobile) {
    const scopeLabel =
      [...scopes.shown, ...scopes.empty].find((scope) => scope.key === selectedScope)?.label ??
      t('settings.library.scopeGlobal');
    const categoryLabel = categories.find((category) => category.key === selectedCategory)?.label ?? '';
    return (
      <div className={styles.mobileRail} data-testid='library-rail-mobile'>
        <Button
          shape='round'
          className={styles.mobileChip}
          aria-haspopup='dialog'
          onClick={() => setSheet('scope')}
          data-testid='library-rail-scope-chip'
        >
          <span className={styles.mobileChipLabel}>{t('settings.library.scopeChip', { name: scopeLabel })}</span>
          <Down theme='outline' size={12} />
        </Button>
        <Button
          shape='round'
          className={styles.mobileChip}
          aria-haspopup='dialog'
          onClick={() => setSheet('category')}
          data-testid='library-rail-category-chip'
        >
          <span className={styles.mobileChipLabel}>{t('settings.library.categoryChip', { name: categoryLabel })}</span>
          <Down theme='outline' size={12} />
        </Button>
        <Drawer
          placement='bottom'
          height='auto'
          visible={sheet !== null}
          title={sheet === 'category' ? t('settings.library.categories') : t('settings.library.scope')}
          footer={null}
          onCancel={() => setSheet(null)}
          bodyStyle={{ maxHeight: '70vh', overflowY: 'auto', paddingBottom: 16 }}
          unmountOnExit
        >
          {sheet === 'scope' ? (
            <ScopeList
              scopes={scopes}
              selectedScope={selectedScope}
              onScope={(key) => {
                props.onScope(key);
                setSheet(null);
              }}
            />
          ) : null}
          {sheet === 'category' ? (
            <CategoryList
              categories={categories}
              selectedCategory={selectedCategory}
              onCategory={(key) => {
                props.onCategory(key);
                setSheet(null);
              }}
            />
          ) : null}
        </Drawer>
      </div>
    );
  }

  return (
    <nav className={styles.rail} aria-label={t('settings.library.railLabel')} data-testid='library-rail'>
      <h2 id={scopeHeadingId} className={styles.railHeading}>
        {t('settings.library.scope')}
      </h2>
      <div role='group' aria-labelledby={scopeHeadingId}>
        <ScopeList scopes={scopes} selectedScope={selectedScope} onScope={props.onScope} />
      </div>
      <h2 id={categoryHeadingId} className={styles.railHeading}>
        {t('settings.library.categories')}
      </h2>
      <div role='group' aria-labelledby={categoryHeadingId}>
        <CategoryList categories={categories} selectedCategory={selectedCategory} onCategory={props.onCategory} />
      </div>
    </nav>
  );
};

export default LibraryRail;

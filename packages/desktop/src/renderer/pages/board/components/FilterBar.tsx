/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Input, Switch, Tooltip } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_CARD_TYPES, BOARD_PRIORITIES, type BoardCardSummary } from '@/common/types/board';
import { BoardSelect } from '@/renderer/components/board/BoardSelect';
import { assigneeLabel } from '@/renderer/components/board/utils/boardFormat';

import { EMPTY_FILTERS, filterOptions, isFiltering, UNASSIGNED, type BoardFilters } from '../utils/boardFilters';

/** Filter bar: search, type, priority, assignee, label, skill, blocked, mine — and the archived toggle. */
export const FilterBar: React.FC<{
  cards: BoardCardSummary[];
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
  visibleCount: number;
  totalCount: number;
}> = ({ cards, filters, onChange, includeArchived, onIncludeArchivedChange, visibleCount, totalCount }) => {
  const { t } = useTranslation();
  const options = useMemo(() => filterOptions(cards), [cards]);
  const set = <K extends keyof BoardFilters>(key: K, value: BoardFilters[K]) => onChange({ ...filters, [key]: value });
  const filtering = isFiltering(filters);
  const selectClass = 'min-w-140px max-w-200px';

  return (
    <div
      role='search'
      aria-label={t('board.filters.title')}
      className='flex flex-wrap items-center gap-8px px-16px py-8px'
    >
      <Input
        size='small'
        allowClear
        className='w-220px'
        prefix={<Search theme='outline' size='14' fill='currentColor' aria-hidden />}
        value={filters.search}
        onChange={(value) => set('search', value)}
        placeholder={t('board.filters.searchPlaceholder')}
        aria-label={t('board.filters.search')}
      />
      <BoardSelect
        ariaLabel={t('board.type.label')}
        size='small'
        mode='multiple'
        maxTagCount={1}
        allowClear
        className={selectClass}
        placeholder={t('board.filters.anyType')}
        value={filters.types}
        onChange={(value) => set('types', value)}
        options={BOARD_CARD_TYPES.map((type) => ({ value: type, label: t(`board.type.${type}`) }))}
      />
      <BoardSelect
        ariaLabel={t('board.priority.label')}
        size='small'
        mode='multiple'
        maxTagCount={1}
        allowClear
        className={selectClass}
        placeholder={t('board.filters.anyPriority')}
        value={filters.priorities}
        onChange={(value) => set('priorities', value)}
        options={BOARD_PRIORITIES.map((priority) => ({ value: priority, label: t(`board.priority.${priority}`) }))}
      />
      <BoardSelect
        ariaLabel={t('board.filters.assignee')}
        size='small'
        mode='multiple'
        maxTagCount={1}
        allowClear
        className={selectClass}
        placeholder={t('board.filters.anyAssignee')}
        value={filters.assignees}
        onChange={(value) => set('assignees', value)}
        options={options.assignees.map((option) => ({
          value: option.value,
          label:
            option.value === UNASSIGNED || !option.card ? t('board.card.unassigned') : assigneeLabel(option.card, t),
        }))}
      />
      {options.labels.length > 0 && (
        <BoardSelect
          ariaLabel={t('board.filters.label')}
          size='small'
          mode='multiple'
          maxTagCount={1}
          allowClear
          className={selectClass}
          placeholder={t('board.filters.anyLabel')}
          value={filters.labels}
          onChange={(value) => set('labels', value)}
          options={options.labels}
        />
      )}
      {options.skills.length > 0 && (
        <BoardSelect
          ariaLabel={t('board.filters.skill')}
          size='small'
          mode='multiple'
          maxTagCount={1}
          allowClear
          className={selectClass}
          placeholder={t('board.filters.anySkill')}
          value={filters.skills}
          onChange={(value) => set('skills', value)}
          options={options.skills}
        />
      )}
      <Checkbox checked={filters.blockedOnly} onChange={(value) => set('blockedOnly', value)}>
        {t('board.filters.blocked')}
      </Checkbox>
      <Tooltip content={t('board.filters.mineTooltip')} mini>
        <span>
          <Checkbox checked={filters.mine} onChange={(value) => set('mine', value)}>
            {t('board.filters.mine')}
          </Checkbox>
        </span>
      </Tooltip>
      <label className='flex items-center gap-6px text-13px text-t-primary'>
        <Switch size='small' checked={includeArchived} onChange={onIncludeArchivedChange} />
        {t('board.filters.showArchived')}
      </label>
      {filtering && (
        <Button size='mini' type='text' onClick={() => onChange(EMPTY_FILTERS)}>
          {t('board.filters.clear')}
        </Button>
      )}
      <span className='ms-auto text-12px text-t-secondary' aria-live='polite'>
        {filtering
          ? t('board.showing', { visible: visibleCount, count: totalCount })
          : t('board.cardCount', { count: totalCount })}
      </span>
    </div>
  );
};

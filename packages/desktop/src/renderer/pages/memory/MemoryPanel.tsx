/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Checkbox, Empty, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import type { MemoryItem } from '@/common/types/memory';
import { useBoardNarrow } from '@/renderer/components/board/hooks/useMediaQuery';

import { MemoryDetail } from './MemoryDetail';
import {
  EMPTY_MEMORY_FILTERS,
  MEMORY_TYPES,
  filterMemories,
  groupMemories,
  lintByFile,
  missingFileIssues,
  type MemoryFilters,
} from './memoryModel';
import { useMemoryReview } from './useMemoryReview';

export const memoryListKey = (projectId: string) => ['memory-list', projectId] as const;

/** Bodies are fetched for content search at most this many at a time. */
const BODY_FETCH_CONCURRENCY = 6;

type Props = {
  projectId: string;
  /** The project's workspace root (where "Review with AI" runs); null while unknown. */
  workspace: string | null;
};

/** Memory review of one project (C29 §3): grouped list, filters, detail, Review with AI. */
export const MemoryPanel: React.FC<Props> = ({ projectId, workspace }) => {
  const { t } = useTranslation();
  const narrow = useBoardNarrow();
  const { data, error, isLoading, mutate } = useSWR(memoryListKey(projectId), ([, pid]) =>
    ipcBridge.memory.list.invoke({ project_id: pid })
  );
  const [filters, setFilters] = useState<MemoryFilters>(EMPTY_MEMORY_FILTERS);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bodies, setBodies] = useState<ReadonlyMap<string, string>>(new Map());
  const [loadingBodies, setLoadingBodies] = useState(false);
  const review = useMemoryReview(workspace);

  // Lint "stale" is relative to now; recomputed with each list load.
  const flags = useMemo(() => (data ? lintByFile(data, Date.now()) : new Map()), [data]);
  const items = data?.items ?? [];
  const visible = useMemo(() => filterMemories(items, filters, flags, bodies), [items, filters, flags, bodies]);
  const groups = useMemo(() => groupMemories(visible), [visible]);
  const missing = data ? missingFileIssues(data) : [];
  const openItem = items.find((item) => item.file === openFile) ?? null;

  const setFilter = (patch: Partial<MemoryFilters>) => setFilters((current) => ({ ...current, ...patch }));

  /** Content search: load the bodies not loaded yet (on demand, a few at a time). */
  const loadBodies = async () => {
    const missingBodies = items.filter((item) => !bodies.has(item.file));
    setLoadingBodies(true);
    const loaded = new Map(bodies);
    for (let i = 0; i < missingBodies.length; i += BODY_FETCH_CONCURRENCY) {
      const batch = missingBodies.slice(i, i + BODY_FETCH_CONCURRENCY);
      // Batches on purpose: at most BODY_FETCH_CONCURRENCY requests at a time.
      // oxlint-disable-next-line no-await-in-loop
      const results = await Promise.allSettled(
        batch.map((item) => ipcBridge.memory.get.invoke({ project_id: projectId, file: item.file }))
      );
      results.forEach((result, n) => {
        if (result.status === 'fulfilled') loaded.set(batch[n].file, result.value.body);
      });
    }
    setBodies(loaded);
    setLoadingBodies(false);
  };

  const toggleSelected = (file: string, on: boolean) =>
    setSelected((current) => (on ? [...current, file] : current.filter((f) => f !== file)));

  const onChanged = () => {
    setBodies(new Map());
    void mutate();
  };

  if (isLoading) return <Spin className='m-24px' />;
  if (error) return <Alert className='m-16px' type='error' content={t('memory.loadFailed')} />;
  if (data && !data.dir_exists) {
    return <Empty className='m-24px' description={t('memory.noMemory')} />;
  }

  const showList = !narrow || !openItem;
  const showDetail = Boolean(openItem) && (!narrow || openItem);

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex flex-wrap items-center gap-8px border-0 border-b border-solid border-arco-2 p-12px'>
        <Input.Search
          allowClear
          className='w-full max-w-280px'
          placeholder={t('memory.searchPlaceholder')}
          aria-label={t('memory.searchPlaceholder')}
          value={filters.query}
          onChange={(query) => setFilter({ query })}
        />
        <Button size='small' loading={loadingBodies} onClick={() => void loadBodies()}>
          {t('memory.searchContents')}
        </Button>
        <Select
          size='small'
          className='w-160px'
          aria-label={t('memory.filters.type')}
          value={filters.type}
          onChange={(type) => setFilter({ type })}
          options={[
            { value: 'all', label: t('memory.filters.allTypes') },
            ...[...MEMORY_TYPES, 'other' as const].map((type) => ({ value: type, label: t(`memory.type.${type}`) })),
          ]}
        />
        <Checkbox checked={filters.staleOnly} onChange={(staleOnly) => setFilter({ staleOnly })}>
          {t('memory.filters.stale')}
        </Checkbox>
        <Checkbox checked={filters.issuesOnly} onChange={(issuesOnly) => setFilter({ issuesOnly })}>
          {t('memory.filters.issues')}
        </Checkbox>
        <span className='flex-1' />
        <Button
          type='primary'
          size='small'
          icon={<Robot />}
          loading={review.starting}
          disabled={!workspace}
          onClick={() => void review.start(selected)}
        >
          {selected.length > 0
            ? t('memory.review.buttonSelected', { count: selected.length })
            : t('memory.review.button')}
        </Button>
      </div>

      <div className='flex min-h-0 flex-1'>
        {showList && (
          <nav
            aria-label={t('memory.listLabel')}
            className={`min-h-0 overflow-auto p-12px ${narrow ? 'flex-1' : 'w-360px shrink-0 border-0 border-r border-solid border-arco-2'}`}
          >
            <p className='m-0 mb-8px text-12px text-t-secondary'>
              {t('memory.summary', { count: items.length, lines: data?.index_lines ?? 0 })}
            </p>
            {missing.length > 0 && (
              <Alert
                className='mb-8px'
                type='warning'
                content={t('memory.lint.missingFiles', {
                  count: missing.length,
                  files: missing.map((m) => m.file).join(', '),
                })}
              />
            )}
            {groups.length === 0 && <Empty description={t('memory.noMatches')} />}
            {groups.map((group) => (
              <section key={group.key} aria-label={t(`memory.type.${group.key}`)} className='mb-12px'>
                <h3 className='m-0 mb-4px text-13px font-600 text-t-primary'>
                  {t(`memory.type.${group.key}`)} <span className='text-t-tertiary'>({group.items.length})</span>
                </h3>
                <ul className='m-0 list-none p-0'>
                  {group.items.map((item) => (
                    <MemoryRow
                      key={item.file}
                      item={item}
                      active={item.file === openFile}
                      selected={selected.includes(item.file)}
                      issues={[...(flags.get(item.file) ?? [])]}
                      onOpen={() => setOpenFile(item.file)}
                      onSelect={(on) => toggleSelected(item.file, on)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        )}
        {showDetail && openItem && (
          <MemoryDetail
            projectId={projectId}
            item={openItem}
            items={items}
            flags={flags.get(openItem.file) ?? new Set()}
            onOpen={setOpenFile}
            onBack={narrow ? () => setOpenFile(null) : undefined}
            onChanged={onChanged}
            onDeleted={(file) => {
              setOpenFile(null);
              setSelected((current) => current.filter((f) => f !== file));
            }}
          />
        )}
        {!narrow && !openItem && (
          <div className='flex flex-1 items-center justify-center text-t-tertiary'>{t('memory.pickOne')}</div>
        )}
      </div>
    </div>
  );
};

const MemoryRow: React.FC<{
  item: MemoryItem;
  active: boolean;
  selected: boolean;
  issues: string[];
  onOpen: () => void;
  onSelect: (on: boolean) => void;
}> = ({ item, active, selected, issues, onOpen, onSelect }) => {
  const { t } = useTranslation();
  const title = item.name ?? item.file;
  return (
    <li className={`flex items-start gap-6px rounded-6px px-4px py-2px ${active ? 'bg-fill-2' : ''}`}>
      <Checkbox
        className='mt-6px'
        checked={selected}
        onChange={onSelect}
        aria-label={t('memory.selectForReview', { name: title })}
      />
      <Button type='text' long className='!h-auto !px-4px !py-4px !text-left' onClick={onOpen} aria-current={active}>
        <span className='block truncate text-13px text-t-primary'>{title}</span>
        {item.description && <span className='block truncate text-12px text-t-secondary'>{item.description}</span>}
        {issues.length > 0 && (
          <span className='mt-2px flex flex-wrap gap-4px'>
            {issues.map((kind) => (
              <Tag key={kind} size='small' color='orangered'>
                {t(`memory.lint.${kind}`)}
              </Tag>
            ))}
          </span>
        )}
      </Button>
    </li>
  );
};

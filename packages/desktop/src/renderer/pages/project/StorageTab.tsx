/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Disk usage of a project (C42): the total and its share of the disk, then each
 * root (workspace, attached folders, memory) with its top-level entries and its
 * largest files as size bars. The scan is cached by core; the first read can
 * take a few seconds and never blocks the rest of the page. "Rescan" measures now.
 */

import { Alert, Button, Tag } from '@arco-design/web-react';
import { FolderClose, Notes } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StorageRoot } from '@/common/types/platform/projectPage';
import { EmptyBlock, ErrorBlock, Panel, SizeBar, describeProjectError } from './ProjectParts';
import { formatAgo, formatBytes, percentOf } from './projectModel';
import { useProjectStorage } from './useProjectPage';

const SizeRow: React.FC<{ name: string; bytes: number; whole: number; icon?: React.ReactNode; tag?: string }> = ({
  name,
  bytes,
  whole,
  icon,
  tag,
}) => (
  <li
    className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10px gap-y-4px py-6px'
    data-testid='project-size-row'
  >
    <span className='flex items-center gap-6px min-w-0 text-13px text-t-primary'>
      {icon}
      <span className='truncate' title={name}>
        {name}
      </span>
      {tag ? (
        <Tag size='small' className='shrink-0'>
          {tag}
        </Tag>
      ) : null}
    </span>
    <span className='text-12px text-t-secondary tabular-nums whitespace-nowrap'>{formatBytes(bytes)}</span>
    <span className='col-span-2'>
      <SizeBar percent={percentOf(bytes, whole)} />
    </span>
  </li>
);

const RootPanel: React.FC<{ root: StorageRoot }> = ({ root }) => {
  const { t, i18n } = useTranslation();
  const title = t(`conversation.projectPage.storage.root.${root.label}`, { defaultValue: root.label });
  return (
    <Panel
      title={title}
      testId='project-storage-root'
      actions={<span className='text-13px font-600 text-t-primary tabular-nums'>{formatBytes(root.bytes)}</span>}
    >
      <code className='break-all text-12px text-t-secondary'>{root.path}</code>
      {!root.exists ? (
        <span className='text-12px text-t-tertiary'>{t('conversation.projectPage.storage.missing')}</span>
      ) : (
        <>
          {root.truncated ? (
            <Alert
              type='warning'
              content={t('conversation.projectPage.storage.truncated')}
              data-testid='project-storage-truncated'
            />
          ) : null}
          <span className='text-12px text-t-tertiary'>
            {t('conversation.projectPage.storage.entries', {
              count: root.entries,
              shown: root.entries.toLocaleString(i18n.language),
            })}
          </span>
          {root.children.length === 0 ? (
            <span className='text-12px text-t-tertiary'>{t('conversation.projectPage.storage.emptyRoot')}</span>
          ) : (
            <div className='grid gap-x-24px gap-y-10px lg:grid-cols-2'>
              <div className='min-w-0'>
                <h3 className='m-0 text-12px font-500 text-t-secondary'>
                  {t('conversation.projectPage.storage.topLevel')}
                </h3>
                <ul className='m-0 p-0 list-none'>
                  {root.children.map((child) => (
                    <SizeRow
                      key={`${child.kind}:${child.name}`}
                      name={child.name}
                      bytes={child.bytes}
                      whole={root.bytes}
                      icon={
                        child.kind === 'dir' ? (
                          <FolderClose theme='outline' size='14' className='shrink-0 text-t-tertiary' />
                        ) : (
                          <Notes theme='outline' size='14' className='shrink-0 text-t-tertiary' />
                        )
                      }
                      tag={
                        child.kind === 'symlink' || child.kind === 'other'
                          ? t(`conversation.projectPage.storage.kind.${child.kind}`)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </div>
              {root.largest_files.length > 0 ? (
                <div className='min-w-0'>
                  <h3 className='m-0 text-12px font-500 text-t-secondary'>
                    {t('conversation.projectPage.storage.largestFiles')}
                  </h3>
                  <ul className='m-0 p-0 list-none'>
                    {root.largest_files.map((file) => (
                      <SizeRow key={file.path} name={file.path} bytes={file.bytes} whole={root.bytes} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </Panel>
  );
};

const StorageTab: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t, i18n } = useTranslation();
  const { storage, error, isLoading, reload, rescan, rescanning, rescanError } = useProjectStorage(projectId);

  if (error) return <ErrorBlock error={error} onRetry={() => void reload()} />;
  if (isLoading || !storage) {
    return (
      <Panel testId='project-storage-scanning'>
        <div role='status' aria-busy='true' className='text-13px text-t-secondary'>
          {t('conversation.projectPage.storage.scanning')}
        </div>
      </Panel>
    );
  }

  const disk = storage.disk;
  const ago = formatAgo(storage.scanned_at, Date.now(), i18n.language);
  return (
    <div className='flex flex-col gap-12px' data-testid='project-storage'>
      <Panel testId='project-storage-total'>
        <div className='flex flex-wrap items-end gap-x-16px gap-y-8px'>
          <div className='flex flex-col min-w-0'>
            <span className='text-12px text-t-secondary'>{t('conversation.projectPage.storage.total')}</span>
            <span className='text-22px font-600 leading-28px text-t-primary'>{formatBytes(storage.total_bytes)}</span>
          </div>
          <span className='flex-1' />
          <div className='flex items-center gap-8px'>
            <span className='text-12px text-t-tertiary' data-testid='project-storage-scanned'>
              {ago
                ? t('conversation.projectPage.storage.scanned', { ago })
                : t('conversation.projectPage.storage.scannedNow')}
            </span>
            <Button
              size='small'
              loading={rescanning}
              onClick={() => void rescan()}
              data-testid='project-storage-rescan'
            >
              {t('conversation.projectPage.storage.rescan')}
            </Button>
          </div>
        </div>
        {disk ? (
          <div className='flex flex-col gap-4px'>
            <SizeBar percent={percentOf(storage.total_bytes, disk.total_bytes)} />
            <span className='text-12px text-t-secondary'>
              {t('conversation.projectPage.storage.shareOfDisk', {
                percent: percentOf(storage.total_bytes, disk.total_bytes).toFixed(1),
                total: formatBytes(disk.total_bytes),
                free: formatBytes(disk.free_bytes),
              })}
            </span>
          </div>
        ) : null}
        {rescanError ? (
          <Alert
            type='error'
            content={describeProjectError(t, rescanError)}
            data-testid='project-storage-rescan-error'
          />
        ) : null}
      </Panel>
      {storage.roots.length === 0 ? (
        <EmptyBlock text={t('conversation.projectPage.storage.empty')} />
      ) : (
        storage.roots.map((root) => <RootPanel key={`${root.label}:${root.path}`} root={root} />)
      )}
    </div>
  );
};

export default StorageTab;

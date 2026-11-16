/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Collapse, Input, Notification, Spin, Tag } from '@arco-design/web-react';
import { Delete, Edit, Left } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { MemoryItem, MemoryLintKind } from '@/common/types/memory';
import MarkdownView from '@/renderer/components/Markdown';

import { fileForLink } from './memoryModel';

export const memoryFileKey = (projectId: string, file: string) => ['memory-file', projectId, file] as const;

type Props = {
  projectId: string;
  item: MemoryItem;
  items: MemoryItem[];
  flags: ReadonlySet<MemoryLintKind>;
  onOpen: (file: string) => void;
  /** Narrow layout: back to the list. */
  onBack?: () => void;
  /** The file list changed (save, delete, restore). */
  onChanged: () => void;
  onDeleted: (file: string) => void;
};

/** One memory: rendered body, frontmatter, links, edit + save (409 aware), delete with undo. */
export const MemoryDetail: React.FC<Props> = ({
  projectId,
  item,
  items,
  flags,
  onOpen,
  onBack,
  onChanged,
  onDeleted,
}) => {
  const { t, i18n } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR(memoryFileKey(projectId, item.file), ([, pid, file]) =>
    ipcBridge.memory.get.invoke({ project_id: pid, file })
  );
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [frontmatter, setFrontmatter] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setEditing(false);
    setConflict(false);
  }, [item.file]);

  const startEdit = () => {
    if (!data) return;
    setBody(data.body);
    setFrontmatter(data.frontmatter_raw);
    setConflict(false);
    setEditing(true);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const saved = await ipcBridge.memory.update.invoke({
        project_id: projectId,
        file: item.file,
        body,
        frontmatter_raw: frontmatter,
        expected_modified: data.modified,
      });
      await mutate(saved, { revalidate: false });
      setEditing(false);
      onChanged();
    } catch (err) {
      if (isBackendHttpError(err) && err.status === 409) setConflict(true);
      else Notification.error({ title: t('memory.detail.saveFailed'), content: item.file });
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    const fresh = await mutate();
    setConflict(false);
    if (fresh) {
      setBody(fresh.body);
      setFrontmatter(fresh.frontmatter_raw);
    }
  };

  const restore = async (notificationId: string) => {
    Notification.remove(notificationId);
    try {
      await ipcBridge.memory.restore.invoke({ project_id: projectId, file: item.file });
      onChanged();
      onOpen(item.file);
    } catch {
      Notification.error({ title: t('memory.detail.restoreFailed'), content: item.file });
    }
  };

  const remove = async () => {
    try {
      await ipcBridge.memory.remove.invoke({ project_id: projectId, file: item.file });
    } catch {
      Notification.error({ title: t('memory.detail.deleteFailed'), content: item.file });
      return;
    }
    onDeleted(item.file);
    onChanged();
    const id = `memory-deleted-${item.file}`;
    Notification.info({
      id,
      title: t('memory.detail.deleted', { file: item.file }),
      content: t('memory.detail.deletedHint'),
      duration: 10000,
      btn: (
        <Button type='primary' size='small' onClick={() => void restore(id)}>
          {t('memory.detail.undo')}
        </Button>
      ),
    });
  };

  const modified = new Date(data?.modified ?? item.modified).toLocaleString(i18n.language);

  return (
    <section aria-label={item.name ?? item.file} className='flex min-w-0 flex-1 flex-col gap-12px overflow-auto p-16px'>
      <header className='flex flex-wrap items-center gap-8px'>
        {onBack && (
          <Button type='text' size='small' icon={<Left />} onClick={onBack} aria-label={t('memory.detail.back')} />
        )}
        <h2 className='m-0 min-w-0 flex-1 truncate text-16px font-600 text-t-primary'>{item.name ?? item.file}</h2>
        {!editing && (
          <>
            <Button size='small' icon={<Edit />} onClick={startEdit} disabled={!data}>
              {t('common.edit')}
            </Button>
            <Button size='small' status='danger' icon={<Delete />} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </>
        )}
      </header>
      <div className='flex flex-wrap items-center gap-6px text-12px text-t-secondary'>
        <code>{item.file}</code>
        <span>{t('memory.detail.modified', { date: modified })}</span>
        <span>{t('memory.detail.size', { count: item.size })}</span>
        {[...flags].map((kind) => (
          <Tag key={kind} size='small' color='orangered'>
            {t(`memory.lint.${kind}`)}
          </Tag>
        ))}
      </div>
      {item.description && <p className='m-0 text-13px text-t-secondary'>{item.description}</p>}

      {isLoading && <Spin />}
      {error && <Alert type='error' content={t('memory.detail.loadFailed')} />}

      {data && editing && (
        <div className='flex flex-col gap-8px'>
          {conflict && (
            <Alert
              type='warning'
              content={t('memory.detail.conflict')}
              action={
                <Button size='small' onClick={() => void reload()}>
                  {t('common.reload')}
                </Button>
              }
            />
          )}
          <label className='text-12px text-t-secondary' htmlFor='memory-frontmatter'>
            {t('memory.detail.frontmatter')}
          </label>
          <Input.TextArea
            id='memory-frontmatter'
            value={frontmatter}
            onChange={setFrontmatter}
            autoSize={{ minRows: 3, maxRows: 10 }}
            className='font-mono'
          />
          <label className='text-12px text-t-secondary' htmlFor='memory-body'>
            {t('memory.detail.body')}
          </label>
          <Input.TextArea
            id='memory-body'
            value={body}
            onChange={setBody}
            autoSize={{ minRows: 8, maxRows: 30 }}
            className='font-mono'
          />
          <div className='flex gap-8px'>
            <Button type='primary' loading={saving} disabled={conflict} onClick={() => void save()}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {data && !editing && (
        <>
          <Collapse bordered={false}>
            <Collapse.Item name='frontmatter' header={t('memory.detail.frontmatter')}>
              <pre className='m-0 whitespace-pre-wrap break-all rounded-6px bg-fill-2 p-8px text-12px'>
                {data.frontmatter_raw}
              </pre>
            </Collapse.Item>
          </Collapse>
          <div className='min-w-0'>
            <MarkdownView>{data.body}</MarkdownView>
          </div>
        </>
      )}

      {item.links.length > 0 && (
        <div className='flex flex-wrap items-center gap-6px'>
          <span className='text-12px text-t-secondary'>{t('memory.detail.links')}</span>
          {item.links.map((slug) => {
            const target = fileForLink(slug, items);
            return target ? (
              <Button key={slug} size='mini' onClick={() => onOpen(target)}>
                {slug}
              </Button>
            ) : (
              <Tag key={slug} size='small' color='gray' title={t('memory.lint.broken_link')}>
                {slug}
              </Tag>
            );
          })}
        </div>
      )}
    </section>
  );
};

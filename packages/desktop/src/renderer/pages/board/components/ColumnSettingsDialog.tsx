/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Column settings of the department flow: rename, reorder, WIP limit, add,
 * archive an empty column (never a gate or a gate's target) and restore one. Saves the full list in one
 * `PUT …/columns` guarded by the board version.
 */

import { Button, Input, InputNumber, Modal, Tooltip } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Inbox, Plus, Undo } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BOARD_CATEGORIES,
  STUDIO_COLUMN_KEYS,
  type BoardCategory,
  type BoardColumn,
  type BoardColumnInput,
  type BoardSnapshot,
} from '@/common/types/board';
import { BoardSelect } from '@/renderer/components/board/BoardSelect';
import type { BoardController } from '@/renderer/components/board/hooks/useBoard';
import { columnName } from '@/renderer/components/board/utils/boardFormat';
import { activeCardCount } from '@/renderer/components/board/utils/boardModel';
import { iconLabelButton } from '@/renderer/components/board/utils/boardStyles';

/** Column keys that have a translated default name (`board.columns.<key>`). */
const DEFAULT_NAMED_KEYS: ReadonlySet<string> = new Set(STUDIO_COLUMN_KEYS);

/** Longest column name accepted by the dialog. */
const MAX_COLUMN_NAME = 60;

type DraftColumn = BoardColumnInput & { isNew?: boolean };

const toDraft = (columns: BoardColumn[]): DraftColumn[] =>
  columns
    .toSorted((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position)
    .map(({ id: _id, ...column }) => column);

const newColumnKey = (taken: Set<string>): string => {
  let key = '';
  do {
    key = `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(key));
  return key;
};

/** Draft → request: positions follow the list order, a blank name on a default key means "translated default". */
export const columnsForSave = (draft: DraftColumn[]): BoardColumnInput[] =>
  draft.map(({ isNew: _isNew, ...column }, index) => ({
    ...column,
    name: column.name && column.name.trim() ? column.name.trim() : null,
    position: index,
  }));

const DialogBody: React.FC<{
  snapshot: BoardSnapshot;
  draft: DraftColumn[];
  setDraft: (draft: DraftColumn[]) => void;
  error: string | null;
}> = ({ snapshot, draft, setDraft, error }) => {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<BoardCategory>('todo');
  const active = draft.filter((column) => !column.archived);
  // A gate and the columns a gate leads to keep the flow intact: the server refuses to archive them (422).
  const gateTargets = new Set(
    draft.flatMap((column) => (column.gate ? [column.gate.on_approve, column.gate.on_reject] : [])).filter(Boolean)
  );
  const archived = draft.filter((column) => column.archived);

  const patch = (key: string, change: Partial<DraftColumn>) =>
    setDraft(draft.map((column) => (column.key === key ? { ...column, ...change } : column)));

  const move = (key: string, offset: -1 | 1) => {
    const index = active.findIndex((column) => column.key === key);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= active.length) return;
    const reordered = [...active];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setDraft([...reordered, ...archived]);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const key = newColumnKey(new Set(draft.map((column) => column.key)));
    const terminal = newCategory === 'done';
    const column: DraftColumn = {
      key,
      name,
      category: newCategory,
      kind: terminal ? 'terminal' : 'normal',
      resolution: terminal ? 'completed' : null,
      agent_move: 'allow',
      wip_limit: null,
      exit_rule: null,
      gate: null,
      position: active.length,
      archived: false,
      isNew: true,
    };
    setDraft([...active, column, ...archived]);
    setNewName('');
  };

  return (
    <div className='flex flex-col gap-12px'>
      <ol className='m-0 p-0 list-none flex flex-col gap-8px'>
        {active.map((column, index) => {
          const label = columnName(column, t) || t('board.settings.newColumnName');
          const cardCount = activeCardCount(snapshot.cards, column.key);
          const protectedColumn = column.kind === 'gate' || gateTargets.has(column.key);
          const canArchive = cardCount === 0 && active.length > 1 && !column.isNew && !protectedColumn;
          const archiveHint = protectedColumn
            ? t('board.settings.archiveGateDisabled')
            : t('board.settings.archiveDisabled');
          return (
            <li
              key={column.key}
              className='flex flex-wrap items-center gap-8px rd-6px bg-2 p-8px'
              data-column-row={column.key}
            >
              <Input
                size='small'
                className='flex-1 min-w-160px'
                value={column.name ?? ''}
                maxLength={MAX_COLUMN_NAME}
                placeholder={DEFAULT_NAMED_KEYS.has(column.key) ? t(`board.columns.${column.key}`) : ''}
                aria-label={`${label} · ${t('board.settings.name')}`}
                onChange={(value) => patch(column.key, { name: value })}
              />
              {column.isNew ? (
                <BoardSelect
                  ariaLabel={`${label} · ${t('board.settings.category')}`}
                  size='small'
                  className='w-140px'
                  value={column.category}
                  onChange={(category: BoardCategory) => {
                    const terminal = category === 'done';
                    patch(column.key, {
                      category,
                      kind: terminal ? 'terminal' : 'normal',
                      resolution: terminal ? 'completed' : null,
                    });
                  }}
                  options={BOARD_CATEGORIES.map((category) => ({
                    value: category,
                    label: t(`board.categories.${category}`),
                  }))}
                />
              ) : (
                <span className='text-12px text-t-secondary w-140px truncate'>
                  {t(`board.categories.${column.category}`)}
                </span>
              )}
              <InputNumber
                size='small'
                className='w-110px'
                min={1}
                max={999}
                precision={0}
                value={column.wip_limit ?? undefined}
                placeholder={t('board.settings.wipPlaceholder')}
                aria-label={`${label} · ${t('board.settings.wip')}`}
                onChange={(value) => patch(column.key, { wip_limit: typeof value === 'number' ? value : null })}
              />
              <Button
                size='mini'
                type='text'
                icon={<ArrowUp theme='outline' size='14' fill='currentColor' />}
                aria-label={t('board.settings.moveUp', { column: label })}
                disabled={index === 0}
                onClick={() => move(column.key, -1)}
              />
              <Button
                size='mini'
                type='text'
                icon={<ArrowDown theme='outline' size='14' fill='currentColor' />}
                aria-label={t('board.settings.moveDown', { column: label })}
                disabled={index === active.length - 1}
                onClick={() => move(column.key, 1)}
              />
              {column.isNew ? (
                <Button
                  size='mini'
                  type='text'
                  icon={<Inbox theme='outline' size='14' fill='currentColor' />}
                  aria-label={t('board.settings.archiveColumn', { column: label })}
                  onClick={() => setDraft(draft.filter((candidate) => candidate.key !== column.key))}
                />
              ) : (
                <Tooltip content={canArchive ? undefined : archiveHint} mini>
                  <span>
                    <Button
                      size='mini'
                      type='text'
                      icon={<Inbox theme='outline' size='14' fill='currentColor' />}
                      aria-label={t('board.settings.archiveColumn', { column: label })}
                      aria-describedby={
                        canArchive
                          ? undefined
                          : protectedColumn
                            ? 'board-settings-archive-gate-help'
                            : 'board-settings-archive-help'
                      }
                      disabled={!canArchive}
                      onClick={() => patch(column.key, { archived: true })}
                    />
                  </span>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ol>
      <div className='flex flex-col gap-2px text-12px text-t-secondary'>
        <span id='board-settings-archive-help'>{t('board.settings.archiveDisabled')}</span>
        <span id='board-settings-archive-gate-help'>{t('board.settings.archiveGateDisabled')}</span>
        <span>{t('board.settings.wipHelp')}</span>
      </div>
      <div className='flex flex-wrap items-center gap-8px'>
        <Input
          size='small'
          className='flex-1 min-w-160px'
          value={newName}
          maxLength={MAX_COLUMN_NAME}
          onChange={setNewName}
          onPressEnter={add}
          placeholder={t('board.settings.newColumnName')}
          aria-label={t('board.settings.newColumnName')}
        />
        <BoardSelect
          ariaLabel={t('board.settings.category')}
          size='small'
          className='w-140px'
          value={newCategory}
          onChange={(category: BoardCategory) => setNewCategory(category)}
          options={BOARD_CATEGORIES.map((category) => ({ value: category, label: t(`board.categories.${category}`) }))}
        />
        <Button
          className={iconLabelButton('small')}
          size='small'
          icon={<Plus theme='outline' size='14' fill='currentColor' />}
          disabled={!newName.trim()}
          onClick={add}
        >
          {t('board.settings.addColumn')}
        </Button>
      </div>
      {archived.length > 0 && (
        <section aria-labelledby='board-settings-archived' className='flex flex-col gap-6px'>
          <h3 id='board-settings-archived' className='m-0 text-13px font-medium text-t-secondary'>
            {t('board.settings.archivedColumns')}
          </h3>
          <ul className='m-0 p-0 list-none flex flex-col gap-6px'>
            {archived.map((column) => {
              const label = columnName(column, t);
              return (
                <li key={column.key} className='flex items-center gap-8px'>
                  <span className='flex-1 text-13px text-t-primary truncate'>{label}</span>
                  <Button
                    className={iconLabelButton('mini')}
                    size='mini'
                    icon={<Undo theme='outline' size='14' fill='currentColor' />}
                    onClick={() =>
                      setDraft([
                        ...active,
                        { ...column, archived: false },
                        ...archived.filter((c) => c.key !== column.key),
                      ])
                    }
                  >
                    {t('board.settings.restoreColumn', { column: label })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {error && (
        <span role='alert' className='text-13px text-danger'>
          {error}
        </span>
      )}
    </div>
  );
};

export const ColumnSettingsDialog: React.FC<{ board: BoardController; visible: boolean; onClose: () => void }> = ({
  board,
  visible,
  onClose,
}) => {
  const { t } = useTranslation();
  const snapshot = board.snapshot;
  const [draft, setDraft] = useState<DraftColumn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the draft from the board each time the dialog opens; live updates while it
  // is open do not overwrite what the user is editing (the save is version-guarded).
  useEffect(() => {
    if (!visible || !snapshot) return;
    setDraft(toDraft(snapshot.columns));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    const missingName = draft.some(
      (column) => !column.archived && !DEFAULT_NAMED_KEYS.has(column.key) && !(column.name ?? '').trim()
    );
    if (missingName) {
      setError(t('board.settings.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      if (await board.saveColumns(columnsForSave(draft))) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('board.settings.title')}
      visible={visible && Boolean(snapshot)}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      autoFocus
      focusLock
      unmountOnExit
      style={{ width: 640, maxWidth: 'calc(100vw - 32px)' }}
    >
      {snapshot && <DialogBody snapshot={snapshot} draft={draft} setDraft={setDraft} error={error} />}
    </Modal>
  );
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Used in" of one item attached only through kits — a server (C36) or a rule
 * (C37): every attachment at every level (global, project, assistant,
 * conversation) with its op, a way to drop it, and a row to turn the item on —
 * or off — for Global, a project or an assistant. Conversation-level attachments
 * are made from the conversation's own kits button.
 */

import { Button, Message, Radio, Select, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KitItemKind, KitLevel, KitOp } from '@/common/config/storage';
import { attachRequest } from '@/renderer/hooks/mcp/market/kitModel';
import { useKitActions, useKitItemAttachments } from '@/renderer/hooks/mcp/market/useKits';
import { useAssistantList } from '@/renderer/hooks/assistant/useAssistantList';
import type { StandardProject } from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';
import { KitOpTag } from './KitAttachPanel';

const ADD_LEVELS: readonly KitLevel[] = ['global', 'project', 'assistant'];

type KitItemUsedInProps = {
  kind: Extract<KitItemKind, 'server' | 'rule'>;
  itemRef: string;
  projects: StandardProject[];
  /** Strings of the page: `<prefix>.nowhere`, `.drop`, `.dropLabel`, `.levelLabel`, … */
  i18nPrefix: string;
  describeError: (error: unknown) => string;
  disabled?: boolean;
};

const KitItemUsedIn: React.FC<KitItemUsedInProps> = ({
  kind,
  itemRef,
  projects,
  i18nPrefix,
  describeError,
  disabled,
}) => {
  const { t } = useTranslation();
  const { attachments, isLoading } = useKitItemAttachments(kind, itemRef);
  const { assistants } = useAssistantList();
  const { attach, detach } = useKitActions();
  const [level, setLevel] = useState<KitLevel>('project');
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [op, setOp] = useState<KitOp>('add');
  const [busy, setBusy] = useState<string | null>(null);

  const projectName = useMemo(
    () => new Map(projects.filter((p) => p.project_id).map((p) => [p.project_id as string, p.name])),
    [projects]
  );
  const assistantName = useMemo(() => new Map(assistants.map((a) => [a.id, a.name])), [assistants]);

  const targetLabel = (rowLevel: KitLevel, targetId: string): string => {
    if (rowLevel === 'global') return t('settings.library.scopeGlobal');
    if (rowLevel === 'project') return projectName.get(targetId) ?? targetId;
    if (rowLevel === 'assistant') return assistantName.get(targetId) ?? targetId;
    return t(`${i18nPrefix}.conversation`, { id: targetId.slice(0, 8) });
  };

  const targets =
    level === 'project'
      ? projects.filter((p) => p.project_id).map((p) => ({ value: p.project_id as string, label: p.name }))
      : level === 'assistant'
        ? assistants.map((a) => ({ value: a.id, label: a.name }))
        : [];

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      Message.error(describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const canAdd = level === 'global' || Boolean(target);

  return (
    <div className='flex flex-col gap-8px' data-testid={`${kind}-used-in`}>
      {isLoading ? null : attachments.length === 0 ? (
        <span className='text-12px text-t-tertiary'>{t(`${i18nPrefix}.nowhere`)}</span>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-4px'>
          {attachments.map((row) => (
            <li key={row.id} className='flex items-center gap-8px min-w-0' data-testid={`${kind}-used-in-row`}>
              <Tag size='small'>{t(`mcp.kits.level.${row.level}`)}</Tag>
              <span className='flex-1 min-w-0 truncate text-13px text-t-primary'>
                {targetLabel(row.level, row.target_id)}
              </span>
              <KitOpTag op={row.op} />
              <Button
                size='mini'
                type='text'
                disabled={disabled}
                loading={busy === row.id}
                aria-label={t(`${i18nPrefix}.dropLabel`, { scope: targetLabel(row.level, row.target_id) })}
                onClick={() => void run(row.id, () => detach(row.id))}
              >
                {t(`${i18nPrefix}.drop`)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className='flex flex-wrap items-center gap-6px'>
        <Select
          size='small'
          className='!w-120px'
          value={level}
          onChange={(value: KitLevel) => {
            setLevel(value);
            setTarget(undefined);
          }}
          aria-label={t(`${i18nPrefix}.levelLabel`)}
          disabled={disabled}
        >
          {ADD_LEVELS.map((key) => (
            <Select.Option key={key} value={key}>
              {t(`mcp.kits.level.${key}`)}
            </Select.Option>
          ))}
        </Select>
        {level !== 'global' ? (
          <Select
            size='small'
            className='!min-w-160px !flex-1'
            value={target}
            onChange={setTarget}
            placeholder={t(`${i18nPrefix}.targetPlaceholder`)}
            aria-label={t(`${i18nPrefix}.targetLabel`)}
            showSearch
            disabled={disabled}
            options={targets}
          />
        ) : null}
        <Radio.Group
          type='button'
          size='small'
          value={op}
          onChange={setOp}
          aria-label={t(`${i18nPrefix}.opLabel`)}
          disabled={disabled}
        >
          <Radio value='add'>{t('mcp.kits.op.add')}</Radio>
          <Radio value='remove'>{t('mcp.kits.op.remove')}</Radio>
        </Radio.Group>
        <Button
          size='small'
          type='primary'
          disabled={disabled || !canAdd}
          loading={busy === 'attach'}
          onClick={() => void run('attach', () => attach(attachRequest(level, target ?? '', kind, itemRef, op)))}
          data-testid={`${kind}-used-in-attach`}
        >
          {t(`${i18nPrefix}.apply`)}
        </Button>
      </div>
      <span className='text-12px text-t-tertiary'>{t(`${i18nPrefix}.hint`)}</span>
    </div>
  );
};

export default KitItemUsedIn;

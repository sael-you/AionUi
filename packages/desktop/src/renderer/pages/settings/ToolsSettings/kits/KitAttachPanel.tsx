/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Attachments at one level (global, a project, an assistant or a conversation):
 * the list with detach, and a row to attach a kit, a skill or an MCP instance
 * with Add or Remove. The same panel serves all four levels. At the global
 * level, MCP instances the server refuses (R2/R3) are disabled with the reason;
 * the server still decides.
 */

import { Button, Message, Radio, Select, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KitAttachmentResponse, KitItemKind, KitLevel, KitOp } from '@/common/config/storage';
import { attachRequest, globalAttachBlock, describeKitError } from '@/renderer/hooks/mcp/market/kitModel';
import { attachableKits } from '@/renderer/hooks/mcp/market/kitGroups';
import { useKitActions, useKitAttachments, useKitLibrary, useKitList } from '@/renderer/hooks/mcp/market/useKits';
import { MarketErrorNotice, touchClass, useIsMobileLayout } from '../market/shared';

const KINDS: readonly KitItemKind[] = ['kit', 'skill', 'mcp'];
const OPS: readonly KitOp[] = ['add', 'remove'];

type KitAttachPanelProps = {
  level: KitLevel;
  /** `''` for global. */
  targetId: string;
  /** Prefix for test ids and element ids, unique on the page. */
  idPrefix?: string;
};

export const KitOpTag: React.FC<{ op: KitOp }> = ({ op }) => {
  const { t } = useTranslation();
  return (
    <Tag size='small' color={op === 'add' ? 'green' : 'orangered'}>
      {t(`mcp.kits.op.${op}`)}
    </Tag>
  );
};

const KitAttachPanel: React.FC<KitAttachPanelProps> = ({ level, targetId, idPrefix = `kit-attach-${level}` }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const query = useMemo(() => ({ level, target_id: level === 'global' ? '' : targetId }), [level, targetId]);
  const { attachments, error, isLoading } = useKitAttachments(query);
  const { kits } = useKitList();
  const library = useKitLibrary();
  const { attach, detach } = useKitActions();
  const [kind, setKind] = useState<KitItemKind>('kit');
  const [itemRef, setItemRef] = useState<string | undefined>(undefined);
  const [op, setOp] = useState<KitOp>('add');
  const [busy, setBusy] = useState<string | null>(null);

  const options = useMemo((): Array<{ value: string; label: string; disabled?: boolean }> => {
    if (kind === 'kit') return attachableKits(kits).map((kit) => ({ value: kit.id, label: kit.name }));
    if (kind === 'skill') return library.skillNames.map((name) => ({ value: name, label: name }));
    return library.instances.map((instance) => {
      const block = globalAttachBlock(level, instance);
      return {
        value: instance.id,
        label: block ? `${instance.name} · ${t(`mcp.kits.attach.blocked.${block}`)}` : instance.name,
        disabled: block !== null,
      };
    });
  }, [kind, kits, library.skillNames, library.instances, level, t]);

  const handleAttach = async () => {
    if (!itemRef) return;
    setBusy('attach');
    try {
      await attach(attachRequest(level, targetId, kind, itemRef, op));
      Message.success(t('mcp.kits.attach.attached'));
      setItemRef(undefined);
    } catch (attachError) {
      Message.error(describeKitError(t, attachError));
    } finally {
      setBusy(null);
    }
  };

  const handleDetach = async (row: KitAttachmentResponse) => {
    setBusy(row.id);
    try {
      await detach(row.id);
      Message.success(t('mcp.kits.attach.detached'));
    } catch (detachError) {
      Message.error(describeKitError(t, detachError));
    } finally {
      setBusy(null);
    }
  };

  const labelId = `${idPrefix}-label`;

  return (
    <div className='flex flex-col gap-12px' data-testid={idPrefix}>
      {error ? <MarketErrorNotice message={describeKitError(t, error)} /> : null}
      {isLoading ? (
        <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div>
      ) : attachments.length === 0 ? (
        <div className='text-13px text-t-secondary'>{t('mcp.kits.attach.empty')}</div>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-8px' aria-label={t('mcp.kits.attach.listLabel')}>
          {attachments.map((row) => (
            <li
              key={row.id}
              className='flex flex-wrap items-center gap-8px rd-8px border border-border-2 px-12px py-8px'
              data-testid={`${idPrefix}-row`}
            >
              <Tag size='small'>{t(`mcp.kits.kind.${row.item_kind}`)}</Tag>
              <span className='text-13px text-t-primary font-medium break-all'>
                {row.item_name || t('mcp.kits.attach.missing', { ref: row.item_ref })}
              </span>
              <KitOpTag op={row.op} />
              <Button
                size='mini'
                type='text'
                status='danger'
                className={`ms-auto ${touchClass(isMobile)}`}
                loading={busy === row.id}
                aria-label={t('mcp.kits.attach.detachLabel', { name: row.item_name || row.item_ref })}
                onClick={() => void handleDetach(row)}
              >
                {t('mcp.kits.attach.detach')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div
        className='flex flex-col md:flex-row md:items-center gap-8px'
        role='group'
        aria-labelledby={labelId}
        data-testid={`${idPrefix}-form`}
      >
        <span id={labelId} className='text-13px text-t-secondary shrink-0'>
          {t('mcp.kits.attach.formLabel')}
        </span>
        <Select
          className='md:w-140px'
          value={kind}
          aria-label={t('mcp.kits.attach.kind')}
          onChange={(value: KitItemKind) => {
            setKind(value);
            setItemRef(undefined);
          }}
        >
          {KINDS.map((entry) => (
            <Select.Option key={entry} value={entry}>
              {t(`mcp.kits.kind.${entry}`)}
            </Select.Option>
          ))}
        </Select>
        <Select
          className='md:flex-1 min-w-0'
          showSearch
          allowClear
          value={itemRef}
          placeholder={t('mcp.kits.attach.itemPlaceholder')}
          aria-label={t('mcp.kits.attach.item')}
          notFoundContent={<span className='text-13px text-t-secondary'>{t('mcp.kits.attach.noOptions')}</span>}
          onChange={(value: string | undefined) => setItemRef(value)}
        >
          {options.map((option) => (
            <Select.Option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
        <Radio.Group
          type='button'
          size='small'
          value={op}
          aria-label={t('mcp.kits.attach.op')}
          onChange={(value: KitOp) => setOp(value)}
        >
          {OPS.map((entry) => (
            <Radio key={entry} value={entry}>
              {t(`mcp.kits.op.${entry}`)}
            </Radio>
          ))}
        </Radio.Group>
        <Button
          type='primary'
          className={touchClass(isMobile)}
          disabled={!itemRef}
          loading={busy === 'attach'}
          onClick={() => void handleAttach()}
        >
          {t('mcp.kits.attach.submit')}
        </Button>
      </div>
    </div>
  );
};

export default KitAttachPanel;

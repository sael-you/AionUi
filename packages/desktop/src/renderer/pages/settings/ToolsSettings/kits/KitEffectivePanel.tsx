/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "What this conversation gets" (C27): the skills and MCP instances kits and
 * attachments decide for a conversation, each with where it comes from (the
 * deciding level, and the kit when it came through one), whether a removal took
 * it out, and for MCPs whether a session start would launch it. Also the
 * conversation's frozen skill snapshot and wanted templates without an instance.
 */

import { Tag } from '@arco-design/web-react';
import { Attention, CheckOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { KitEffectiveItem, KitEffectiveQuery } from '@/common/config/storage';
import { sortEffectiveItems, describeKitError } from '@/renderer/hooks/mcp/market/kitModel';
import { useKitEffective } from '@/renderer/hooks/mcp/market/useKits';
import { MarketErrorNotice, MarketStatusTag } from '../market/shared';
import { KitOpTag } from './KitAttachPanel';

const Provenance: React.FC<{ item: KitEffectiveItem }> = ({ item }) => {
  const { t } = useTranslation();
  const level = t(`mcp.kits.level.${item.provenance.level}`);
  const text = item.provenance.kit_id
    ? t('mcp.kits.effective.fromKit', { level, kit: item.provenance.kit_name || item.provenance.kit_id })
    : t('mcp.kits.effective.fromItem', { level });
  return <span className='text-12px text-t-secondary'>{text}</span>;
};

const EffectiveRow: React.FC<{ item: KitEffectiveItem }> = ({ item }) => {
  const { t } = useTranslation();
  const mcp = item.mcp;
  const name = mcp?.instance_name || item.item_ref;
  return (
    <li
      className={`flex flex-col gap-4px rd-8px border border-border-2 px-12px py-8px ${item.included ? '' : 'opacity-70'}`}
      data-testid='kit-effective-row'
    >
      <div className='flex flex-wrap items-center gap-6px'>
        <span
          className={`text-13px font-medium break-all ${item.included ? 'text-t-primary' : 'text-t-secondary line-through'}`}
        >
          {name}
        </span>
        <Tag size='small' color={item.included ? 'green' : 'gray'}>
          {item.included ? t('mcp.kits.effective.included') : t('mcp.kits.effective.removed')}
        </Tag>
        {mcp?.status ? <MarketStatusTag status={mcp.status} /> : null}
        {mcp?.environment ? (
          <Tag size='small'>{t(`mcp.market.environment.${mcp.environment}`, { defaultValue: mcp.environment })}</Tag>
        ) : null}
        {mcp?.tier ? <Tag size='small'>{t(`mcp.market.tier.${mcp.tier}`, { defaultValue: mcp.tier })}</Tag> : null}
      </div>
      <div className='flex flex-wrap items-center gap-6px'>
        <KitOpTag op={item.provenance.op} />
        <Provenance item={item} />
      </div>
      {mcp?.shadowed_by_project_file && item.included ? (
        <span
          className='inline-flex items-center gap-4px text-12px text-t-secondary'
          data-testid='kit-effective-shadowed'
        >
          <Attention theme='filled' size={14} className='text-warning-6' aria-hidden />
          {t('mcp.kits.effective.shadowed')}
        </span>
      ) : null}
      {mcp && item.included ? (
        <span className='inline-flex items-center gap-4px text-12px text-t-secondary'>
          {mcp.delivered ? (
            <CheckOne theme='filled' size={14} className='text-success-6' aria-hidden />
          ) : (
            <Attention theme='filled' size={14} className='text-warning-6' aria-hidden />
          )}
          {mcp.delivered
            ? t('mcp.kits.effective.delivered')
            : mcp.reason
              ? t('mcp.kits.effective.notDeliveredReason', { reason: mcp.reason })
              : t('mcp.kits.effective.notDelivered')}
        </span>
      ) : null}
    </li>
  );
};

const EffectiveList: React.FC<{ title: string; items: readonly KitEffectiveItem[]; testId: string }> = ({
  title,
  items,
  testId,
}) => {
  const { t } = useTranslation();
  const headingId = `${testId}-title`;
  return (
    <section aria-labelledby={headingId} data-testid={testId}>
      <h4 id={headingId} className='m-0 mb-8px text-13px font-medium text-t-primary'>
        {title}
      </h4>
      {items.length === 0 ? (
        <div className='text-12px text-t-tertiary'>{t('mcp.kits.none')}</div>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-6px'>
          {sortEffectiveItems(items).map((item) => (
            <EffectiveRow key={`${item.kind}:${item.item_ref}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
};

const KitEffectivePanel: React.FC<{ query: KitEffectiveQuery }> = ({ query }) => {
  const { t } = useTranslation();
  const { effective, error, isLoading, reload } = useKitEffective(query);

  if (error) {
    return <MarketErrorNotice message={describeKitError(t, error)} onRetry={() => void reload()} />;
  }
  if (isLoading || !effective) {
    return <div className='text-13px text-t-secondary'>{t('mcp.kits.loading')}</div>;
  }

  const nothingDecided = effective.skills.length === 0 && effective.mcps.length === 0;

  return (
    <div className='flex flex-col gap-16px' data-testid='kit-effective-panel'>
      <p className='m-0 text-12px text-t-secondary'>{t('mcp.kits.effective.hint')}</p>
      {nothingDecided ? <div className='text-13px text-t-secondary'>{t('mcp.kits.effective.empty')}</div> : null}
      <EffectiveList title={t('mcp.kits.skills')} items={effective.skills} testId='kit-effective-skills' />
      <EffectiveList title={t('mcp.kits.mcps')} items={effective.mcps} testId='kit-effective-mcps' />
      {effective.conversation_skills ? (
        <section aria-labelledby='kit-effective-frozen-title' data-testid='kit-effective-frozen'>
          <h4 id='kit-effective-frozen-title' className='m-0 mb-4px text-13px font-medium text-t-primary'>
            {t('mcp.kits.effective.frozenTitle')}
          </h4>
          <p className='m-0 mb-8px text-12px text-t-secondary'>{t('mcp.kits.effective.frozenHint')}</p>
          <div className='flex flex-wrap gap-6px'>
            {effective.conversation_skills.length === 0 ? (
              <span className='text-12px text-t-tertiary'>{t('mcp.kits.none')}</span>
            ) : (
              effective.conversation_skills.map((skill) => (
                <Tag key={skill} size='small'>
                  {skill}
                </Tag>
              ))
            )}
          </div>
        </section>
      ) : null}
      {effective.missing_templates.length > 0 ? (
        <section aria-labelledby='kit-effective-missing-title' data-testid='kit-effective-missing'>
          <h4 id='kit-effective-missing-title' className='m-0 mb-8px text-13px font-medium text-t-primary'>
            {t('mcp.kits.effective.missingTitle')}
          </h4>
          <ul className='m-0 p-0 list-none flex flex-col gap-4px'>
            {effective.missing_templates.map((missing) => (
              <li key={`${missing.kit_id}:${missing.template_id}`} className='text-12px text-t-secondary'>
                {t('mcp.kits.effective.missingItem', { template: missing.template_id, kit: missing.kit_name })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export default KitEffectivePanel;

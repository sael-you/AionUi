/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a scope or a conversation gets from the rules (C37): each rule in force,
 * in the order the block states (Global → Project → Assistant → Conversation),
 * its size, whether it fit under the 24 KB cap, and the exact text a session
 * starts with. Running conversations pick a change up at their next session.
 */

import { Alert, Collapse, Link, Progress, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RuleEffectiveQuery } from '@/common/types/platform/rules';
import { formatBytes, sizeState, type SizeState } from './ruleModel';
import { useRuleEffective } from './useRules';

const LEVEL_ORDER = ['global', 'project', 'assistant', 'conversation'];
const METER_COLORS: Record<SizeState, string | undefined> = {
  ok: undefined,
  near: 'var(--warning)',
  over: 'var(--danger)',
};

/** "3.1 KB of 8 KB" with a bar that turns orange near the cap and red past it. */
export const SizeMeter: React.FC<{ bytes: number; max: number; testId?: string }> = ({ bytes, max, testId }) => {
  const { t } = useTranslation();
  const state = sizeState(bytes, max);
  return (
    <div className='flex items-center gap-8px min-w-0' data-testid={testId} data-state={state}>
      <Progress
        className='flex-1 min-w-80px'
        percent={Math.min(100, Math.round((bytes / max) * 100))}
        showText={false}
        size='small'
        color={METER_COLORS[state]}
        aria-label={t('settings.rules.size.label', { used: formatBytes(bytes), max: formatBytes(max) })}
      />
      <span className={`text-12px whitespace-nowrap ${state === 'over' ? 'text-danger' : 'text-t-secondary'}`}>
        {t('settings.rules.size.label', { used: formatBytes(bytes), max: formatBytes(max) })}
      </span>
    </div>
  );
};

const RulesEffectivePanel: React.FC<{ query: RuleEffectiveQuery; onOpenRule?: (id: string) => void }> = ({
  query,
  onOpenRule,
}) => {
  const { t } = useTranslation();
  const { effective, error, isLoading } = useRuleEffective(query);

  if (error) return <span className='text-12px text-t-tertiary'>{t('settings.rules.effective.loadFailed')}</span>;
  if (isLoading || !effective) return <span className='text-12px text-t-tertiary'>{t('settings.rules.loading')}</span>;

  const rules = effective.rules.toSorted(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.name.localeCompare(b.name)
  );
  const left = rules.filter((rule) => !rule.delivered);

  return (
    <div className='flex flex-col gap-10px' data-testid='rules-effective'>
      <SizeMeter bytes={effective.bytes} max={effective.max_bytes} testId='rules-effective-meter' />
      {left.length > 0 ? (
        <Alert
          type='warning'
          content={t('settings.rules.effective.capped', { names: left.map((rule) => rule.name).join(', ') })}
          data-testid='rules-effective-capped'
        />
      ) : null}
      {rules.length === 0 ? (
        <span className='text-12px text-t-tertiary'>{t('settings.rules.effective.none')}</span>
      ) : (
        <ol className='m-0 p-0 list-none flex flex-col gap-6px'>
          {rules.map((rule) => (
            <li
              key={`${rule.level}:${rule.id}`}
              className={`flex items-center gap-8px min-w-0 ${rule.delivered ? '' : 'opacity-60'}`}
              data-testid='rules-effective-row'
            >
              <Tag size='small'>{t(`mcp.kits.level.${rule.level}`, { defaultValue: rule.level })}</Tag>
              {onOpenRule ? (
                <Link
                  className='flex-1 min-w-0 truncate !text-13px !text-t-primary hover:underline'
                  onClick={() => onOpenRule(rule.id)}
                >
                  {rule.name}
                </Link>
              ) : (
                <span className='flex-1 min-w-0 truncate text-13px text-t-primary'>{rule.name}</span>
              )}
              <span className='text-12px text-t-tertiary'>{formatBytes(rule.bytes)}</span>
              {rule.delivered ? null : (
                <Tag size='small' color='orange'>
                  {t('settings.rules.effective.leftOut')}
                </Tag>
              )}
            </li>
          ))}
        </ol>
      )}
      {effective.block ? (
        <Collapse bordered={false} className='!bg-transparent'>
          <Collapse.Item name='block' header={t('settings.rules.effective.exactText')}>
            <pre
              className='m-0 max-h-320px overflow-auto whitespace-pre-wrap break-words text-12px text-t-primary bg-fill-1 rd-6px p-8px'
              data-testid='rules-effective-block'
            >
              {effective.block}
            </pre>
          </Collapse.Item>
        </Collapse>
      ) : null}
      <span className='text-12px text-t-tertiary'>{t('settings.rules.effective.nextSession')}</span>
    </div>
  );
};

export default RulesEffectivePanel;

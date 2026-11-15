/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One market instance in a group: its template, status, tier and environment,
 * where it is attached (projects, assistants, CLIs) and which secret keys are
 * set — names and "set"/"not set" only, never a value.
 */

import { Button, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  McpMarketAssignment,
  McpMarketInstance,
  McpMarketInstanceHealth,
  McpMarketTemplate,
} from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { summarizeAttachments, type MarketProject } from '@/renderer/hooks/mcp/market/marketModel';
import { CliTag, MarketStatusTag, ScopeLabel, TemplateUpdateBadge, touchClass, useIsMobileLayout } from './shared';

type InstanceCardProps = {
  instance: McpMarketInstance;
  template?: McpMarketTemplate;
  health?: McpMarketInstanceHealth;
  assignments: readonly McpMarketAssignment[];
  projects: readonly MarketProject[];
  assistants: readonly Assistant[];
  onOpen: (instance: McpMarketInstance) => void;
};

const InstanceCard: React.FC<InstanceCardProps> = ({
  instance,
  template,
  health,
  assignments,
  projects,
  assistants,
  onOpen,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const attachments = summarizeAttachments(instance.id, assignments);
  const problems = health?.problems ?? [];

  return (
    <div
      className='flex flex-col gap-8px p-12px rd-12px border border-solid border-border-2 bg-fill-0'
      data-testid='mcp-market-instance'
      data-instance-name={instance.name}
    >
      <div className='flex items-start justify-between gap-8px'>
        <div className='flex flex-col gap-4px min-w-0'>
          <div className='flex flex-wrap items-center gap-6px'>
            <span className='text-14px text-t-primary font-mono font-medium break-all'>{instance.name}</span>
            <MarketStatusTag status={instance.status} />
            <Tag size='small' color={instance.tier === 'write' ? 'orangered' : 'arcoblue'}>
              {t(`mcp.market.tier.${instance.tier}`, { defaultValue: instance.tier })}
            </Tag>
            <Tag size='small'>
              {t(`mcp.market.environment.${instance.environment}`, { defaultValue: instance.environment })}
            </Tag>
            <TemplateUpdateBadge instance={instance} />
          </div>
          <span className='text-12px text-t-secondary truncate'>
            {t('mcp.market.instance.fromTemplate', { template: template?.name ?? instance.template_id })}
            {instance.template_version ? ` · ${instance.template_version}` : ''}
          </span>
        </div>
        <Button size='small' onClick={() => onOpen(instance)} className={touchClass(isMobile)}>
          {t('mcp.market.actions.manage')}
        </Button>
      </div>

      <div className='flex flex-col gap-4px'>
        <span className='text-12px text-t-secondary'>{t('mcp.market.instance.attachedTo')}</span>
        {attachments.length === 0 ? (
          <span className='text-12px text-t-tertiary'>{t('mcp.market.instance.notAttached')}</span>
        ) : (
          <div className='flex flex-col gap-4px'>
            {attachments.map((a) => (
              <div key={a.key} className='flex flex-wrap items-center gap-6px'>
                <ScopeLabel scope={a.scope} projects={projects} assistants={assistants} />
                {a.clis.map((c) => (
                  <CliTag key={c.assignmentId} cli={c.cli} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {instance.secrets.length > 0 && (
        <div className='flex flex-wrap items-center gap-6px' data-testid='mcp-market-instance-secrets'>
          <span className='text-12px text-t-secondary'>{t('mcp.market.instance.secrets')}</span>
          {instance.secrets.map((s) => (
            <Tag key={s.key} size='small' color={s.set ? 'green' : s.required ? 'orangered' : 'gray'}>
              <span className='font-mono'>{s.key}</span>
              {' · '}
              {s.set ? t('mcp.market.secret.set') : t('mcp.market.secret.notSet')}
            </Tag>
          ))}
        </div>
      )}

      {instance.missing.length > 0 && (
        <span className='text-12px text-warning'>
          {t('mcp.market.instance.missing', { keys: instance.missing.join(', ') })}
        </span>
      )}
      {problems.length > 0 && instance.status === 'active' && (
        <span className='text-12px text-danger'>{t('mcp.market.instance.problems', { count: problems.length })}</span>
      )}
    </div>
  );
};

export default InstanceCard;

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** The template catalogue: what can be added, with its tiers, CLIs and the keys it needs. */

import { Button, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketTemplate } from '@/common/config/storage';
import { secretKeys } from '@/renderer/hooks/mcp/market/marketModel';
import { CliTag, touchClass, useIsMobileLayout } from './shared';

type TemplateListProps = {
  templates: readonly McpMarketTemplate[];
  onAdd: (template: McpMarketTemplate) => void;
};

const TemplateList: React.FC<TemplateListProps> = ({ templates, onAdd }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-8px' data-testid='mcp-market-templates'>
      {templates.map((template) => {
        const secrets = secretKeys(template);
        return (
          <div
            key={template.id}
            className='flex flex-col gap-6px p-12px rd-12px border border-solid border-border-2 bg-fill-0'
            data-testid='mcp-market-template'
          >
            <div className='flex items-start justify-between gap-8px'>
              <div className='flex flex-col gap-2px min-w-0'>
                <span className='text-14px text-t-primary font-medium'>{template.name}</span>
                <span className='text-12px text-t-secondary font-mono truncate'>
                  {template.id}
                  {template.version ? ` · ${template.version}` : ''}
                </span>
              </div>
              <Button size='small' type='primary' onClick={() => onAdd(template)} className={touchClass(isMobile)}>
                {t('mcp.market.actions.add')}
              </Button>
            </div>
            {template.description && (
              <p className='m-0 text-12px text-t-secondary line-clamp-2'>{template.description}</p>
            )}
            <div className='flex flex-wrap gap-4px'>
              {template.tiers.map((tier) => (
                <Tag key={tier} size='small' color={tier === 'write' ? 'orangered' : 'arcoblue'}>
                  {t(`mcp.market.tier.${tier}`, { defaultValue: tier })}
                </Tag>
              ))}
              {template.clis.map((cli) => (
                <CliTag key={cli} cli={cli} />
              ))}
            </div>
            {secrets.length > 0 && (
              <span className='text-12px text-t-secondary'>
                {t('mcp.market.template.needsSecrets', { keys: secrets.join(', ') })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TemplateList;

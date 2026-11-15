/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The MCP library (D49/D50): every catalogue template grouped by category,
 * with a category filter (the page's search box filters too). Each entry
 * shows the vendor (official or community), a one-line purpose, the keys it
 * needs, how a read-only instance is enforced and the install mode, and
 * opens the add-from-template flow.
 */

import { Button, Select, Tag } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketTemplate } from '@/common/config/storage';
import {
  defaultTemplateTier,
  groupTemplatesByCategory,
  requiredSecretKeys,
  templateCategory,
  templateReadEnforcement,
  type McpTemplateCategory,
} from '@/renderer/hooks/mcp/market/marketModel';
import { touchClass, useIsMobileLayout } from './shared';

type TemplateListProps = {
  templates: readonly McpMarketTemplate[];
  onAdd: (template: McpMarketTemplate) => void;
};

type CategoryFilter = 'all' | McpTemplateCategory;

const TemplateEntry: React.FC<{ template: McpMarketTemplate; onAdd: () => void }> = ({ template, onAdd }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const keys = requiredSecretKeys(template);
  const enforcement = templateReadEnforcement(template);
  const fullTools = defaultTemplateTier(template) === 'write';
  const purpose = template.summary ?? template.description;
  return (
    <div
      className='flex flex-col gap-6px p-12px rd-12px border border-solid border-border-2 bg-fill-0 min-w-0'
      data-testid='mcp-market-template'
      data-template-id={template.id}
    >
      <div className='flex items-start justify-between gap-8px'>
        <div className='flex flex-col gap-4px min-w-0'>
          <span className='text-14px text-t-primary font-medium'>{template.name}</span>
          <div className='flex flex-wrap items-center gap-4px'>
            {template.vendor && <span className='text-12px text-t-secondary'>{template.vendor}</span>}
            <Tag size='small' color={template.official ? 'green' : 'gray'}>
              {t(template.official ? 'mcp.market.library.official' : 'mcp.market.library.community')}
            </Tag>
            {template.optional && <Tag size='small'>{t('mcp.market.library.optional')}</Tag>}
            {template.billing === 'metered' && (
              <Tag size='small' color='orange'>
                {t('mcp.market.library.metered')}
              </Tag>
            )}
          </div>
        </div>
        <Button
          size='small'
          type='primary'
          onClick={onAdd}
          className={touchClass(isMobile)}
          aria-label={t('mcp.market.library.addNamed', { name: template.name })}
        >
          {t('mcp.market.actions.add')}
        </Button>
      </div>
      {purpose && <p className='m-0 text-12px text-t-secondary line-clamp-2'>{purpose}</p>}
      <dl className='m-0 flex flex-col gap-2px text-12px'>
        <div className='flex flex-wrap gap-4px'>
          <dt className='text-t-tertiary'>{t('mcp.market.library.keysLabel')}</dt>
          <dd className='m-0 text-t-primary break-all' data-testid='mcp-market-template-keys'>
            {keys.length > 0
              ? t('mcp.market.library.needsKey', { keys: keys.join(', ') })
              : t('mcp.market.library.noKey')}
          </dd>
        </div>
        <div className='flex flex-wrap gap-4px'>
          <dt className='text-t-tertiary'>{t('mcp.market.library.readOnlyLabel')}</dt>
          <dd className='m-0 text-t-primary' data-testid='mcp-market-template-enforcement'>
            {t(`mcp.market.library.enforcement.${enforcement}`)}
          </dd>
        </div>
        <div className='flex flex-wrap gap-4px'>
          <dt className='text-t-tertiary'>{t('mcp.market.library.modeLabel')}</dt>
          <dd className='m-0 text-t-primary' data-testid='mcp-market-template-mode'>
            {t(fullTools ? 'mcp.market.library.modeFull' : 'mcp.market.library.modeReadOnly')}
          </dd>
        </div>
      </dl>
    </div>
  );
};

const TemplateList: React.FC<TemplateListProps> = ({ templates, onAdd }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [category, setCategory] = useState<CategoryFilter>('all');
  const allGroups = useMemo(() => groupTemplatesByCategory(templates), [templates]);
  const groups = category === 'all' ? allGroups : allGroups.filter((g) => g.category === category);
  const shown =
    category === 'all' ? templates.length : templates.filter((x) => templateCategory(x) === category).length;

  return (
    <div className='flex flex-col gap-12px min-w-0' data-testid='mcp-market-templates'>
      <div className='flex flex-col md:flex-row md:items-center gap-8px'>
        <Select
          value={category}
          onChange={(v: CategoryFilter) => setCategory(v)}
          aria-label={t('mcp.market.library.categoryFilter')}
          className={`md:max-w-240px ${touchClass(isMobile)}`}
          data-testid='mcp-market-category-filter'
        >
          <Select.Option value='all'>{t('mcp.market.library.allCategories')}</Select.Option>
          {allGroups.map((g) => (
            <Select.Option key={g.category} value={g.category}>
              {t(`mcp.market.library.category.${g.category}`)}
            </Select.Option>
          ))}
        </Select>
        <span className='text-12px text-t-secondary' aria-live='polite'>
          {t('mcp.market.library.count', { count: shown })}
        </span>
      </div>
      {groups.length === 0 ? (
        <div className='py-12px text-center text-12px text-t-secondary border border-dashed border-border-2 rd-8px'>
          {t('mcp.market.library.noMatch')}
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            className='flex flex-col gap-8px min-w-0'
            aria-labelledby={`mcp-market-category-${group.category}`}
            data-testid='mcp-market-category'
          >
            <h4 id={`mcp-market-category-${group.category}`} className='m-0 text-13px text-t-primary font-medium'>
              {t(`mcp.market.library.category.${group.category}`)}
            </h4>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-8px'>
              {group.templates.map((template) => (
                <TemplateEntry key={template.id} template={template} onAdd={() => onAdd(template)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

export default TemplateList;

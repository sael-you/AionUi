/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Small pieces shared by the MCP market view: status tags, scope labels, touch sizing, error notice. */

import { Alert, Button, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { ProjectChip, useProjectTheme } from '@/renderer/components/workspace/ProjectIdentity';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import type { McpMarketInstance } from '@/common/config/storage';
import { templateUpdate, type AttachScope, type MarketProject } from '@/renderer/hooks/mcp/market/marketModel';

/** Mobile layout (same signal as the rest of the app). */
export const useIsMobileLayout = (): boolean => useLayoutContext()?.isMobile ?? false;

/** 44 px touch targets on mobile. */
export const touchClass = (isMobile: boolean): string => (isMobile ? 'min-h-44px min-w-44px' : '');

const STATUS_COLORS: Record<string, string> = { active: 'green', dormant: 'gray', revoked: 'red' };

export const MarketStatusTag: React.FC<{ status: string }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <Tag size='small' color={STATUS_COLORS[status] ?? 'gray'} data-testid='mcp-market-status'>
      {t(`mcp.market.status.${status}`, { defaultValue: status })}
    </Tag>
  );
};

export const CliTag: React.FC<{ cli: string; closable?: boolean; onClose?: () => void }> = ({
  cli,
  closable,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <Tag size='small' closable={closable} onClose={onClose}>
      {t(`mcp.market.cli.${cli}`, { defaultValue: cli })}
    </Tag>
  );
};

/** A project as the sidebar shows it: the shared ProjectChip in the project's colour. */
export const MarketProjectChip: React.FC<{ project: MarketProject | null; projectId: string }> = ({
  project,
  projectId,
}) => {
  const { t } = useTranslation();
  const theme = useProjectTheme(project?.workspace);
  if (!theme) {
    return (
      <span className='text-12px text-t-secondary truncate'>
        {t('mcp.market.scope.unknownProject', { id: projectId })}
      </span>
    );
  }
  return <ProjectChip project={theme} />;
};

const assistantName = (assistants: readonly Assistant[], id: string) => assistants.find((a) => a.id === id)?.name ?? id;

/** Where an attachment applies: Global, a project, or an assistant in a project. */
export const ScopeLabel: React.FC<{
  scope: AttachScope;
  projects: readonly MarketProject[];
  assistants: readonly Assistant[];
}> = ({ scope, projects, assistants }) => {
  const { t } = useTranslation();
  if (scope.kind === 'global') {
    return <span className='text-12px text-t-primary font-medium'>{t('mcp.market.scope.global')}</span>;
  }
  const project = projects.find((p) => p.project_id === scope.projectId) ?? null;
  return (
    <span className='inline-flex flex-wrap items-center gap-6px min-w-0'>
      <MarketProjectChip project={project} projectId={scope.projectId} />
      {scope.kind === 'assistant' && (
        <span className='text-12px text-t-secondary'>
          {t('mcp.market.scope.assistantIn', { name: assistantName(assistants, scope.assistantId) })}
        </span>
      )}
    </span>
  );
};

/** Error notice with an optional retry. */
export const MarketErrorNotice: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const { t } = useTranslation();
  return (
    <Alert
      type='error'
      content={message}
      action={
        onRetry ? (
          <Button size='small' onClick={onRetry}>
            {t('mcp.market.actions.retry')}
          </Button>
        ) : undefined
      }
    />
  );
};

/** "Update available (v1 → v2)" when the catalogue has a newer template than the instance runs. */
export const TemplateUpdateBadge: React.FC<{
  instance: Pick<McpMarketInstance, 'template_update_available' | 'template_version' | 'template_current_version'>;
}> = ({ instance }) => {
  const { t } = useTranslation();
  const update = templateUpdate(instance);
  if (!update) return null;
  return (
    <Tag size='small' color='purple' data-testid='mcp-market-template-update'>
      {update.from && update.to
        ? t('mcp.market.template.updateAvailableVersions', { from: update.from, to: update.to })
        : t('mcp.market.template.updateAvailable')}
    </Tag>
  );
};

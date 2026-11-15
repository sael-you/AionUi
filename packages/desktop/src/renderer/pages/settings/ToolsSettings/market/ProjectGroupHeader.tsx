/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Header of one market group: label (Global, a project chip in its sidebar colour, …), count, optional action. */

import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MarketProject } from '@/renderer/hooks/mcp/market/marketModel';
import { MarketProjectChip, touchClass, useIsMobileLayout } from './shared';

type ProjectGroupHeaderProps = {
  /** A plain label (Global, Unassigned, Templates) or a project. */
  label?: string;
  project?: { projectId: string; project: MarketProject | null };
  count: number;
  actionLabel?: string;
  onAction?: () => void;
};

const ProjectGroupHeader: React.FC<ProjectGroupHeaderProps> = ({ label, project, count, actionLabel, onAction }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  return (
    <div className='flex items-center justify-between gap-8px w-full min-w-0'>
      <span className='flex items-center gap-8px min-w-0'>
        {project ? (
          <MarketProjectChip project={project.project} projectId={project.projectId} />
        ) : (
          <span className='text-14px text-t-primary font-medium truncate'>{label}</span>
        )}
        <span className='text-12px text-t-secondary' aria-label={t('mcp.market.group.count', { count })}>
          {count}
        </span>
      </span>
      {actionLabel && onAction && (
        <Button
          size='mini'
          onClick={(e) => {
            // The header toggles the group; the action must not.
            e.stopPropagation();
            onAction();
          }}
          className={touchClass(isMobile)}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export default ProjectGroupHeader;

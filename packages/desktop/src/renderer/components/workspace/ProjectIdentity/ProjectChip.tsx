/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ProjectIdentity.module.css';
import type { ProjectThemeView } from './useProjectTheme';

type ProjectChipProps = {
  project: ProjectThemeView;
  className?: string;
};

/**
 * The current project, at a glance: folder icon + project name on the project
 * tint. The name and icon carry the meaning; the colour only matches the
 * sidebar group. The full workspace path is in the tooltip.
 */
export const ProjectChip: React.FC<ProjectChipProps> = ({ project, className }) => {
  const { t } = useTranslation();
  return (
    <Tooltip content={project.workspace} mini position='bl'>
      <span
        data-project-chip
        {...project.dataAttributes}
        className={classNames(styles.chip, className)}
        style={project.style}
      >
        <span className={styles.chipIcon} aria-hidden='true'>
          <FolderOpen theme='outline' size={14} fill='currentColor' />
        </span>
        <span className='sr-only'>{t('conversation.projectIdentity.label', { name: project.name })}</span>
        <span className={styles.chipName} aria-hidden='true'>
          {project.name}
        </span>
      </span>
    </Tooltip>
  );
};

/** Single-line project label for tight spaces (mobile titlebar, under the title). */
export const ProjectLabel: React.FC<ProjectChipProps> = ({ project, className }) => {
  const { t } = useTranslation();
  return (
    <span
      data-project-label
      {...project.dataAttributes}
      className={classNames(styles.mobileLabel, className)}
      style={project.style}
    >
      <span className={styles.chipIcon} aria-hidden='true'>
        <FolderOpen theme='outline' size={11} fill='currentColor' />
      </span>
      <span className='sr-only'>{t('conversation.projectIdentity.label', { name: project.name })}</span>
      <span className={styles.chipName} aria-hidden='true'>
        {project.name}
      </span>
    </span>
  );
};

/** Class names of the shared project surfaces (accent strips, active tab, active sidebar group). */
export const projectSurfaceClasses = {
  stripTop: styles.stripTop,
  stripBottom: styles.stripBottom,
  activeTab: styles.activeTab,
  activeGroup: styles.activeGroup,
} as const;

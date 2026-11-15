/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClock } from '@icon-park/react';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import SiderNavItem from './SiderNavItem';

interface SiderScheduledEntryProps {
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

const SiderScheduledEntry: React.FC<SiderScheduledEntryProps> = ({
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <SiderNavItem
      icon={<AlarmClock theme='outline' size='16' fill='currentColor' />}
      label={t('cron.scheduledTasks')}
      isActive={isActive}
      collapsed={collapsed}
      siderTooltipProps={siderTooltipProps}
      onClick={onClick}
      testId='sider-nav-scheduled'
    />
  );
};

export default SiderScheduledEntry;

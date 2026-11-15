/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Ghost } from '@icon-park/react';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import SiderNavItem from './SiderNavItem';

interface SiderAssistantEntryProps {
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

const SiderAssistantEntry: React.FC<SiderAssistantEntryProps> = ({
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <SiderNavItem
      icon={<Ghost theme='outline' size='16' fill='currentColor' />}
      label={t('settings.assistants')}
      isActive={isActive}
      collapsed={collapsed}
      siderTooltipProps={siderTooltipProps}
      onClick={onClick}
      testId='sider-nav-assistants'
    />
  );
};

export default SiderAssistantEntry;

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** `/settings/voice` page (route added by the integration patch), same layout as the other settings pages. */

import React from 'react';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { getVoiceController } from '../core/effects';
import VoiceSettingsPanel from './VoiceSettingsPanel';

const VoiceSettingsPage: React.FC = () => {
  const isPageMode = useSettingsViewMode() === 'page';
  return (
    <SettingsPageWrapper>
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
          <VoiceSettingsPanel controller={getVoiceController()} />
        </div>
      </AionScrollArea>
    </SettingsPageWrapper>
  );
};

export default VoiceSettingsPage;

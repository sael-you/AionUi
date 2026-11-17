/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/settings/browser` (TASK-128): the browser's own settings page. WebUI: the
 * server browser (agents switch, limits, profiles, hide-automation), the
 * owner's own browsers (pairing, devices) and the approvals log. Desktop: the
 * in-app webview's data and agent-control switch.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import BrowserApprovalsLog from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserApprovalsLog';
import BrowserDataSection from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDataSection';
import BrowserDevicesSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BrowserDevicesSettings';
import ServerBrowserSettings from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/ServerBrowserSettings';
import { useSettingsViewMode } from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import SettingsPageHeader from '@/renderer/pages/settings/components/SettingsPageHeader';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { isElectronDesktop } from '@/renderer/utils/platform';

const BrowserSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const isPageMode = useSettingsViewMode() === 'page';
  const isDesktop = isElectronDesktop();
  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-16px' data-testid='browser-settings-page'>
        <SettingsPageHeader
          title={t('settings.browserPage.title')}
          description={t(isDesktop ? 'settings.browserPage.descriptionDesktop' : 'settings.browserPage.description')}
        />
        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
          <div className='flex flex-col gap-16px'>
            {isDesktop ? (
              <BrowserDataSection />
            ) : (
              <>
                <ServerBrowserSettings />
                <BrowserDevicesSettings />
                <BrowserApprovalsLog />
              </>
            )}
          </div>
        </AionScrollArea>
      </div>
    </SettingsPageWrapper>
  );
};

export default BrowserSettingsPage;

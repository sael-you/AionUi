/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Settings → Servers (C36, TASK-130). */

import React from 'react';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import ServersLibrary from './ServersLibrary';

const ServersSettings: React.FC = () => (
  <SettingsPageWrapper contentClassName='max-w-1200px'>
    <ServersLibrary />
  </SettingsPageWrapper>
);

export default ServersSettings;

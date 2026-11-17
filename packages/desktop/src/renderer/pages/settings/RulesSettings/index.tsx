/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Settings → Rules (C37, TASK-131). */

import React from 'react';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import RulesLibrary from './RulesLibrary';

const RulesSettings: React.FC = () => (
  <SettingsPageWrapper contentClassName='max-w-1200px'>
    <RulesLibrary />
  </SettingsPageWrapper>
);

export default RulesSettings;

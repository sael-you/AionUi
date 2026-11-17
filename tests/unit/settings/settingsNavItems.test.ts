/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';

const t = (key: string) => key;

describe('settings navigation', () => {
  // A tab in BUILTIN_TAB_IDS without an entry in the page wrapper left every settings page blank.
  it.each([true, false])('the page wrapper has an entry for every built-in tab (desktop=%s)', (isDesktop) => {
    const items = getBuiltinSettingsNavItems(isDesktop, t);
    expect(items.map((item) => item?.id)).toEqual([...BUILTIN_TAB_IDS]);
    for (const item of items) expect(item.path).toBeTruthy();
  });
});

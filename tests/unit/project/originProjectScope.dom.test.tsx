/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: async () => null,
}));

import { useOriginProjectId } from '@/renderer/components/settings/SettingsModal/library/useOriginProjectId';

describe('settings scope from the route (C42 Manage links)', () => {
  afterEach(() => {
    window.location.hash = '';
    sessionStorage.clear();
  });

  it('?project= of the settings route opens the page on that project', () => {
    window.location.hash = '#/settings/rules?project=p1';
    expect(renderHook(() => useOriginProjectId(null)).result.current).toBe('p1');
  });

  it('an explicit project still wins; without either the scope is Global', () => {
    window.location.hash = '#/settings/rules?project=p1';
    expect(renderHook(() => useOriginProjectId('p2')).result.current).toBe('p2');
    window.location.hash = '#/settings/rules';
    expect(renderHook(() => useOriginProjectId(null)).result.current).toBeNull();
  });
});

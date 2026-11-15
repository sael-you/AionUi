/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const layout = vi.hoisted(() => ({ isMobile: false }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => layout }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(async () => null),
}));
vi.mock('@/common', () => ({ ipcBridge: {} }));

import ParentBreadcrumb from '@/renderer/pages/conversation/GroupedHistory/components/ParentBreadcrumb';
import { setConversationSnapshotForTest } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

const row = (id: string, parent?: string) =>
  ({ id, name: `${id}-name`, parent_conversation_id: parent, extra: {} }) as unknown as TChatConversation;

describe('ParentBreadcrumb', () => {
  setConversationSnapshotForTest([row('root'), row('parent', 'root'), row('child', 'parent')]);

  it('shows the full path on desktop', () => {
    layout.isMobile = false;
    render(<ParentBreadcrumb conversation={{ id: 'child', parent_conversation_id: 'parent' }} />);
    expect(screen.getByText('root-name')).toBeInTheDocument();
    expect(screen.getByText('parent-name')).toBeInTheDocument();
  });

  it('shows only "↰ parent" at 390 px', () => {
    layout.isMobile = true;
    render(<ParentBreadcrumb conversation={{ id: 'child', parent_conversation_id: 'parent' }} />);
    expect(screen.queryByText('root-name')).toBeNull();
    expect(screen.getByText('parent-name')).toBeInTheDocument();
  });
});

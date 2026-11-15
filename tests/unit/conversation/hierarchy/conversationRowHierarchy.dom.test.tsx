/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));
vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));
vi.mock('@/renderer/pages/cron', () => ({ CronJobIndicator: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const conversation = {
  id: 'conv-1',
  name: 'Chat',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: {},
} as unknown as TChatConversation;

const baseProps: ConversationRowProps = {
  conversation,
  isGenerating: false,
  isWaitingConfirmation: false,
  hasUnread: false,
  isManualUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onArchive: vi.fn(),
  onTogglePin: vi.fn(),
  onToggleManualUnread: vi.fn(),
  getJobStatus: () => 'none',
};

const renderRow = (props: Partial<ConversationRowProps>) => render(<ConversationRow {...baseProps} {...props} />);

const rollup = { total: 3, running: 1, pendingConfirmations: 1, hasError: false };

describe('ConversationRow hierarchy', () => {
  it('renders a plain row as a leaf tree item: no aria-expanded, no toggle', () => {
    const { container } = renderRow({});
    const row = container.querySelector('[role="treeitem"]');
    expect(row).not.toBeNull();
    expect(row?.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByTestId('conversation-tree-toggle-conv-1')).toBeNull();
  });

  it('shows chevron, aria-expanded and a rollup badge when collapsed, and toggles without selecting', () => {
    const onToggle = vi.fn();
    const onConversationClick = vi.fn();
    const { container } = renderRow({
      onConversationClick,
      treeInfo: { expanded: false, childCount: 2, rollup, onToggle },
    });
    expect(container.querySelector('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('conversation-rollup-conv-1').textContent).toContain('2');
    // Needs-you outranks running in the rollup: one dot, no spinner.
    expect(screen.getByTestId('conversation-rollup-attention-conv-1')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-rollup-running-conv-1')).toBeNull();
    expect(container.querySelector('.arco-spin')).toBeNull();
    fireEvent.click(screen.getByTestId('conversation-tree-toggle-conv-1'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onConversationClick).not.toHaveBeenCalled();
  });

  it('hides the rollup badge when expanded', () => {
    renderRow({ treeInfo: { expanded: true, childCount: 2, rollup, onToggle: vi.fn() } });
    expect(screen.queryByTestId('conversation-rollup-conv-1')).toBeNull();
  });

  it('marks nested rows with aria-level and indents them', () => {
    const { container } = renderRow({ depth: 2 });
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;
    expect(row.getAttribute('aria-level')).toBe('3');
    expect(row.style.paddingInlineStart).toBe('40px');
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const env = vi.hoisted(() => ({ isMobile: false }));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({ info: null }) }));
vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));
vi.mock('@/renderer/pages/cron', () => ({ CronJobIndicator: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: env.isMobile }) }));
vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en-US' } }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const HOUR = 3_600_000;
const conversation = {
  id: 'conv-1',
  name: 'Refactor the sidebar',
  type: 'acp',
  created_at: Date.now() - 3 * HOUR,
  modified_at: Date.now() - 3 * HOUR,
  extra: {},
} as unknown as TChatConversation;

const props = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
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
  ...overrides,
});

const row = () => screen.getByRole('treeitem');

describe('sidebar conversation row', () => {
  it('is a tree item at its tree level, out of the tab order until the tree gives it the stop', () => {
    render(<ConversationRow {...props({ treeLevel: 3 })} />);
    expect(row().getAttribute('aria-level')).toBe('3');
    expect(row().tabIndex).toBe(-1);
    expect(row().getAttribute('data-tree-level')).toBe('3');
  });

  it('marks the selected conversation with aria-current (neutral selection)', () => {
    render(<ConversationRow {...props({ selected: true })} />);
    expect(row().getAttribute('aria-current')).toBe('page');
    expect(row().getAttribute('aria-selected')).toBe('true');
  });

  it('shows the time ago (revealed on hover) and the unread dot', () => {
    render(<ConversationRow {...props({ hasUnread: true })} />);
    expect(screen.getByTestId('conversation-time-conv-1').textContent).toBe('3 hours ago');
    expect(screen.getByTestId('conversation-unread-conv-1')).toBeInTheDocument();
  });

  it('hides the unread dot while the row is running', () => {
    render(<ConversationRow {...props({ hasUnread: true, isGenerating: true })} />);
    expect(screen.queryByTestId('conversation-unread-conv-1')).toBeNull();
  });

  it('renders the badge slot after the title', () => {
    render(<ConversationRow {...props({ badge: <span data-testid='board-keeper-badge'>B</span> })} />);
    expect(screen.getByTestId('conversation-badge-conv-1')).toContainElement(screen.getByTestId('board-keeper-badge'));
  });

  it('opens with Enter and opens its menu with the context-menu key', () => {
    const onConversationClick = vi.fn();
    const onOpenMenu = vi.fn();
    render(<ConversationRow {...props({ onConversationClick, onOpenMenu })} />);
    fireEvent.keyDown(row(), { key: 'Enter' });
    expect(onConversationClick).toHaveBeenCalledWith(conversation);
    fireEvent.keyDown(row(), { key: 'ContextMenu' });
    expect(onOpenMenu).toHaveBeenCalledWith(conversation);
  });

  it('labels the row menu for assistive tech and keeps it reachable on touch', () => {
    env.isMobile = true;
    render(<ConversationRow {...props()} />);
    const trigger = screen.getByTestId('conversation-row-menu-conv-1');
    expect(trigger.getAttribute('aria-label')).toBe('conversation.sidebar.conversationActions');
    // No hover on touch: no time-ago column either, the menu button stays.
    expect(screen.queryByTestId('conversation-time-conv-1')).toBeNull();
    env.isMobile = false;
  });
});

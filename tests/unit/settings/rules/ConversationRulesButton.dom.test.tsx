/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ effective: vi.fn() }));
const bridge = vi.hoisted(() => ({
  rules: { effective: { invoke: (...args: unknown[]) => api.effective(...args) } },
}));
vi.mock('@/common', () => ({ ipcBridge: bridge }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
    i18n: { language: 'en-US' },
  }),
}));

import ConversationRulesButton from '@/renderer/pages/settings/RulesSettings/ConversationRulesButton';

const renderButton = () =>
  render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ConversationRulesButton conversationId='c1' />
      </SWRConfig>
    </MemoryRouter>
  );

const effective = (delivered: boolean[]) => ({
  rules: delivered.map((ok, i) => ({ id: `r${i}`, name: `Rule ${i}`, level: 'global', bytes: 10, delivered: ok })),
  block: delivered.length ? '# Rules' : '',
  bytes: 10,
  max_bytes: 24576,
});

describe('ConversationRulesButton (C37)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('is hidden when no rule applies, and when the core has no rules', async () => {
    api.effective.mockResolvedValue(effective([]));
    const { container, unmount } = renderButton();
    await waitFor(() => expect(api.effective).toHaveBeenCalledWith({ conversation_id: 'c1' }));
    expect(container.querySelector('[data-testid="conversation-rules-button"]')).toBeNull();
    unmount();

    api.effective.mockRejectedValue(new Error('404'));
    const second = renderButton();
    await waitFor(() => expect(api.effective).toHaveBeenCalledTimes(2));
    expect(second.container.querySelector('[data-testid="conversation-rules-button"]')).toBeNull();
  });

  it('counts the delivered rules; opening shows what the conversation gets with the capped one', async () => {
    api.effective.mockResolvedValue(effective([true, true, false]));
    renderButton();
    const button = await screen.findByTestId('conversation-rules-button');
    expect(button).toHaveAttribute('aria-label', 'settings.rules.header.label:2');
    expect(button).toHaveTextContent('2');
    fireEvent.click(button);
    expect(await screen.findByTestId('rules-effective-capped')).toBeInTheDocument();
    expect(screen.getAllByTestId('rules-effective-row')).toHaveLength(3);
    expect(screen.getByText('settings.rules.header.manage')).toBeInTheDocument();
  });
});

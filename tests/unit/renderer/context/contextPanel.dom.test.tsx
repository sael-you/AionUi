/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationContextReport } from '@/common/types/conversationContext';
import type { UseContextReportResult } from '@/renderer/pages/conversation/explorer/context/useContextReport';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      if (typeof options.defaultValue === 'string') return `${key}|${options.defaultValue}`;
      return `${key}(${Object.values(options).join(',')})`;
    },
    i18n: { language: 'en-US' },
  }),
}));

let turnRunning = false;
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  useIsConversationGenerating: () => turnRunning,
}));

let hookState: UseContextReportResult;
vi.mock('@/renderer/pages/conversation/explorer/context/useContextReport', () => ({
  useContextReport: () => hookState,
}));

const messageWarning = vi.fn();
const messageError = vi.fn();
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, warning: (m: unknown) => messageWarning(m), error: (m: unknown) => messageError(m) },
    Tooltip: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
      <span data-tooltip={typeof content === 'string' ? content : undefined}>{children}</span>
    ),
  };
});

import ContextPanel from '@/renderer/pages/conversation/explorer/context/ContextPanel';

const cliReport = (over: Partial<ConversationContextReport> = {}): ConversationContextReport => ({
  used: 603_800,
  size: 1_000_000,
  percent: 60.4,
  model: 'm',
  auto_compact: { supported: true, mode: 'auto', threshold_tokens: 963_800, until_tokens: 360_000 },
  categories: [
    { id: 'messages', label_key: 'k', name: 'Messages', tokens: 507_500, deferred: false, estimated: false },
    { id: 'mcp_tools', label_key: 'k', name: 'MCP tools', tokens: 27_800, deferred: false, estimated: false },
    { id: 'free_space', label_key: 'k', name: 'Free space', tokens: 363_200, deferred: false, estimated: false },
    {
      id: 'mcp_tools_deferred',
      label_key: 'k',
      name: 'MCP tools (deferred)',
      tokens: 584_000,
      deferred: true,
      estimated: false,
    },
    { id: 'other', label_key: 'k', name: 'Brand new bucket', tokens: 10, deferred: false, estimated: false },
  ],
  items: {
    mcp_tools: [
      { name: 'query', server: 'db', tokens: 300, loaded: true },
      { name: 'open', server: null, tokens: 200, loaded: null },
    ],
    memory_files: [{ path: '/p/AGENTS.md', kind: 'project', tokens: 900 }],
    agents: [],
    skills: [],
  },
  cost: { amount: 1.5, currency: 'USD' },
  source: 'cli',
  updated_at: 1,
  ...over,
});

const state = (over: Partial<UseContextReportResult> = {}): UseContextReportResult => ({
  report: cliReport(),
  loading: false,
  error: false,
  reload: vi.fn(async () => {}),
  compacting: false,
  compact: vi.fn(async () => 'started' as const),
  autoCompactPending: false,
  savingAutoCompact: false,
  setAutoCompact: vi.fn(async () => true),
  ...over,
});

const compactButton = (c: HTMLElement) => c.querySelector('[data-context-compact]') as HTMLButtonElement;

beforeEach(() => {
  turnRunning = false;
  hookState = state();
  messageWarning.mockClear();
  messageError.mockClear();
});
afterEach(() => cleanup());

describe('ContextPanel', () => {
  it('empty: says "no usage yet" before the first turn and without a conversation', () => {
    hookState = state({ report: null });
    const { container, rerender } = render(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-state="empty"]')).toHaveTextContent('conversation.context.empty');
    rerender(<ContextPanel conversationId={null} />);
    expect(screen.getByText('conversation.context.empty')).toBeInTheDocument();
  });

  it('error: offers a retry only when there is no report to keep', () => {
    const reload = vi.fn(async () => {});
    hookState = state({ report: null, error: true, reload });
    const { container, rerender } = render(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-state="error"]')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.retry'));
    expect(reload).toHaveBeenCalledTimes(1);

    hookState = state({ error: true });
    rerender(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-state="ready"]')).toBeInTheDocument();
  });

  it('cli: shows the share, the totals, one bar segment per loaded category and every row', () => {
    const { container } = render(<ContextPanel conversationId='c1' />);
    expect(screen.getByText('conversation.context.used(60%)')).toBeInTheDocument();
    expect(screen.getByText('603.8K / 1M')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');

    const segments = [...container.querySelectorAll('[data-segment]')].map((s) => s.getAttribute('data-segment'));
    expect(segments).toEqual(['messages', 'mcp_tools', 'other']);

    const messages = container.querySelector('[data-category="messages"]') as HTMLElement;
    expect(messages).toHaveTextContent('507.5K');
    expect(messages).toHaveTextContent('50.8%');
    const deferred = container.querySelector('[data-category="mcp_tools_deferred"]') as HTMLElement;
    expect(deferred).toHaveAttribute('data-deferred', 'true');
    expect(deferred).toHaveTextContent('584.0K');
    expect(deferred).toHaveTextContent('—');
    // A category the backend does not know keeps the backend's own name.
    expect(container.querySelector('[data-category="other"]')).toHaveTextContent('Brand new bucket');

    expect(container.querySelector('[data-estimated]')).toBeNull();
    expect(container.querySelector('[data-context-cost]')).toHaveTextContent('$1.50');
    expect(screen.getByText('conversation.context.untilAutoCompact(360.0K)')).toBeInTheDocument();
    expect(container.querySelector('[data-context-source="cli"]')).toBeInTheDocument();
  });

  it('estimated: marks estimated values with ~ and explains them; no window → raw count', () => {
    hookState = state({
      report: cliReport({
        source: 'estimated',
        size: null,
        percent: null,
        cost: null,
        auto_compact: { supported: false, mode: 'auto', threshold_tokens: null, until_tokens: null },
        categories: [
          { id: 'messages', label_key: 'k', name: 'Messages', tokens: 9_000, deferred: false, estimated: false },
          { id: 'skills', label_key: 'k', name: 'Skills', tokens: 1_000, deferred: false, estimated: true },
        ],
      }),
    });
    const { container } = render(<ContextPanel conversationId='c1' />);
    const skills = container.querySelector('[data-category="skills"]') as HTMLElement;
    expect(skills.querySelector('[data-estimated]')).toHaveTextContent('~1.0K');
    expect(skills.querySelector('[data-tooltip]')).toHaveAttribute(
      'data-tooltip',
      'conversation.context.estimatedTooltip'
    );
    expect(container.querySelector('[data-category="messages"] [data-estimated]')).toBeNull();
    expect(skills).toHaveTextContent('—');
    expect(screen.getByText('conversation.contextUsage.tokensUsed(603.8K)')).toBeInTheDocument();
    expect(screen.getByText('conversation.contextUsage.windowUnknown')).toBeInTheDocument();
    // An agent without a configurable threshold gets no select and no cost line.
    expect(container.querySelector('[data-context-auto-compact]')).toBeNull();
    expect(container.querySelector('[data-context-cost]')).toBeNull();
  });

  it('lists: collapsed by default, expand to per-server tools and file paths', () => {
    const { container } = render(<ContextPanel conversationId='c1' />);
    const lists = [...container.querySelectorAll('[data-context-list]')].map((l) =>
      l.getAttribute('data-context-list')
    );
    expect(lists).toEqual(['mcp_tools', 'memory_files']);
    expect(screen.queryByText('query')).not.toBeInTheDocument();

    const toggle = container.querySelector('[data-context-list="mcp_tools"] button') as HTMLElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('db')).toBeInTheDocument();
    expect(screen.getByText('query')).toBeInTheDocument();
    expect(screen.getByText('conversation.context.otherServer')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-context-list="memory_files"] button') as HTMLElement);
    expect(screen.getByText('/p/AGENTS.md')).toBeInTheDocument();
  });

  it('auto-compact: shows the hint, and the "next agent start" note only after a change', () => {
    const { container, rerender } = render(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-auto-compact]')).toHaveTextContent(
      'conversation.context.autoCompactHint'
    );
    expect(container.querySelector('[data-context-next-start]')).toBeNull();
    hookState = state({ autoCompactPending: true });
    rerender(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-next-start]')).toHaveTextContent(
      'conversation.context.autoCompactNextStart'
    );
  });

  it('compact: starts on click and reports a refusal in words', async () => {
    const compact = vi.fn(async () => 'started' as const);
    hookState = state({ compact });
    const { container, rerender } = render(<ContextPanel conversationId='c1' />);
    expect(compactButton(container)).toHaveTextContent('conversation.context.compact');
    fireEvent.click(compactButton(container));
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
    expect(messageWarning).not.toHaveBeenCalled();

    hookState = state({ compact: vi.fn(async () => 'unsupported' as const) });
    rerender(<ContextPanel conversationId='c1' />);
    fireEvent.click(compactButton(container));
    await waitFor(() => expect(messageWarning).toHaveBeenCalledWith('conversation.context.compactUnsupported'));

    hookState = state({ compact: vi.fn(async () => 'failed' as const) });
    rerender(<ContextPanel conversationId='c1' />);
    fireEvent.click(compactButton(container));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('conversation.context.compactFailed'));
  });

  it('compacting: the button is busy and says so', () => {
    turnRunning = true; // the compact itself runs as a turn
    hookState = state({ compacting: true });
    const { container } = render(<ContextPanel conversationId='c1' />);
    expect(container.querySelector('[data-context-state="compacting"]')).toBeInTheDocument();
    expect(compactButton(container)).toHaveTextContent('conversation.context.compacting');
    expect(compactButton(container).className).toContain('arco-btn-loading');
  });

  it('turn running: the button is disabled and explains why', () => {
    turnRunning = true;
    const compact = vi.fn(async () => 'started' as const);
    hookState = state({ compact });
    const { container } = render(<ContextPanel conversationId='c1' />);
    expect(compactButton(container)).toBeDisabled();
    expect(compactButton(container).closest('[data-tooltip]')).toHaveAttribute(
      'data-tooltip',
      'conversation.context.compactTurnRunning'
    );
    fireEvent.click(compactButton(container));
    expect(compact).not.toHaveBeenCalled();
  });
});

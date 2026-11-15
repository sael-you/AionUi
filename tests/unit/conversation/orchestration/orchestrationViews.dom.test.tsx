/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageThinking, IMessageToolCall } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key.startsWith('common.unit.')
        ? key.slice('common.unit.'.length, 'common.unit.'.length + 1)
        : options && 'count' in options
          ? `${key}:${String(options.count)}`
          : options && 'duration' in options
            ? `${key}:${String(options.duration)}`
            : key,
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { responseStream: { on: vi.fn() }, turnCompleted: { on: vi.fn() } },
    database: { getConversationMessage: { invoke: vi.fn() } },
  },
}));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({ info: null }) }));
vi.mock('@/renderer/utils/model/agentLogo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/model/agentLogo')>()),
  useAgentLogos: () => ({}),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));

import StatusGlyph from '@/renderer/pages/conversation/components/orchestration/StatusGlyph';
import TurnActivity from '@/renderer/pages/conversation/components/orchestration/TurnActivity';
import DelegatedWorkCard from '@/renderer/pages/conversation/components/orchestration/DelegatedWork/DelegatedWorkCard';
import type { DelegatedRow } from '@/renderer/pages/conversation/components/orchestration/DelegatedWork/delegatedWork';
import ChildResultCard from '@/renderer/pages/conversation/Messages/components/childResult/ChildResultCard';

const conv = (id: string) =>
  ({ id, name: id, type: 'acp', created_at: 0, modified_at: 0, extra: {} }) as unknown as TChatConversation;

describe('StatusGlyph', () => {
  it('gives every state a shape and a name; idle draws nothing', () => {
    const { container, rerender } = render(<StatusGlyph state='waiting' />);
    expect(screen.getByRole('img', { name: 'conversation.orchestration.state.waiting' })).toBeInTheDocument();
    rerender(<StatusGlyph state='queued' />);
    expect(container.querySelector('[data-run-state="queued"] circle')).not.toBeNull();
    rerender(<StatusGlyph state='idle' />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('TurnActivity', () => {
  it('folds a turn into one line and expands into a timeline with short thoughts folded', () => {
    const now = Date.now();
    const thought = (id: string, duration: number) =>
      ({
        id,
        type: 'thinking',
        conversation_id: 'p',
        created_at: now - 60_000,
        content: { content: 'x', duration, status: 'done', subject: 'Planned' },
      }) as IMessageThinking;
    const step = {
      id: 's1',
      type: 'tool_call',
      conversation_id: 'p',
      created_at: now - 50_000,
      content: { call_id: 's1', name: 'Read', args: {}, status: 'completed' },
    } as IMessageToolCall;
    render(
      <TurnActivity
        entries={[
          { kind: 'thought', message: thought('t1', 6000) },
          { kind: 'thought', message: thought('t2', 300) },
          { kind: 'tools', id: 'g', created_at: now - 50_000, messages: [step] },
        ]}
        endAt={now}
      />
    );
    const line = screen.getByRole('button', { expanded: false });
    expect(line.textContent).toContain('conversation.orchestration.activity.worked:1m 00s');
    expect(line.textContent).toContain('conversation.orchestration.activity.steps:1');
    expect(line.textContent).toContain('conversation.orchestration.activity.thoughts:2');
    fireEvent.click(line);
    const timeline = screen.getByTestId('turn-activity-timeline');
    expect(within(timeline).getByText('Planned')).toBeInTheDocument();
    expect(timeline.textContent).toContain('conversation.orchestration.activity.shortThoughts:1');
  });
});

describe('DelegatedWorkCard', () => {
  const rows: DelegatedRow[] = [
    {
      key: 'conversation:c15',
      kind: 'conversation',
      name: 'C15',
      state: 'waiting',
      depth: 0,
      startedAt: 0,
      conversation: conv('c15'),
    },
    {
      key: 'conversation:c17',
      kind: 'conversation',
      name: 'C17',
      state: 'failed',
      depth: 0,
      startedAt: 0,
      endedAt: 120_000,
      conversation: conv('c17'),
    },
    {
      key: 'task:a',
      kind: 'subagent',
      name: 'Build Jarvis',
      state: 'running',
      depth: 0,
      startedAt: Date.now() - 1000,
      callId: 'sa',
    },
    { key: 'task:b', kind: 'background', name: 'Run tests', state: 'done', depth: 0, startedAt: 0, endedAt: 60_000 },
  ];

  it('groups rows, offers Review for needs-you, and folds finished background tasks', () => {
    navigate.mockClear();
    render(<DelegatedWorkCard id='card' rows={rows} toolCalls={[]} />);
    expect(screen.getByText('conversation.orchestration.card.group.conversation')).toBeInTheDocument();
    expect(screen.getByText('conversation.orchestration.card.waitingNote')).toBeInTheDocument();
    expect(screen.getByText('conversation.orchestration.card.failedNote')).toBeInTheDocument();
    expect(screen.queryByText('Run tests')).toBeNull();
    expect(screen.getByText('conversation.orchestration.card.finishedHidden:1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delegated-review-conversation:c15'));
    expect(navigate).toHaveBeenCalledWith('/conversation/c15');
    fireEvent.click(screen.getByText('conversation.orchestration.card.show'));
    expect(screen.getByText('Run tests')).toBeInTheDocument();
  });

  it('moves between rows with the arrows and opens with Enter', () => {
    navigate.mockClear();
    render(<DelegatedWorkCard id='card' rows={rows} toolCalls={[]} />);
    const first = screen.getByTestId('delegated-row-conversation:c15');
    expect(first.getAttribute('tabindex')).toBe('0');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = screen.getByTestId('delegated-row-conversation:c17');
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith('/conversation/c17');
  });
});

describe('ChildResultCard', () => {
  it('shows a glyph and a localized word, never the raw status', () => {
    render(<ChildResultCard result={{ childId: 'c14', name: 'C14', status: 'error', body: 'boom' }} />);
    expect(screen.getByTestId('child-result-card').getAttribute('data-run-state')).toBe('failed');
    expect(screen.getByText('conversation.orchestration.report.failed')).toBeInTheDocument();
    expect(screen.queryByText('error')).toBeNull();
    fireEvent.click(screen.getByText('conversation.orchestration.report.show'));
    expect(screen.getByTestId('child-result-body').textContent).toBe('boom');
  });
});

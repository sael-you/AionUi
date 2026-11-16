/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Continue in background" on a running tool call (TASK-8): shown only for a
 * running call of a claude conversation that nothing refused yet; the request
 * names the conversation and the call; afterwards a "running in background"
 * tag; refusals (session-wide or for this call) hide it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ background: vi.fn(), messageError: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { backgroundToolCall: { invoke: api.background } },
    database: { getConversationMessage: { invoke: vi.fn() } },
  },
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, error: api.messageError } };
});

import type { IMessageToolCall, TMessage } from '@/common/chat/chatLib';
import { backgroundRefused, isBackgroundToolSupported } from '@/common/chat/backgroundTool';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';
import MessageToolCall from '@/renderer/pages/conversation/Messages/components/MessageToolCall';
import { resetBackgroundRequests } from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

const toolCall = (status: string, callId = 'toolu_sleep'): IMessageToolCall =>
  ({
    id: `m-${callId}`,
    msg_id: `m-${callId}`,
    conversation_id: 'c1',
    type: 'tool_call',
    position: 'left',
    content: { call_id: callId, name: 'Bash', status, args: { command: 'sleep 120' } },
  }) as unknown as IMessageToolCall;

const tip = (code: string, callId?: string): TMessage =>
  ({
    id: `tip-${code}`,
    conversation_id: 'c1',
    type: 'tips',
    position: 'center',
    content: { content: 'refused', type: 'warning', code, params: callId ? { call_id: callId } : undefined },
  }) as unknown as TMessage;

const renderCall = (message: IMessageToolCall, opts: { backend?: string; messages?: TMessage[] } = {}) =>
  render(
    <ConversationProvider value={{ conversation_id: 'c1', type: 'acp', backend: opts.backend ?? 'claude' }}>
      <MessageListProvider value={opts.messages ?? []}>
        <MessageToolCall message={message} />
      </MessageListProvider>
    </ConversationProvider>
  );

beforeEach(() => {
  api.background.mockReset();
  api.messageError.mockReset();
  resetBackgroundRequests();
});
afterEach(() => cleanup());

describe('Continue in background', () => {
  it('is offered on a running claude tool call and sends the conversation and call id', async () => {
    api.background.mockResolvedValue(undefined);
    renderCall(toolCall('running'));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.backgroundTool.continue' }));
    await waitFor(() => expect(api.background).toHaveBeenCalledWith({ conversation_id: 'c1', call_id: 'toolu_sleep' }));
    expect(await screen.findByText('conversation.backgroundTool.running')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'conversation.backgroundTool.continue' })).toBeNull();
  });

  it('is not offered for a finished call or another backend', () => {
    renderCall(toolCall('completed'));
    expect(screen.queryByText('conversation.backgroundTool.continue')).toBeNull();
    cleanup();
    renderCall(toolCall('running'), { backend: 'codex' });
    expect(screen.queryByText('conversation.backgroundTool.continue')).toBeNull();
  });

  it('hides after a refusal: session-wide for everyone, per call for its own call', () => {
    renderCall(toolCall('running'), { messages: [tip('TOOL_BACKGROUND_DISABLED')] });
    expect(screen.queryByText('conversation.backgroundTool.continue')).toBeNull();
    cleanup();
    renderCall(toolCall('running'), { messages: [tip('TOOL_BACKGROUND_NOT_RUNNING', 'toolu_sleep')] });
    expect(screen.queryByText('conversation.backgroundTool.continue')).toBeNull();
    cleanup();
    // Another call's refusal does not hide this one.
    renderCall(toolCall('running'), { messages: [tip('TOOL_BACKGROUND_FAILED', 'toolu_other')] });
    expect(screen.getByText('conversation.backgroundTool.continue')).toBeTruthy();
  });

  it('a failed request says so and keeps the button', async () => {
    api.background.mockRejectedValue(new Error('400'));
    renderCall(toolCall('running'));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.backgroundTool.continue' }));
    await waitFor(() => expect(api.messageError).toHaveBeenCalledWith('conversation.backgroundTool.failed'));
    expect(screen.getByRole('button', { name: 'conversation.backgroundTool.continue' })).toBeTruthy();
  });
});

describe('background tool helpers', () => {
  it('supports claude ACP conversations only', () => {
    expect(isBackgroundToolSupported({ type: 'acp', backend: 'claude' })).toBe(true);
    expect(isBackgroundToolSupported({ type: 'acp', backend: 'gemini' })).toBe(false);
    expect(isBackgroundToolSupported({ type: 'aionrs', backend: 'claude' })).toBe(false);
  });

  it('reads refusals from the stream tips', () => {
    expect(backgroundRefused([tip('TOOL_BACKGROUND_UNSUPPORTED')], 'x')).toBe(true);
    expect(backgroundRefused([tip('TOOL_BACKGROUND_NOT_RUNNING', 'x')], 'x')).toBe(true);
    expect(backgroundRefused([tip('TOOL_BACKGROUND_NOT_RUNNING', 'y')], 'x')).toBe(false);
    expect(backgroundRefused([tip('ACP_EMPTY_TURN')], 'x')).toBe(false);
  });
});

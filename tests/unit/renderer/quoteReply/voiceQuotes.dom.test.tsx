/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { quoteStackStore, type QuoteItem } from '@/renderer/components/chat/SendBox/quoteStack';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import { decodeFrame, encodeFrame } from '@/renderer/voice/core/protocol';
import type { ServerFrame } from '@/renderer/voice/core/types';
import { createFakeEffects, flush } from '../voice/fakes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));

import ConversationVoiceBar from '@/renderer/voice/ui/ConversationVoiceBar';

const quote = (id: string, content: string, reply = ''): QuoteItem => ({
  id,
  messageId: `m-${id}`,
  position: 'left',
  content,
  reply,
});

const ready = (attachQuotes: boolean): ServerFrame => ({
  name: 'voice.ready',
  voiceSessionId: 'vs-1',
  engine: 'openai-realtime',
  model: 'm',
  ...(attachQuotes ? { attachQuotes: true } : {}),
});

async function setup(attachQuotes: boolean) {
  const f = createFakeEffects();
  const controller = new VoiceController(f.fx);
  render(
    <MemoryRouter>
      <ConversationVoiceBar conversationId='c1' running={false} controller={controller} />
    </MemoryRouter>
  );
  act(() => controller.toggle({ focusConversationId: 'c1', mode: 'conversation' }));
  await act(flush);
  act(() => f.openSocket());
  await act(flush);
  act(() => f.frame(ready(attachQuotes)));
  return { f, controller };
}

const ack = (consumed: boolean, reason: 'posted' | 'too_large' | 'cleared'): ServerFrame => ({
  name: 'voice.quotesAttached',
  voiceSessionId: 'vs-1',
  consumed,
  reason,
});

describe('voice protocol for stacked quotes (C32)', () => {
  it('reads the capability on the hello replies and the attach ack', () => {
    const ready = decodeFrame(
      JSON.stringify({
        name: 'voice.ready',
        data: { voiceSessionId: 'vs', engine: 'e', model: 'm', capabilities: { attachQuotes: true } },
      })
    );
    expect(ready).toMatchObject({ name: 'voice.ready', attachQuotes: true });
    const armed = decodeFrame(JSON.stringify({ name: 'voice.state', data: { state: 'armed', capabilities: {} } }));
    expect(armed).not.toHaveProperty('attachQuotes');
    expect(
      decodeFrame(
        JSON.stringify({
          name: 'voice.quotesAttached',
          data: { voiceSessionId: 'vs', consumed: true, reason: 'posted' },
        })
      )
    ).toEqual({ name: 'voice.quotesAttached', voiceSessionId: 'vs', consumed: true, reason: 'posted' });
    expect(
      decodeFrame(JSON.stringify({ name: 'voice.quotesAttached', data: { consumed: true, reason: 'whatever' } }))
    ).toBeNull();
  });

  it('encodes voice.attachQuotes as {voiceSessionId, text}', () => {
    expect(JSON.parse(encodeFrame({ name: 'voice.attachQuotes', text: '> q' }, 'vs-1'))).toEqual({
      name: 'voice.attachQuotes',
      data: { text: '> q', voiceSessionId: 'vs-1' },
    });
  });
});

describe('stacked quotes ride with the next spoken message (C32 5b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    quoteStackStore.resetForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the whole stack when the backend can take it, and clears it once posted', async () => {
    act(() => quoteStackStore.set('c1', [quote('a', 'first', 'yes'), quote('b', 'second')]));
    const { f } = await setup(true);

    expect(f.sent('voice.attachQuotes')).toEqual([{ name: 'voice.attachQuotes', text: '> first\n\nyes\n\n> second' }]);
    expect(screen.getByTestId('voice-bar-quotes')).toHaveTextContent('voice.bar.quotesAttached|{"count":2}');

    act(() => quoteStackStore.set('c1', [quote('a', 'first', 'yes')]));
    expect(f.sent('voice.attachQuotes').at(-1)).toEqual({ name: 'voice.attachQuotes', text: '> first\n\nyes' });

    act(() => f.frame(ack(true, 'posted')));
    expect(quoteStackStore.get('c1')).toEqual([]);
    expect(screen.queryByTestId('voice-bar-quotes')).toBeNull();
  });

  it('cancels the pending quotes with "" when the owner empties the stack', async () => {
    act(() => quoteStackStore.set('c1', [quote('a', 'gone soon')]));
    const { f } = await setup(true);
    act(() => quoteStackStore.set('c1', []));
    expect(f.sent('voice.attachQuotes').at(-1)).toEqual({ name: 'voice.attachQuotes', text: '' });
  });

  it('keeps the stack and says so when the quotes are too long or the call ended', async () => {
    act(() => quoteStackStore.set('c1', [quote('a', 'long')]));
    const { f } = await setup(true);

    act(() => f.frame(ack(false, 'too_large')));
    expect(screen.getByTestId('voice-bar-quotes')).toHaveTextContent('voice.bar.quotesTooLarge|{"count":1}');
    act(() => f.frame(ack(false, 'cleared')));
    expect(quoteStackStore.get('c1')).toHaveLength(1);
  });

  it('never sends to an older backend; the quotes wait in the composer', async () => {
    act(() => quoteStackStore.set('c1', [quote('a', 'waiting')]));
    const { f } = await setup(false);

    expect(f.sent('voice.attachQuotes')).toEqual([]);
    expect(screen.getByTestId('voice-bar-quotes')).toHaveTextContent('voice.bar.quotesWaiting|{"count":1}');
  });
});

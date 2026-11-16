/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';

const layout = vi.hoisted(() => ({ isMobile: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: layout.isMobile }) }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
}));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({
  default: ({ onTranscript }: { onTranscript: (text: string) => void }) => (
    <button type='button' data-testid='mic' onClick={() => onTranscript('dictated words')}>
      mic
    </button>
  ),
}));

import { quoteStackStore } from '@/renderer/components/chat/SendBox/quoteStack';
import SelectionReplyButton from '@/renderer/pages/conversation/Messages/components/SelectionReplyButton';

const CONVERSATION = 'conv-quote';
const messages = [{ id: 'm1', conversation_id: CONVERSATION, position: 'left' }] as unknown as TMessage[];

const select = (node: Node, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  range.getBoundingClientRect = () =>
    ({
      top: 200,
      bottom: 220,
      left: 100,
      right: 300,
      width: 200,
      height: 20,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
};

const mountMessage = (text: string) => {
  const message = document.createElement('div');
  message.id = 'message-m1';
  message.textContent = text;
  document.body.appendChild(message);
  return message;
};

const mouseUpOn = async (target: Element) => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};

describe('select text → reply → stack (C32)', () => {
  beforeEach(() => {
    layout.isMobile = false;
    window.localStorage.clear();
    quoteStackStore.resetForTests();
  });

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('shows a toolbar on a message selection, then adds the quote with a typed reply', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const message = mountMessage('The hub accepted the three wordings.');
    select(message.firstChild as Node, 4, 16);
    await mouseUpOn(message);

    const toolbar = await screen.findByRole('toolbar');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(toolbar).not.toBeInTheDocument();

    const popover = await screen.findByTestId('quote-reply-popover');
    expect(popover).toHaveTextContent('hub accepted');
    const reply = popover.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(reply, { target: { value: 'Fine by me' } });
    fireEvent.keyDown(reply, { key: 'Enter', code: 'Enter' });

    expect(quoteStackStore.get(CONVERSATION)).toEqual([
      expect.objectContaining({ messageId: 'm1', position: 'left', content: 'hub accepted', reply: 'Fine by me' }),
    ]);
    expect(screen.queryByTestId('quote-reply-popover')).toBeNull();
  });

  it('adds a quote-only item, dictates into the reply, and closes with Esc', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const message = mountMessage('Section seven proposes eight tactics.');
    select(message.firstChild as Node, 0, 13);
    await mouseUpOn(message);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.dictateReply' }));

    // The toolbar's mic starts dictation in the popover at once.
    const popover = await screen.findByTestId('quote-reply-popover');
    expect((popover.querySelector('textarea') as HTMLTextAreaElement).value).toBe('dictated words');
    fireEvent.keyDown(popover.querySelector('textarea') as HTMLTextAreaElement, { key: 'Escape' });
    expect(screen.queryByTestId('quote-reply-popover')).toBeNull();
    expect(quoteStackStore.get(CONVERSATION)).toEqual([]);

    select(message.firstChild as Node, 0, 13);
    await mouseUpOn(message);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.add' }));
    expect(quoteStackStore.get(CONVERSATION)[0]).toMatchObject({ content: 'Section seven', reply: '' });
  });

  it('opens the reply with R while the toolbar shows, but not while typing', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const message = mountMessage('Quote me with a key.');
    select(message.firstChild as Node, 0, 8);
    await mouseUpOn(message);
    await screen.findByRole('toolbar');

    const field = document.createElement('textarea');
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: 'r' });
    expect(screen.queryByTestId('quote-reply-popover')).toBeNull();

    fireEvent.keyDown(document.body, { key: 'r' });
    expect(await screen.findByTestId('quote-reply-popover')).toHaveTextContent('Quote me');
  });

  it('works for text selected inside a Shadow DOM message (Markdown view)', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const message = document.createElement('div');
    message.id = 'message-m1';
    const host = document.createElement('div');
    message.appendChild(host);
    document.body.appendChild(message);
    const shadow = host.attachShadow({ mode: 'open' });
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Shadow markdown text';
    shadow.appendChild(paragraph);

    // jsdom keeps shadow-tree selections off document.getSelection(); browsers expose them on the root.
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Node, 0);
    range.setEnd(paragraph.firstChild as Node, 6);
    range.getBoundingClientRect = () =>
      ({
        top: 200,
        bottom: 220,
        left: 100,
        right: 300,
        width: 200,
        height: 20,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;
    const shadowSelection = {
      isCollapsed: false,
      anchorNode: paragraph.firstChild,
      focusNode: paragraph.firstChild,
      toString: () => 'Shadow',
      getRangeAt: () => range,
    };
    (shadow as unknown as { getSelection: () => unknown }).getSelection = () => shadowSelection;
    document.getSelection()?.removeAllRanges();
    await mouseUpOn(paragraph);
    expect(await screen.findByRole('toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.add' }));
    expect(quoteStackStore.get(CONVERSATION)[0]).toMatchObject({ content: 'Shadow', messageId: 'm1' });
  });

  it('never opens on selections inside the quote UI or outside messages', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const ui = document.createElement('div');
    ui.setAttribute('data-quote-ui', '');
    const inner = document.createElement('div');
    inner.id = 'message-m1';
    inner.textContent = 'chip text';
    ui.appendChild(inner);
    document.body.appendChild(ui);
    select(inner.firstChild as Node, 0, 4);
    await mouseUpOn(inner);

    const loose = document.createElement('p');
    loose.textContent = 'not a message';
    document.body.appendChild(loose);
    select(loose.firstChild as Node, 0, 3);
    await mouseUpOn(loose);

    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('touch: follows the selection and places the toolbar below it', async () => {
    layout.isMobile = true;
    vi.useFakeTimers();
    try {
      render(<SelectionReplyButton messages={messages} />);
      const message = mountMessage('Long-press selection on a phone.');
      select(message.firstChild as Node, 0, 10);
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
        vi.advanceTimersByTime(400);
      });
      const toolbar = screen.getByRole('toolbar');
      expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThan(220);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
  });
});

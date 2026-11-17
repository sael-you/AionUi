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
// The reply field's own dictation (bound to that field; covered in replyDictation.dom.test.tsx).
vi.mock('@/renderer/components/chat/SendBox/useReplyDictation', () => ({
  useReplyDictation: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
    const dictate = () => onChange(value ? `${value} dictated words` : 'dictated words');
    return {
      setup: 'ready',
      enabling: false,
      status: 'idle',
      live: null,
      availability: 'record',
      levels: [],
      durationMs: 0,
      start: dictate,
      stop: () => {},
      toggle: dictate,
      enableAndStart: () => {},
    };
  },
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
    fireEvent.click(screen.getByRole('button', { name: 'conversation.quoteReply.replyTooltip' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.dictateReplyTooltip' }));

    // The toolbar's mic starts dictation in the popover at once.
    const popover = await screen.findByTestId('quote-reply-popover');
    expect((popover.querySelector('textarea') as HTMLTextAreaElement).value).toBe('dictated words');
    fireEvent.keyDown(popover.querySelector('textarea') as HTMLTextAreaElement, { key: 'Escape' });
    expect(screen.queryByTestId('quote-reply-popover')).toBeNull();
    expect(quoteStackStore.get(CONVERSATION)).toEqual([]);

    select(message.firstChild as Node, 0, 13);
    await mouseUpOn(message);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.replyTooltip' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'conversation.quoteReply.replyTooltip' }));
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
      // The positioned wrapper holds the place; the toolbar itself only animates.
      expect(Number.parseFloat((toolbar.parentElement as HTMLElement).style.top)).toBeGreaterThan(220);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(screen.getByRole('toolbar')).toBeInTheDocument());
  });

  it('follows the selection while the list scrolls, and hides while it is off screen (TASK-126)', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    render(<SelectionReplyButton messages={messages} />);
    const message = mountMessage('The hub accepted the three wordings.');
    select(message.firstChild as Node, 4, 16);
    await mouseUpOn(message);
    const place = () => Number.parseFloat((screen.getByRole('toolbar').parentElement as HTMLElement).style.top);
    expect(place()).toBe(200 - 36 - 8);

    // The toolbar keeps a clone of the range, which reads the prototype's box.
    const moveTo = (top: number) => {
      Range.prototype.getBoundingClientRect = () =>
        ({ top, bottom: top + 20, left: 100, right: 300, width: 200, height: 20 }) as DOMRect;
      act(() => {
        document.dispatchEvent(new Event('scroll'));
        frames.splice(0).forEach((frame) => frame(0));
      });
    };
    const original = Range.prototype.getBoundingClientRect;
    try {
      moveTo(150);
      expect(place()).toBe(150 - 36 - 8);
      moveTo(-400);
      expect(screen.queryByRole('toolbar')).toBeNull();
      moveTo(300);
      expect(place()).toBe(300 - 36 - 8);
    } finally {
      Range.prototype.getBoundingClientRect = original;
      vi.restoreAllMocks();
    }
  });

  it('keyboard: D dictates, Tab enters the toolbar, arrows move, Esc dismisses (TASK-126)', async () => {
    render(<SelectionReplyButton messages={messages} />);
    const message = mountMessage('Section seven proposes eight tactics.');
    select(message.firstChild as Node, 0, 13);
    await mouseUpOn(message);

    fireEvent.keyDown(document.body, { key: 'Tab' });
    const reply = screen.getByRole('button', { name: 'conversation.quoteReply.replyTooltip' });
    const dictate = screen.getByRole('button', { name: 'conversation.quoteReply.dictateReplyTooltip' });
    expect(document.activeElement).toBe(reply);
    fireEvent.keyDown(reply, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(dictate);
    fireEvent.keyDown(dictate, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(reply);
    fireEvent.keyDown(reply, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();

    select(message.firstChild as Node, 0, 13);
    await mouseUpOn(message);
    fireEvent.keyDown(document.body, { key: 'd' });
    const popover = await screen.findByTestId('quote-reply-popover');
    expect((popover.querySelector('textarea') as HTMLTextAreaElement).value).toBe('dictated words');
  });

  it('phones: the reply opens as a bottom sheet that the scrim closes (TASK-126)', async () => {
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
      fireEvent.click(screen.getByRole('button', { name: 'conversation.quoteReply.replyTooltip' }));
    } finally {
      vi.useRealTimers();
    }
    const sheet = await screen.findByTestId('quote-reply-popover');
    expect(sheet).toHaveAttribute('data-variant', 'sheet');
    fireEvent.click(sheet.previousElementSibling as HTMLElement);
    expect(screen.queryByTestId('quote-reply-popover')).toBeNull();
  });
});

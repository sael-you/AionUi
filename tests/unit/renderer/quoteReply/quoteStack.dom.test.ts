/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  composeQuotedMessage,
  formatQuoteItems,
  moveQuote,
  parseStoredStack,
  quoteStackStore,
  useQuoteStack,
  type QuoteItem,
} from '@/renderer/components/chat/SendBox/quoteStack';

const item = (id: string, content: string, reply = ''): QuoteItem => ({
  id,
  messageId: `m-${id}`,
  position: 'left',
  content,
  reply,
});

describe('quote stack format (C32)', () => {
  it('formats each quote as a blockquote followed by its reply, items separated by a blank line', () => {
    const items = [item('a', 'first line\nsecond line', 'Agreed.'), item('b', 'quote only')];
    expect(formatQuoteItems(items)).toBe('> first line\n> second line\n\nAgreed.\n\n> quote only');
  });

  it('puts the composer text after the quotes, and allows quotes without text', () => {
    const items = [item('a', 'q', 'r')];
    expect(composeQuotedMessage(items, 'And one more thing.')).toBe('> q\n\nr\n\nAnd one more thing.');
    expect(composeQuotedMessage(items, '   ')).toBe('> q\n\nr');
    expect(composeQuotedMessage([], 'plain')).toBe('plain');
  });

  it('keeps the single-quote format of before for one quote and text', () => {
    expect(composeQuotedMessage([item('a', 'line 1\nline 2')], 'reply text')).toBe('> line 1\n> line 2\n\nreply text');
  });

  it('moves an item, clamping the target', () => {
    const items = [item('a', '1'), item('b', '2'), item('c', '3')];
    expect(moveQuote(items, 2, 0).map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    expect(moveQuote(items, 0, 9).map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    expect(moveQuote(items, 1, 1).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('accepts only well-formed stored items', () => {
    const good = item('a', 'q', 'r');
    expect(parseStoredStack(JSON.stringify([good, { id: 'x' }, { ...good, position: 'nowhere' }]))).toEqual([good]);
    expect(parseStoredStack('not json')).toEqual([]);
    expect(parseStoredStack(null)).toEqual([]);
  });
});

describe('useQuoteStack store (C32)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    quoteStackStore.resetForTests();
  });

  it('adds in selection order, edits, reorders and removes, shared by every hook of the conversation', () => {
    const first = renderHook(() => useQuoteStack('conv-1'));
    const second = renderHook(() => useQuoteStack('conv-1'));

    act(() => first.result.current.add({ messageId: 'm1', position: 'left', content: 'one' }));
    act(() => first.result.current.add({ messageId: 'm2', position: 'right', content: 'two', reply: 'yes' }));
    expect(second.result.current.items.map((entry) => [entry.content, entry.reply])).toEqual([
      ['one', ''],
      ['two', 'yes'],
    ]);

    const [a, b] = second.result.current.items as [QuoteItem, QuoteItem];
    act(() => second.result.current.updateReply(a.id, 'edited'));
    act(() => second.result.current.move(1, 0));
    expect(first.result.current.items.map((entry) => entry.id)).toEqual([b.id, a.id]);
    expect(first.result.current.items[1]?.reply).toBe('edited');

    act(() => first.result.current.remove(b.id));
    expect(second.result.current.items.map((entry) => entry.id)).toEqual([a.id]);
  });

  it('keeps one stack per conversation and survives a reload (localStorage)', () => {
    const one = renderHook(() => useQuoteStack('conv-1'));
    act(() => one.result.current.add({ messageId: 'm1', position: 'left', content: 'kept' }));
    const other = renderHook(() => useQuoteStack('conv-2'));
    expect(other.result.current.items).toEqual([]);

    quoteStackStore.resetForTests(); // a reload: the memory cache is gone
    const reloaded = renderHook(() => useQuoteStack('conv-1'));
    expect(reloaded.result.current.items.map((entry) => entry.content)).toEqual(['kept']);

    act(() => reloaded.result.current.clear());
    expect(window.localStorage.getItem('aionui.quoteStack.conv-1')).toBeNull();
  });

  it('is inert without a conversation', () => {
    const none = renderHook(() => useQuoteStack(undefined));
    act(() => none.result.current.add({ messageId: 'm', position: 'left', content: 'x' }));
    expect(none.result.current.items).toEqual([]);
  });
});

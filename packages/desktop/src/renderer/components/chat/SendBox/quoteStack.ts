/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stacked quote replies (C32): the quotes a user collected from messages, each
 * with an optional reply, kept per conversation until they are sent. Pure
 * helpers (message format, reorder, storage validation) plus a tiny store that
 * every component of a conversation shares (selection toolbar, send box, voice
 * bar) and that persists to localStorage, so a reload or a conversation switch
 * keeps the stack.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  getOfflineOwner,
  isOfflineDraftExpired,
  onOfflineDraftsCleared,
} from '@/renderer/services/pendingUploads/offlineOwner';

export type QuotePosition = 'left' | 'right' | 'center' | 'pop';

export type QuoteItem = {
  id: string;
  messageId: string;
  position: QuotePosition;
  /** The selected text, as selected. */
  content: string;
  /** The user's reply to this quote ('' = quote only). */
  reply: string;
};

const STORAGE_PREFIX = 'aionui.quoteStack.';
const POSITIONS = new Set<QuotePosition>(['left', 'right', 'center', 'pop']);

/** `> ` before every line, the markdown the agents already read for a single quote. */
export const blockquote = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

/** Each quote as a blockquote, then its reply; items separated by a blank line. */
export const formatQuoteItems = (items: readonly QuoteItem[]): string =>
  items
    .map((item) => {
      const reply = item.reply.trim();
      return reply ? `${blockquote(item.content)}\n\n${reply}` : blockquote(item.content);
    })
    .join('\n\n');

/** The message sent for a stack and the composer text (either may be empty). */
export const composeQuotedMessage = (items: readonly QuoteItem[], text: string): string => {
  const quoted = formatQuoteItems(items);
  if (!quoted) return text;
  return text.trim() ? `${quoted}\n\n${text}` : quoted;
};

/** `items` with the item at `from` moved to `to` (clamped); the same array when nothing moves. */
export const moveQuote = (items: readonly QuoteItem[], from: number, to: number): QuoteItem[] => {
  const target = Math.max(0, Math.min(items.length - 1, to));
  if (from < 0 || from >= items.length || from === target) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved as QuoteItem);
  return next;
};

/** Stored JSON → valid items only (anything else is dropped, never trusted). */
/**
 * A stored stack: `{savedAt, items}` (TASK-127 review: per user, 14-day expiry).
 * A bare array is also read, for tests and stacks written before the wrapper.
 */
export const parseStoredStack = (raw: string | null, now = Date.now()): QuoteItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    let value: unknown = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const stored = parsed as { savedAt?: unknown; items?: unknown };
      if (isOfflineDraftExpired(stored.savedAt, now)) return [];
      value = stored.items;
    }
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is QuoteItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as QuoteItem).id === 'string' &&
        typeof (item as QuoteItem).messageId === 'string' &&
        typeof (item as QuoteItem).content === 'string' &&
        typeof (item as QuoteItem).reply === 'string' &&
        POSITIONS.has((item as QuoteItem).position)
    );
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Store: one stack per conversation, shared and persisted
// ---------------------------------------------------------------------------

const EMPTY: QuoteItem[] = [];
const stacks = new Map<string, QuoteItem[]>();
const listeners = new Map<string, Set<() => void>>();

/** Per user and conversation; null while no user is known (then the stack lives in memory only). */
const storageKey = (conversationId: string): string | null => {
  const owner = getOfflineOwner();
  return owner ? `${STORAGE_PREFIX}${owner}.${conversationId}` : null;
};

const read = (conversationId: string): QuoteItem[] => {
  const cached = stacks.get(conversationId);
  if (cached) return cached;
  let loaded: QuoteItem[] = EMPTY;
  try {
    const key = storageKey(conversationId);
    loaded = key ? parseStoredStack(window.localStorage.getItem(key)) : EMPTY;
  } catch {
    loaded = EMPTY;
  }
  const value = loaded.length > 0 ? loaded : EMPTY;
  stacks.set(conversationId, value);
  return value;
};

const write = (conversationId: string, items: QuoteItem[]) => {
  const value = items.length > 0 ? items : EMPTY;
  stacks.set(conversationId, value);
  const key = storageKey(conversationId);
  try {
    if (!key) {
      // No known user: memory only.
    } else if (value.length > 0) {
      window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items: value }));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage full or blocked: the stack still works for this page.
  }
  for (const listener of listeners.get(conversationId) ?? []) listener();
};

export const quoteStackStore = {
  get: read,
  set: write,
  subscribe(conversationId: string, listener: () => void): () => void {
    const set = listeners.get(conversationId) ?? new Set();
    set.add(listener);
    listeners.set(conversationId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(conversationId);
    };
  },
  /** Test seam: forget cached stacks (localStorage is the source on next read). */
  resetForTests(): void {
    stacks.clear();
    listeners.clear();
  },
};

// Logout or another user signing in: forget the cached stacks and tell the open views.
onOfflineDraftsCleared(() => {
  stacks.clear();
  for (const set of listeners.values()) for (const listener of set) listener();
});

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type QuoteStackApi = {
  items: QuoteItem[];
  add: (quote: Omit<QuoteItem, 'id' | 'reply'> & { reply?: string }) => void;
  updateReply: (id: string, reply: string) => void;
  remove: (id: string) => void;
  move: (from: number, to: number) => void;
  clear: () => void;
  replace: (items: QuoteItem[]) => void;
};

/** The quote stack of one conversation (`undefined` = no conversation: an inert empty stack). */
export const useQuoteStack = (conversationId: string | undefined): QuoteStackApi => {
  const id = conversationId ?? '';
  const items = useSyncExternalStore(
    useCallback((listener: () => void) => (id ? quoteStackStore.subscribe(id, listener) : () => {}), [id]),
    () => (id ? read(id) : EMPTY)
  );
  const update = useCallback(
    (change: (current: QuoteItem[]) => QuoteItem[]) => {
      if (id) write(id, change(read(id)));
    },
    [id]
  );
  return {
    items,
    add: useCallback(
      (quote) => update((current) => [...current, { ...quote, id: newId(), reply: quote.reply ?? '' }]),
      [update]
    ),
    updateReply: useCallback(
      (itemId, reply) => update((current) => current.map((item) => (item.id === itemId ? { ...item, reply } : item))),
      [update]
    ),
    remove: useCallback((itemId) => update((current) => current.filter((item) => item.id !== itemId)), [update]),
    move: useCallback((from, to) => update((current) => moveQuote(current, from, to)), [update]),
    clear: useCallback(() => update(() => []), [update]),
    replace: useCallback((next) => update(() => next), [update]),
  };
};

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A message that could not be sent because there was no connection (TASK-127).
 * Its text, quotes and files go back into the composer (the saved draft); this
 * hook remembers WHAT was sent and under which idempotency key, shows as
 * "Not sent — saved as draft · Retry", and sends it again when the connection
 * returns. The same key makes core return the first result, so a send that did
 * reach the server is never doubled. Without that capability (older core) there
 * is no automatic retry: Retry stays a deliberate click.
 *
 * Editing the restored text turns it back into an ordinary draft: the record is
 * dropped, and the next send is a new message with a new key.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { SessionRef } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import type { ChatFileRef } from '@/common/types/chatFile';
import { uuid } from '@/common/utils';

export type UnsentMessage = {
  key: string;
  input: string;
  files: ChatFileRef[];
  sessions?: SessionRef[];
  /** The composer text that was put back (the quotes and files are restored separately). */
  draftText: string;
  savedAt: number;
};

const STORAGE_PREFIX = 'aionui.unsentMessage.';
const GATEWAY_DOWN = new Set([502, 503, 504]);

/** A fresh idempotency key (core accepts 1–128 characters). */
const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuid(32);

/** No connection: the request never got an answer from AionCore (offline, or the gateway had no core). */
export const isConnectionFailure = (error: unknown): boolean => {
  if (isBackendHttpError(error)) return GATEWAY_DOWN.has(error.status);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return error instanceof TypeError;
};

const sameFiles = (a: ChatFileRef[], b: ChatFileRef[]): boolean => JSON.stringify(a) === JSON.stringify(b);

const readUnsent = (conversation_id: string): UnsentMessage | null => {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_PREFIX + conversation_id) ?? 'null'
    ) as Partial<UnsentMessage> | null;
    if (!parsed || typeof parsed.key !== 'string' || typeof parsed.input !== 'string') return null;
    return {
      key: parsed.key,
      input: parsed.input,
      files: Array.isArray(parsed.files) ? parsed.files : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : undefined,
      draftText: typeof parsed.draftText === 'string' ? parsed.draftText : '',
      savedAt: Number(parsed.savedAt) || 0,
    };
  } catch {
    return null;
  }
};

const writeUnsent = (conversation_id: string, unsent: UnsentMessage | null): void => {
  try {
    if (unsent) window.localStorage.setItem(STORAGE_PREFIX + conversation_id, JSON.stringify(unsent));
    else window.localStorage.removeItem(STORAGE_PREFIX + conversation_id);
  } catch {
    // Storage full or blocked: the record lives for this page only.
  }
};

type UseUnsentMessageOptions = {
  conversation_id: string;
  /** The composer's text, to notice when the owner edits the restored draft. */
  content: string;
  /** Send the remembered message again (same key); resolves once it was accepted. */
  resend: (unsent: UnsentMessage) => Promise<void>;
};

export const useUnsentMessage = ({ conversation_id, content, resend }: UseUnsentMessageOptions) => {
  // Cache-only read: the conversation page already loads this key.
  const { data: conversation } = useSWR<TChatConversation | null>(
    conversation_id ? `conversation/${conversation_id}` : null
  );
  const idempotent = conversation?.capabilities?.send_idempotency === true;

  const [unsent, setUnsent] = useState<UnsentMessage | null>(() => readUnsent(conversation_id));
  const [retrying, setRetrying] = useState(false);
  const unsentRef = useRef(unsent);
  unsentRef.current = unsent;
  const retryingRef = useRef(false);
  const resendRef = useRef(resend);
  resendRef.current = resend;
  /** The restored text has shown up in the composer; a difference after that is an edit. */
  const restoredSeenRef = useRef(false);

  useEffect(() => {
    setUnsent(readUnsent(conversation_id));
    restoredSeenRef.current = false;
  }, [conversation_id]);

  const store = useCallback(
    (next: UnsentMessage | null) => {
      writeUnsent(conversation_id, next);
      setUnsent(next);
      restoredSeenRef.current = false;
    },
    [conversation_id]
  );

  /** The key for this send: the remembered one when it is the same message, else a new one. */
  const keyFor = useCallback(
    (input: string, files: ChatFileRef[]): string | undefined => {
      if (!idempotent) return undefined;
      const current = unsentRef.current;
      return current && current.input === input && sameFiles(current.files, files) ? current.key : newKey();
    },
    [idempotent]
  );

  const remember = useCallback(
    (message: Omit<UnsentMessage, 'savedAt' | 'key'> & { key?: string }) => {
      store({ ...message, key: message.key ?? newKey(), savedAt: Date.now() });
    },
    [store]
  );

  const forget = useCallback(() => {
    if (unsentRef.current) store(null);
  }, [store]);

  const retry = useCallback(async () => {
    const current = unsentRef.current;
    if (!current || retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      await resendRef.current(current);
      store(null);
    } catch {
      // Still no connection (or refused): the record and the draft stay.
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }, [store]);

  // The owner edited the restored text: it is an ordinary draft again.
  useEffect(() => {
    if (!unsent || retrying) return;
    if (content === unsent.draftText) {
      restoredSeenRef.current = true;
      return;
    }
    // Before the restore lands the composer is briefly empty: that is not an edit.
    if (restoredSeenRef.current) store(null);
  }, [content, retrying, store, unsent]);

  // The connection is back: send it again, but only when a repeat cannot double it.
  useEffect(() => {
    if (!unsent || !idempotent) return;
    const onBack = () => {
      void retry();
    };
    window.addEventListener('online', onBack);
    const off = ipcBridge.realtime.reconnected.on(onBack);
    return () => {
      window.removeEventListener('online', onBack);
      off();
    };
  }, [idempotent, retry, unsent]);

  return { unsent, idempotent, retrying, keyFor, remember, forget, retry };
};

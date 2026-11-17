import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import {
  getOfflineOwner,
  isOfflineDraftExpired,
  onOfflineDraftsCleared,
} from '@/renderer/services/pendingUploads/offlineOwner';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';
export type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

type Draft =
  | {
      _type: 'acp';
      content: string;
      atPath: Array<string | FileOrFolderItem>;
      uploadFile: string[];
    }
  | {
      _type: 'codex';
      content: string;
      atPath: Array<string | FileOrFolderItem>;
      uploadFile: string[];
    }
  | {
      _type: 'aionrs';
      content: string;
      atPath: Array<string | FileOrFolderItem>;
      uploadFile: string[];
    };

/**
 * 当前支持的对话类型以及对应的草稿对象
 */
type DraftConversationType = Draft['_type'];
type SendBoxDraftStore = {
  [K in DraftConversationType]: Map<string, Extract<Draft, { _type: K }>>;
};

const store: SendBoxDraftStore = {
  acp: new Map(),
  codex: new Map(),
  aionrs: new Map(),
};

// ---------------------------------------------------------------------------
// Persistence (TASK-127): what the owner is typing survives a reload, a crash or
// a lost connection. One localStorage entry per user and conversation holds the
// text and the attachment references (uploaded files already live on the server;
// the quote stack persists itself). Restored on open, removed once the draft is
// empty (a successful send empties it), dropped after 14 days, and cleared on
// logout or when another user signs in (see offlineOwner).
// ---------------------------------------------------------------------------

const DRAFT_STORAGE_PREFIX = 'aionui.sendBoxDraft.';
/** Longest text kept (characters); a longer draft is still kept in memory. */
export const DRAFT_MAX_CONTENT_CHARS = 200_000;
/** Most conversations with a saved draft; the oldest are dropped first. */
export const DRAFT_MAX_ENTRIES = 50;

type StoredDraft = { v: 1; savedAt: number; draft: Draft };

/** Null while no user is known: then the draft lives in memory only. */
const draftStorageKey = (type: DraftConversationType, conversation_id: string): string | null => {
  const owner = getOfflineOwner();
  return owner ? `${DRAFT_STORAGE_PREFIX}${owner}.${type}.${conversation_id}` : null;
};

const isEmptyDraft = (draft: Draft | undefined): boolean =>
  !draft || (draft.content.length === 0 && draft.atPath.length === 0 && draft.uploadFile.length === 0);

const draftStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const parseStoredDraft = (raw: string | null, type: DraftConversationType): Draft | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    const draft = parsed?.draft;
    if (parsed?.v !== 1 || !draft || draft._type !== type) return undefined;
    if (isOfflineDraftExpired(parsed.savedAt)) return undefined;
    if (typeof draft.content !== 'string' || !Array.isArray(draft.atPath) || !Array.isArray(draft.uploadFile)) {
      return undefined;
    }
    return draft;
  } catch {
    return undefined;
  }
};

/** Keep at most DRAFT_MAX_ENTRIES saved drafts: drop the oldest. */
const pruneStoredDrafts = (storage: Storage): void => {
  const entries: Array<{ key: string; savedAt: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
    let savedAt = 0;
    try {
      savedAt = Number((JSON.parse(storage.getItem(key) ?? '{}') as Partial<StoredDraft>).savedAt) || 0;
    } catch {
      /* unreadable entries go first */
    }
    entries.push({ key, savedAt });
  }
  if (entries.length <= DRAFT_MAX_ENTRIES) return;
  entries
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(0, entries.length - DRAFT_MAX_ENTRIES)
    .forEach((entry) => storage.removeItem(entry.key));
};

const persistDraft = (type: DraftConversationType, conversation_id: string, draft: Draft | undefined): void => {
  const storage = draftStorage();
  const key = draftStorageKey(type, conversation_id);
  if (!storage || !conversation_id || !key) return;
  try {
    if (isEmptyDraft(draft)) {
      storage.removeItem(key);
      return;
    }
    const kept = draft as Draft;
    const stored: StoredDraft = {
      v: 1,
      savedAt: Date.now(),
      draft: { ...kept, content: kept.content.slice(0, DRAFT_MAX_CONTENT_CHARS) },
    };
    storage.setItem(key, JSON.stringify(stored));
    pruneStoredDrafts(storage);
  } catch {
    // Storage full or blocked: the draft stays in memory for this page.
  }
};

const loadStoredDraft = <K extends DraftConversationType>(
  type: K,
  conversation_id: string
): Extract<Draft, { _type: K }> | undefined => {
  const storage = draftStorage();
  const key = draftStorageKey(type, conversation_id);
  if (!storage || !conversation_id || !key) return undefined;
  try {
    const raw = storage.getItem(key);
    const draft = parseStoredDraft(raw, type) as Extract<Draft, { _type: K }> | undefined;
    // Expired or unreadable: drop it now rather than keep it around.
    if (raw && !draft) storage.removeItem(key);
    return draft;
  } catch {
    return undefined;
  }
};

const forgetDraftsInMemory = (): void => {
  store.acp.clear();
  store.codex.clear();
  store.aionrs.clear();
};
// Logout or another user: the drafts held in memory go with the stored ones.
onOfflineDraftsCleared(forgetDraftsInMemory);

/** Test seam: forget the in-memory drafts (localStorage is the source on the next read). */
export const resetSendBoxDraftsForTests = forgetDraftsInMemory;

export type ConversationSendBoxPrefill = {
  requestId: number;
  prompt: string;
};

type ConversationSendBoxPrefillListener = (prefill: ConversationSendBoxPrefill) => void;

let pendingConversationPrefill:
  | {
      conversation_id: string;
      prefill: ConversationSendBoxPrefill;
    }
  | undefined;
const conversationPrefillListeners = new Map<string, ConversationSendBoxPrefillListener>();
let nextConversationPrefillRequestId = 0;

/**
 * Adds a prompt without discarding text the user has already typed.
 */
export const appendPromptToDraft = (draft: string, prompt: string): string => {
  if (!prompt) return draft;
  if (!draft) return prompt;
  return `${draft}${draft.endsWith('\n') ? '' : '\n'}${prompt}`;
};

/**
 * Delivers a prefill only to the SendBox owned by the requested conversation.
 * If that SendBox is not mounted yet, the request remains queued until it is.
 */
export const requestConversationSendBoxPrefill = (conversation_id: string, prompt: string): void => {
  if (!conversation_id || !prompt) return;

  const prefill = {
    requestId: ++nextConversationPrefillRequestId,
    prompt,
  };
  // A navigation can only have one not-yet-mounted destination. Supersede an
  // older target so opening it later cannot inject a stale prompt.
  pendingConversationPrefill = undefined;
  const listener = conversationPrefillListeners.get(conversation_id);
  if (listener) {
    listener(prefill);
    return;
  }

  pendingConversationPrefill = { conversation_id, prefill };
};

/**
 * Registers the mounted SendBox as the single consumer for its conversation.
 */
export const useConversationSendBoxPrefill = (
  conversation_id: string | undefined,
  onPrefill: ConversationSendBoxPrefillListener
): void => {
  const onPrefillRef = useRef(onPrefill);
  onPrefillRef.current = onPrefill;

  useEffect(() => {
    if (!conversation_id) return;

    const listener: ConversationSendBoxPrefillListener = (prefill) => onPrefillRef.current(prefill);
    conversationPrefillListeners.set(conversation_id, listener);

    if (pendingConversationPrefill?.conversation_id === conversation_id) {
      const { prefill } = pendingConversationPrefill;
      pendingConversationPrefill = undefined;
      listener(prefill);
    }

    return () => {
      if (conversationPrefillListeners.get(conversation_id) === listener) {
        conversationPrefillListeners.delete(conversation_id);
      }
    };
  }, [conversation_id]);
};

const setDraft = <K extends DraftConversationType>(
  type: K,
  conversation_id: string,
  draft: Extract<Draft, { _type: K }> | undefined
) => {
  persistDraft(type, conversation_id, draft);
  // TODO import ts-pattern for exhaustive check
  switch (type) {
    case 'acp':
      if (draft) {
        store.acp.set(conversation_id, draft as Extract<Draft, { _type: 'acp' }>);
      } else {
        store.acp.delete(conversation_id);
      }
      break;
    case 'codex':
      if (draft) {
        store.codex.set(conversation_id, draft as Extract<Draft, { _type: 'codex' }>);
      } else {
        store.codex.delete(conversation_id);
      }
      break;
    case 'aionrs':
      if (draft) {
        store.aionrs.set(conversation_id, draft as Extract<Draft, { _type: 'aionrs' }>);
      } else {
        store.aionrs.delete(conversation_id);
      }
      break;
    default:
      break;
  }
};

const getDraft = <K extends DraftConversationType>(
  type: K,
  conversation_id: string
): Extract<Draft, { _type: K }> | undefined => {
  // First read after a reload: bring the saved draft back into memory.
  if (!store[type].has(conversation_id)) {
    const saved = loadStoredDraft(type, conversation_id);
    if (saved) (store[type] as Map<string, Draft>).set(conversation_id, saved);
  }
  // TODO import ts-pattern for exhaustive check
  switch (type) {
    case 'acp':
      return store.acp.get(conversation_id) as Extract<Draft, { _type: K }>;
    case 'codex':
      return store.codex.get(conversation_id) as Extract<Draft, { _type: K }>;
    case 'aionrs':
      return store.aionrs.get(conversation_id) as Extract<Draft, { _type: K }>;
    default:
      return undefined;
  }
};

/**
 * 获得一种类型下的会话草稿操作的 React Hook
 */
export const getSendBoxDraftHook = <K extends DraftConversationType>(
  type: K,
  initialValue: Extract<Draft, { _type: K }>
) => {
  function useDraft(conversation_id: string) {
    const swrRet = useSWR([`/send-box/${type}/draft/${conversation_id}`, conversation_id], ([_, id]) => {
      return getDraft(type, id);
    });

    const mutateDraft = useCallback(
      (draft: (k: Extract<Draft, { _type: K }>) => typeof k | undefined): void => {
        swrRet
          .mutate(
            (prev) => {
              const newDraft = draft(prev ?? initialValue);
              setDraft(type, conversation_id, newDraft);
              return newDraft;
            },
            { revalidate: false }
          )
          .catch((error) => {
            console.error('Failed to mutate draft:', error);
          });
      },
      [conversation_id]
    );

    return {
      get data() {
        return swrRet.data;
      },
      mutate: mutateDraft,
    };
  }

  return useDraft;
};

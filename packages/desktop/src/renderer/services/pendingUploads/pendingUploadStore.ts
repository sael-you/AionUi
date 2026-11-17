/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Files and images attached while there was no connection (TASK-127). Their
 * upload failed, so the bytes are kept in the browser (IndexedDB) per user and
 * conversation until the connection returns; a reload or a crash does not lose
 * them. Size-capped: one file up to 25 MB, 100 MB in total. Dropped after 14
 * days, and cleared on logout or when another user signs in (offlineOwner).
 * Where IndexedDB is missing or blocked the files are kept in memory only.
 */

import { getOfflineOwner, isOfflineDraftExpired, onOfflineDraftsCleared } from './offlineOwner';

export const PENDING_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PENDING_UPLOAD_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export type PendingUpload = {
  id: string;
  /** The signed-in user who attached it ('' when none was known: memory only). */
  owner: string;
  conversationId: string;
  name: string;
  type: string;
  size: number;
  savedAt: number;
};

type StoredUpload = PendingUpload & { blob: Blob };
export type SavePendingUploadResult = 'saved' | 'too-large' | 'full';

const DB_NAME = 'aionui-pending-uploads';
const STORE_NAME = 'files';

const memory = new Map<string, StoredUpload>();
const listeners = new Set<() => void>();
/** Told when a file could not be kept (over a cap), so the composer can say so. */
export type PendingUploadRejection = { conversationId: string; name: string; reason: 'too-large' | 'full' };
const rejectionListeners = new Set<(rejection: PendingUploadRejection) => void>();
const reject = (rejection: PendingUploadRejection): SavePendingUploadResult => {
  for (const listener of rejectionListeners) {
    try {
      listener(rejection);
    } catch {
      /* a listener never breaks the store */
    }
  }
  return rejection.reason;
};
let dbPromise: Promise<IDBDatabase | null> | null = null;

const notify = (): void => {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a listener never breaks the store */
    }
  }
};

const openDb = (): Promise<IDBDatabase | null> => {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.addEventListener('upgradeneeded', () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      });
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => resolve(null));
      request.addEventListener('blocked', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
};

const everything = async (): Promise<StoredUpload[]> => {
  const db = await openDb();
  const stored = db ? ((await run<StoredUpload[]>('readonly', (store) => store.getAll())) ?? []) : [];
  return [...stored, ...memory.values()];
};

/** This user's kept files; expired ones (anyone's) are deleted on the way. */
const all = async (): Promise<StoredUpload[]> => {
  const owner = getOfflineOwner() ?? '';
  const kept: StoredUpload[] = [];
  for (const item of await everything()) {
    if (isOfflineDraftExpired(item.savedAt)) {
      memory.delete(item.id);
      await run('readwrite', (store) => store.delete(item.id));
      continue;
    }
    if (item.owner === owner) kept.push(item);
  }
  return kept;
};

const toMeta = ({ blob: _blob, ...meta }: StoredUpload): PendingUpload => meta;

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const pendingUploadStore = {
  /** Keep a file whose upload failed for lack of a connection. */
  async save(conversationId: string, file: File): Promise<SavePendingUploadResult> {
    if (file.size > PENDING_UPLOAD_MAX_FILE_BYTES)
      return reject({ conversationId, name: file.name, reason: 'too-large' });
    const used = (await everything()).reduce((sum, item) => sum + item.size, 0);
    if (used + file.size > PENDING_UPLOAD_MAX_TOTAL_BYTES)
      return reject({ conversationId, name: file.name, reason: 'full' });
    const owner = getOfflineOwner();
    const entry: StoredUpload = {
      id: newId(),
      owner: owner ?? '',
      conversationId,
      name: file.name,
      type: file.type,
      size: file.size,
      savedAt: Date.now(),
      blob: file,
    };
    // No known user: keep it for this page only, never on disk.
    const db = owner ? await openDb() : null;
    if (!db || (await run('readwrite', (store) => store.put(entry))) === null) memory.set(entry.id, entry);
    notify();
    return 'saved';
  },

  async list(conversationId: string): Promise<PendingUpload[]> {
    return (await all())
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => a.savedAt - b.savedAt)
      .map(toMeta);
  },

  /** The kept file, ready to upload again; null when it is gone. */
  async read(id: string): Promise<File | null> {
    const entry = memory.get(id) ?? (await run<StoredUpload | undefined>('readonly', (store) => store.get(id)));
    if (!entry || entry.owner !== (getOfflineOwner() ?? '') || isOfflineDraftExpired(entry.savedAt)) return null;
    return new File([entry.blob], entry.name, { type: entry.type });
  },

  async remove(id: string): Promise<void> {
    memory.delete(id);
    await run('readwrite', (store) => store.delete(id));
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Delete every kept file of every user (logout or another user signing in). */
  async clearAll(): Promise<void> {
    memory.clear();
    await run('readwrite', (store) => store.clear());
    notify();
  },

  /** A file was refused (over a cap): never a silent drop. */
  onRejected(listener: (rejection: PendingUploadRejection) => void): () => void {
    rejectionListeners.add(listener);
    return () => rejectionListeners.delete(listener);
  },

  /** Test seam: forget everything kept in memory. */
  resetForTests(): void {
    memory.clear();
    listeners.clear();
    rejectionListeners.clear();
    dbPromise = null;
  },
};

/** An upload error that means "no connection" (the XHR never got an answer). */
export const isUploadConnectionError = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Upload failed: network error';

// Logout or another user signing in: the kept files go too.
onOfflineDraftsCleared(() => {
  void pendingUploadStore.clearAll();
});

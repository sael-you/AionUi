/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import { pendingUploadStore, type PendingUpload } from './pendingUploadStore';

/**
 * The files of one conversation that wait for a connection (TASK-127): lists
 * them, uploads them when the connection returns (or on Retry) and hands each
 * uploaded path to the composer.
 */
export const usePendingUploads = (conversation_id: string, onUploaded: (paths: string[]) => void) => {
  const [items, setItems] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const busyRef = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const refresh = useCallback(async () => {
    setItems(await pendingUploadStore.list(conversation_id));
  }, [conversation_id]);

  useEffect(() => {
    void refresh();
    return pendingUploadStore.subscribe((): void => {
      void refresh();
    });
  }, [refresh]);

  const retry = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setUploading(true);
    try {
      for (const item of await pendingUploadStore.list(conversation_id)) {
        const file = await pendingUploadStore.read(item.id);
        if (!file) {
          await pendingUploadStore.remove(item.id);
          continue;
        }
        // Still no connection: stop, the rest waits too.
        const path = await uploadFileViaHttp(file, conversation_id).catch((): null => null);
        if (path === null) break;
        await pendingUploadStore.remove(item.id);
        onUploadedRef.current([path]);
      }
    } finally {
      busyRef.current = false;
      setUploading(false);
    }
  }, [conversation_id]);

  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    const onBack = (): void => {
      void retry();
    };
    window.addEventListener('online', onBack);
    const off = ipcBridge.realtime.reconnected.on(onBack);
    return () => {
      window.removeEventListener('online', onBack);
      off();
    };
  }, [hasItems, retry]);

  const remove = useCallback((id: string): void => {
    void pendingUploadStore.remove(id);
  }, []);

  return { items, uploading, retry, remove };
};

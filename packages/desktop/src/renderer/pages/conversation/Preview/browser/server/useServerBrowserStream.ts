/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's socket to one server browser instance (`/api/browser/ws?instance=n`,
 * C30): state, dialogs and errors as React state; frames go straight to
 * `onFrame` (no re-render per frame) and are acknowledged after drawing, so the
 * server keeps at most two in flight. Reconnects with backoff; asks the server
 * to start the instance on every open. The session cookie authenticates it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BrowserClientMessage,
  BrowserDialog,
  BrowserFileChooser,
  BrowserFrameMeta,
  BrowserState,
  BrowserWsError,
} from '@/common/types/platform/serverBrowser';
import { browserStreamUrl, decodeFrame, parseServerMessage } from './streamProtocol';

export type StreamConnection = 'connecting' | 'open' | 'closed';

export type ServerBrowserStream = {
  connection: StreamConnection;
  state: BrowserState | null;
  dialog: BrowserDialog | null;
  fileChooser: BrowserFileChooser | null;
  lastError: BrowserWsError | null;
  send: (message: BrowserClientMessage) => void;
  clearDialog: () => void;
  clearFileChooser: () => void;
  clearError: () => void;
};

const BASE_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 8000;

/** Turns frame bytes into something drawable; injectable for tests. */
export type FrameDecoder = (jpeg: Uint8Array) => Promise<ImageBitmap | HTMLImageElement>;

const defaultDecoder: FrameDecoder = (jpeg) =>
  // Copy into a plain ArrayBuffer view: Blob parts must not be SharedArrayBuffer-backed.
  createImageBitmap(new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }));

export const useServerBrowserStream = (
  instance: number,
  onFrame: (image: ImageBitmap | HTMLImageElement, meta: BrowserFrameMeta) => void,
  decode: FrameDecoder = defaultDecoder
): ServerBrowserStream => {
  const [connection, setConnection] = useState<StreamConnection>('connecting');
  const [state, setState] = useState<BrowserState | null>(null);
  const [dialog, setDialog] = useState<BrowserDialog | null>(null);
  const [fileChooser, setFileChooser] = useState<BrowserFileChooser | null>(null);
  const [lastError, setLastError] = useState<BrowserWsError | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let alive = true;
    let delay = BASE_RECONNECT_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState(null);
    setDialog(null);
    setFileChooser(null);
    setLastError(null);

    const connect = () => {
      setConnection('connecting');
      const socket = new WebSocket(browserStreamUrl(window.location, instance));
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        delay = BASE_RECONNECT_MS;
        setConnection('open');
        socket.send(JSON.stringify({ type: 'start' } satisfies BrowserClientMessage));
      });

      socket.addEventListener('message', (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const frame = decodeFrame(event.data);
          if (!frame) return;
          void decode(frame.jpeg)
            .then((image) => {
              if (alive) onFrameRef.current(image, frame.meta);
            })
            .catch(() => {})
            .finally(() => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'frame_ack', seq: frame.meta.seq } satisfies BrowserClientMessage));
              }
            });
          return;
        }
        const message = typeof event.data === 'string' ? parseServerMessage(event.data) : null;
        if (!message) return;
        if (message.type === 'state') setState(message);
        else if (message.type === 'dialog') setDialog(message);
        else if (message.type === 'file_chooser') setFileChooser(message);
        else setLastError({ code: message.code, ...(message.message ? { message: message.message } : {}) });
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!alive) return;
        setConnection('closed');
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_RECONNECT_MS);
      });
    };

    connect();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [instance, decode]);

  const send = useCallback((message: BrowserClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  return {
    connection,
    state,
    dialog,
    fileChooser,
    lastError,
    send,
    clearDialog: useCallback(() => setDialog(null), []),
    clearFileChooser: useCallback(() => setFileChooser(null), []),
    clearError: useCallback(() => setLastError(null), []),
  };
};

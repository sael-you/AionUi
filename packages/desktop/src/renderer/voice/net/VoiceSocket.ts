/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/api/voice/ws` control channel (plan §3.6, §3.8, §3.9).
 *
 * - sends `voice.hello` on every open (with the bound `voiceSessionId`, so a
 *   reconnect during a call re-binds it and the backend answers `voice.ready`);
 * - `voice.heartbeat` every 10 s (a device silent for 25 s is "not armed");
 * - reconnects with exponential backoff + jitter; an auth close (1008) gets one
 *   shared session refresh first, exactly like the core `/ws` client;
 * - outbound rate limit 10 frames/s (backend limit), excess frames are queued
 *   briefly, heartbeats are dropped rather than queued.
 */

import { WS_CLOSE_POLICY_VIOLATION, refreshSession } from '@/common/adapter/sessionRefresh';
import { getSpeechStreamUrl } from '@/renderer/services/speech/SpeechStreamClient';
import { decodeFrame, encodeFrame } from '../core/protocol';
import type { ClientCapabilities, ClientFrame, DeviceInfo, ServerFrame } from '../core/types';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 10_000;
export const MAX_FRAMES_PER_SECOND = 10;
const MAX_QUEUED_FRAMES = 32;
const WS_OPEN = 1;

/** Voice socket URL in the current runtime mode (same rules as the STT stream). */
export function getVoiceSocketUrl(): string {
  return getSpeechStreamUrl().replace(/\/api\/stt\/stream$/, '/api/voice/ws');
}

/** Structural subset of `WebSocket` (tests inject a fake). */
export type VoiceWebSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
};

export type VoiceSocketListener = {
  onOpen(): void;
  onClose(info: { code: number; willReconnect: boolean }): void;
  onFrame(frame: ServerFrame): void;
};

export type Timers = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export type VoiceSocketOptions = {
  device: DeviceInfo;
  capabilities: ClientCapabilities;
  listener: VoiceSocketListener;
  createSocket?: (url: string) => VoiceWebSocket;
  url?: () => string;
  timers?: Timers;
  random?: () => number;
  refresh?: () => Promise<boolean>;
};

export class VoiceSocket {
  private ws: VoiceWebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private flushTimer: unknown = null;
  private sentAt: number[] = [];
  private queue: string[] = [];
  private voiceSessionId: string | null = null;
  private readonly timers: Timers;
  private readonly createSocket: (url: string) => VoiceWebSocket;

  constructor(private readonly options: VoiceSocketOptions) {
    this.timers = options.timers ?? realTimers;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WS_OPEN;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // Handlers check `this.ws === ws`, so the detached socket's events are ignored.
      try {
        ws.close(1000, 'disarm');
      } catch {
        // already closed
      }
    }
  }

  /** Bind (or clear) the voice session this device's frames belong to. */
  bindSession(voiceSessionId: string | null): void {
    if (this.voiceSessionId === voiceSessionId) return;
    this.voiceSessionId = voiceSessionId;
    if (voiceSessionId && this.isOpen) this.sendHello();
  }

  /** Send a frame; returns false when it was dropped (socket down). */
  send(frame: ClientFrame): boolean {
    if (!this.isOpen) return false;
    const text = encodeFrame(frame, this.voiceSessionId);
    if (this.withinRate()) {
      this.transmit(text);
      return true;
    }
    if (frame.name === 'voice.heartbeat' || this.queue.length >= MAX_QUEUED_FRAMES) return false;
    this.queue.push(text);
    this.scheduleFlush();
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = (this.options.url ?? getVoiceSocketUrl)();
    let ws: VoiceWebSocket;
    try {
      ws = this.createSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.sendHello();
      this.heartbeatTimer = this.timers.setInterval(() => {
        this.send({ name: 'voice.heartbeat', t: this.timers.now() });
      }, HEARTBEAT_INTERVAL_MS);
      this.options.listener.onOpen();
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      if (this.ws !== ws) return;
      const frame = decodeFrame(event.data);
      if (frame) this.options.listener.onFrame(frame);
    });
    ws.addEventListener('error', () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
    ws.addEventListener('close', (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.queue = [];
      const willReconnect = !this.stopped;
      this.options.listener.onClose({ code: event.code, willReconnect });
      if (!willReconnect) return;
      if (event.code === WS_CLOSE_POLICY_VIOLATION) {
        void (this.options.refresh ?? refreshSession)().then((ok) => {
          if (ok && !this.stopped) {
            this.attempt = 0;
            this.connect();
          } else if (!this.stopped) {
            // Session is gone: keep retrying slowly so a re-login recovers.
            this.attempt = Math.max(this.attempt, 6);
            this.scheduleReconnect();
          }
        });
        return;
      }
      this.scheduleReconnect();
    });
  }

  private sendHello(): void {
    const hello: ClientFrame = {
      name: 'voice.hello',
      device: this.options.device,
      capabilities: this.options.capabilities,
      ...(this.voiceSessionId ? { voiceSessionId: this.voiceSessionId } : {}),
    };
    // Hello bypasses the queue so it is always the first frame after open.
    this.transmit(encodeFrame(hello, null));
  }

  private transmit(text: string): void {
    this.sentAt.push(this.timers.now());
    try {
      this.ws?.send(text);
    } catch {
      // the close handler will follow
    }
  }

  private withinRate(): boolean {
    const now = this.timers.now();
    this.sentAt = this.sentAt.filter((t) => now - t < 1000);
    return this.sentAt.length < MAX_FRAMES_PER_SECOND && this.queue.length === 0;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null;
      const now = this.timers.now();
      this.sentAt = this.sentAt.filter((t) => now - t < 1000);
      while (this.queue.length && this.sentAt.length < MAX_FRAMES_PER_SECOND && this.isOpen) {
        this.transmit(this.queue.shift() as string);
      }
      if (this.queue.length) this.scheduleFlush();
    }, 110);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    const delay = Math.round(base * (0.8 + 0.4 * (this.options.random ?? Math.random)()));
    this.attempt++;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) this.timers.clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer && this.stopped) this.timers.clearTimeout(this.reconnectTimer);
    if (this.flushTimer) this.timers.clearTimeout(this.flushTimer);
    this.heartbeatTimer = null;
    if (this.stopped) this.reconnectTimer = null;
    this.flushTimer = null;
  }
}

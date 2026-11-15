/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-thread handle of the wake-word worker. The worker (and its loaded
 * models) survives disarm, so the second arm is instant; each arm hands it a
 * fresh capture port.
 */

import type { KwsMode, KwsWorkerIn, KwsWorkerOut } from './kws.worker';

export type WorkerLike = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
};

export type WakeWordEvents = {
  onLoaded(ms: number): void;
  onWake(t: number, score: number): void;
  onVad(speech: boolean, t: number): void;
  onError(message: string): void;
  onStats?(stats: { frames: number; inferenceMsP50: number; dropped: number }): void;
};

export const WAKE_WORKER_IDLE_MS = 5 * 60_000;

export const createKwsWorker = (): WorkerLike =>
  new Worker(new URL('./kws.worker.ts', import.meta.url), { type: 'module', name: 'aionui-voice-kws' });

export class WakeWord {
  private worker: WorkerLike | null = null;
  private loadedState: 'no' | 'loading' | 'yes' | 'failed' = 'no';
  private events: WakeWordEvents | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike = createKwsWorker,
    /** Disarmed this long, the worker (and ~5 MB of models + wasm memory) is released. */
    private readonly idleDisposeMs = WAKE_WORKER_IDLE_MS
  ) {}

  get loaded(): boolean {
    return this.loadedState === 'yes';
  }

  /**
   * Attach a capture port and start. With `loadModels: false` (wake word off)
   * only the VAD runs — speech onsets are still needed as confirm evidence.
   */
  start(
    port: MessagePort,
    assetBase: string,
    events: WakeWordEvents,
    options: { threshold?: number; loadModels?: boolean } = {}
  ): void {
    this.events = events;
    this.clearIdle();
    const worker = this.ensureWorker();
    const loadModels = options.loadModels !== false;
    if (loadModels && (this.loadedState === 'no' || this.loadedState === 'failed')) {
      this.loadedState = 'loading';
      this.post({ type: 'init', assetBase, threshold: options.threshold });
    } else if (loadModels && this.loadedState === 'yes') {
      events.onLoaded(0);
    }
    this.post({ type: 'reset' });
    this.post({ type: 'mode', mode: loadModels ? 'wake' : 'vad' });
    worker.postMessage({ type: 'port', port } satisfies KwsWorkerIn, [port]);
  }

  setMode(mode: KwsMode): void {
    this.post({ type: 'mode', mode });
  }

  /** Ignore wakes until context time `untilT` (own earcons / clips playing); see WakeGate.suppress. */
  suppress(untilT: number, replace = false): void {
    this.post({ type: 'suppress', untilT, replace });
  }

  /** Detach (disarm); keeps the worker and loaded models for a quick re-arm, then releases them. */
  detach(): void {
    this.post({ type: 'mode', mode: 'idle' });
    this.post({ type: 'reset' });
    this.events = null;
    this.clearIdle();
    if (this.worker) this.idleTimer = setTimeout(() => this.dispose(), this.idleDisposeMs);
  }

  /** Release the worker if no capture is attached (page hidden for good, or idle timeout). */
  disposeIfDetached(): void {
    if (!this.events) this.dispose();
  }

  dispose(): void {
    this.clearIdle();
    this.worker?.terminate();
    this.worker = null;
    this.loadedState = 'no';
    this.events = null;
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private post(msg: KwsWorkerIn): void {
    this.worker?.postMessage(msg, []);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener('message', (event: MessageEvent) => this.onMessage(event.data as KwsWorkerOut));
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.loadedState = 'failed';
      this.events?.onError(event.message || 'worker error');
    });
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: KwsWorkerOut): void {
    const events = this.events;
    switch (msg.type) {
      case 'loaded':
        this.loadedState = 'yes';
        events?.onLoaded(msg.ms);
        break;
      case 'error':
        if (this.loadedState === 'loading') this.loadedState = 'failed';
        events?.onError(msg.message);
        break;
      case 'wake':
        events?.onWake(msg.t, msg.score);
        break;
      case 'vad':
        events?.onVad(msg.speech, msg.t);
        break;
      case 'stats':
        events?.onStats?.(msg);
        break;
      default:
        break;
    }
  }
}

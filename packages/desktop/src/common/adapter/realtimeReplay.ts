/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client side of the realtime replay protocol (TASK-43) on the main `/ws` socket.
 *
 * The server numbers every frame it pushes to this user (`seq`, one counter per
 * user, +1 per frame). After a reconnect, or when a seq is skipped on a live
 * socket, the client asks for the missed frames and applies them in order:
 *
 * - `realtime.hello {epoch, seq}`: first frame of every connection (an older
 *   core sends none: then nothing here is active and frames pass straight through);
 * - `realtime.resume {epoch, last_seq}` (client → server): after hello when a
 *   previous position is known, or on the same socket when a gap is seen;
 * - `realtime.replay {epoch, from_seq, to_seq, frames}`: the missed frames;
 * - `realtime.resyncRequired {epoch, seq, reason}`: the server cannot replay
 *   (restart, or too old): the app re-pulls its state and continues from `seq`.
 *
 * While a resume is pending, live frames are held, then applied after the replay;
 * a frame at or below the highest applied seq is dropped. Frames without `seq`
 * are per-connection replies and are delivered at once.
 */

export const REALTIME_HELLO = 'realtime.hello';
export const REALTIME_RESUME = 'realtime.resume';
export const REALTIME_REPLAY = 'realtime.replay';
export const REALTIME_RESYNC_REQUIRED = 'realtime.resyncRequired';

/** How long to wait for the answer to a resume before re-pulling state instead. */
export const RESUME_TIMEOUT_MS = 10_000;

export type RealtimeFrame = { name: string; data: unknown; seq?: number };
export type RealtimeResyncReason = 'epoch_changed' | 'too_old' | 'timeout';

export type RealtimeReplayHooks = {
  /** Hand one frame to the app, in order. */
  deliver: (name: string, data: unknown) => void;
  /** Send a frame on the current socket; false when it could not be sent. */
  send: (name: string, data: unknown) => boolean;
  /** Frames were lost for good: the app must re-pull its state. */
  resync: (reason: RealtimeResyncReason) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asSeq = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export class RealtimeReplayTracker {
  private epoch: string | null = null;
  private lastSeq = 0;
  private pending = false;
  private held: RealtimeFrame[] = [];
  private timer: unknown = null;

  constructor(private readonly hooks: RealtimeReplayHooks) {}

  /** The position to resume from, or null before the first hello. */
  get position(): { epoch: string; lastSeq: number } | null {
    return this.epoch === null ? null : { epoch: this.epoch, lastSeq: this.lastSeq };
  }

  /** The socket closed: whatever was held will be replayed on the next connection. */
  onDisconnected(): void {
    this.stopWaiting();
    this.held = [];
  }

  /** Every parsed frame from the socket goes through here. */
  onFrame(frame: RealtimeFrame): void {
    switch (frame.name) {
      case REALTIME_HELLO:
        this.onHello(asRecord(frame.data));
        return;
      case REALTIME_REPLAY:
        this.onReplay(asRecord(frame.data));
        return;
      case REALTIME_RESYNC_REQUIRED:
        this.onResyncRequired(asRecord(frame.data));
        return;
      default:
        this.onEvent(frame);
    }
  }

  private onHello(data: Record<string, unknown>): void {
    const epoch = typeof data.epoch === 'string' ? data.epoch : null;
    const seq = asSeq(data.seq);
    if (epoch === null || seq === null) return;
    if (this.epoch === null) {
      // First connection of this page: start from where the server is.
      this.epoch = epoch;
      this.lastSeq = seq;
      return;
    }
    if (this.epoch === epoch && this.lastSeq === seq) return;
    // Something was pushed while we were away (or the server restarted): ask for it.
    this.requestResume();
  }

  private onEvent(frame: RealtimeFrame): void {
    const seq = asSeq(frame.seq);
    // No seq = a per-connection reply; no hello yet = an older core. Either way: pass through.
    if (seq === null || this.epoch === null) {
      this.hooks.deliver(frame.name, frame.data);
      return;
    }
    if (this.pending) {
      this.held.push(frame);
      return;
    }
    if (seq <= this.lastSeq) return;
    if (seq === this.lastSeq + 1) {
      this.lastSeq = seq;
      this.hooks.deliver(frame.name, frame.data);
      return;
    }
    // A seq was skipped on a live socket (dropped under backpressure): hold this one and ask.
    this.held.push(frame);
    this.requestResume();
  }

  private onReplay(data: Record<string, unknown>): void {
    if (!this.pending) return;
    const frames = Array.isArray(data.frames) ? (data.frames as RealtimeFrame[]) : [];
    for (const frame of frames) this.applyInOrder(frame);
    const toSeq = asSeq(data.to_seq);
    if (toSeq !== null && toSeq > this.lastSeq) this.lastSeq = toSeq;
    this.stopWaiting();
    this.flushHeld();
  }

  private onResyncRequired(data: Record<string, unknown>): void {
    const epoch = typeof data.epoch === 'string' ? data.epoch : this.epoch;
    const seq = asSeq(data.seq);
    this.epoch = epoch;
    if (seq !== null) this.lastSeq = seq;
    this.stopWaiting();
    const reason = data.reason === 'too_old' ? 'too_old' : 'epoch_changed';
    this.hooks.resync(reason);
    this.flushHeld();
  }

  /** Replayed frames are trusted to be in order: apply every one above the last applied seq. */
  private applyInOrder(frame: RealtimeFrame): void {
    const seq = asSeq(frame?.seq);
    if (seq === null || typeof frame.name !== 'string' || seq <= this.lastSeq) return;
    this.lastSeq = seq;
    this.hooks.deliver(frame.name, frame.data);
  }

  /** Apply the frames held during a resume; a new gap among them asks again. */
  private flushHeld(): void {
    const held = [...this.held].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this.held = [];
    for (let index = 0; index < held.length; index += 1) {
      const frame = held[index] as RealtimeFrame;
      const seq = frame.seq ?? 0;
      if (seq <= this.lastSeq) continue;
      if (seq !== this.lastSeq + 1) {
        this.held = held.slice(index);
        this.requestResume();
        return;
      }
      this.lastSeq = seq;
      this.hooks.deliver(frame.name, frame.data);
    }
  }

  private requestResume(): void {
    if (this.epoch === null) return;
    this.pending = true;
    const sent = this.hooks.send(REALTIME_RESUME, { epoch: this.epoch, last_seq: this.lastSeq });
    if (!sent) {
      // The socket went away: the next connection's hello starts a new resume.
      this.pending = false;
      return;
    }
    const setTimer = this.hooks.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearWaitTimer();
    this.timer = setTimer(() => this.onResumeTimeout(), RESUME_TIMEOUT_MS);
  }

  /** No answer to the resume: stop holding frames and have the app re-pull its state. */
  private onResumeTimeout(): void {
    this.timer = null;
    if (!this.pending) return;
    this.pending = false;
    const held = [...this.held].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    this.held = [];
    this.hooks.resync('timeout');
    for (const frame of held) this.applyInOrder(frame);
  }

  private stopWaiting(): void {
    this.pending = false;
    this.clearWaitTimer();
  }

  private clearWaitTimer(): void {
    if (this.timer === null) return;
    const clearTimer = this.hooks.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    clearTimer(this.timer);
    this.timer = null;
  }
}

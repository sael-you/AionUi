/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local clip playback (read-backs, follow-ups, say/ask) on the shared
 * AudioContext, so `tEnd` is on the same clock as the VAD's speech onsets
 * (plan §3.3.4: `t − tEnd ≥ 300 ms` is evaluated by the backend).
 *
 * One clip at a time; a new clip or `stop()` truncates the current one, and a
 * truncated clip is reported as `completed: false` (never as finished).
 */

export type ClipOutcome = { completed: boolean; tStart: number; tEnd: number };

export type ClipPlayOptions = {
  gain?: number;
  /** Called once playback is scheduled, with the context time at which the clip will be heard to end. */
  onStart?: (tStart: number, tEnd: number) => void;
};

/** Output path latency on the context clock (seconds): when scheduled audio is actually heard. */
export function outputLatencyOf(ctx: BaseAudioContext): number {
  const c = ctx as Partial<Pick<AudioContext, 'outputLatency' | 'baseLatency'>>;
  return (c.outputLatency || 0) + (c.baseLatency || 0);
}

export class ClipPlayer {
  private current: {
    source: AudioBufferSourceNode;
    settle: (o: ClipOutcome) => void;
    onEnded: () => void;
    tStart: number;
  } | null = null;

  constructor(private readonly ctx: BaseAudioContext) {}

  get playing(): boolean {
    return this.current !== null;
  }

  /**
   * Decode and play; resolves when the clip ends or is truncated. `tEnd` is when
   * the last sample is heard (scheduled end + output latency), on the context clock.
   */
  async play(data: ArrayBuffer, options: ClipPlayOptions = {}): Promise<ClipOutcome> {
    const gain = options.gain ?? 1;
    const buffer = await this.ctx.decodeAudioData(data);
    this.stop();
    return new Promise<ClipOutcome>((resolve) => {
      const source = this.ctx.createBufferSource();
      const amp = this.ctx.createGain();
      amp.gain.value = gain;
      source.buffer = buffer;
      source.connect(amp).connect(this.ctx.destination);
      const tStart = this.ctx.currentTime + 0.02;
      let settled = false;
      const settle = (outcome: ClipOutcome) => {
        if (settled) return;
        settled = true;
        if (this.current?.source === source) this.current = null;
        try {
          source.disconnect();
        } catch {
          // ignore
        }
        resolve(outcome);
      };
      const tEnd = tStart + buffer.duration + outputLatencyOf(this.ctx);
      const onEnded = () => settle({ completed: true, tStart, tEnd });
      source.addEventListener('ended', onEnded);
      this.current = { source, settle, onEnded, tStart };
      source.start(tStart);
      options.onStart?.(tStart, tEnd);
    });
  }

  /** Truncate the current clip (barge-in, disarm, superseded draft). */
  stop(): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    current.source.removeEventListener('ended', current.onEnded);
    try {
      current.source.stop();
    } catch {
      // not started
    }
    current.settle({ completed: false, tStart: current.tStart, tEnd: this.ctx.currentTime });
  }
}

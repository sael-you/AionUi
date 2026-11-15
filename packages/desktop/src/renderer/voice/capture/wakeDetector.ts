/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Energy VAD + wake gate (pure, runs inside the wake-word worker).
 *
 * VAD: ported from S0-C `kws-worker.js` — 4 sub-frames of 20 ms, adaptive
 * noise floor, speech = 10 dB over the floor (min −50 dBFS), 4-frame (320 ms)
 * hangover. Its speech-start times are on the AudioContext clock, so they
 * double as `voice.speechOnset` evidence (plan §3.3.4 item 2).
 *
 * Wake rule (S0 recommendation + plan §2): score ≥ threshold (0.65), VAD
 * speech within the last 1 s, 2 s refractory period, and no wake while the
 * page's own earcons/clips play (`suppressUntil`, plan §3.8).
 */

export const DEFAULT_WAKE_THRESHOLD = 0.65;
export const WAKE_REFRACTORY_S = 2;
export const WAKE_VAD_WINDOW_S = 1;

export type VadEvent = { speech: boolean; t: number };

export type WakeDetectorConfig = { threshold: number };

export class EnergyVad {
  private noiseDb = -60;
  private speech = false;
  private hangover = 0;
  lastVoicedT = -1;

  /** Feed one 1280-sample frame (float −1..1) ending at context time `tEnd`. */
  frame(pcm: Float32Array, tEnd: number): VadEvent | null {
    const sub = Math.floor(pcm.length / 4);
    let voicedAny = false;
    for (let k = 0; k < 4; k++) {
      let s = 0;
      for (let i = k * sub; i < (k + 1) * sub; i++) s += pcm[i] * pcm[i];
      const db = 10 * Math.log10(s / sub + 1e-12);
      const voiced = db > Math.max(this.noiseDb + 10, -50);
      this.noiseDb += (voiced ? 0.002 : 0.05) * (db - this.noiseDb);
      if (voiced) {
        voicedAny = true;
        this.lastVoicedT = tEnd - (3 - k) * 0.02;
      }
    }
    if (voicedAny) {
      this.hangover = 4;
      if (!this.speech) {
        this.speech = true;
        return { speech: true, t: tEnd - 0.08 };
      }
    } else if (this.speech && --this.hangover <= 0) {
      this.speech = false;
      return { speech: false, t: this.lastVoicedT };
    }
    return null;
  }

  get inSpeech(): boolean {
    return this.speech;
  }
}

export class WakeGate {
  private lastWakeT = -1e9;
  private suppressUntil = -1;

  constructor(private config: WakeDetectorConfig = { threshold: DEFAULT_WAKE_THRESHOLD }) {}

  configure(config: Partial<WakeDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Ignore wakes until context time `untilT` (own audio playing). By default the
   * longer window wins (overlapping earcons); `replace` sets it exactly, so a
   * clip's window can be shortened when it is truncated.
   */
  suppress(untilT: number, replace = false): void {
    this.suppressUntil = replace ? untilT : Math.max(this.suppressUntil, untilT);
  }

  /** Decide whether the score at context time `t` is a wake. */
  check(score: number, t: number, lastVoicedT: number): boolean {
    if (score < this.config.threshold) return false;
    if (t < this.suppressUntil) return false;
    if (t - this.lastWakeT <= WAKE_REFRACTORY_S) return false;
    if (lastVoicedT < 0 || t - lastVoicedT > WAKE_VAD_WINDOW_S) return false;
    this.lastWakeT = t;
    return true;
  }

  reset(): void {
    this.lastWakeT = -1e9;
    this.suppressUntil = -1;
  }
}

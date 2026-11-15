/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Earcons synthesised with WebAudio on the shared AudioContext (no assets).
 * The first six tones are the S0-C set that passed the phone echo/self-wake
 * tests; the rest follow the same short sine-pip style. Every tone stays
 * under ~0.5 s so the wake word can be paused while it plays (plan §3.8).
 */

export type EarconName =
  | 'armed'
  | 'listening'
  | 'gotIt'
  | 'yourTurn'
  | 'working'
  | 'sent'
  | 'needsYou'
  | 'agent'
  | 'bye'
  | 'reconnecting'
  | 'back'
  | 'otherDevice';

/** [frequency Hz, offset s, duration s] */
type Note = readonly [number, number, number];

export const EARCONS: Record<EarconName, readonly Note[]> = {
  armed: [
    [660, 0, 0.09],
    [880, 0.1, 0.12],
  ],
  listening: [
    [880, 0, 0.08],
    [1320, 0.08, 0.12],
  ],
  gotIt: [[1175, 0, 0.07]],
  yourTurn: [
    [784, 0, 0.07],
    [1046, 0.08, 0.09],
  ],
  working: [
    [740, 0, 0.06],
    [740, 0.14, 0.06],
    [740, 0.28, 0.06],
  ],
  sent: [
    [1046, 0, 0.08],
    [1568, 0.09, 0.16],
  ],
  needsYou: [
    [988, 0, 0.12],
    [784, 0.16, 0.12],
    [988, 0.32, 0.16],
  ],
  agent: [
    [523, 0, 0.08],
    [659, 0.09, 0.08],
    [784, 0.18, 0.12],
  ],
  bye: [
    [880, 0, 0.1],
    [587, 0.11, 0.16],
  ],
  reconnecting: [
    [587, 0, 0.1],
    [587, 0.2, 0.1],
  ],
  back: [
    [587, 0, 0.08],
    [880, 0.09, 0.12],
  ],
  otherDevice: [
    [440, 0, 0.12],
    [440, 0.16, 0.12],
  ],
};

/** Total length of a tone in seconds. */
export function earconDuration(name: EarconName): number {
  return EARCONS[name].reduce((max, [, offset, dur]) => Math.max(max, offset + dur), 0) + 0.02;
}

/**
 * Play an earcon now. Returns the context time at which it ends (for the
 * wake-word suppression window), or null when the context is not running.
 */
export function playEarcon(ctx: BaseAudioContext, name: EarconName, gain = 0.25): number | null {
  if (ctx.state !== 'running') return null;
  const t = ctx.currentTime + 0.01;
  for (const [freq, offset, dur] of EARCONS[name]) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, t + offset);
    amp.gain.linearRampToValueAtTime(gain, t + offset + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + offset + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + dur + 0.02);
  }
  return t + earconDuration(name);
}

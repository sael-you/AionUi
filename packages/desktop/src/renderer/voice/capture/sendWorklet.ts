/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Outgoing ("send") AudioWorklet — the only path from the microphone to a
 * provider call (plan §3.6 step 2):
 *
 * - the raw mic track is never sent: this node feeds a
 *   `MediaStreamAudioDestinationNode` whose track goes into the WebRTC call;
 * - **mute = this worklet writes silence** (socket loss, waiting for
 *   `voice.ready`, user mute);
 * - an 8 s ring buffer at the native rate always records the call track, so
 *   on `live { fromTime }` it replays from the wake moment ("no lost words")
 *   and catches up to the live mic by dropping windows an energy VAD marks
 *   silent. After `maxCatchupSec` (default 2 s) it jumps to live at the next
 *   silent window (never mid-word); `hardCapSec` (default 1 s) later it jumps
 *   regardless;
 * - fixed-size ring, no accumulation; `clear` wipes it (disarm).
 *
 * Messages in: `{cmd:'mute'}`, `{cmd:'live', fromTime?, maxCatchupSec?}`,
 * `{cmd:'clear'}`, `{cmd:'stop'}`. Messages out (S2 pre-roll gate metric):
 * `{type:'mode', mode, jumped, lagSec, catchupSec}` — `lagSec` is how far
 * behind live the replay was (at catch-up start) or how much was dropped by a
 * jump; `catchupSec` is how long the catch-up took.
 */

export const SEND_PROCESSOR_NAME = 'aionui-voice-send';

/** Mode change reported by the send worklet (pre-roll replay metric for the S2 gate). */
export type SendModeEvent = {
  type: 'mode';
  mode: 'mute' | 'live' | 'catchup';
  jumped: boolean;
  lagSec: number;
  catchupSec: number;
};
export const RING_SECONDS = 8;

export const SEND_WORKLET_SOURCE = `
class VoiceSend extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = Math.ceil(sampleRate * ${RING_SECONDS});
    this.ring = new Float32Array(this.N);
    this.W = 0;
    this.R = 0;
    this.mode = 'mute';
    this.deadline = 0;
    this.hardDeadline = 0;
    this.catchupStart = 0;
    this.win = Math.max(1, Math.round(sampleRate * 0.02));
    this.noiseDb = -60;
    this.hang = 0;
    this.checkedUntil = 0;
    this.running = true;
    this.port.onmessage = (e) => this.onCmd(e.data || {});
  }
  setMode(mode, jumped, lagSamples) {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'catchup') this.catchupStart = currentTime;
    this.port.postMessage({
      type: 'mode',
      mode: mode,
      jumped: !!jumped,
      lagSec: (lagSamples || 0) / sampleRate,
      catchupSec: prev === 'catchup' ? currentTime - this.catchupStart : 0,
    });
  }
  jumpLive(n) {
    const dropped = this.W - n - this.R;
    this.R = this.W - n;
    this.setMode('live', true, dropped);
  }
  onCmd(m) {
    if (m.cmd === 'mute') this.setMode('mute');
    else if (m.cmd === 'stop') { this.running = false; this.setMode('mute'); }
    else if (m.cmd === 'clear') { this.ring.fill(0); this.W = 0; this.R = 0; }
    else if (m.cmd === 'live') {
      if (typeof m.fromTime === 'number' && m.fromTime < currentTime) {
        const back = Math.round((currentTime - m.fromTime) * sampleRate);
        this.R = this.W - Math.min(back, this.N - 1, this.W);
        this.deadline = currentTime + (typeof m.maxCatchupSec === 'number' ? m.maxCatchupSec : 2);
        this.hardDeadline = this.deadline + (typeof m.hardCapSec === 'number' ? m.hardCapSec : 1);
        this.hang = 0;
        this.checkedUntil = this.R;
        this.setMode(this.W - this.R > 128 ? 'catchup' : 'live', false, this.W - this.R);
      } else {
        this.setMode('live');
      }
    }
  }
  energyDb(start, len) {
    let s = 0;
    for (let i = 0; i < len; i++) { const v = this.ring[(start + i) % this.N]; s += v * v; }
    return 10 * Math.log10(s / len + 1e-12);
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return this.running;
    const n = out[0].length;
    const inp = inputs[0];
    const has = inp && inp.length > 0 && inp[0];
    const nch = has ? inp.length : 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (has) { x = inp[0][i]; if (nch > 1) { for (let c = 1; c < nch; c++) x += inp[c][i]; x /= nch; } }
      this.ring[(this.W + i) % this.N] = x;
    }
    this.W += n;
    const o = out[0];
    if (this.mode === 'mute') {
      o.fill(0);
    } else {
      if (this.mode === 'catchup') {
        if (this.W - this.R > this.N) this.R = this.W - this.N;
        const overdue = currentTime >= this.deadline;
        if (currentTime >= this.hardDeadline) this.jumpLive(n);
        else {
          let skipped = 0;
          while (skipped < 400) {
            const lag = this.W - this.R;
            if (lag <= n || this.R < this.checkedUntil) break;
            const len = Math.min(this.win, lag - n);
            const e = this.energyDb(this.R, len);
            const voiced = e > Math.max(this.noiseDb + 10, -50);
            if (voiced) { this.hang = 15; this.checkedUntil = this.R + len; break; }
            this.noiseDb += 0.05 * (e - this.noiseDb);
            // Past the soft deadline: jump at this pause instead of finishing the catch-up.
            if (overdue) { this.jumpLive(n); break; }
            if (this.hang > 0) { this.hang--; this.checkedUntil = this.R + len; break; }
            this.R += len;
            skipped++;
          }
          if (this.mode === 'catchup' && this.W - this.R <= n) { this.R = this.W - n; this.setMode('live'); }
        }
      }
      if (this.mode === 'live') this.R = this.W - n;
      for (let i = 0; i < n; i++) o[i] = this.ring[(this.R + i) % this.N];
      this.R += n;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return this.running;
  }
}
registerProcessor('${SEND_PROCESSOR_NAME}', VoiceSend);
`;

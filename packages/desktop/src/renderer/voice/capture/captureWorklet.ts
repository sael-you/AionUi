/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wake-word capture AudioWorklet, ported from the S0-C phone test
 * (`clauterm-studio/tools/voice-s0/capture-worklet.js`, proven on the owner's
 * Android phone): mono mix → windowed-sinc anti-alias FIR (7.2 kHz) →
 * fractional resample to 16 kHz → 1280-sample (80 ms) frames posted straight
 * to the wake-word worker over a transferred MessagePort (no main-thread hop).
 * Each frame carries the AudioContext time of its last sample.
 *
 * Loaded from a Blob URL like `services/speech/pcmRecorder.ts`, so no bundler
 * configuration is needed. No accumulation: one 1280-sample buffer in flight.
 */

export const CAPTURE_PROCESSOR_NAME = 'aionui-voice-capture16k';

export const CAPTURE_WORKLET_SOURCE = `
class VoiceCapture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    const taps = sampleRate > 16000 ? 63 : 1;
    const fc = 7200 / sampleRate;
    this.h = new Float32Array(taps);
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - (taps - 1) / 2;
      const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
      const w = taps === 1 ? 1 : 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
      this.h[i] = sinc * w;
      sum += this.h[i];
    }
    for (let i = 0; i < taps; i++) this.h[i] /= sum;
    this.hist = new Float32Array(taps);
    this.hp = 0;
    this.prev = 0;
    this.pos = 0;
    this.out = new Float32Array(1280);
    this.on = 0;
    this.port2 = null;
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.port) this.port2 = e.data.port;
      if (e.data && e.data.stop) this.running = false;
    };
  }
  filt(x) {
    const h = this.h, n = h.length, hist = this.hist;
    hist[this.hp] = x;
    let acc = 0, j = this.hp;
    for (let i = 0; i < n; i++) { acc += h[i] * hist[j]; j = j === 0 ? n - 1 : j - 1; }
    this.hp = this.hp + 1 === n ? 0 : this.hp + 1;
    return acc;
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || inp.length === 0) return this.running;
    const ch0 = inp[0], len = ch0.length, nch = inp.length;
    for (let i = 0; i < len; i++) {
      let x = ch0[i];
      if (nch > 1) { for (let c = 1; c < nch; c++) x += inp[c][i]; x /= nch; }
      const y = this.filt(x);
      while (this.pos <= 1) {
        if (this.pos > 0) {
          this.out[this.on++] = this.prev + (y - this.prev) * this.pos;
          if (this.on === 1280) {
            const t = currentTime + (i + 1) / sampleRate;
            if (this.port2) this.port2.postMessage({ pcm: this.out, t: t }, [this.out.buffer]);
            this.out = new Float32Array(1280);
            this.on = 0;
          }
        }
        this.pos += this.ratio;
      }
      this.pos -= 1;
      this.prev = y;
    }
    return this.running;
  }
}
registerProcessor('${CAPTURE_PROCESSOR_NAME}', VoiceCapture16k);
`;

/**
 * Runs the shipped AudioWorklet source strings in a fake AudioWorkletGlobalScope.
 */

import { describe, expect, it } from 'vitest';
import { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_SOURCE } from '@/renderer/voice/capture/captureWorklet';
import { RING_SECONDS, SEND_PROCESSOR_NAME, SEND_WORKLET_SOURCE } from '@/renderer/voice/capture/sendWorklet';

type Port = { onmessage: ((e: { data: unknown }) => void) | null; posted: unknown[]; postMessage(m: unknown): void };
type Processor = { port: Port; process(inputs: Float32Array[][], outputs?: Float32Array[][]): boolean };

function loadProcessor(source: string, name: string, sampleRate: number) {
  const scope = { currentTime: 0 };
  const registry: Record<string, new () => Processor> = {};
  class AudioWorkletProcessor {
    port: Port = {
      onmessage: null,
      posted: [],
      postMessage(m: unknown) {
        this.posted.push(m);
      },
    };
  }
  // eslint-disable-next-line no-new-func
  const install = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'scope',
    `with (scope) { ${source} }`
  );
  install(AudioWorkletProcessor, (n: string, ctor: new () => Processor) => (registry[n] = ctor), sampleRate, scope);
  const proc = new registry[name]();
  const send = (data: unknown) => proc.port.onmessage?.({ data });
  return { proc, scope, send };
}

const QUANTUM = 128;

const modes = (w: ReturnType<typeof loadProcessor>) =>
  w.proc.port.posted as Array<{ mode: string; jumped: boolean; lagSec: number; catchupSec: number }>;

describe('send worklet (outgoing path)', () => {
  const SR = 48000;
  const runBlock = (w: ReturnType<typeof loadProcessor>, value: number) => {
    const input = new Float32Array(QUANTUM).fill(value);
    const output = new Float32Array(QUANTUM);
    w.proc.process([[input]], [[output]]);
    w.scope.currentTime += QUANTUM / SR;
    return output;
  };

  it('writes silence while muted (default) even with loud input', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    const out = runBlock(w, 0.5);
    expect(Math.max(...out.map(Math.abs))).toBe(0);
  });

  it('passes the live mic through after live without pre-roll', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    w.send({ cmd: 'live' });
    expect(runBlock(w, 0.25)[0]).toBeCloseTo(0.25);
  });

  it('mute after live returns to silence', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    w.send({ cmd: 'live' });
    runBlock(w, 0.25);
    w.send({ cmd: 'mute' });
    expect(runBlock(w, 0.25)[0]).toBe(0);
  });

  it('replays from the wake time first ("no lost words"), then catches up to live', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    // 0.5 s of speech-level audio marked 0.3, recorded while muted.
    for (let i = 0; i < 188; i++) runBlock(w, 0.3);
    const wakeT = w.scope.currentTime - 0.5;
    // then silence while the call is set up
    for (let i = 0; i < 188; i++) runBlock(w, 0);
    w.send({ cmd: 'live', fromTime: wakeT });
    expect(w.proc.port.posted).toContainEqual(
      expect.objectContaining({ type: 'mode', mode: 'catchup', jumped: false, lagSec: expect.closeTo(1, 1) })
    );
    const first = runBlock(w, 0);
    expect(first[0]).toBeCloseTo(0.3); // the buffered speech comes out first
    // The user pauses: silent windows are dropped until the replay reaches live.
    const isLive = () => w.proc.port.posted.some((m) => (m as { mode?: string }).mode === 'live');
    let blocks = 0;
    while (!isLive() && blocks < 400) {
      runBlock(w, 0);
      blocks++;
    }
    expect(w.proc.port.posted).toContainEqual(expect.objectContaining({ type: 'mode', mode: 'live', jumped: false }));
    // well under the ~1 s of audio that was behind live (0.5 s speech + 0.5 s silence)
    expect(blocks * (QUANTUM / SR)).toBeLessThan(1);
    expect(runBlock(w, 0.9)[0]).toBeCloseTo(0.9);
  });

  it('past the soft deadline it keeps replaying words and jumps live at the next pause, not mid-word', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    const start = w.scope.currentTime;
    for (let i = 0; i < 375; i++) runBlock(w, 0.3); // 1 s of speech
    for (let i = 0; i < 75; i++) runBlock(w, 0); // 0.2 s pause between words
    for (let i = 0; i < 940; i++) runBlock(w, 0.3); // 2.5 s more speech
    w.send({ cmd: 'live', fromTime: start, maxCatchupSec: 0.1, hardCapSec: 5 });
    // replaying the first word: past the soft deadline but no pause yet → still catching up
    for (let i = 0; i < 200; i++) expect(Math.abs(runBlock(w, 0.3)[0] - 0.3)).toBeLessThan(1e-6);
    expect(modes(w).some((m) => m.mode === 'live')).toBe(false);
    // the replay reaches the pause → jump to live there
    for (let i = 0; i < 400 && !modes(w).some((m) => m.mode === 'live'); i++) runBlock(w, 0.3);
    expect(modes(w).at(-1)).toMatchObject({ mode: 'live', jumped: true });
    expect(modes(w).at(-1)?.catchupSec).toBeCloseTo(1, 0);
  });

  it('jumps live at the hard cap even without a pause', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    for (let i = 0; i < 1500; i++) runBlock(w, 0.3);
    w.send({ cmd: 'live', fromTime: w.scope.currentTime - 3.5, maxCatchupSec: 0.1, hardCapSec: 0.2 });
    for (let i = 0; i < 150; i++) runBlock(w, 0.3);
    expect(modes(w).at(-1)).toMatchObject({ mode: 'live', jumped: true });
    expect(modes(w).at(-1)?.catchupSec).toBeGreaterThanOrEqual(0.3);
  });

  it('never replays more than the 8 s ring', () => {
    const w = loadProcessor(SEND_WORKLET_SOURCE, SEND_PROCESSOR_NAME, SR);
    const blocks = Math.ceil(((RING_SECONDS + 2) * SR) / QUANTUM);
    for (let i = 0; i < blocks; i++) runBlock(w, 0.1);
    w.send({ cmd: 'live', fromTime: 0 });
    const proc = w.proc as unknown as { W: number; R: number; N: number };
    expect(proc.W - proc.R).toBeLessThanOrEqual(proc.N);
    expect(proc.N).toBe(RING_SECONDS * SR);
  });
});

describe('capture-16k worklet (wake word path)', () => {
  it('emits 1280-sample 16 kHz frames with the context time of the last sample', () => {
    const SR = 48000;
    const w = loadProcessor(CAPTURE_WORKLET_SOURCE, CAPTURE_PROCESSOR_NAME, SR);
    const frames: Array<{ pcm: Float32Array; t: number }> = [];
    w.send({ port: { postMessage: (m: { pcm: Float32Array; t: number }) => frames.push(m) } });
    // 0.2 s of a 440 Hz tone at 48 kHz → 3200 samples at 16 kHz → 2 full frames
    let n = 0;
    for (let b = 0; b < (0.2 * SR) / QUANTUM; b++) {
      const input = new Float32Array(QUANTUM);
      for (let i = 0; i < QUANTUM; i++, n++) input[i] = 0.5 * Math.sin((2 * Math.PI * 440 * n) / SR);
      w.proc.process([[input]]);
      w.scope.currentTime += QUANTUM / SR;
    }
    expect(frames).toHaveLength(2);
    expect(frames[0].pcm).toHaveLength(1280);
    expect(frames[0].t).toBeCloseTo(0.08, 2);
    const peak = Math.max(...Array.from(frames[1].pcm, Math.abs));
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThan(0.6);
  });

  it('stops processing after stop', () => {
    const w = loadProcessor(CAPTURE_WORKLET_SOURCE, CAPTURE_PROCESSOR_NAME, 16000);
    w.send({ stop: true });
    expect(w.proc.process([[new Float32Array(QUANTUM)]])).toBe(false);
  });
});

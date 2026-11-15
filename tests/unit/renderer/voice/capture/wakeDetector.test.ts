import { describe, expect, it } from 'vitest';
import { DEFAULT_WAKE_THRESHOLD, EnergyVad, WakeGate } from '@/renderer/voice/capture/wakeDetector';

const frame = (amp: number) => new Float32Array(1280).fill(amp);

describe('EnergyVad', () => {
  it('reports a speech start with a context-clock time and an end after the hangover', () => {
    const vad = new EnergyVad();
    for (let i = 0; i < 10; i++) expect(vad.frame(frame(0.0005), i * 0.08)).toBeNull();
    const start = vad.frame(frame(0.2), 0.88);
    expect(start).toEqual({ speech: true, t: 0.8 });
    expect(vad.frame(frame(0.2), 0.96)).toBeNull();
    const events = [1.04, 1.12, 1.2, 1.28].map((t) => vad.frame(frame(0.0005), t)).filter(Boolean);
    expect(events).toEqual([{ speech: false, t: 0.96 }]);
  });

  it('stays silent on a steady noise floor', () => {
    const vad = new EnergyVad();
    const events = Array.from({ length: 50 }, (_, i) => vad.frame(frame(0.001), i * 0.08)).filter(Boolean);
    expect(events).toEqual([]);
  });
});

describe('WakeGate', () => {
  it('uses the 0.65 threshold from the S0 phone runs', () => {
    expect(DEFAULT_WAKE_THRESHOLD).toBe(0.65);
    const gate = new WakeGate();
    expect(gate.check(0.64, 10, 9.9)).toBe(false);
    expect(gate.check(0.66, 10, 9.9)).toBe(true);
  });

  it('requires VAD speech within the last second', () => {
    const gate = new WakeGate();
    expect(gate.check(0.9, 10, 8.5)).toBe(false);
    expect(gate.check(0.9, 10, -1)).toBe(false);
  });

  it('applies a 2 s refractory period', () => {
    const gate = new WakeGate();
    expect(gate.check(0.9, 10, 9.9)).toBe(true);
    expect(gate.check(0.9, 11.5, 11.4)).toBe(false);
    expect(gate.check(0.9, 12.1, 12)).toBe(true);
  });

  it('ignores wakes while our own audio plays', () => {
    const gate = new WakeGate();
    gate.suppress(10.5);
    expect(gate.check(0.99, 10.2, 10.1)).toBe(false);
    expect(gate.check(0.99, 10.6, 10.5)).toBe(true);
  });

  it('overlapping suppressions keep the longest window unless replaced (a truncated clip)', () => {
    const gate = new WakeGate();
    gate.suppress(40);
    gate.suppress(11);
    expect(gate.check(0.99, 20, 19.9)).toBe(false);
    gate.suppress(11, true);
    expect(gate.check(0.99, 20, 19.9)).toBe(true);
  });
});

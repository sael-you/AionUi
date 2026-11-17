/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REALTIME_HELLO,
  REALTIME_REPLAY,
  REALTIME_RESUME,
  REALTIME_RESYNC_REQUIRED,
  RESUME_TIMEOUT_MS,
  RealtimeReplayTracker,
} from '@/common/adapter/realtimeReplay';

const setup = () => {
  const delivered: string[] = [];
  const sent: Array<{ name: string; data: unknown }> = [];
  const resyncs: string[] = [];
  const timers: Array<() => void> = [];
  let canSend = true;
  const tracker = new RealtimeReplayTracker({
    deliver: (name) => delivered.push(name),
    send: (name, data) => {
      if (!canSend) return false;
      sent.push({ name, data });
      return true;
    },
    resync: (reason) => resyncs.push(reason),
    setTimer: (callback) => timers.push(callback),
    clearTimer: vi.fn(),
  });
  const hello = (epoch: string, seq: number) => tracker.onFrame({ name: REALTIME_HELLO, data: { epoch, seq } });
  const event = (seq: number) => tracker.onFrame({ name: `e${seq}`, data: {}, seq });
  const replay = (from: number, to: number, seqs: number[]) =>
    tracker.onFrame({
      name: REALTIME_REPLAY,
      data: { epoch: 'A', from_seq: from, to_seq: to, frames: seqs.map((seq) => ({ name: `e${seq}`, data: {}, seq })) },
    });
  return {
    tracker,
    delivered,
    sent,
    resyncs,
    timers,
    hello,
    event,
    replay,
    offline: () => {
      canSend = false;
    },
  };
};

describe('realtime replay tracker (TASK-43)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('passes everything through against an older core that sends no hello', () => {
    t.event(7);
    t.event(3);
    t.tracker.onFrame({ name: 'pong', data: {} });
    expect(t.delivered).toEqual(['e7', 'e3', 'pong']);
    expect(t.sent).toEqual([]);
  });

  it('starts at the hello seq, delivers in order and drops what it already applied', () => {
    t.hello('A', 10);
    t.event(11);
    t.event(11);
    t.event(9);
    t.event(12);
    expect(t.delivered).toEqual(['e11', 'e12']);
    expect(t.tracker.position).toEqual({ epoch: 'A', lastSeq: 12 });
    expect(t.sent).toEqual([]);
  });

  it('delivers frames without a seq at once and never counts them', () => {
    t.hello('A', 0);
    t.tracker.onFrame({ name: 'realtime.error', data: {} });
    t.event(1);
    expect(t.delivered).toEqual(['realtime.error', 'e1']);
  });

  it('after a reconnect: resumes from its last seq, holds live frames, applies replay then held, in order', () => {
    t.hello('A', 0);
    t.event(1);
    t.tracker.onDisconnected();

    t.hello('A', 4);
    expect(t.sent).toEqual([{ name: REALTIME_RESUME, data: { epoch: 'A', last_seq: 1 } }]);
    t.event(5);
    t.event(6);
    expect(t.delivered).toEqual(['e1']);

    t.replay(2, 4, [2, 3, 4]);
    expect(t.delivered).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    t.event(4);
    t.event(7);
    expect(t.delivered.at(-1)).toBe('e7');
    expect(t.resyncs).toEqual([]);
  });

  it('does not resume when nothing was missed while away', () => {
    t.hello('A', 3);
    t.tracker.onDisconnected();
    t.hello('A', 3);
    expect(t.sent).toEqual([]);
  });

  it('a skipped seq on a live socket asks for the gap and keeps the order', () => {
    t.hello('A', 0);
    t.event(1);
    t.event(4);
    expect(t.sent).toEqual([{ name: REALTIME_RESUME, data: { epoch: 'A', last_seq: 1 } }]);
    t.event(5);
    t.replay(2, 4, [2, 3, 4]);
    expect(t.delivered).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('a second gap among the held frames asks again', () => {
    t.hello('A', 0);
    t.event(3);
    t.event(6);
    t.replay(1, 3, [1, 2, 3]);
    expect(t.delivered).toEqual(['e1', 'e2', 'e3']);
    expect(t.sent.at(-1)).toEqual({ name: REALTIME_RESUME, data: { epoch: 'A', last_seq: 3 } });
    t.replay(4, 6, [4, 5, 6]);
    expect(t.delivered).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  });

  it('resyncRequired (restart or too old): the app re-pulls, then continues from the given seq', () => {
    t.hello('A', 0);
    t.event(1);
    t.tracker.onDisconnected();
    t.hello('B', 2);
    expect(t.sent).toEqual([{ name: REALTIME_RESUME, data: { epoch: 'A', last_seq: 1 } }]);
    t.event(3);
    t.tracker.onFrame({ name: REALTIME_RESYNC_REQUIRED, data: { epoch: 'B', seq: 2, reason: 'epoch_changed' } });

    expect(t.resyncs).toEqual(['epoch_changed']);
    expect(t.delivered).toEqual(['e1', 'e3']);
    expect(t.tracker.position).toEqual({ epoch: 'B', lastSeq: 3 });

    t.tracker.onFrame({ name: REALTIME_RESYNC_REQUIRED, data: { epoch: 'B', seq: 9, reason: 'too_old' } });
    expect(t.resyncs).toEqual(['epoch_changed', 'too_old']);
    t.event(10);
    expect(t.delivered.at(-1)).toBe('e10');
  });

  it('no answer to a resume: re-pulls state and releases the held frames', () => {
    t.hello('A', 0);
    t.event(3);
    expect(t.timers).toHaveLength(1);
    expect(RESUME_TIMEOUT_MS).toBeGreaterThan(0);
    t.event(4);
    t.timers[0]?.();
    expect(t.resyncs).toEqual(['timeout']);
    expect(t.delivered).toEqual(['e3', 'e4']);
    t.event(5);
    expect(t.delivered.at(-1)).toBe('e5');
  });

  it('a resume that cannot be sent leaves the next connection to recover', () => {
    t.hello('A', 0);
    t.event(1);
    t.offline();
    t.event(4);
    t.tracker.onDisconnected();
    expect(t.delivered).toEqual(['e1']);
    expect(t.tracker.position).toEqual({ epoch: 'A', lastSeq: 1 });
  });

  it('ignores a replay nobody asked for and malformed hellos', () => {
    t.tracker.onFrame({ name: REALTIME_HELLO, data: { epoch: 5 } });
    expect(t.tracker.position).toBeNull();
    t.hello('A', 0);
    t.replay(1, 3, [1, 2, 3]);
    expect(t.delivered).toEqual([]);
  });
});

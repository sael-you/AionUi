import { describe, expect, it } from 'vitest';
import { todayStats, utcDayStart } from '@/renderer/voice/core/todayStats';
import type { VoiceSessionSummary } from '@/renderer/voice/core/types';

const DAY = 86_400_000;
const NOW = 20 * DAY + 15 * 3_600_000; // 15:00 UTC on day 20
const MIN = 60_000;

const session = (patch: Partial<VoiceSessionSummary>): VoiceSessionSummary => ({
  id: 's',
  engine: 'openai-realtime',
  model: 'm',
  state: 'ended',
  created_at: NOW - 60 * MIN,
  cost_usd: 0,
  ...patch,
});

describe('voice todayStats (TASK-37 #5)', () => {
  it('counts the calls that connected today (UTC) and their connected minutes', () => {
    const stats = todayStats(
      [
        // Live call: counts up to now.
        session({ state: 'live', created_at: NOW - 5 * MIN, ready_at: NOW - 4 * MIN }),
        session({ created_at: NOW - 60 * MIN, ready_at: NOW - 59 * MIN, ended_at: NOW - 49 * MIN }),
        // Never connected: not a call.
        session({ state: 'failed', created_at: NOW - 70 * MIN }),
        // Yesterday (UTC): not today.
        session({ created_at: utcDayStart(NOW) - MIN, ready_at: utcDayStart(NOW) - MIN, ended_at: NOW - 90 * MIN }),
      ],
      NOW,
      50
    );
    expect(stats).toEqual({ calls: 2, minutes: 14, truncated: false });
  });

  it('is empty with no sessions', () => {
    expect(todayStats([], NOW, 50)).toEqual({ calls: 0, minutes: 0, truncated: false });
  });

  it('says the numbers are a floor when the list is full and its oldest row is still today', () => {
    const today = Array.from({ length: 3 }, (_, i) =>
      session({ created_at: NOW - (i + 1) * MIN, ready_at: NOW - (i + 1) * MIN, ended_at: NOW - i * MIN })
    );
    expect(todayStats(today, NOW, 3).truncated).toBe(true);
    const reachesYesterday = [...today.slice(0, 2), session({ created_at: utcDayStart(NOW) - MIN })];
    expect(todayStats(reachesYesterday, NOW, 3).truncated).toBe(false);
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Today's voice use for the settings panel (TASK-37 #5), from `GET /api/voice/sessions`. The day
 * is the UTC day, like the backend's daily budget (`budget.rs` `utc_day_start_ms`).
 */

import type { VoiceSessionSummary } from './types';

const DAY_MS = 86_400_000;

export type VoiceTodayStats = {
  /** Calls that connected (`ready_at` set) and started today. */
  calls: number;
  /** Their connected time in whole minutes (a live call counts up to now). */
  minutes: number;
  /** The list hit its row limit inside today: the real numbers are higher. */
  truncated: boolean;
};

export const utcDayStart = (nowMs: number): number => Math.floor(nowMs / DAY_MS) * DAY_MS;

export function todayStats(sessions: VoiceSessionSummary[], nowMs: number, limit: number): VoiceTodayStats {
  const dayStart = utcDayStart(nowMs);
  let calls = 0;
  let ms = 0;
  for (const session of sessions) {
    if (session.created_at < dayStart || typeof session.ready_at !== 'number') continue;
    calls += 1;
    ms += Math.max(0, (session.ended_at ?? nowMs) - session.ready_at);
  }
  const oldest = sessions[sessions.length - 1];
  return {
    calls,
    minutes: Math.round(ms / 60_000),
    truncated: sessions.length >= limit && !!oldest && oldest.created_at >= dayStart,
  };
}

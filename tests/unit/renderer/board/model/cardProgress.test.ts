/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Board Butler progress (C22): read from card metadata, clamped, and stale only where it matters. */

import { describe, expect, it } from 'vitest';

import { cardProgress, PROGRESS_STALE_MS } from '@/renderer/components/board/utils/cardProgress';

const NOW = 1_800_000_000_000;
const card = (metadata: Record<string, unknown> | null | undefined, column_key = 'building') => ({
  column_key,
  metadata,
});

describe('cardProgress', () => {
  it('reads progress, note and update time from metadata', () => {
    expect(cardProgress(card({ progress: 45, status_note: 'Wiring the API', updated_at: NOW - 1000 }), NOW)).toEqual({
      value: 45,
      note: 'Wiring the API',
      updatedAt: NOW - 1000,
      stale: false,
    });
  });

  it('is null when progress is missing or not a number (never 0 %)', () => {
    expect(cardProgress(card(undefined), NOW)).toBeNull();
    expect(cardProgress(card(null), NOW)).toBeNull();
    expect(cardProgress(card({}), NOW)).toBeNull();
    expect(cardProgress(card({ status_note: 'only a note', updated_at: NOW }), NOW)).toBeNull();
    expect(cardProgress(card({ progress: null }), NOW)).toBeNull();
    expect(cardProgress(card({ progress: 'soon' }), NOW)).toBeNull();
    expect(cardProgress(card({ progress: Number.NaN }), NOW)).toBeNull();
  });

  it('clamps to 0–100 and rounds to an integer', () => {
    expect(cardProgress(card({ progress: 150 }), NOW)?.value).toBe(100);
    expect(cardProgress(card({ progress: -5 }), NOW)?.value).toBe(0);
    expect(cardProgress(card({ progress: 42.6 }), NOW)?.value).toBe(43);
    expect(cardProgress(card({ progress: '70' }), NOW)?.value).toBe(70);
  });

  it('keeps the note to one line and drops an empty one', () => {
    expect(cardProgress(card({ progress: 1, status_note: 'first\nsecond' }), NOW)?.note).toBe('first');
    expect(cardProgress(card({ progress: 1, status_note: '   ' }), NOW)?.note).toBeNull();
  });

  it('flags an update older than 24 h only in building and local_test', () => {
    const old = { progress: 30, updated_at: NOW - PROGRESS_STALE_MS - 1 };
    expect(cardProgress(card(old, 'building'), NOW)?.stale).toBe(true);
    expect(cardProgress(card(old, 'local_test'), NOW)?.stale).toBe(true);
    expect(cardProgress(card(old, 'triage'), NOW)?.stale).toBe(false);
    expect(cardProgress(card(old, 'done'), NOW)?.stale).toBe(false);
    expect(cardProgress(card({ progress: 30, updated_at: NOW - PROGRESS_STALE_MS }, 'building'), NOW)?.stale).toBe(
      false
    );
    expect(cardProgress(card({ progress: 30 }, 'building'), NOW)?.stale).toBe(false);
  });
});

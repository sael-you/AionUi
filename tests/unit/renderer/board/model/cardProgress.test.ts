/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Board Butler progress (C22): read from card metadata, clamped, and stale only where it matters. */

import { describe, expect, it } from 'vitest';

import { cardProgress, parseUpdatedAt, PROGRESS_STALE_MS } from '@/renderer/components/board/utils/cardProgress';

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

describe('parseUpdatedAt (Butler writes ISO-8601; epochs in ms or seconds)', () => {
  const ISO = '2026-11-15T10:00:00.000Z';
  const MS = Date.parse(ISO);

  it('reads ms, seconds (< 1e12), numeric strings and ISO-8601', () => {
    expect(parseUpdatedAt(MS)).toBe(MS);
    expect(parseUpdatedAt(MS / 1000)).toBe(MS);
    expect(parseUpdatedAt(String(MS))).toBe(MS);
    expect(parseUpdatedAt(String(MS / 1000))).toBe(MS);
    expect(parseUpdatedAt(ISO)).toBe(MS);
    expect(parseUpdatedAt('2026-11-15T11:00:00+01:00')).toBe(MS);
  });

  it('rejects invalid values', () => {
    for (const bad of [null, undefined, '', '  ', 'yesterday', 'not-a-date', 0, -5, Number.NaN, Infinity, {}, true]) {
      expect(parseUpdatedAt(bad), String(bad)).toBeNull();
    }
  });

  it('an ISO updated_at drives "updated" and the stale warning', () => {
    const now = MS + PROGRESS_STALE_MS + 1;
    const progress = cardProgress(card({ progress: 40, updated_at: ISO }, 'building'), now);
    expect(progress?.updatedAt).toBe(MS);
    expect(progress?.stale).toBe(true);
    expect(cardProgress(card({ progress: 40, updated_at: ISO }, 'building'), MS + 1000)?.stale).toBe(false);
    // Seconds epoch behaves the same.
    expect(cardProgress(card({ progress: 40, updated_at: MS / 1000 }, 'building'), now)?.stale).toBe(true);
  });
});

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Card progress as reported by the Board Butler (C22): `metadata.progress`
 * (integer 0–100), `metadata.status_note` (one line) and `metadata.updated_at`
 * (ms epoch of the Butler's last update).
 */

import type { BoardCardSummary } from '@/common/types/board';

/** An update older than this is highlighted as stale. */
export const PROGRESS_STALE_MS = 24 * 60 * 60 * 1000;

/** Columns where a silent card is a problem worth highlighting: work is supposed to be moving there. */
export const PROGRESS_STALE_COLUMNS: ReadonlySet<string> = new Set(['building', 'local_test']);

export type CardProgress = {
  /** Integer percentage, clamped to 0–100. */
  value: number;
  /** One-line status note, or null when none was written. */
  note: string | null;
  /** Ms epoch of the Butler's last update, or null when unknown. */
  updatedAt: number | null;
  /** The last update is older than 24 h and the card sits in a column where that matters. */
  stale: boolean;
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Progress of a card, or null when the card carries none (missing, null or not
 * a number): the UI then shows nothing rather than 0 %.
 */
export const cardProgress = (
  card: Pick<BoardCardSummary, 'column_key' | 'metadata'>,
  nowMs: number = Date.now()
): CardProgress | null => {
  const metadata = card.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = finiteNumber(metadata.progress);
  if (raw === null) return null;
  const value = Math.round(Math.min(100, Math.max(0, raw)));
  const rawNote = metadata.status_note;
  // One line: the tile has no room for more, and the Butler writes a single line anyway.
  const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim().split(/\r?\n/, 1)[0] : null;
  const updatedAt = finiteNumber(metadata.updated_at);
  const stale =
    updatedAt !== null && PROGRESS_STALE_COLUMNS.has(card.column_key) && nowMs - updatedAt > PROGRESS_STALE_MS;
  return { value, note, updatedAt, stale };
};

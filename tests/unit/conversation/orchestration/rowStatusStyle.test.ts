/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { rowStatusStyle } from '@/renderer/pages/conversation/GroupedHistory/utils/rowStatusStyle';

/** C24: sidebar status is colour plus a right-aligned dot, never a spinner. */
describe('rowStatusStyle (status → style)', () => {
  it('running: primary dot that pulses, icon tinted', () => {
    expect(rowStatusStyle('running')).toEqual({
      dot: 'running',
      pulse: true,
      emphasis: false,
      tintIcon: true,
      announce: 'running',
    });
  });

  it('needs you: amber dot, semibold title, no pulse', () => {
    expect(rowStatusStyle('waiting')).toMatchObject({ dot: 'waiting', emphasis: true, pulse: false, tintIcon: false });
  });

  it('failed: red dot; done (unread finished): small primary dot without pulse', () => {
    expect(rowStatusStyle('failed')).toMatchObject({ dot: 'failed', pulse: false, announce: 'failed' });
    expect(rowStatusStyle('done')).toMatchObject({ dot: 'unread', pulse: false, announce: 'done' });
  });

  it('idle, not started and stopped: no dot; a manual unread mark shows the small dot', () => {
    for (const state of ['idle', 'queued', 'stopped'] as const) {
      expect(rowStatusStyle(state).dot).toBeNull();
    }
    expect(rowStatusStyle('idle', { manualUnread: true })).toMatchObject({ dot: 'unread', announce: 'unread' });
  });

  it('a quiet collapsed parent shows its most urgent child state as a dot, without emphasis', () => {
    expect(rowStatusStyle('idle', { rollupWorst: 'waiting' })).toMatchObject({
      dot: 'waiting',
      emphasis: false,
      announce: 'waiting',
    });
    // The row's own state wins.
    expect(rowStatusStyle('running', { rollupWorst: 'failed' }).dot).toBe('running');
    expect(rowStatusStyle('idle', { rollupWorst: 'queued' }).dot).toBeNull();
  });
});

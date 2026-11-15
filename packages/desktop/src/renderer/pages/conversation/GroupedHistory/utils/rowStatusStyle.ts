/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunState } from '@/renderer/pages/conversation/components/orchestration/runState';

/** The right-aligned status dot of a sidebar row (C24). */
export type RowDot = 'running' | 'waiting' | 'failed' | 'unread';

export type RowStatusStyle = {
  /** Right-aligned dot; `null` = none (idle). */
  dot: RowDot | null;
  /** Running pulses softly (never with reduced motion: CSS). */
  pulse: boolean;
  /** Needs you: the title is semibold. */
  emphasis: boolean;
  /** Running: the leading icon is tinted with the primary colour. */
  tintIcon: boolean;
  /** The state named in the row's accessible label (status is never colour only). */
  announce: RunState | 'unread' | null;
};

/**
 * Sidebar row status → style (C24, Claude-desktop / Codex look): colour and a
 * right-aligned dot instead of status icons. `rollupWorst` is the most urgent
 * state among a COLLAPSED parent's descendants, shown when the row itself is
 * quiet. `manualUnread` is the owner's own "mark as unread".
 */
export const rowStatusStyle = (
  state: RunState,
  options: { manualUnread?: boolean; rollupWorst?: RunState } = {}
): RowStatusStyle => {
  const own = styleOf(state);
  if (own.dot) return own;
  if (options.rollupWorst && options.rollupWorst !== 'idle') {
    const rolled = styleOf(options.rollupWorst);
    // A collapsed parent shows its children's state as a dot only.
    if (rolled.dot) return { ...rolled, emphasis: false, tintIcon: false };
  }
  if (options.manualUnread) return { ...QUIET, dot: 'unread', announce: 'unread' };
  return QUIET;
};

const QUIET: RowStatusStyle = { dot: null, pulse: false, emphasis: false, tintIcon: false, announce: null };

const styleOf = (state: RunState): RowStatusStyle => {
  switch (state) {
    case 'running':
      return { dot: 'running', pulse: true, emphasis: false, tintIcon: true, announce: 'running' };
    case 'waiting':
      return { dot: 'waiting', pulse: false, emphasis: true, tintIcon: false, announce: 'waiting' };
    case 'failed':
      return { dot: 'failed', pulse: false, emphasis: false, tintIcon: false, announce: 'failed' };
    case 'done':
      return { dot: 'unread', pulse: false, emphasis: false, tintIcon: false, announce: 'done' };
    default:
      // Not started, stopped, idle: no dot.
      return QUIET;
  }
};

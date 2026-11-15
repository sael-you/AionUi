/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the client does when `voice.callEnded` arrives (PROTOCOL.md "End reasons").
 * The frame is the only signal that ends a call; this table only decides the
 * follow-up: stay armed (default), disarm, re-dial, and which notice to show.
 */

export type CallEndPolicy = {
  /** `voice.notice.<code>` to show, or null for a quiet end. */
  notice: string | null;
  /** Leave voice mode entirely (sleep, kill switch). */
  disarm: boolean;
  /** Dial a fresh call at once with `resume_of` (rotation at an idle point). */
  redial: boolean;
};

const QUIET: CallEndPolicy = { notice: null, disarm: false, redial: false };

const POLICIES: Record<string, CallEndPolicy> = {
  sleep: { notice: null, disarm: true, redial: false },
  disabled: { notice: 'disabled', disarm: true, redial: false },
  auth_revoked: { notice: 'unauthorized', disarm: false, redial: false },
  budget: { notice: 'budget', disarm: false, redial: false },
  idle: { notice: 'callIdle', disarm: false, redial: false },
  hard_cap: { notice: 'callHardCap', disarm: false, redial: false },
  rotation: { notice: null, disarm: false, redial: true },
  device_stale: { notice: 'callDropped', disarm: false, redial: false },
  config_timeout: { notice: 'callDropped', disarm: false, redial: false },
  attach_failed: { notice: 'callDropped', disarm: false, redial: false },
  control_lost: { notice: 'callDropped', disarm: false, redial: false },
  provider_ended: { notice: 'callDropped', disarm: false, redial: false },
  restart: { notice: 'callDropped', disarm: false, redial: false },
};

/**
 * Policy for an end reason. Client-requested ends (`user`, `offline`, `network`),
 * `resumed` (replaced by our own `resume_of`), `device_frozen` (we froze) and
 * unknown reasons end quietly and stay armed.
 */
export function callEndPolicy(reason: string): CallEndPolicy {
  return POLICIES[reason] ?? QUIET;
}

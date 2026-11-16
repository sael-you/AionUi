/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Messages between the popup and the service worker (chrome.runtime messaging). */

import type { RelaySnapshot } from './relay';

export type PopupRequest =
  | { type: 'get' }
  | { type: 'pair'; address: string; code: string; device_name: string }
  | { type: 'share'; tab_id: number }
  | { type: 'unshare'; tab_id: number }
  | { type: 'new_tabs'; allowed: boolean }
  | { type: 'stop' }
  | { type: 'resume' }
  | { type: 'unpair' };

export type PopupResponse =
  | { ok: true; snapshot: RelaySnapshot }
  | { ok: false; error: string; snapshot: RelaySnapshot };

/** Broadcast by the worker whenever the relay changes. */
export type SnapshotMessage = { type: 'snapshot'; snapshot: RelaySnapshot };

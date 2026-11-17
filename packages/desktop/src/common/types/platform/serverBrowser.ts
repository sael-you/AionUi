/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Server-side in-app browser for the WebUI (C30, TASK-111): wire types of
 * AionCore `aionui-api-types::browser` (snake_case, field by field). Request
 * types are `deny_unknown_fields` on the server: send exactly these fields.
 * Nothing here ever carries a CDP port or a bridge token.
 */

export type BrowserErrorCode =
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_START_FAILED'
  | 'BROWSER_NOT_RUNNING'
  | 'BROWSER_URL_BLOCKED'
  | 'BROWSER_AGENTS_DISABLED'
  | 'BROWSER_METHOD_BLOCKED'
  | 'BROWSER_TAB_LIMIT'
  | 'BROWSER_INSTANCE_LIMIT'
  | 'BROWSER_SETTING_OUT_OF_RANGE'
  | 'BROWSER_TAB_NOT_FOUND'
  | 'BROWSER_BAD_MESSAGE'
  | 'BROWSER_BUSY'
  | 'BROWSER_PROFILE_NAME_TAKEN'
  | 'BROWSER_INSTANCE_PROTECTED'
  | 'BROWSER_INSTANCE_NOT_FOUND'
  // C34: the owner's own browser through the extension (TASK-125).
  | 'BROWSER_PAIRING_INVALID'
  | 'BROWSER_DEVICE_REVOKED'
  | 'BROWSER_DEVICE_NOT_FOUND'
  | 'BROWSER_APPROVAL_DENIED'
  | 'BROWSER_APPROVAL_TIMEOUT'
  | 'BROWSER_APPROVAL_EXPIRED';

/** Hard upper bound of `max_instances`. */
export const BROWSER_MAX_INSTANCES_LIMIT = 5;
/** Hard upper bound of `max_tabs`. */
export const BROWSER_MAX_TABS_LIMIT = 20;

/** Palette ids a browser profile may use (the project colour palette, TASK-124). */
export const BROWSER_PROFILE_COLORS = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
] as const;

/** Profile name length (trimmed), as the server checks it. */
export const BROWSER_PROFILE_NAME_MAX = 40;

/**
 * One browser profile = one instance with its own Chrome user-data dir (TASK-124).
 * `instances` lists the EXISTING profiles; instance 1 ("Main", the panel's default
 * with the owner's logins) always exists and cannot be deleted.
 */
export type BrowserInstanceSettings = {
  instance: number;
  /** 1..=40 chars, unique per user (case-insensitive). */
  name: string;
  /** Palette id ({@link BROWSER_PROFILE_COLORS}); absent = neutral. */
  color?: string;
  emoji?: string;
  /** "Hide that the browser is automated" (default false); applies at the next start. */
  hide_automation: boolean;
  /** The browser engine of the profile (C35); `camoufox` has a VNC live view instead of the CDP stream. */
  engine?: string;
};

/** Optional profile fields; `""` for `color`/`emoji` clears them, absent = unchanged. */
export type BrowserInstanceFields = {
  name?: string;
  color?: string;
  emoji?: string;
  hide_automation?: boolean;
};

/** A row of `PUT /api/browser/settings` `instances` (existing instances only). */
export type BrowserInstanceUpdate = BrowserInstanceFields & { instance: number };

/** `POST /api/browser/instances`: lowest free instance number; 409 BROWSER_INSTANCE_LIMIT when full. */
export type BrowserInstanceCreate = BrowserInstanceFields & { name: string };

/** `PATCH /api/browser/instances/{n}`. */
export type BrowserInstancePatch = BrowserInstanceFields;

/** `GET /api/browser/settings` and the answer of `PUT`. */
export type BrowserSettings = {
  /** "Agents can use the browser" (default true). */
  agents_enabled: boolean;
  /** Cap on the number of profiles, 1..=5 (default 3); never below the current count. */
  max_instances: number;
  /** 1..=20, default 10, per instance. */
  max_tabs: number;
  instances: BrowserInstanceSettings[];
  /**
   * "Agents may use my Mac browser" (C34, default false): agents reach the owner's
   * paired browsers only when this AND `agents_enabled` are on.
   */
  devices_agents_enabled: boolean;
};

/** `PUT /api/browser/settings`: only the given fields change; `instances` updates only the listed rows. */
export type BrowserSettingsUpdate = {
  agents_enabled?: boolean;
  devices_agents_enabled?: boolean;
  max_instances?: number;
  max_tabs?: number;
  instances?: BrowserInstanceUpdate[];
};

export type BrowserInstanceStatus = {
  instance: number;
  name: string;
  color?: string;
  emoji?: string;
  running: boolean;
  tabs: number;
  agent_active: boolean;
  /** The value the running instance was launched with (false when stopped). */
  hide_automation_active: boolean;
};

/** `GET /api/browser/status`, also the answer of `POST /api/browser/instances/{n}/clear|stop`. */
export type BrowserStatusResponse = {
  available: boolean;
  unavailable_reason?: BrowserErrorCode;
  chrome_version?: string;
  instances: BrowserInstanceStatus[];
  idle_timeout_secs: number;
};

/** JSON header of a binary frame: `[u32 BE meta_len][meta JSON][JPEG]`, CSS pixels. */
export type BrowserFrameMeta = {
  seq: number;
  tab_id: string;
  width: number;
  height: number;
  device_scale_factor: number;
  page_scale_factor: number;
  offset_top: number;
  scroll_x?: number;
  scroll_y?: number;
};

export type BrowserRunStatus = 'starting' | 'running' | 'stopped' | 'error';

export type BrowserTab = { id: string; url: string; title: string; active: boolean; loading: boolean };

export type BrowserState = {
  instance: number;
  max_tabs: number;
  status: BrowserRunStatus;
  error_code?: BrowserErrorCode;
  chrome_version?: string;
  tabs: BrowserTab[];
  can_go_back: boolean;
  can_go_forward: boolean;
  /** An agent sent CDP within the last few seconds ("agent is driving"). */
  agent_active: boolean;
  /** The tab an agent last acted on, so the panel can follow it. */
  agent_tab_id?: string;
};

export type BrowserDialogKind = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

export type BrowserDialog = { tab_id: string; kind: BrowserDialogKind; message: string; default_prompt?: string };

export type BrowserFileChooser = { tab_id: string; mode: 'single' | 'multiple' };

export type BrowserWsError = { code: BrowserErrorCode; message?: string };

export type BrowserServerMessage =
  | ({ type: 'state' } & BrowserState)
  | ({ type: 'dialog' } & BrowserDialog)
  | ({ type: 'file_chooser' } & BrowserFileChooser)
  | ({ type: 'error' } & BrowserWsError);

export type BrowserMouseInput = {
  event: 'move' | 'down' | 'up' | 'wheel';
  x: number;
  y: number;
  button: 'none' | 'left' | 'middle' | 'right';
  click_count: number;
  /** CDP bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
  modifiers: number;
  delta_x?: number;
  delta_y?: number;
};

export type BrowserKeyInput = {
  event: 'down' | 'up' | 'char';
  key: string;
  code: string;
  text?: string;
  /** `windowsVirtualKeyCode`. */
  key_code: number;
  modifiers: number;
};

export type BrowserClientMessage =
  | { type: 'start' }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'tab_new'; url?: string }
  | { type: 'tab_select'; id: string }
  | { type: 'tab_close'; id: string }
  | { type: 'resize'; width: number; height: number; device_scale_factor: number }
  | ({ type: 'mouse' } & BrowserMouseInput)
  | ({ type: 'key' } & BrowserKeyInput)
  | { type: 'insert_text'; text: string }
  | { type: 'dialog_reply'; tab_id: string; accept: boolean; prompt_text?: string }
  | { type: 'frame_ack'; seq: number };

// ---------------------------------------------------------------------------
// C34 (TASK-125): the owner's own browser through the AionUi extension.
// AionCore `aionui-api-types::browser` (BrowserPairingCode, BrowserDevice,
// BrowserApproval, BrowserApprovalResolved, BrowserDeviceActivity), snake_case.
// ---------------------------------------------------------------------------

/** `POST /api/browser/devices/pairing-code`: one-time, 5 minutes; a new code replaces the previous one. */
export type BrowserPairingCode = { code: string; /** Epoch ms. */ expires_at: number };

/** `GET /api/browser/devices` row (never the token). */
export type BrowserDevice = {
  device_id: string;
  name: string;
  browser: string;
  /** The extension build that last connected (TASK-133); absent for builds that predate it. */
  extension_version?: string;
  created_at: number;
  last_seen_at?: number;
  online: boolean;
  /** The extension's "agents may open new tabs" switch. */
  new_tabs: boolean;
  shared_tabs: number;
};

/** A paused agent action on a high-value origin, waiting for the owner. */
export type BrowserApproval = {
  approval_id: string;
  device_id: string;
  device_name: string;
  tab_id: number;
  origin: string;
  url: string;
  method: string;
  /** The method plus at most 120 characters of the expression / text. */
  summary: string;
  requested_at: number;
  expires_at: number;
};

/** `POST /api/browser/approvals/{approval_id}` body. */
export type BrowserApprovalDecision = { approve: boolean };

/** `browser.approvalResolved` event payload. */
export type BrowserApprovalResolved = { approval_id: string; approved: boolean };

export type BrowserActivityOutcome = 'ok' | 'refused' | 'paused' | 'approved' | 'denied' | 'timeout';

/** `GET /api/browser/devices/{device_id}/activity` row: method names only, never params or results. */
export type BrowserDeviceActivity = {
  at: number;
  conversation_id: string | null;
  tab_id: number;
  origin: string;
  method: string;
  outcome: BrowserActivityOutcome;
};

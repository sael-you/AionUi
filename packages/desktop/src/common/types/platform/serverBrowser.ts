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
  | 'BROWSER_BUSY';

/** Hard upper bound of `max_instances`. */
export const BROWSER_MAX_INSTANCES_LIMIT = 5;
/** Hard upper bound of `max_tabs`. */
export const BROWSER_MAX_TABS_LIMIT = 20;

/** Per instance; a change applies at the instance's next start. */
export type BrowserInstanceSettings = {
  instance: number;
  /** "Hide that the browser is automated" (default false). */
  hide_automation: boolean;
};

/** `GET /api/browser/settings` and the answer of `PUT`. */
export type BrowserSettings = {
  /** "Agents can use the browser" (default true). */
  agents_enabled: boolean;
  /** 1..=5, default 3. Instance 1 is the panel's, with the owner's logins. */
  max_instances: number;
  /** 1..=20, default 10, per instance. */
  max_tabs: number;
  instances: BrowserInstanceSettings[];
};

/** `PUT /api/browser/settings`: only the given fields change; `instances` updates only the listed rows. */
export type BrowserSettingsUpdate = {
  agents_enabled?: boolean;
  max_instances?: number;
  max_tabs?: number;
  instances?: BrowserInstanceSettings[];
};

export type BrowserInstanceStatus = {
  instance: number;
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

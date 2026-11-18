/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Devices (C38 W1, TASK-136): every device an agent can reach, as
 * AionCore's device registry reports it. The registry aggregates the existing
 * `/api/browser/*` data (server browsers, the owner's own browsers) and adds
 * phones, the Mac and add-ons. Ids are opaque. Times are epoch ms. Mirrors
 * AionCore `aionui-api-types/src/devices.rs` (wip/devices-core 0da493b3).
 */

export type DeviceKind = 'server_browser' | 'my_browser' | 'phone' | 'mac' | 'addon';

export type DeviceStatus = 'on' | 'off' | 'offline' | 'needs_pairing' | 'installing' | 'removing' | 'error';

/** How a phone is reached (C38 §1): via the paired Mac, the companion app, or Wi-Fi debugging from the server. */
export type DeviceRouteKind = 'mac_relay' | 'companion' | 'wifi_direct';

export type DeviceRoute = {
  route: DeviceRouteKind;
  enabled: boolean;
  status: DeviceStatus;
  /** Shown as "experimental — needs a test" (Wi-Fi direct until the owner's test passes). */
  experimental: boolean;
};

/** Phones and the Mac switch off by themselves after this many minutes. */
export const DEVICE_TIMEOUTS = [15, 30, 60] as const;
export type DeviceTimeout = (typeof DEVICE_TIMEOUTS)[number];

export type Device = {
  id: string;
  kind: DeviceKind;
  name: string;
  status: DeviceStatus;
  /** The agent switch. */
  enabled: boolean;
  /** Phones / Mac: when the switch turns itself off. */
  enabled_until: number | null;
  installed: boolean;
  disk_bytes: number | null;
  version: string | null;
  routes?: DeviceRoute[];
  /** Add-ons: the device that runs them (the Mac helper or the server). */
  addon_host?: string;
  /** The id behind the row: C34 device id, engine id, profile instance. */
  source_id: string | null;
  /** `later`: shown greyed in the Library until it can be installed (Camoufox, the Mac). */
  available: 'now' | 'later';
  /** The install / remove job while one runs. */
  job_id: string | null;
  last_seen_at: number | null;
  /** Phones: what the phone last reported about itself (TASK-173); absent when it never did. */
  health?: DeviceHealth;
  /** Phones and the Mac: how much agents may do without asking (TASK-175). */
  access?: DeviceAccess;
};

export type DeviceAccessMode = 'ask' | 'trusted' | 'full';

export type DeviceFullDuration = '1h' | '8h' | 'until_off';

export type DeviceAccess = {
  /** The EFFECTIVE mode: a Full access that ended reads `ask`. */
  mode: DeviceAccessMode;
  /** Full access ends then; null = until turned off (only meaningful when `mode` is `full`). */
  full_until: number | null;
  /** Banking and password-manager apps are covered too (otherwise they still ask). */
  include_sensitive: boolean;
  /** Package / bundle ids that no longer ask. */
  trusted_apps: string[];
};

export type DeviceHealth = {
  /** 0–100. */
  battery_percent?: number | null;
  charging?: boolean | null;
  /** The screen is locked: agents cannot act until it is unlocked. */
  locked: boolean;
  /** The companion app's accessibility service is on (needed to read and tap). */
  accessibility_on: boolean;
  android_version?: string | null;
  model?: string | null;
};

export type DeviceUpdate = { enabled: boolean; timeout_minutes?: DeviceTimeout };

export type DeviceJobState = 'queued' | 'running' | 'done' | 'failed';

export type DeviceJob = {
  job_id: string;
  device_id: string;
  state: DeviceJobState;
  /** 0–100. */
  progress: number;
  error: string | null;
};

export type DevicePairingKind = 'mac_helper' | 'companion' | 'wifi_direct';

export type DevicePairingCode = {
  code: string;
  expires_at: number;
  /** Companion app: a short-lived signed APK link (shown as a QR). */
  download_url: string | null;
  /** What the companion app scans to pair: `aionui-pair:v1?host=<host>&code=<CODE>`. */
  qr_payload: string | null;
};

export type DeviceApproval = {
  id: string;
  device_id: string;
  device_name: string;
  verb: string;
  summary: string;
  /** Add-on runs: the whole task the owner approves. */
  task: string | null;
  package: string | null;
  origin: string | null;
  conversation_id: string | null;
  created_at: number;
  expires_at: number;
  /** A banking / password-manager app: "always allow" still asks unless sensitive apps are included. */
  sensitive?: boolean;
  /** Allowing covers reads and actions on that device + app for this many minutes; absent on add-on tasks. */
  grant_minutes?: number;
};

export type DeviceApprovalDecision = 'allow' | 'deny';

export type DeviceAuditOutcome = 'ok' | 'refused' | 'approved' | 'denied' | 'timeout' | 'error';

export type DeviceAuditRow = {
  at: number;
  verb: string;
  package: string | null;
  origin: string | null;
  outcome: DeviceAuditOutcome;
  conversation_id: string | null;
  detail: string | null;
};

export type DeviceAuditPage = { rows: DeviceAuditRow[]; next_cursor: string | null };

export type DevicesChangedEvent = { device_id: string | null };

export type DeviceApprovalEvent = {
  approval: DeviceApproval;
  state: 'requested' | 'resolved';
  /** Resolved: allowed or denied. */
  approved?: boolean;
};

/** ApiResponse error codes of the device routes (core `DeviceErrorCode`). */
export type DeviceErrorCode =
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_PAIRING_INVALID'
  | 'DEVICE_REVOKED'
  | 'DEVICE_DISABLED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_VERB_REFUSED'
  | 'DEVICE_APPROVAL_DENIED'
  | 'DEVICE_APPROVAL_TIMEOUT'
  | 'DEVICE_APPROVAL_EXPIRED'
  | 'DEVICE_BAD_MESSAGE'
  | 'DEVICE_BUSY'
  | 'DEVICE_JOB_NOT_FOUND'
  | 'DEVICE_IN_USE'
  | 'DEVICE_ORIGIN_REFUSED';

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Devices (C38 §5, TASK-136): the pure parts — rail categories and
 * counts, which devices sit on the Active and the Library tab, status tones
 * and sizes.
 */

import type { Device, DeviceKind, DeviceStatus } from '@/common/types/platform/devices';

/** Rail order (C38 §5). */
export const DEVICE_CATEGORIES: readonly DeviceKind[] = ['server_browser', 'my_browser', 'phone', 'addon', 'mac'];

export type DevicesTab = 'active' | 'library';

/**
 * Active = installed, available and paired: what agents can be given. My
 * browsers and phones count once paired (`needs_pairing` stays in the Library).
 */
export const isActiveDevice = (device: Device): boolean =>
  device.installed && device.available === 'now' && device.status !== 'needs_pairing';

/** Devices of one category on one tab; Library shows everything of the category (installable or installed). */
export const devicesOn = (devices: readonly Device[], kind: DeviceKind, tab: DevicesTab): Device[] =>
  devices.filter((device) => device.kind === kind && (tab === 'library' || isActiveDevice(device)));

/** Rail counts for a tab. */
export const categoryCounts = (devices: readonly Device[], tab: DevicesTab): Record<DeviceKind, number> => {
  const counts: Record<DeviceKind, number> = { server_browser: 0, my_browser: 0, phone: 0, addon: 0, mac: 0 };
  for (const device of devices) {
    if (tab === 'library' || isActiveDevice(device)) counts[device.kind] += 1;
  }
  return counts;
};

/** Arco tag colour per status (colour is never the only signal: the word is always shown). */
export const STATUS_COLORS: Record<DeviceStatus, string> = {
  on: 'green',
  off: 'gray',
  offline: 'orange',
  needs_pairing: 'arcoblue',
  installing: 'arcoblue',
  removing: 'arcoblue',
  error: 'red',
};

/** True while an install / remove job runs for the device. */
export const isBusy = (device: Device): boolean => device.status === 'installing' || device.status === 'removing';

/** Phones and the Mac pick a timeout when they are switched on (C38 §3). */
export const takesTimeout = (device: Device): boolean => device.kind === 'phone' || device.kind === 'mac';

/** "312 MB", "1.4 GB" (base 1000, like Finder and Android). */
export const formatDiskSize = (bytes: number, locale: string): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
};

/** Minutes left until the switch turns itself off (rounded up), or null. */
export const minutesLeft = (enabledUntil: number | null, now: number): number | null =>
  enabledUntil === null ? null : Math.max(0, Math.ceil((enabledUntil - now) / 60_000));

/** Add-ons we describe (C38 §5); others show the generic add-on text. */
export const KNOWN_ADDONS = ['artemis', 'mobilerun'] as const;
export type KnownAddon = (typeof KNOWN_ADDONS)[number];

/** Which known add-on a registry row is, by its source id or name. */
export const knownAddon = (device: Device): KnownAddon | null => {
  if (device.kind !== 'addon') return null;
  const haystack = `${device.source_id ?? ''} ${device.name}`.toLowerCase();
  return KNOWN_ADDONS.find((name) => haystack.includes(name)) ?? null;
};

/** i18n key of the one-line description on a card, or null. */
export const descriptionKey = (device: Device): string | null => {
  if (device.kind === 'addon') return `settings.devices.addons.${knownAddon(device) ?? 'generic'}.desc`;
  if (device.kind === 'mac') return 'settings.devices.mac.desc';
  return null;
};

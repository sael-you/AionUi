/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fingerprints of MCP env secrets the UI last sent (train-2 review, C15 #1).
 *
 * AionCore returns secret env values masked, so the UI cannot compare a stored
 * secret with the current one. It keeps a SHA-256 fingerprint of the secrets
 * it last PUT for a server instead (localStorage, keyed by server id): same
 * fingerprint → unchanged; different or missing → send once and remember.
 * The secret itself is never stored.
 */

const STORAGE_PREFIX = 'aionui.mcpSecretFingerprint.';

/**
 * SHA-256 (hex) over the given `[key, value]` pairs, order-independent;
 * `null` when Web Crypto is unavailable (insecure http context).
 */
export async function fingerprintSecrets(entries: Array<[string, string]>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const sorted = [...entries].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sorted)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readSecretFingerprint(serverId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + serverId);
  } catch {
    return null;
  }
}

export function writeSecretFingerprint(serverId: string, fingerprint: string | null): void {
  try {
    if (fingerprint) window.localStorage.setItem(STORAGE_PREFIX + serverId, fingerprint);
    else window.localStorage.removeItem(STORAGE_PREFIX + serverId);
  } catch {
    // Storage unavailable (private mode, quota): the next sync sends once more.
  }
}

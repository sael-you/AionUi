/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser platform hooks used while voice mode is armed (plan §3.8, S0-C):
 * Screen Wake Lock (re-acquired when the page is visible again), Media
 * Session controls, haptics, and a stable per-browser device id.
 *
 * Media Session: the S0 phone test could not confirm that a silent keep-alive
 * `<audio>` leaves other apps' audio (navigation, music) alone, so the plan's
 * fallback is used — controls are registered only while a call plays through
 * the remote `<audio>` element.
 */

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  /** Last outcome, shown as "screen may sleep" when refused. */
  refused = false;

  constructor(private readonly nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator) {}

  async acquire(): Promise<boolean> {
    this.wanted = true;
    const wakeLock = (this.nav as (Navigator & { wakeLock?: WakeLockLike }) | undefined)?.wakeLock;
    if (!wakeLock || this.sentinel) {
      this.refused = !wakeLock;
      return Boolean(this.sentinel);
    }
    try {
      const sentinel = await wakeLock.request('screen');
      if (!this.wanted) {
        void sentinel.release().catch((): undefined => undefined);
        return false;
      }
      this.sentinel = sentinel;
      this.refused = false;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      return true;
    } catch {
      this.refused = true;
      return false;
    }
  }

  /** Call on `visibilitychange` → visible: the lock is dropped whenever the page hides. */
  reacquireIfWanted(): void {
    if (this.wanted && !this.sentinel) void this.acquire();
  }

  release(): void {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (s) void s.release().catch((): undefined => undefined);
  }
}

export type MediaControls = { hangup(): void; toggleMic(): void; stop(): void };

/** Register Media Session handlers for a live call; returns an unregister function. */
export function registerMediaSession(title: string, controls: MediaControls): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return (): void => undefined;
  const session = navigator.mediaSession;
  const actions: Array<[string, () => void]> = [
    ['hangup', controls.hangup],
    ['togglemicrophone', controls.toggleMic],
    ['stop', controls.stop],
    ['pause', controls.hangup],
  ];
  try {
    session.metadata = new MediaMetadata({ title });
  } catch {
    // MediaMetadata unsupported
  }
  const registered: string[] = [];
  for (const [action, handler] of actions) {
    try {
      session.setActionHandler(action as MediaSessionAction, handler);
      registered.push(action);
    } catch {
      // action unsupported on this browser
    }
  }
  return () => {
    for (const action of registered) {
      try {
        session.setActionHandler(action as MediaSessionAction, null);
      } catch {
        // ignore
      }
    }
    try {
      session.metadata = null;
    } catch {
      // ignore
    }
  };
}

/** Short haptic pulse on Android (no-op elsewhere). */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

const DEVICE_ID_KEY = 'aionui.voice.deviceId';

/** Stable random id of this browser (voice "device" for hello/sessions). */
export function getVoiceDeviceId(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage
): string {
  try {
    const existing = storage?.getItem(DEVICE_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const id = `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    storage?.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'web-ephemeral';
  }
}

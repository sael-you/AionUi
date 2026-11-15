/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configurable arm shortcut (plan §1: default `Alt+J`; `Ctrl+J` is Chrome's
 * Downloads). Stored per browser; matching uses `KeyboardEvent.code` so
 * `Alt+J` still matches on macOS where Option+J types "∆".
 */

export const DEFAULT_VOICE_SHORTCUT = 'Alt+J';
const STORAGE_KEY = 'aionui.voice.shortcut';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

export type ParsedShortcut = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string };

export function parseShortcut(text: string): ParsedShortcut | null {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key || MODIFIERS.includes(key as (typeof MODIFIERS)[number])) return null;
  const mods = new Set(parts);
  if (![...mods].every((m) => MODIFIERS.includes(m as (typeof MODIFIERS)[number]))) return null;
  // A bare key would fire while typing; require at least one modifier.
  if (mods.size === 0 || (mods.size === 1 && mods.has('Shift'))) return null;
  return {
    ctrl: mods.has('Ctrl'),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    meta: mods.has('Meta'),
    key: key.toUpperCase(),
  };
}

/** Key name from `KeyboardEvent.code` ("KeyJ" → "J", "Digit1" → "1", "F5" → "F5"). */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'Space') return 'SPACE';
  return null;
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'code'>,
  shortcut: string
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta &&
    keyFromCode(event.code) === parsed.key
  );
}

/** Format a keydown as a shortcut string, or null for modifier-only / unsupported keys. */
export function shortcutFromEvent(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'code'>
): string | null {
  const key = keyFromCode(event.code);
  if (!key) return null;
  const mods = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
  ].filter(Boolean) as string[];
  const text = [...mods, key === 'SPACE' ? 'Space' : key].join('+');
  return parseShortcut(text) ? text : null;
}

export function loadVoiceShortcut(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage
): string {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value && parseShortcut(value) ? value : DEFAULT_VOICE_SHORTCUT;
  } catch {
    return DEFAULT_VOICE_SHORTCUT;
  }
}

export function saveVoiceShortcut(
  value: string,
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage
): void {
  try {
    storage?.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent(VOICE_SHORTCUT_CHANGED_EVENT, { detail: value }));
  } catch {
    // storage unavailable
  }
}

export const VOICE_SHORTCUT_CHANGED_EVENT = 'aionui:voice-shortcut-changed';

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_SHORTCUT,
  loadVoiceShortcut,
  matchesShortcut,
  parseShortcut,
  shortcutFromEvent,
} from '@/renderer/voice/core/shortcut';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

const memoryStorage = (value: string | null) =>
  ({ getItem: () => value, setItem: () => undefined }) as unknown as Storage;

describe('voice shortcut', () => {
  it('defaults to Alt+J and matches it by physical key (macOS Option+J types ∆)', () => {
    expect(DEFAULT_VOICE_SHORTCUT).toBe('Alt+J');
    expect(matchesShortcut(key('KeyJ', { altKey: true }), 'Alt+J')).toBe(true);
  });

  it('does not match extra or missing modifiers', () => {
    expect(matchesShortcut(key('KeyJ', { altKey: true, ctrlKey: true }), 'Alt+J')).toBe(false);
    expect(matchesShortcut(key('KeyJ'), 'Alt+J')).toBe(false);
  });

  it('refuses bare keys and Shift-only combos (they fire while typing)', () => {
    expect(parseShortcut('J')).toBeNull();
    expect(parseShortcut('Shift+J')).toBeNull();
    expect(parseShortcut('Alt+Hyper+J')).toBeNull();
  });

  it('records a combo from a keydown and ignores modifier-only presses', () => {
    expect(shortcutFromEvent(key('KeyK', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K');
    expect(shortcutFromEvent(key('AltLeft', { altKey: true }))).toBeNull();
  });

  it('falls back to the default for invalid stored values', () => {
    expect(loadVoiceShortcut(memoryStorage('nonsense'))).toBe('Alt+J');
    expect(loadVoiceShortcut(memoryStorage('Ctrl+Alt+V'))).toBe('Ctrl+Alt+V');
  });
});

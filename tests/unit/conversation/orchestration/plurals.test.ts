/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import deDE from '@/renderer/services/i18n/locales/de-DE/index';
import enUS from '@/renderer/services/i18n/locales/en-US/index';
import ruRU from '@/renderer/services/i18n/locales/ru-RU/index';

/** FIXES 5: count strings use _one / _other (and _few / _many where a language needs them). */
describe('C21 count strings are pluralized', () => {
  const instance = i18n.createInstance();
  void instance.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    resources: {
      'en-US': { translation: enUS as Record<string, unknown> },
      'de-DE': { translation: deDE as Record<string, unknown> },
      'ru-RU': { translation: ruRU as Record<string, unknown> },
    },
    interpolation: { escapeValue: false },
  });
  const t = (lng: string, key: string, count: number) =>
    instance.t(`conversation.orchestration.${key}`, { lng, count }) as string;

  it('English says "1 step" and "2 steps", never "1 steps" or "task(s)"', () => {
    expect(t('en-US', 'activity.steps', 1)).toBe('1 step');
    expect(t('en-US', 'activity.steps', 14)).toBe('14 steps');
    expect(t('en-US', 'needsYou.running', 1)).toBe('1 conversation running');
    expect(t('en-US', 'card.finishedHidden', 1)).toBe('1 finished task hidden ·');
    expect(t('en-US', 'card.finishedHidden', 3)).toBe('3 finished tasks hidden ·');
    expect(t('en-US', 'activity.waitingOnBackground', 1)).toBe('waiting on 1 background task');
  });

  it('German and Russian resolve their own plural forms', () => {
    expect(t('de-DE', 'activity.thoughts', 1)).toBe('1 Gedanke');
    expect(t('de-DE', 'activity.thoughts', 3)).toBe('3 Gedanken');
    expect(t('ru-RU', 'activity.steps', 3)).toBe('шагов: 3');
    expect(t('ru-RU', 'activity.steps', 5)).toBe('шагов: 5');
  });
});

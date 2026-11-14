/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `board` module ships real translations in every locale (SPEC §8): same
 * keys and placeholders as en-US, every plural form the language needs, and no
 * value left identical to English except words that genuinely are the same.
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import i18nConfig from '@/common/config/i18n-config.json';

const LOCALES_DIR = path.resolve(__dirname, '../../../../../packages/desktop/src/renderer/services/i18n/locales');

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') acc[full] = value;
    else Object.assign(acc, flatten(value, full));
    return acc;
  }, {});

const load = (lang: string): Record<string, string> =>
  flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, lang, 'board.json'), 'utf-8')) as Tree);

const placeholders = (value: string): string[] => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

/**
 * Values allowed to equal en-US: the word is the same in that language (checked
 * against the locale's existing modules), not an untranslated leftover.
 */
const SAME_AS_ENGLISH: Record<string, ReadonlySet<string>> = {
  'de-DE': new Set(['filters.skill', 'departments.marketing', 'assign.team', 'conversations.status']),
  'es-ES': new Set(['type.idea', 'columns.ideas', 'departments.marketing']),
  'fr-FR': new Set([
    'type.label',
    'drawer.description',
    'departments.marketing',
    'assign.assistant',
    'questions.title',
    'conversations.title',
    'conversations.untitled',
  ]),
  'pt-BR': new Set(['departments.marketing']),
};

/** A value with no words of its own (only placeholders and symbols) needs no translation. */
const hasWords = (value: string): boolean => /\p{L}/u.test(value.replace(/{{\s*\w+\s*}}/g, ''));

const PLURAL_FORMS: Record<string, string[]> = {
  'ru-RU': ['one', 'few', 'many', 'other'],
  'uk-UA': ['one', 'few', 'many', 'other'],
  'fr-FR': ['one', 'many', 'other'],
  'es-ES': ['one', 'many', 'other'],
  'pt-BR': ['one', 'many', 'other'],
};

const reference = load('en-US');
const pluralBases = Object.keys(reference)
  .filter((key) => key.endsWith('_one'))
  .map((key) => key.slice(0, -'_one'.length));
const locales = i18nConfig.supportedLanguages.filter((lang) => lang !== 'en-US');

describe('board locale module', () => {
  it('is registered in i18n-config.json', () => {
    expect(i18nConfig.modules).toContain('board');
  });

  it.each(locales)('%s has every en-US key with the same placeholders', (lang) => {
    const values = load(lang);
    for (const [key, english] of Object.entries(reference)) {
      expect(values[key], `${lang}: missing ${key}`).toBeTypeOf('string');
      expect(values[key].trim(), `${lang}: empty ${key}`).not.toBe('');
      expect(placeholders(values[key]), `${lang}: placeholders of ${key}`).toEqual(placeholders(english));
    }
  });

  it.each(locales)('%s translates every value (no English left behind)', (lang) => {
    const values = load(lang);
    const allowed = SAME_AS_ENGLISH[lang] ?? new Set<string>();
    const untranslated = Object.entries(reference)
      .filter(([key, english]) => values[key] === english && hasWords(english) && !allowed.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it.each(locales)('%s has the plural forms its language needs', (lang) => {
    const values = load(lang);
    const forms = PLURAL_FORMS[lang] ?? ['one', 'other'];
    for (const base of pluralBases) {
      for (const form of forms) {
        expect(values[`${base}_${form}`], `${lang}: ${base}_${form}`).toBeTypeOf('string');
      }
    }
  });

  it('every locale index registers the module', () => {
    for (const lang of i18nConfig.supportedLanguages) {
      const index = fs.readFileSync(path.join(LOCALES_DIR, lang, 'index.ts'), 'utf-8');
      expect(index, lang).toContain("import board from './board.json';");
      expect(index, lang).toMatch(/\n\s+board,\n/);
    }
  });
});

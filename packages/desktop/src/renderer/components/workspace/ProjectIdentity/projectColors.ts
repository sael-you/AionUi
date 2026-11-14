/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project colour palette, shared by the sidebar and every project surface
 * (conversation header, send box, file panel, team page, mobile titlebar).
 *
 * Twelve hues with one accent per theme, chosen at a matching visual weight
 * (light theme: 600 shades, dark theme: 400 shades) so every project reads with
 * the same emphasis and stays legible on the app background. Colour is never
 * the only cue: project names and folder icons remain, the colour only groups.
 * The derived per-surface tokens live in `projectTheme.ts`.
 */

export type ProjectColorId =
  | 'red'
  | 'orange'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'slate';

export type ProjectColor = { id: ProjectColorId; light: string; dark: string };

export const PROJECT_COLORS: readonly ProjectColor[] = [
  { id: 'red', light: '#dc2626', dark: '#f87171' },
  { id: 'orange', light: '#ea580c', dark: '#fb923c' },
  { id: 'amber', light: '#d97706', dark: '#fbbf24' },
  { id: 'lime', light: '#65a30d', dark: '#a3e635' },
  { id: 'green', light: '#16a34a', dark: '#4ade80' },
  { id: 'teal', light: '#0d9488', dark: '#2dd4bf' },
  { id: 'cyan', light: '#0891b2', dark: '#22d3ee' },
  { id: 'blue', light: '#2563eb', dark: '#60a5fa' },
  { id: 'indigo', light: '#4f46e5', dark: '#818cf8' },
  { id: 'violet', light: '#7c3aed', dark: '#a78bfa' },
  { id: 'pink', light: '#db2777', dark: '#f472b6' },
  { id: 'slate', light: '#475569', dark: '#94a3b8' },
];

const BY_ID = new Map<string, ProjectColor>(PROJECT_COLORS.map((c) => [c.id, c]));

export const isProjectColorId = (value: unknown): value is ProjectColorId =>
  typeof value === 'string' && BY_ID.has(value);

/** FNV-1a 32-bit: stable across sessions and devices, so a project keeps its colour everywhere. */
const hash = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** The automatic colour of a workspace (used when the user has not chosen one). */
export const autoProjectColorId = (workspace: string): ProjectColorId =>
  PROJECT_COLORS[hash(workspace) % PROJECT_COLORS.length].id;

/** The user's choice when valid, otherwise the automatic colour. */
export const resolveProjectColor = (workspace: string, overrides: Record<string, string> = {}): ProjectColor => {
  const chosen = overrides[workspace];
  if (isProjectColorId(chosen)) return BY_ID.get(chosen)!;
  return BY_ID.get(autoProjectColorId(workspace))!;
};

/** Accent for the active theme. */
export const projectAccent = (color: ProjectColor, theme: 'light' | 'dark'): string =>
  theme === 'dark' ? color.dark : color.light;

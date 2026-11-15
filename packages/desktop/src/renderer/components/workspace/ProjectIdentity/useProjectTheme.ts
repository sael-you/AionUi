/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThemeAppearance } from '@/common/theme/types';
import { useThemeAppearance } from '@/renderer/hooks/context/ThemeContext';
import { getWorkspaceDisplayName, normalizeWorkspace } from '@/renderer/utils/workspace/workspace';
import type { CSSProperties } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
import { resolveProjectColor, type ProjectColorId } from './projectColors';
import { buildProjectTheme, projectThemeStyle, type ProjectThemeTokens } from './projectTheme';
import { useThemeSurfaces } from './themeSurfaces';
import { useProjectColors } from './useProjectColors';

const MORE_CONTRAST_QUERY = '(prefers-contrast: more)';

const contrastQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MORE_CONTRAST_QUERY)
    : null;

const subscribeContrast = (onChange: () => void) => {
  const mql = contrastQuery();
  if (!mql) return () => {};
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

const getPrefersMoreContrast = () => contrastQuery()?.matches ?? false;

/** Whether the OS asks for more contrast (`prefers-contrast: more`). */
export const usePrefersMoreContrast = (): boolean =>
  useSyncExternalStore(subscribeContrast, getPrefersMoreContrast, getPrefersMoreContrast);

export type ProjectThemeView = {
  /** Normalised workspace path (the colour key). */
  workspace: string;
  /** Folder name, as the sidebar shows it. */
  name: string;
  colorId: ProjectColorId;
  appearance: ThemeAppearance;
  tokens: ProjectThemeTokens;
  /** `--project-*` custom properties for the surface root. */
  style: CSSProperties;
  /** Data attributes for the surface root (styling hooks + verification). */
  dataAttributes: { 'data-project-color': ProjectColorId; 'data-project-appearance': ThemeAppearance };
};

/**
 * The project colour of a workspace (user choice or automatic) as theme tokens
 * for the active light/dark theme and contrast preference. `null` when there is
 * no project workspace, so callers render their neutral look.
 */
export const useProjectTheme = (workspace: string | null | undefined): ProjectThemeView | null => {
  const { overrides } = useProjectColors();
  const appearance = useThemeAppearance();
  const highContrast = usePrefersMoreContrast();
  const surfaces = useThemeSurfaces(appearance);
  return useMemo(() => {
    const key = workspace ? normalizeWorkspace(workspace) : '';
    if (!key) return null;
    const color = resolveProjectColor(key, overrides);
    const tokens = buildProjectTheme(color, appearance, { highContrast, surfaces });
    return {
      workspace: key,
      name: getWorkspaceDisplayName(key, false),
      colorId: color.id,
      appearance,
      tokens,
      style: projectThemeStyle(tokens),
      dataAttributes: { 'data-project-color': color.id, 'data-project-appearance': appearance },
    };
  }, [workspace, overrides, appearance, highContrast, surfaces]);
};

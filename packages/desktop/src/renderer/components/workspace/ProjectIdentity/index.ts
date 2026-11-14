/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project colour identity: the 12-hue palette, the per-theme tokens derived from
 * it, the user's colour choices (backend client preference), the current
 * project of the route, and the shared chip / strip visuals.
 */

export {
  PROJECT_COLORS,
  autoProjectColorId,
  isProjectColorId,
  projectAccent,
  resolveProjectColor,
  type ProjectColor,
  type ProjectColorId,
} from './projectColors';
export { buildProjectTheme, contrastRatio, projectThemeStyle, type ProjectThemeTokens } from './projectTheme';
export { useProjectColors } from './useProjectColors';
export { useProjectTheme, type ProjectThemeView } from './useProjectTheme';
export {
  projectIdentityOf,
  projectIdentityOfConversation,
  setCurrentProjectIdentity,
  useCurrentProjectIdentity,
  type ProjectIdentity,
} from './currentProjectIdentityStore';
export { ProjectChip, ProjectLabel, projectSurfaceClasses } from './ProjectChip';

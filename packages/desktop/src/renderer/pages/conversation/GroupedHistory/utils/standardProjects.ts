/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SidebarResponse } from '@/common/types/sidebar';
import { normalizeWorkspace } from '@/renderer/utils/workspace/workspace';

/** A standard (user-chosen folder) project known to the backend, even with no visible conversation. */
export type StandardProject = { workspace: string; name: string; project_id?: string };

/** `file:///root/projects/x` → `/root/projects/x`; plain paths pass through; anything else → null. */
export const workspaceFromUri = (uri: string | null | undefined): string | null => {
  if (!uri) return null;
  if (uri.startsWith('file://')) {
    try {
      const url = new URL(uri);
      // Only local files: a host (file://server/share) is not a path on this machine.
      if (url.hostname !== '' && url.hostname !== 'localhost') return null;
      let path = decodeURIComponent(url.pathname);
      // Windows: file:///C:/x has the pathname /C:/x.
      if (/^\/[A-Za-z]:(\/|$)/.test(path)) path = path.slice(1);
      return path ? normalizeWorkspace(path) : null;
    } catch {
      return null;
    }
  }
  return uri.startsWith('/') || /^[A-Za-z]:[\\/]/.test(uri) ? normalizeWorkspace(uri) : null;
};

/**
 * Standard projects from the backend sidebar read model (`GET /api/sidebar`).
 * The backend surfaces every standard project in the active slice even with zero
 * conversations, so this is the list of projects the sidebar should always show.
 */
export const standardProjectsFromSidebar = (response: SidebarResponse | null | undefined): StandardProject[] => {
  if (response?.has_more_groups) {
    // The read model caps the project area (100 groups); projects past the cap are not listed here.
    console.warn('[sidebar] more projects than the sidebar read model returns; some empty projects may be hidden');
  }
  const seen = new Set<string>();
  const projects: StandardProject[] = [];
  for (const group of response?.groups ?? []) {
    const scope = group.scope;
    if (scope.type !== 'project') continue;
    const workspace = workspaceFromUri(scope.workspace);
    if (!workspace || seen.has(workspace)) continue;
    seen.add(workspace);
    projects.push({ workspace, name: scope.name, project_id: scope.project_id });
  }
  return projects;
};

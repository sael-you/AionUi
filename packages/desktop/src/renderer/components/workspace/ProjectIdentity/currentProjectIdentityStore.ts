/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Module-level store of the project shown by the current route, for the
 * surfaces that live above the route subtree (sidebar, mobile titlebar,
 * Layout-level file panel). Published by the conversation and team routes next
 * to `setCurrentProject`, cleared by Layout when leaving both routes.
 *
 * `workspace` is the normalised workspace path, the project colour key (the
 * same key the sidebar groups by). `projectId` lets project-id-keyed surfaces
 * (the file panel) check the identity belongs to the project they show.
 */

import { useSyncExternalStore } from 'react';
import type { TChatConversation } from '@/common/config/storage';
import { normalizeWorkspace } from '@/renderer/utils/workspace/workspace';

export type ProjectIdentity = { projectId: string | null; workspace: string };

let current: ProjectIdentity | null = null;
const listeners = new Set<() => void>();

/** Project identity of a workspace, or `null` for none (temporary / no workspace). */
export const projectIdentityOf = (
  workspace: string | null | undefined,
  projectId: string | null | undefined
): ProjectIdentity | null => {
  const normalized = workspace ? normalizeWorkspace(workspace) : '';
  return normalized ? { projectId: projectId ?? null, workspace: normalized } : null;
};

/**
 * A conversation belongs to a project when its workspace was chosen by the user
 * (`extra.custom_workspace`) — the same rule the sidebar uses to put it in a
 * project folder.
 */
export const projectIdentityOfConversation = (
  conversation: Pick<TChatConversation, 'extra' | 'project_id'> | null | undefined
): ProjectIdentity | null => {
  const extra = conversation?.extra as { workspace?: string; custom_workspace?: boolean } | undefined;
  if (!extra?.custom_workspace) return null;
  return projectIdentityOf(extra.workspace, conversation?.project_id);
};

/** Publish the current project identity (no-op when unchanged). */
export const setCurrentProjectIdentity = (next: ProjectIdentity | null): void => {
  if (current?.projectId === next?.projectId && current?.workspace === next?.workspace) return;
  current = next;
  for (const listener of listeners) listener();
};

export const getCurrentProjectIdentity = (): ProjectIdentity | null => current;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Subscribe a component to the current project identity. */
export const useCurrentProjectIdentity = (): ProjectIdentity | null =>
  useSyncExternalStore(subscribe, getCurrentProjectIdentity, getCurrentProjectIdentity);

/** Test hook: reset module state. */
export const resetCurrentProjectIdentityForTest = (): void => {
  current = null;
  listeners.clear();
};

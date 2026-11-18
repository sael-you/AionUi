/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The project the settings were opened from (C33): an explicit `?project=`
 * wins (passed in, or read from the route itself: the project page's "Manage"
 * links, C42); otherwise the project of the conversation of the last
 * non-settings route (kept by the titlebar in sessionStorage). Null = Global.
 */

import useSWR from 'swr';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

const LAST_PATH_KEY = 'aion:last-non-settings-path';

/** The conversation id in an app route (`/conversation/<id>…`), else null. */
export const conversationIdOfPath = (path: string | null | undefined): string | null => {
  const match = /^\/conversation\/([^/?#]+)/.exec(path ?? '');
  return match ? decodeURIComponent(match[1]) : null;
};

const readLastPath = (): string | null => {
  try {
    return sessionStorage.getItem(LAST_PATH_KEY);
  } catch {
    return null;
  }
};

/** `?project=<id>` of a hash route (`#/settings/rules?project=p1`), else null. */
export const projectIdOfHash = (hash: string | null | undefined): string | null => {
  const query = (hash ?? '').split('?')[1];
  return query ? new URLSearchParams(query).get('project') || null : null;
};

const readRouteProject = (): string | null =>
  typeof window === 'undefined' ? null : projectIdOfHash(window.location.hash);

export const useOriginProjectId = (explicitProject: string | null): string | null => {
  const explicit = explicitProject ?? readRouteProject();
  const conversationId = explicit ? null : conversationIdOfPath(readLastPath());
  const { data } = useSWR(conversationId ? `conversation/${conversationId}` : null, () =>
    getConversationOrNull(conversationId ?? '')
  );
  return explicit ?? data?.project_id ?? null;
};

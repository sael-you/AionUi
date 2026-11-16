/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The project the settings were opened from (C33): an explicit `?project=`
 * wins; otherwise the project of the conversation of the last non-settings
 * route (kept by the titlebar in sessionStorage). Null = Global.
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

export const useOriginProjectId = (explicit: string | null): string | null => {
  const conversationId = explicit ? null : conversationIdOfPath(readLastPath());
  const { data } = useSWR(conversationId ? `conversation/${conversationId}` : null, () =>
    getConversationOrNull(conversationId ?? '')
  );
  return explicit ?? data?.project_id ?? null;
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sidebar name filter (the filter field above the list, Ctrl/Cmd+K). Pure, so
 * the matching rules are testable on their own:
 * - matching is case-insensitive and ignores surrounding spaces;
 * - a conversation is kept when its name, or the name of one of its
 *   sub-conversations, matches;
 * - a project whose name matches keeps all its conversations; otherwise it is
 *   kept with only its matching conversations, and dropped when none match.
 */

import type { TChatConversation } from '@/common/config/storage';

/** The query as compared: trimmed and lower-cased (`''` = no filter). */
export const normalizeSidebarQuery = (query: string | undefined): string => (query ?? '').trim().toLocaleLowerCase();

/** Whether `text` matches a normalised query (everything matches no query). */
export const matchesSidebarQuery = (text: string | undefined, normalizedQuery: string): boolean =>
  normalizedQuery === '' || (text ?? '').toLocaleLowerCase().includes(normalizedQuery);

/** Whether a root conversation, or one of its descendants, matches. */
export const conversationMatchesQuery = (
  conversation: TChatConversation,
  descendants: readonly TChatConversation[] | undefined,
  normalizedQuery: string
): boolean =>
  matchesSidebarQuery(conversation.name, normalizedQuery) ||
  (descendants ?? []).some((child) => matchesSidebarQuery(child.name, normalizedQuery));

/** Keep the conversations that match (no query keeps the list as is). */
export const filterConversations = (
  conversations: readonly TChatConversation[],
  normalizedQuery: string,
  descendantsOf: (conversationId: string) => readonly TChatConversation[] | undefined
): TChatConversation[] =>
  normalizedQuery === ''
    ? [...conversations]
    : conversations.filter((conversation) =>
        conversationMatchesQuery(conversation, descendantsOf(conversation.id), normalizedQuery)
      );

export type FilterableProjectGroup = {
  displayName: string;
  conversations: TChatConversation[];
};

/** A project as shown for the query, or `null` when nothing in it matches. */
export const filterProjectGroup = <G extends FilterableProjectGroup>(
  group: G,
  normalizedQuery: string,
  descendantsOf: (conversationId: string) => readonly TChatConversation[] | undefined
): G | null => {
  if (normalizedQuery === '' || matchesSidebarQuery(group.displayName, normalizedQuery)) return group;
  const conversations = filterConversations(group.conversations, normalizedQuery, descendantsOf);
  return conversations.length > 0 ? { ...group, conversations } : null;
};

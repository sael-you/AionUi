/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ReactNode } from 'react';
import type { RunState } from '@/renderer/pages/conversation/components/orchestration/runState';
import type { ConversationTreeRollup } from './utils/conversationTree';

export type WorkspaceGroup = {
  workspace: string;
  display_name: string;
  conversations: TChatConversation[];
  /** Backend project id, known for projects listed by the backend (e.g. empty ones). */
  project_id?: string;
};

export type TimelineItem = {
  type: 'workspace' | 'conversation';
  time: number;
  workspaceGroup?: WorkspaceGroup;
  conversation?: TChatConversation;
};

export type TimelineSection = {
  timeline: string;
  items: TimelineItem[];
};

export type GroupedHistoryResult = {
  pinnedConversations: TChatConversation[];
  timelineSections: TimelineSection[];
  /** Hierarchy: flat descendants (all levels) keyed by their root conversation id. */
  descendantsByRoot: Map<string, TChatConversation[]>;
};

export type ExportZipFile = {
  name: string;
  content?: string;
  sourcePath?: string;
};

export type ExportTask =
  | { mode: 'single'; conversation: TChatConversation }
  | { mode: 'batch'; conversation_ids: string[] }
  | null;

/** Hierarchy info for a row that has sub-conversations. */
export type ConversationRowTreeInfo = {
  expanded: boolean;
  /** Direct children count (shown on the collapsed rollup badge). */
  childCount: number;
  /** Aggregated status over all descendants. */
  rollup: ConversationTreeRollup;
  onToggle: () => void;
};

/**
 * Tree connectors of a nested row (C21): drawn only for real parent → child
 * relations, through the parent node's centre.
 */
/** 1-based position of a tree item among its siblings. */
export type TreeItemPosition = { posinset: number; setsize: number };

export type ConversationRowGuides = {
  /** Per ancestor level 1..depth-1: that ancestor has a later sibling, so its line continues past this row. */
  continues: boolean[];
  /** A later sibling follows this row at the same depth. */
  hasNextSibling: boolean;
  /** The row's own children are shown below it. */
  showsChildren: boolean;
};

export type ConversationRowProps = {
  conversation: TChatConversation;
  isGenerating: boolean;
  /** The agent is blocked awaiting the user (tool permission or a question).
   *  Takes display precedence over `isGenerating` — a distinct "needs you" icon
   *  replaces the generating spinner. */
  isWaitingConfirmation: boolean;
  hasUnread: boolean;
  /**
   * The row's state in the one status language (C21). When not `idle` the
   * status glyph takes the node slot; idle rows show the agent mark.
   * Defaults to waiting / running from the two flags above.
   */
  runState?: RunState;
  /** Whether the user manually marked this conversation as unread (persisted). */
  isManualUnread: boolean;
  collapsed: boolean;
  tooltipEnabled: boolean;
  batchMode: boolean;
  checked: boolean;
  selected: boolean;
  menuVisible: boolean;
  onToggleChecked: (conversation: TChatConversation) => void;
  onConversationClick: (conversation: TChatConversation) => void;
  onOpenMenu: (conversation: TChatConversation) => void;
  onMenuVisibleChange: (conversation_id: string, visible: boolean) => void;
  onEditStart: (conversation: TChatConversation) => void;
  onCreateCronTask: (conversation: TChatConversation) => void;
  onArchive: (conversation: TChatConversation) => void;
  onExport?: (conversation: TChatConversation) => void;
  onTogglePin: (conversation: TChatConversation) => void;
  onToggleManualUnread: (conversation: TChatConversation) => void;
  getJobStatus: (conversation_id: string) => 'none' | 'active' | 'paused' | 'error' | 'unread';
  /** Resolve a loaded conversation's name by id (fork-lineage badge tooltip). */
  resolveConversationName?: (conversation_id: string) => string | undefined;
  /** Tree level of the row's root (1 = top level, 2 = inside a project); nested depth adds to it. */
  treeLevel?: number;
  /** Badge slot after the title (e.g. the Board Keeper badge). */
  badge?: ReactNode;
  /** Nesting depth for sub-conversation rows (0 / undefined = top-level row). */
  depth?: number;
  /** Present only when this row has sub-conversations. */
  treeInfo?: ConversationRowTreeInfo;
  /** Connectors for nested rows and parents with shown children. */
  guides?: ConversationRowGuides;
  /** Position among its siblings (aria-posinset / aria-setsize). */
  treePosition?: TreeItemPosition;
  /** Total descendants (all levels) — drives "includes N sub-conversations" copy. */
  descendantCount?: number;
  onCreateChild?: (conversation: TChatConversation) => void;
  onDetach?: (conversation: TChatConversation) => void;
  onMoveUnder?: (conversation: TChatConversation) => void;
  /** Hover-reveal drag handle overlaying the leading icon; supplied by the sortable wrapper for reorderable (pinned) rows. */
  dragHandle?: ReactNode;
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
  afterPinnedContent?: ReactNode;
  /** Sidebar name filter (projects and conversations); empty = no filter. */
  filterQuery?: string;
  /**
   * Actions slot of a project row, before the built-in "+" and menu (e.g. the
   * Board button). Shown on hover / focus, always on touch.
   */
  projectActions?: (project: {
    workspace: string;
    name: string;
    /** Backend project id, when known (null for a folder without a project record yet). */
    projectId: string | null;
    /** Class of the row's icon buttons, so slot buttons look and size like the built-in ones. */
    buttonClassName: string;
  }) => ReactNode;
  /** Badge slot of a conversation row, after its title (e.g. the Board Keeper badge). */
  conversationBadge?: (conversation: TChatConversation) => ReactNode;
  /** Conversations listed first in their project (e.g. the Board Keeper). */
  isProjectLeadConversation?: (conversation: TChatConversation) => boolean;
};

export type DragItemType = 'conversation' | 'workspace';

export type DragItem = {
  type: DragItemType;
  id: string;
  conversation?: TChatConversation;
  workspaceGroup?: WorkspaceGroup;
  sourceSection: 'pinned' | string;
  sourceWorkspace?: string;
};

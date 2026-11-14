/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project board DTOs — mirror of `aionui-api-types/src/board.rs` (SPEC C4 §3/§5).
 *
 * User router: `/api/projects/{pid}/board…` and `/api/board/…`, wrapped in
 * `ApiResponse<T>` (unwrapped by `httpRequest`); errors are `ApiError::coded`
 * and surface as `BackendHttpError.code` (one of {@link BoardErrorCode}).
 * Timestamps are epoch milliseconds, like every other AionUi DTO.
 */

export type BoardTemplate = 'simple' | 'studio';
/** Upstream category every column maps to (F-KANBAN compatibility). */
export type BoardCategory = 'backlog' | 'todo' | 'in_progress' | 'done';
export type BoardColumnKind = 'normal' | 'gate' | 'terminal';
export type BoardResolution = 'completed' | 'dropped';
export type BoardAgentMove = 'allow' | 'deny';
export type BoardCardType = 'idea' | 'bug' | 'feature' | 'update' | 'chore' | 'research';
export type BoardPriority = 'low' | 'medium' | 'high' | 'urgent';
export type BoardSize = 's' | 'm' | 'l';
export type BoardTier = 't0' | 't1' | 't2' | 't3';
export type BoardActorKind = 'user' | 'agent' | 'system';
export type BoardAssigneeKind = 'assistant' | 'team' | 'user';

export const BOARD_CATEGORIES: readonly BoardCategory[] = ['backlog', 'todo', 'in_progress', 'done'];
export const BOARD_CARD_TYPES: readonly BoardCardType[] = ['idea', 'bug', 'feature', 'update', 'chore', 'research'];
export const BOARD_PRIORITIES: readonly BoardPriority[] = ['low', 'medium', 'high', 'urgent'];
export const BOARD_SIZES: readonly BoardSize[] = ['s', 'm', 'l'];
export const BOARD_TIERS: readonly BoardTier[] = ['t0', 't1', 't2', 't3'];

/** Content limits (SPEC R9) — enforced server-side (422 `board_invalid`), mirrored for inline validation. */
export const BOARD_LIMITS = {
  title: 200,
  description: 20_000,
  comment: 4_000,
  listItems: 20,
  listItemLength: 40,
} as const;

/** `board_settings` row. A project that never had a board answers `enabled: false`, `version: 0`. */
export type BoardSettings = {
  project_id: string;
  enabled: boolean;
  template: BoardTemplate;
  next_number: number;
  /** Guards settings and the columns collection (`PUT …/settings`, `PUT …/columns`). */
  version: number;
  settings: Record<string, unknown>;
  /** Set while the project is archived → the board is read-only (409 `board_archived`). */
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

/** `board_columns` row. `name: null` = i18n default `board.columns.<key>`. */
export type BoardColumn = {
  id: string;
  key: string;
  name: string | null;
  category: BoardCategory;
  kind: BoardColumnKind;
  resolution: BoardResolution | null;
  agent_move: BoardAgentMove;
  wip_limit: number | null;
  exit_rule: Record<string, unknown> | null;
  gate: Record<string, unknown> | null;
  position: number;
  archived: boolean;
};

/** Card as listed on the board (`GET /api/projects/{pid}/board`): everything but the long text fields. */
export type BoardCardSummary = {
  id: string;
  project_id: string;
  /** `TASK-N`. */
  number: number;
  title: string;
  type: BoardCardType;
  priority: BoardPriority;
  size: BoardSize | null;
  tier: BoardTier | null;
  column_key: string;
  position: number;
  labels: string[];
  skills: string[];
  creator_kind: BoardActorKind;
  creator_ref: string;
  assignee_kind: BoardAssigneeKind | null;
  assignee_ref: string | null;
  /** Resolved display name of the assignee (assistant / team name), when the server knows it. */
  assignee_name?: string | null;
  /** Manual blocked flag (R5). */
  blocked: boolean;
  blocked_reason: string | null;
  /** Dependencies whose target has not reached a `resolution=completed` column (R5, derived). */
  open_dependency_count: number;
  version: number;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

/** One `board_card_deps` row, resolved for display. */
export type BoardDependency = {
  card_id: string;
  number: number;
  title: string;
  column_key: string;
  /** True once the target sits in a `resolution=completed` column. */
  resolved: boolean;
};

/** Full card (`GET /api/board/cards/{id}`, PATCH/move/archive responses). */
export type BoardCard = BoardCardSummary & {
  description: string;
  routing: string[];
  change_id: string | null;
  metadata: Record<string, unknown>;
  dependencies: BoardDependency[];
};

export type BoardReviewVerdict = 'pending' | 'approve' | 'change' | 'reject' | 'blocked';

/** `board_card_reviews` row (rendered from S4 on). */
export type BoardReview = {
  id: string;
  card_id: string;
  department: string;
  reviewer_ref: string;
  conversation_id: string | null;
  verdict: BoardReviewVerdict;
  summary: string;
  findings: Array<{ severity: 'info' | 'low' | 'medium' | 'high' | 'critical'; claim: string; evidence: string }>;
  recommendation: string;
  assumptions: string[];
  confidence: number | null;
  tokens_used: number;
  version: number;
  created_at: number;
  updated_at: number;
};

/** `board_card_questions` row (rendered from S4 on). */
export type BoardQuestion = {
  id: string;
  card_id: string;
  from_department: string;
  to_department: string;
  text: string;
  answered_by_event: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

export type BoardLinkRole = 'lead' | 'review' | 'build' | 'brainstorm' | 'qa' | 'other';

/** `board_card_links` row with the linked conversation's status (`removed` once deleted). */
export type BoardLink = {
  card_id: string;
  conversation_id: string;
  role: BoardLinkRole;
  department: string | null;
  conversation_name: string | null;
  conversation_status: string;
  created_at: number;
};

/** `board_events` row (R8). `payload` carries the after-state of the changed entity. */
export type BoardEvent = {
  seq: number;
  id: string;
  card_id: string | null;
  project_id: string;
  actor_kind: BoardActorKind;
  actor_ref: string;
  conversation_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: number;
};

/** `GET /api/projects/{pid}/board` response. */
export type BoardSnapshot = {
  settings: BoardSettings;
  columns: BoardColumn[];
  cards: BoardCardSummary[];
  /** Highest `board_events.seq` of the project at read time (live-update checkpoint). */
  last_seq: number;
};

/** `GET /api/board/cards/{id}` response. */
export type BoardCardDetail = {
  card: BoardCard;
  reviews: BoardReview[];
  questions: BoardQuestion[];
  links: BoardLink[];
  /** Last 50 events of the card, oldest first. */
  events: BoardEvent[];
};

/** Paged events (`…/events?after_seq=`, `…/comments?after_seq=`). */
export type BoardEventPage = {
  items: BoardEvent[];
  has_more: boolean;
  /** Pass as the next `after_seq`; null when `has_more` is false. */
  next_after_seq: number | null;
};

/** `PUT /api/projects/{pid}/board/settings` body. */
export type UpdateBoardSettingsRequest = {
  version: number;
  enabled?: boolean;
  template?: BoardTemplate;
  settings?: Record<string, unknown>;
};

/** One entry of the full list sent to `PUT /api/projects/{pid}/board/columns` (no `id`; matched by `key`). */
export type BoardColumnInput = Omit<BoardColumn, 'id'>;

export type UpdateBoardColumnsRequest = {
  version: number;
  columns: BoardColumnInput[];
};

/** `PUT …/columns` response. */
export type BoardColumnsResponse = {
  columns: BoardColumn[];
  version: number;
};

/** `POST /api/projects/{pid}/board/cards` body (server defaults the rest; column defaults to the first one). */
export type CreateBoardCardRequest = {
  title: string;
  description?: string;
  type?: BoardCardType;
  priority?: BoardPriority;
  size?: BoardSize | null;
  tier?: BoardTier | null;
  labels?: string[];
  skills?: string[];
  column_key?: string;
};

/** `PATCH /api/board/cards/{id}` body: changed fields + the `version` the edit was based on. */
export type UpdateBoardCardRequest = {
  version: number;
  title?: string;
  description?: string;
  type?: BoardCardType;
  priority?: BoardPriority;
  size?: BoardSize | null;
  tier?: BoardTier | null;
  labels?: string[];
  skills?: string[];
  blocked?: boolean;
  blocked_reason?: string | null;
};

/** `POST /api/board/cards/{id}/move` body. `before_id` and `after_id` are mutually exclusive. */
export type MoveBoardCardRequest = {
  to_column: string;
  before_id?: string;
  after_id?: string;
  /** Column the card was in when the user started the move (placement guard). */
  expected_column: string;
  /** Owner override (WIP / exit rules). Never sent by agents. */
  force?: boolean;
};

/** `POST /api/board/cards/{id}/comments` body. */
export type CreateBoardCommentRequest = {
  body: string;
  to_department?: string;
  answers?: string;
};

/** WS `board.changed` payload (R8) — an invalidation hint, the paged events API is the source of truth. */
export type BoardChangedEvent = {
  user_id: string;
  project_id: string;
  seq: number;
  event: BoardEvent;
  card?: BoardCardSummary;
  review?: BoardReview;
};

/** Error codes (SPEC §5) carried by `BackendHttpError.code`. */
export const BOARD_ERROR_CODES = {
  assignmentInProgress: 'board_assignment_in_progress',
  deployInFlight: 'board_deploy_in_flight',
  useAgentRouter: 'board_use_agent_router',
  archived: 'board_archived',
  idempotencyConflict: 'board_idempotency_conflict',
  featureNotEnabled: 'board_feature_not_enabled',
  dependencyCycle: 'board_dependency_cycle',
  notFound: 'board_not_found',
  disabled: 'board_disabled',
  gateUseDecision: 'board_gate_use_decision',
  systemForbidden: 'board_system_forbidden',
  agentMoveDenied: 'board_agent_move_denied',
  departmentMismatch: 'board_department_mismatch',
  wrongProject: 'board_wrong_project',
  versionConflict: 'board_version_conflict',
  wipLimit: 'board_wip_limit',
  exitRule: 'board_exit_rule',
  noProject: 'board_no_project',
  invalid: 'board_invalid',
  rateLimited: 'board_rate_limited',
} as const;

export type BoardErrorCode = (typeof BOARD_ERROR_CODES)[keyof typeof BOARD_ERROR_CODES];

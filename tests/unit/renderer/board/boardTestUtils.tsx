/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared fixtures for the board tests: DTO builders, a mocked `ipcBridge.board`
 * (+ realtime / project / sidebar), a real i18next instance loaded with the
 * shipped en-US and fa-IR `board`/`common` modules, and a render helper with a
 * fresh SWR cache + router.
 *
 * Usage in a test file (the mock must be declared there so it is hoisted):
 *   vi.mock('@/common', async (importOriginal) =>
 *     (await import('./boardTestUtils')).mockCommonModule(await importOriginal()));
 */

import { render, type RenderResult } from '@testing-library/react';
import i18next, { type i18n as I18n } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';

import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  STUDIO_COLUMN_KEYS,
  type BoardCard,
  type BoardCardDetail,
  type BoardCardSummary,
  type BoardChangedEvent,
  type BoardColumn,
  type BoardEvent,
  type BoardSettings,
  type BoardSnapshot,
} from '@/common/types/board';
import enBoard from '@/renderer/services/i18n/locales/en-US/board.json';
import enCommon from '@/renderer/services/i18n/locales/en-US/common.json';
import enConversation from '@/renderer/services/i18n/locales/en-US/conversation.json';
import faBoard from '@/renderer/services/i18n/locales/fa-IR/board.json';
import faCommon from '@/renderer/services/i18n/locales/fa-IR/common.json';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const PROJECT_ID = 'p1';

export const makeSettings = (over: Partial<BoardSettings> = {}): BoardSettings => ({
  project_id: PROJECT_ID,
  enabled: true,
  template: 'studio',
  next_number: 10,
  version: 3,
  settings: {},
  archived_at: null,
  keeper_conversation_id: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  ...over,
});

const CATEGORY: Record<string, BoardColumn['category']> = {
  ideas: 'backlog',
  inbox: 'backlog',
  triage: 'todo',
  review: 'todo',
  accuracy: 'todo',
  decision: 'todo',
  planned: 'in_progress',
  building: 'in_progress',
  local_test: 'in_progress',
  ready_to_deploy: 'in_progress',
  deploying: 'in_progress',
  deployed: 'done',
  done: 'done',
  parked: 'done',
  rejected: 'done',
};
const TERMINAL: Record<string, BoardColumn['resolution']> = {
  deployed: 'completed',
  done: 'completed',
  parked: 'dropped',
  rejected: 'dropped',
};
const GATES: Record<string, BoardColumn['gate']> = {
  decision: { owner_if: { size: ['m', 'l'] }, on_approve: 'planned', on_reject: 'parked' },
  ready_to_deploy: { owner_if: {}, on_approve: 'deploying', on_reject: 'local_test' },
};
const WIP: Record<string, number> = { review: 4, building: 1, local_test: 1 };

/** A column with the studio template's defaults for its key (category, kind, resolution, gate). */
export const makeColumn = (key: string, position: number, over: Partial<BoardColumn> = {}): BoardColumn => ({
  id: `col-${key}`,
  key,
  name: null,
  category: CATEGORY[key] ?? 'todo',
  kind: GATES[key] ? 'gate' : TERMINAL[key] ? 'terminal' : 'normal',
  resolution: TERMINAL[key] ?? null,
  agent_move: 'deny',
  wip_limit: null,
  exit_rule: null,
  gate: GATES[key] ?? null,
  position,
  archived: false,
  ...over,
});

/** A short flow (one column per category) for tests about generic board behaviour. */
export const flowColumns = (over: Partial<Record<string, Partial<BoardColumn>>> = {}): BoardColumn[] =>
  ['ideas', 'triage', 'building', 'done'].map((key, index) => makeColumn(key, index, over[key]));

/** The full studio flow with its default WIP limits (SPEC §3). */
export const studioColumns = (over: Partial<Record<string, Partial<BoardColumn>>> = {}): BoardColumn[] =>
  STUDIO_COLUMN_KEYS.map((key, index) => makeColumn(key, index, { wip_limit: WIP[key] ?? null, ...over[key] }));

export const makeCard = (
  number: number,
  columnKey: string,
  position: number,
  over: Partial<BoardCardSummary> = {}
): BoardCardSummary => ({
  id: `card-${number}`,
  project_id: PROJECT_ID,
  number,
  title: `Card ${number}`,
  type: 'feature',
  priority: 'medium',
  size: null,
  tier: null,
  column_key: columnKey,
  position,
  labels: [],
  skills: [],
  creator_kind: 'user',
  creator_ref: 'u1',
  assignee_kind: null,
  assignee_ref: null,
  blocked: false,
  blocked_reason: null,
  open_dependency_count: 0,
  needs_decision: false,
  version: 1,
  archived_at: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  ...over,
});

export const makeSnapshot = (over: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  settings: makeSettings(),
  columns: flowColumns(),
  cards: [],
  last_seq: 100,
  ...over,
});

export const fullCard = (summary: BoardCardSummary, over: Partial<BoardCard> = {}): BoardCard => ({
  ...summary,
  description: '',
  routing: [],
  change_id: null,
  metadata: {},
  dependencies: [],
  ...over,
});

export const makeEvent = (seq: number, kind: string, over: Partial<BoardEvent> = {}): BoardEvent => ({
  seq,
  prev_seq: seq - 1,
  id: `ev-${seq}`,
  card_id: 'card-1',
  project_id: PROJECT_ID,
  actor_kind: 'user',
  actor_ref: 'u1',
  conversation_id: null,
  kind,
  payload: {},
  created_at: 1_700_000_000_000 + seq,
  ...over,
});

export const makeDetail = (card: BoardCard, events: BoardEvent[] = []): BoardCardDetail => ({
  card,
  reviews: [],
  questions: [],
  links: [],
  events,
});

/** A coded backend error, as `httpRequest` throws it. */
export const backendError = (status: number, code: string, details?: unknown): BackendHttpError =>
  new BackendHttpError({
    method: 'POST',
    path: '/api/board',
    status,
    body: { success: false, error: code, code, ...(details ? { details } : {}) },
  });

// ---------------------------------------------------------------------------
// Bridge mock
// ---------------------------------------------------------------------------

type Listener<T> = (payload: T) => void;

const emitter = <T,>() => {
  const listeners = new Set<Listener<T>>();
  return {
    listeners,
    on: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (payload: T) => listeners.forEach((listener) => listener(payload)),
  };
};

export const boardChanged = emitter<BoardChangedEvent>();
export const reconnected = emitter<{ timestamp: number }>();

export const bridge = {
  get: vi.fn(),
  updateSettings: vi.fn(),
  updateColumns: vi.fn(),
  createCard: vi.fn(),
  getCard: vi.fn(),
  updateCard: vi.fn(),
  moveCard: vi.fn(),
  archiveCard: vi.fn(),
  restoreCard: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
  listCardEvents: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  decideGate: vi.fn(),
  assign: vi.fn(),
  brainstorm: vi.fn(),
  ensureKeeper: vi.fn(),
  assistantsList: vi.fn(),
  teamList: vi.fn(),
  projectGet: vi.fn(),
  unarchiveProject: vi.fn(),
};

/** Reset every mock to a sane default (empty board, no detail). */
export const resetBridge = (): void => {
  Object.values(bridge).forEach((fn) => fn.mockReset());
  boardChanged.listeners.clear();
  reconnected.listeners.clear();
  bridge.get.mockResolvedValue(makeSnapshot());
  bridge.projectGet.mockResolvedValue({
    project_id: PROJECT_ID,
    name: 'Alpha',
    explorer: { workspace_pe_id: '', entries: [] },
  });
  bridge.listComments.mockResolvedValue({ items: [], has_more: false, next_after_seq: null });
  bridge.assistantsList.mockResolvedValue([]);
  bridge.teamList.mockResolvedValue([]);
};

const provider = (fn: (params: unknown) => unknown) => ({ invoke: (params: unknown) => fn(params) });

/** `@/common` with the board, realtime, project and sidebar bridges replaced. */
export const mockCommonModule = (actual: Record<string, unknown>) => {
  const ipcBridge = actual.ipcBridge as Record<string, unknown>;
  return {
    ...actual,
    ipcBridge: {
      ...ipcBridge,
      board: {
        get: provider(bridge.get),
        updateSettings: provider(bridge.updateSettings),
        updateColumns: provider(bridge.updateColumns),
        createCard: provider(bridge.createCard),
        getCard: provider(bridge.getCard),
        updateCard: provider(bridge.updateCard),
        moveCard: provider(bridge.moveCard),
        archiveCard: provider(bridge.archiveCard),
        restoreCard: provider(bridge.restoreCard),
        listComments: provider(bridge.listComments),
        addComment: provider(bridge.addComment),
        listCardEvents: provider(bridge.listCardEvents),
        addDependency: provider(bridge.addDependency),
        removeDependency: provider(bridge.removeDependency),
        decideGate: provider(bridge.decideGate),
        assign: provider(bridge.assign),
        brainstorm: provider(bridge.brainstorm),
        ensureKeeper: provider(bridge.ensureKeeper),
        changed: { on: boardChanged.on, emit: () => {} },
      },
      realtime: { reconnected: { on: reconnected.on, emit: () => {} } },
      project: { ...(ipcBridge.project as object), get: provider(bridge.projectGet) },
      assistants: { ...(ipcBridge.assistants as object), list: provider(bridge.assistantsList) },
      team: { ...(ipcBridge.team as object), list: provider(bridge.teamList) },
      sidebar: { ...(ipcBridge.sidebar as object), unarchiveProject: provider(bridge.unarchiveProject) },
    },
  };
};

// ---------------------------------------------------------------------------
// i18n + render
// ---------------------------------------------------------------------------

export const createTestI18n = (language: 'en-US' | 'fa-IR' = 'en-US'): I18n => {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en-US',
    initImmediate: false,
    interpolation: { escapeValue: false },
    resources: {
      'en-US': { translation: { board: enBoard, common: enCommon, conversation: enConversation } },
      'fa-IR': { translation: { board: faBoard, common: faCommon } },
    },
  });
  return instance;
};

export const renderWithBoard = (
  ui: React.ReactElement,
  { i18n = createTestI18n(), route = '/' }: { i18n?: I18n; route?: string } = {}
): RenderResult & { i18n: I18n } => {
  const result = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
      </MemoryRouter>
    </I18nextProvider>
  );
  return { ...result, i18n };
};

/** `window.matchMedia` stub; `matches` decides which queries are true. */
export const stubMatchMedia = (matches: (query: string) => boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null as MediaQueryList['onchange'],
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

export const removeMatchMedia = (): void => {
  // jsdom ships without matchMedia; restore that state between tests.
  delete (window as { matchMedia?: unknown }).matchMedia;
};

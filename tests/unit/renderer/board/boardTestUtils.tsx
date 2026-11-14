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
import type {
  BoardCard,
  BoardCardDetail,
  BoardCardSummary,
  BoardChangedEvent,
  BoardColumn,
  BoardEvent,
  BoardSettings,
  BoardSnapshot,
} from '@/common/types/board';
import enBoard from '@/renderer/services/i18n/locales/en-US/board.json';
import enCommon from '@/renderer/services/i18n/locales/en-US/common.json';
import faBoard from '@/renderer/services/i18n/locales/fa-IR/board.json';
import faCommon from '@/renderer/services/i18n/locales/fa-IR/common.json';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const PROJECT_ID = 'p1';

export const makeSettings = (over: Partial<BoardSettings> = {}): BoardSettings => ({
  project_id: PROJECT_ID,
  enabled: true,
  template: 'simple',
  next_number: 10,
  version: 3,
  settings: {},
  archived_at: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  ...over,
});

export const makeColumn = (key: string, position: number, over: Partial<BoardColumn> = {}): BoardColumn => ({
  id: `col-${key}`,
  key,
  name: null,
  category: (['backlog', 'todo', 'in_progress', 'done'].includes(key) ? key : 'todo') as BoardColumn['category'],
  kind: key === 'done' ? 'terminal' : 'normal',
  resolution: key === 'done' ? 'completed' : null,
  agent_move: 'allow',
  wip_limit: null,
  exit_rule: null,
  gate: null,
  position,
  archived: false,
  ...over,
});

export const simpleColumns = (over: Partial<Record<string, Partial<BoardColumn>>> = {}): BoardColumn[] =>
  ['backlog', 'todo', 'in_progress', 'done'].map((key, index) => makeColumn(key, index, over[key]));

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
  version: 1,
  archived_at: null,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  ...over,
});

export const makeSnapshot = (over: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  settings: makeSettings(),
  columns: simpleColumns(),
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
        changed: { on: boardChanged.on, emit: () => {} },
      },
      realtime: { reconnected: { on: reconnected.on, emit: () => {} } },
      project: { ...(ipcBridge.project as object), get: provider(bridge.projectGet) },
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
      'en-US': { translation: { board: enBoard, common: enCommon } },
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

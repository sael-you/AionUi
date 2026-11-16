/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * REST client for the voice user routes (plan §3.5).
 *
 * Built on the shared `httpRequest` (same-origin cookie, 401 → one silent
 * session refresh, `{ success, data }` unwrapping, `BackendHttpError`, and the
 * shared C11 CSRF handling from `csrf.ts`: `x-csrf-token` on writes when the
 * session has a token, one retry on a CSRF rejection). Voice adds one rule:
 * the cookie is the only credential, so no `Authorization` / runtime-token
 * headers are ever attached (the backend rejects them with 400).
 */

import { BackendHttpError, getBaseUrl, httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  CreateVoiceSessionRequest,
  CreateVoiceSessionResponse,
  VoiceSessionSummary,
  VoiceSettings,
} from '../core/types';
import { DEFAULT_VOICE_SETTINGS } from '../core/types';

/** Error raised for a 409 "busy": another device already admitted the wake (§3.6 step 1). */
export class VoiceBusyError extends Error {
  constructor() {
    super('voice session busy on another device');
    this.name = 'VoiceBusyError';
  }
}

/** Map a backend failure to a stable voice error code for the UI. */
export function voiceErrorCode(error: unknown): string {
  if (error instanceof VoiceBusyError) return 'busy';
  if (isBackendHttpError(error)) {
    const code = error.code || error.backendMessage;
    if (/disabled|kill/i.test(code)) return 'disabled';
    if (/budget/i.test(code) || error.status === 402) return 'budget';
    // The MiniMax engine's own 412 (`VOICE_NO_MINIMAX_PROVIDER`) names the key it misses.
    if (/no_minimax_provider/i.test(code)) return 'noMinimaxProvider';
    if (error.status === 412 || /no_provider/i.test(code)) return 'noProvider';
    if (error.status === 429) return 'rateLimited';
    if (error.status === 502) return 'callFailed';
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return code ? 'forbidden' : 'disabled';
    if (error.status === 503) return 'unavailable';
    return 'server';
  }
  return 'network';
}

const READBACK_PATH = /^\/api\/voice\/readbacks\/[A-Za-z0-9_-]{1,128}$/;

/** Only same-origin clip paths are fetched; anything else in a frame is refused. */
export function resolveClipPath(urlOrId: string): string | null {
  if (!urlOrId) return null;
  if (/^[A-Za-z0-9_-]{1,128}$/.test(urlOrId)) return `/api/voice/readbacks/${urlOrId}`;
  if (urlOrId.startsWith('/')) return READBACK_PATH.test(urlOrId) ? urlOrId : null;
  try {
    const url = new URL(urlOrId);
    if (typeof window === 'undefined' || url.origin !== window.location.origin) return null;
    return READBACK_PATH.test(url.pathname) && !url.search ? url.pathname : null;
  } catch {
    return null;
  }
}

export type VoiceApi = {
  getSettings(): Promise<VoiceSettings>;
  putSettings(patch: Partial<VoiceSettings>): Promise<VoiceSettings>;
  createSession(body: CreateVoiceSessionRequest): Promise<CreateVoiceSessionResponse>;
  endSession(voiceSessionId: string, reason: string): Promise<void>;
  fetchClip(urlOrId: string): Promise<ArrayBuffer>;
  /** The user's most recent sessions, newest first (core returns at most `VOICE_SESSIONS_LIMIT`). */
  listSessions(): Promise<VoiceSessionSummary[]>;
};

/** Rows `GET /api/voice/sessions` returns at most (core `service.rs` `LIST_LIMIT`). */
export const VOICE_SESSIONS_LIMIT = 50;

const SETTINGS_PATH = '/api/voice/settings';

function unsafe<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  return httpRequest<T>(method, path, body, { silentStatuses: [409] });
}

const withDefaults = (raw: Partial<VoiceSettings> | undefined): VoiceSettings => ({
  ...DEFAULT_VOICE_SETTINGS,
  ...raw,
});

export const voiceApi: VoiceApi = {
  async getSettings() {
    return withDefaults(await httpRequest<Partial<VoiceSettings>>('GET', SETTINGS_PATH));
  },
  async putSettings(patch) {
    return withDefaults(await unsafe<Partial<VoiceSettings>>('PUT', SETTINGS_PATH, patch));
  },
  async createSession(body) {
    try {
      return await unsafe<CreateVoiceSessionResponse>('POST', '/api/voice/sessions', body);
    } catch (error) {
      if (isBackendHttpError(error) && error.status === 409) throw new VoiceBusyError();
      throw error;
    }
  },
  async endSession(voiceSessionId, reason) {
    await unsafe<unknown>('POST', `/api/voice/sessions/${encodeURIComponent(voiceSessionId)}/end`, { reason });
  },
  async listSessions() {
    return (await httpRequest<VoiceSessionSummary[]>('GET', '/api/voice/sessions')) ?? [];
  },
  async fetchClip(urlOrId) {
    const path = resolveClipPath(urlOrId);
    if (!path) throw new Error('refused clip url');
    // Binary GET: the shared JSON helper does not return bodies of other types.
    const response = await fetch(`${getBaseUrl()}${path}`, { method: 'GET', credentials: 'same-origin' });
    if (!response.ok) throw new BackendHttpError({ method: 'GET', path, status: response.status, body: null });
    return response.arrayBuffer();
  },
};

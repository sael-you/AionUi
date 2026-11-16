/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extension's relay (C34 / TASK-125): one outbound WebSocket to AionUi;
 * the tabs the owner shares are attached with chrome.debugger and their CDP is
 * forwarded both ways. Everything browser-specific is injected (`RelayDeps`),
 * so the logic is tested without Chrome.
 *
 * Rules: nothing is shared by default; a tab leaves the relay the moment the
 * owner unshares it, closes it, presses Stop or cancels Chrome's debugging
 * bar; commands for an unshared tab are refused here too (core checks again);
 * new tabs only while the owner allows them; a revoked or invalid pairing never
 * reconnects.
 */

import {
  FATAL_ERROR_CODES,
  NEW_TABS_DISABLED,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  normalizePairingCode,
  originFor,
  parseCoreFrame,
  socketUrlFor,
  type CoreFrame,
  type ExtensionFrame,
  type SharedTab,
} from './protocol';

export type RelayStatus = 'unpaired' | 'connecting' | 'online' | 'offline' | 'stopped' | 'error';

/** What survives a browser restart (chrome.storage.local). The shared tabs do not. */
export type PersistedState = {
  address: string | null;
  token: string | null;
  device_id: string | null;
  device_name: string;
  new_tabs: boolean;
  stopped: boolean;
};

export type RelaySnapshot = {
  status: RelayStatus;
  error_code: string | null;
  address: string | null;
  device_id: string | null;
  device_name: string;
  new_tabs: boolean;
  tabs: SharedTab[];
};

export type SocketLike = {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

export type TabInfo = { url: string; title: string };

export type RelayDeps = {
  createSocket: (url: string) => SocketLike;
  attach: (tabId: number) => Promise<void>;
  detach: (tabId: number) => Promise<void>;
  sendCommand: (tabId: number, method: string, params: unknown) => Promise<unknown>;
  getTab: (tabId: number) => Promise<TabInfo | null>;
  /** Open a tab and resolve with its id once it has committed an attachable (http/https) URL. */
  createTab: (url: string) => Promise<number>;
  removeTab: (tabId: number) => Promise<void>;
  loadPersisted: () => Promise<Partial<PersistedState>>;
  savePersisted: (state: PersistedState) => Promise<void>;
  loadShared: () => Promise<number[]>;
  saveShared: (tabIds: number[]) => Promise<void>;
  browser: string;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  random?: () => number;
  onChange?: (snapshot: RelaySnapshot) => void;
};

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export const DEFAULT_PERSISTED: PersistedState = {
  address: null,
  token: null,
  device_id: null,
  device_name: 'Mac',
  new_tabs: true,
  stopped: false,
};

/** A short code for chrome.debugger / tabs errors, so core can tell the agent what happened. */
export const errorCodeOf = (message: string): string | undefined => {
  if (/no tab with (given )?id|tab was closed|no such tab/i.test(message)) return 'tab_closed';
  if (/not attached|detached/i.test(message)) return 'not_attached';
  if (/cannot access|cannot be scripted|chrome:\/\/|chrome-extension:\/\//i.test(message)) return 'restricted_url';
  return undefined;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class Relay {
  private state: PersistedState = { ...DEFAULT_PERSISTED };
  private readonly shared = new Map<number, SharedTab>();
  private socket: SocketLike | null = null;
  private status: RelayStatus = 'unpaired';
  private errorCode: string | null = null;
  private pairCode: string | null = null;
  private welcomed = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;

  constructor(private readonly deps: RelayDeps) {}

  // ---------------------------------------------------------------- lifecycle

  /** Load what was saved and reconnect if the device is paired and not stopped. */
  async init(): Promise<void> {
    this.state = { ...DEFAULT_PERSISTED, ...(await this.deps.loadPersisted()) };
    for (const tabId of await this.deps.loadShared()) {
      const tab = await this.deps.getTab(tabId);
      if (tab) this.shared.set(tabId, { tab_id: tabId, url: tab.url, title: tab.title });
    }
    await this.persistShared();
    if (!this.state.token) this.status = 'unpaired';
    else if (this.state.stopped) this.status = 'stopped';
    else this.connect();
    this.changed();
  }

  snapshot(): RelaySnapshot {
    return {
      status: this.status,
      error_code: this.errorCode,
      address: this.state.address,
      device_id: this.state.device_id,
      device_name: this.state.device_name,
      new_tabs: this.state.new_tabs,
      tabs: [...this.shared.values()],
    };
  }

  /** Pair with AionUi: the address the owner uses and the one-time code from Settings → Browser. */
  async pair(address: string, code: string, deviceName: string): Promise<void> {
    const origin = originFor(address);
    if (!origin) throw new Error('invalid_address');
    const pairCode = normalizePairingCode(code);
    if (!pairCode) throw new Error('invalid_code');
    this.closeSocket();
    this.state = {
      ...this.state,
      address: origin,
      token: null,
      device_id: null,
      device_name: deviceName.trim() || DEFAULT_PERSISTED.device_name,
      stopped: false,
    };
    await this.persist();
    this.pairCode = pairCode;
    this.errorCode = null;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.connect();
  }

  /** The alarm's wake-up: reconnect when the device should be online. */
  ensureConnected(): void {
    if (this.state.token && !this.state.stopped && !this.socket && this.status !== 'error') this.connect();
  }

  /** Global Stop: every tab leaves, the socket closes, nothing reconnects until Resume. */
  async stop(): Promise<void> {
    this.state = { ...this.state, stopped: true };
    await this.persist();
    await this.unshareAll('stopped_by_owner');
    this.closeSocket();
    this.status = this.state.token ? 'stopped' : 'unpaired';
    this.changed();
  }

  async resume(): Promise<void> {
    this.state = { ...this.state, stopped: false };
    await this.persist();
    this.errorCode = null;
    this.reconnectDelay = RECONNECT_MIN_MS;
    if (this.state.token) this.connect();
    this.changed();
  }

  /** Forget this pairing (the device stays listed in AionUi until revoked there). */
  async unpair(): Promise<void> {
    await this.unshareAll('stopped_by_owner');
    this.closeSocket();
    this.state = { ...this.state, token: null, device_id: null, stopped: false };
    await this.persist();
    this.pairCode = null;
    this.status = 'unpaired';
    this.errorCode = null;
    this.changed();
  }

  async setNewTabs(allowed: boolean): Promise<void> {
    this.state = { ...this.state, new_tabs: allowed };
    await this.persist();
    this.sendState();
    this.changed();
  }

  // ---------------------------------------------------------------- tabs

  isShared(tabId: number): boolean {
    return this.shared.has(tabId);
  }

  /** Share a tab: attach the debugger (Chrome shows its debugging bar) and tell AionUi. */
  async share(tabId: number): Promise<void> {
    if (this.shared.has(tabId)) return;
    const tab = await this.deps.getTab(tabId);
    if (!tab) throw new Error('tab_closed');
    await this.deps.attach(tabId);
    this.shared.set(tabId, { tab_id: tabId, url: tab.url, title: tab.title });
    await this.persistShared();
    this.sendState();
    this.changed();
  }

  async unshare(tabId: number, reason = 'unshared_by_owner'): Promise<void> {
    if (!this.shared.delete(tabId)) return;
    await this.persistShared();
    try {
      await this.deps.detach(tabId);
    } catch {
      // Already detached (tab closed, bar cancelled): nothing left to undo.
    }
    this.send({ type: 'detached', tab_id: tabId, reason });
    this.sendState();
    this.changed();
  }

  /** chrome.debugger.onDetach: the owner cancelled the bar, the tab closed or crashed. */
  async onDebuggerDetach(tabId: number, reason: string): Promise<void> {
    if (!this.shared.delete(tabId)) return;
    await this.persistShared();
    this.send({ type: 'detached', tab_id: tabId, reason });
    this.sendState();
    this.changed();
  }

  /** chrome.debugger.onEvent: forwarded only for shared tabs (all domains, Fetch included). */
  onDebuggerEvent(tabId: number, method: string, params: unknown): void {
    if (!this.shared.has(tabId)) return;
    this.send({ type: 'event', tab_id: tabId, method, params: params ?? {} });
  }

  onTabUpdated(tabId: number, info: Partial<TabInfo>): void {
    const tab = this.shared.get(tabId);
    if (!tab) return;
    const next = { ...tab, url: info.url ?? tab.url, title: info.title ?? tab.title };
    if (next.url === tab.url && next.title === tab.title) return;
    this.shared.set(tabId, next);
    this.sendState();
    this.changed();
  }

  async onTabRemoved(tabId: number): Promise<void> {
    if (!this.shared.delete(tabId)) return;
    await this.persistShared();
    this.send({ type: 'detached', tab_id: tabId, reason: 'tab_closed' });
    this.sendState();
    this.changed();
  }

  // ---------------------------------------------------------------- socket

  private connect(): void {
    if (this.socket || !this.state.address) return;
    const url = socketUrlFor(this.state.address);
    if (!url) return;
    this.clearReconnect();
    this.status = 'connecting';
    this.welcomed = false;
    this.changed();
    const socket = this.deps.createSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      if (this.pairCode) {
        this.rawSend({
          type: 'pair',
          code: this.pairCode,
          device_name: this.state.device_name,
          browser: this.deps.browser,
        });
      } else if (this.state.token) {
        this.rawSend({ type: 'hello', token: this.state.token, browser: this.deps.browser, version: PROTOCOL_VERSION });
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const frame = parseCoreFrame(event.data);
      if (frame) void this.handle(frame);
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.onSocketClosed();
    };
  }

  private onSocketClosed(): void {
    this.socket = null;
    this.stopPing();
    const wasPairing = this.pairCode !== null && !this.welcomed;
    if (wasPairing) {
      // The one-time code may already be spent: ask the owner for a new one.
      this.pairCode = null;
      this.status = 'error';
      this.errorCode = this.errorCode ?? 'pairing_interrupted';
    } else if (this.status !== 'error' && this.status !== 'stopped' && this.status !== 'unpaired') {
      this.status = 'offline';
      this.scheduleReconnect();
    }
    this.changed();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.state.stopped || !this.state.token) return;
    const jitter = 1 + (this.deps.random?.() ?? Math.random()) * 0.2;
    const delay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay) * jitter;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    this.reconnectTimer = this.deps.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) this.deps.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = this.deps.setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) this.deps.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private closeSocket(): void {
    this.clearReconnect();
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // Closing a socket that never opened.
      }
    }
  }

  private rawSend(frame: ExtensionFrame): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch {
      // The close handler reconnects.
    }
  }

  /** Frames after the handshake only. */
  private send(frame: ExtensionFrame): void {
    if (this.welcomed) this.rawSend(frame);
  }

  private sendState(): void {
    this.send({ type: 'state', new_tabs: this.state.new_tabs, tabs: [...this.shared.values()] });
  }

  // ---------------------------------------------------------------- frames

  private async handle(frame: CoreFrame): Promise<void> {
    switch (frame.type) {
      case 'welcome':
        this.welcomed = true;
        this.pairCode = null;
        this.state = { ...this.state, device_id: frame.device_id, token: frame.token ?? this.state.token };
        await this.persist();
        this.status = 'online';
        this.errorCode = null;
        this.reconnectDelay = RECONNECT_MIN_MS;
        this.startPing();
        this.sendState();
        this.changed();
        return;
      case 'error':
        await this.onCoreError(frame.code);
        return;
      case 'command':
        await this.runCommand(frame.id, frame.tab_id, frame.method, frame.params);
        return;
      case 'create_tab':
        await this.createTab(frame.id, frame.url);
        return;
      case 'close_tab':
        await this.closeTab(frame.id, frame.tab_id);
        return;
      case 'pong':
        return;
    }
  }

  private async onCoreError(code: string): Promise<void> {
    this.errorCode = code;
    if (!FATAL_ERROR_CODES.has(code)) {
      this.changed();
      return;
    }
    // Pairing refused or device revoked: never reconnect with this token.
    await this.unshareAll('device_revoked');
    this.closeSocket();
    this.pairCode = null;
    this.state = { ...this.state, token: null, device_id: null };
    await this.persist();
    this.status = 'error';
    this.changed();
  }

  private async runCommand(id: number, tabId: number, method: string, params: unknown): Promise<void> {
    if (!this.shared.has(tabId)) {
      this.send({ type: 'result', id, error: { message: 'tab is not shared', code: 'not_shared' } });
      return;
    }
    try {
      const result = await this.deps.sendCommand(tabId, method, params ?? {});
      this.send({ type: 'result', id, result: result ?? {} });
    } catch (error) {
      const message = messageOf(error);
      this.send({ type: 'result', id, error: { message, code: errorCodeOf(message) } });
    }
  }

  private async createTab(id: number, url: string): Promise<void> {
    if (!this.state.new_tabs) {
      this.send({ type: 'result', id, error: { message: 'new tabs are off', code: NEW_TABS_DISABLED } });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.send({ type: 'result', id, error: { message: 'only http(s) pages', code: 'restricted_url' } });
      return;
    }
    try {
      const tabId = await this.deps.createTab(url);
      await this.share(tabId);
      this.send({ type: 'result', id, result: { tab_id: tabId } });
    } catch (error) {
      const message = messageOf(error);
      this.send({ type: 'result', id, error: { message, code: errorCodeOf(message) } });
    }
  }

  private async closeTab(id: number, tabId: number): Promise<void> {
    if (!this.shared.has(tabId)) {
      this.send({ type: 'result', id, error: { message: 'tab is not shared', code: 'not_shared' } });
      return;
    }
    try {
      await this.deps.removeTab(tabId);
      await this.onTabRemoved(tabId);
      this.send({ type: 'result', id, result: {} });
    } catch (error) {
      const message = messageOf(error);
      this.send({ type: 'result', id, error: { message, code: errorCodeOf(message) } });
    }
  }

  // ---------------------------------------------------------------- storage

  private async unshareAll(reason: string): Promise<void> {
    // A snapshot: unshare() deletes from the map while we iterate.
    for (const tabId of Array.from(this.shared.keys())) await this.unshare(tabId, reason);
  }

  private async persist(): Promise<void> {
    await this.deps.savePersisted(this.state);
  }

  private async persistShared(): Promise<void> {
    await this.deps.saveShared([...this.shared.keys()]);
  }

  private changed(): void {
    this.deps.onChange?.(this.snapshot());
  }
}

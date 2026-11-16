/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the WebUI browser bridge socket.
 *
 * The browser adapter re-dials on demand so a login can immediately get a
 * cookie-bearing connection. That on-demand path used to ignore both the
 * pending backoff timer and the terminal-auth stop flag, so a WebUI whose
 * connection kept failing reconnected once per bridge emit instead of on the
 * backoff schedule.
 */

const CLOSED = 3;

type SocketListener = (event: unknown) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  private readonly listeners = new Map<string, SocketListener[]>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', { code: 1006 });
  }

  /** Server accepts the upgrade. */
  acceptUpgrade(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', {});
  }

  /** Server pushes a bridge payload. */
  deliver(payload: unknown): void {
    this.dispatch('message', { data: JSON.stringify(payload) });
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const loadBrowserAdapter = async () => {
  FakeWebSocket.instances = [];
  vi.resetModules();

  const win = window as unknown as Record<string, unknown>;
  delete win.electronAPI;
  delete win.__bridgeEmitter;
  delete win.__websocketReconnect;

  vi.stubGlobal('WebSocket', FakeWebSocket);

  const { bridge } = await import('@/common/platform/bridge');
  await import('@/common/adapter/browser');

  return { bridge };
};

const latestSocket = (): FakeWebSocket => {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error('no socket was created');
  }
  return socket;
};

/** Drop the live socket, then assert the next dial lands exactly on `delay`. */
const expectReconnectAt = async (delay: number, socketsSoFar: number): Promise<void> => {
  latestSocket().acceptUpgrade();
  latestSocket().close();

  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(FakeWebSocket.instances).toHaveLength(socketsSoFar);

  await vi.advanceTimersByTimeAsync(1);
  expect(FakeWebSocket.instances).toHaveLength(socketsSoFar + 1);
};

describe('WebUI browser bridge socket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects once on load', async () => {
    await loadBrowserAdapter();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latestSocket().url).toMatch(/\/ws$/);
  });

  it('does not re-dial on every emit while a backoff reconnect is pending', async () => {
    const { bridge } = await loadBrowserAdapter();

    latestSocket().acceptUpgrade();
    latestSocket().close();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // The app keeps talking to a dead socket. Each emit used to call connect()
    // directly, so the reconnect rate tracked the emit rate, not the backoff.
    for (let i = 0; i < 25; i += 1) {
      bridge.emit(`probe-${i}`, {});
    }

    expect(FakeWebSocket.instances).toHaveLength(1);

    // Only the scheduled retry opens the next socket.
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('queues messages emitted while disconnected and flushes them on reconnect', async () => {
    const { bridge } = await loadBrowserAdapter();

    latestSocket().acceptUpgrade();
    latestSocket().close();

    bridge.emit('queued-event', { value: 7 });
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(500);
    const reconnected = latestSocket();
    reconnected.acceptUpgrade();

    expect(reconnected.sent).toHaveLength(1);
    expect(JSON.parse(reconnected.sent[0])).toEqual({ name: 'queued-event', data: { value: 7 } });
  });

  it('backs off when the server accepts the upgrade and drops it immediately', async () => {
    await loadBrowserAdapter();

    // A backend that rejects auth still completes the WebSocket handshake, so
    // `open` fires on every attempt. The delay must keep growing regardless.
    await expectReconnectAt(500, 1);
    await expectReconnectAt(1000, 2);
    await expectReconnectAt(2000, 3);
    await expectReconnectAt(4000, 4);
  });

  it('resets the backoff once a connection has held', async () => {
    await loadBrowserAdapter();

    latestSocket().acceptUpgrade();
    latestSocket().close();
    await vi.advanceTimersByTimeAsync(500);

    // Second attempt stays up long enough to count as recovered.
    latestSocket().acceptUpgrade();
    await vi.advanceTimersByTimeAsync(5000);
    latestSocket().close();

    const before = FakeWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);
  });

  it('stops reconnecting after a terminal auth error, including on later emits', async () => {
    const { bridge } = await loadBrowserAdapter();

    latestSocket().acceptUpgrade();
    latestSocket().deliver({ name: 'realtime.error', data: { code: 'REALTIME_AUTH_EXPIRED' } });

    expect(latestSocket().readyState).toBe(CLOSED);
    const afterAuthFailure = FakeWebSocket.instances.length;

    // Emitting must not quietly resurrect the connection the auth handler just
    // shut down, otherwise "stopping reconnection" never actually stops.
    for (let i = 0; i < 10; i += 1) {
      bridge.emit(`probe-${i}`, {});
    }
    await vi.advanceTimersByTimeAsync(30000);

    expect(FakeWebSocket.instances).toHaveLength(afterAuthFailure);
  });

  it('reconnects immediately when the login flow asks it to', async () => {
    await loadBrowserAdapter();

    latestSocket().acceptUpgrade();
    latestSocket().deliver({ name: 'realtime.error', data: { code: 'REALTIME_AUTH_EXPIRED' } });
    const afterAuthFailure = FakeWebSocket.instances.length;

    const reconnect = (window as unknown as { __websocketReconnect?: () => void }).__websocketReconnect;
    expect(reconnect).toBeTypeOf('function');
    reconnect?.();

    expect(FakeWebSocket.instances).toHaveLength(afterAuthFailure + 1);
  });

  it('cancels a pending backoff retry when the login flow reconnects', async () => {
    await loadBrowserAdapter();

    // Burn one retry so the next one is queued a full second out, then leave a
    // retry pending — this is the state a user is in when they sign in while
    // the socket is still failing.
    await expectReconnectAt(500, 1);
    latestSocket().acceptUpgrade();
    latestSocket().close();

    const beforeLogin = FakeWebSocket.instances.length;
    (window as unknown as { __websocketReconnect?: () => void }).__websocketReconnect?.();

    // Login dials straight away instead of waiting out the backoff.
    expect(FakeWebSocket.instances).toHaveLength(beforeLogin + 1);

    // The superseded timer must not fire a second, duplicate dial afterwards.
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeWebSocket.instances).toHaveLength(beforeLogin + 1);
  });
});

/** The adapter's routing tables; the module is already loaded by `loadBrowserAdapter`. */
const loadTables = async () => import('@/common/adapter/browser');

describe('WebUI bridge: only AionCore-served provider requests go over /ws (TASK-89, TASK-95)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers renderer-log and theme requests locally and never sends them', async () => {
    const { bridge } = await loadBrowserAdapter();
    latestSocket().acceptUpgrade();

    const logs = Array.from({ length: 20 }, () =>
      bridge.invoke('app.write-renderer-log', { level: 'info', tag: 't', message: 'm' })
    );
    await expect(Promise.all(logs)).resolves.toEqual(Array.from({ length: 20 }, () => undefined));
    await expect(bridge.invoke('theme:request-current')).resolves.toBeNull();

    expect(latestSocket().sent).toEqual([]);
  });

  it('resolves every Electron-only provider with its default and sends no frame', async () => {
    const { bridge } = await loadBrowserAdapter();
    const { ELECTRON_ONLY_PROVIDER_DEFAULTS } = await loadTables();
    latestSocket().acceptUpgrade();

    const entries = [...ELECTRON_ONLY_PROVIDER_DEFAULTS];
    const answers = await Promise.all(entries.map(([key]) => bridge.invoke(key, {})));

    expect(answers).toEqual(entries.map(([, expected]) => expected));

    expect(latestSocket().sent).toEqual([]);
  });

  it('answers the per-load update and zoom requests the way their callers expect', async () => {
    const { bridge } = await loadBrowserAdapter();
    latestSocket().acceptUpgrade();

    // useFontScale only applies a number; useUpdateNotificationController stops on !res?.success.
    await expect(bridge.invoke('app.get-zoom-factor')).resolves.toBeUndefined();
    await expect(bridge.invoke('auto-update.restore-downloaded')).resolves.toEqual({ success: false });
    await expect(bridge.invoke('update.installer-last-failure.consume')).resolves.toEqual({ success: false });

    expect(latestSocket().sent).toEqual([]);
  });

  it('hands each caller its own copy of an object or array default', async () => {
    const { bridge } = await loadBrowserAdapter();
    latestSocket().acceptUpgrade();

    const first = await bridge.invoke<{ success: boolean }>('update.check');
    first.success = true;
    await expect(bridge.invoke('update.check')).resolves.toEqual({ success: false });
    await expect(bridge.invoke('skills.files.list')).resolves.toEqual([]);
  });

  it('resolves an unknown provider as unsupported, sends nothing and logs it once', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { bridge } = await loadBrowserAdapter();
    const { WEB_UNSUPPORTED_RESULT } = await loadTables();
    latestSocket().acceptUpgrade();

    await expect(bridge.invoke('future.electron-only')).resolves.toEqual(WEB_UNSUPPORTED_RESULT);
    await expect(bridge.invoke('future.electron-only')).resolves.toEqual(WEB_UNSUPPORTED_RESULT);

    expect(latestSocket().sent).toEqual([]);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0]?.[0])).toContain('future.electron-only');
  });

  it('still sends allowlisted provider requests and plain realtime frames', async () => {
    const { bridge } = await loadBrowserAdapter();
    const { WS_PROVIDER_KEYS } = await loadTables();
    latestSocket().acceptUpgrade();

    expect([...WS_PROVIDER_KEYS]).toEqual(['show-open']);
    void bridge.invoke('show-open', { properties: ['openFile'] });
    bridge.emit('fs', { jsonrpc: '2.0', id: 1, method: 'fs/subscribe' });
    bridge.emit('scm', { jsonrpc: '2.0', id: 2, method: 'scm/subscribe' });

    expect(latestSocket().sent.map((frame) => JSON.parse(frame).name)).toEqual(['subscribe-show-open', 'fs', 'scm']);
  });

  it('classifies every bridge provider key in ipcBridge.ts', async () => {
    const { ELECTRON_ONLY_PROVIDER_DEFAULTS, WS_PROVIDER_KEYS } = await loadTables();
    const source = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src/common/adapter/ipcBridge.ts'),
      'utf8'
    );
    const keys = [...source.matchAll(/bridge\.buildProvider<[\s\S]*?>\(\s*'([^']+)'/g)].map((match) => match[1]);

    expect(keys.length).toBeGreaterThan(40);
    const unclassified = keys.filter((key) => !WS_PROVIDER_KEYS.has(key) && !ELECTRON_ONLY_PROVIDER_DEFAULTS.has(key));
    expect(unclassified).toEqual([]);
  });
});

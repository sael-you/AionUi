/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@/common/platform/bridge';
import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';
import { refreshSession } from './sessionRefresh';
import type { ElectronBridgeAPI } from '@/common/types/platform/electron';

interface CustomWindow extends Window {
  electronAPI?: ElectronBridgeAPI;
  __bridgeEmitter?: { emit: (name: string, data: unknown) => void };
  __websocketReconnect?: () => void;
}

type BrowserWebSocketPayload = { name: string; data?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBrowserWebSocketPayload(value: unknown): value is BrowserWebSocketPayload {
  return isRecord(value) && typeof value.name === 'string';
}

export function isRealtimeAuthTerminalError(payload: unknown): boolean {
  const data = getRealtimeErrorData(payload);
  if (!data) {
    return false;
  }

  const { code } = data;
  return code === 'REALTIME_AUTH_MISSING' || code === 'REALTIME_AUTH_EXPIRED';
}

function getRealtimeErrorData(payload: unknown): Record<string, unknown> | null {
  if (!isBrowserWebSocketPayload(payload) || payload.name !== 'realtime.error' || !isRecord(payload.data)) {
    return null;
  }

  return payload.data;
}

function isUnrecoverableRealtimeError(payload: unknown): boolean {
  return getRealtimeErrorData(payload)?.recoverable === false;
}

/**
 * Provider keys AionCore serves over /ws. AionCore routes only `pong`,
 * `subscribe-show-open`, `fs` and `scm` (crates/aionui-realtime/src/handler.rs,
 * aionui-app router/{fs,scm}_monitor.rs); `fs` and `scm` are plain frames sent
 * by httpBridge's `wsSend`, not provider requests.
 */
export const WS_PROVIDER_KEYS: ReadonlySet<string> = new Set(['show-open']);

/**
 * What a provider that is not available in the WebUI resolves with when it is
 * missing from {@link ELECTRON_ONLY_PROVIDER_DEFAULTS}: the failure shape of
 * `IBridgeResponse`, without `msg`, so callers fall back to their own
 * translated error text.
 */
export const WEB_UNSUPPORTED_RESULT = Object.freeze({ success: false, unsupportedInWeb: true });

/** `IBridgeResponse` failure without `msg`: callers show their own translated text. */
const BRIDGE_FAILURE = Object.freeze({ success: false });

/**
 * Providers only the Electron main process serves (`ipcBridge.ts`, built with
 * `bridge.buildProvider`), with the answer the WebUI gives instead (TASK-89,
 * TASK-95). Sent over /ws, AionCore answered each with `realtime.error
 * REALTIME_UNSUPPORTED_MESSAGE` and the invoke never resolved (one leaked
 * listener per call). Each value is the one its renderer callers already treat
 * as "not available": `false`/`null`/`''`, an unsuccessful `IBridgeResponse`,
 * or `undefined` for writes and for reads whose caller keeps its own default.
 */
export const ELECTRON_ONLY_PROVIDER_DEFAULTS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  // application
  ['restart-app', Object.freeze({ restarted: false, manualRestartRequired: false })],
  ['open-dev-tools', false],
  ['is-dev-tools-opened', false],
  ['app.get-path', ''],
  ['update-system-info', undefined],
  // useFontScale keeps its own default when the factor is not a number.
  ['app.get-zoom-factor', undefined],
  ['app.set-zoom-factor', undefined],
  ['app.get-cdp-status', BRIDGE_FAILURE],
  ['app.update-cdp-config', BRIDGE_FAILURE],
  ['app.clear-browser-data', BRIDGE_FAILURE],
  ['app.report-browser-webcontents-id', BRIDGE_FAILURE],
  ['app.get-start-on-boot-status', BRIDGE_FAILURE],
  ['app.set-start-on-boot', BRIDGE_FAILURE],
  ['app.get-gpu-status', BRIDGE_FAILURE],
  ['app.set-gpu-override', BRIDGE_FAILURE],
  ['app.write-renderer-log', undefined],
  // update / autoUpdate (no desktop updater in the WebUI)
  ['update.check', BRIDGE_FAILURE],
  ['update.installer-last-failure.consume', BRIDGE_FAILURE],
  ['update.download', BRIDGE_FAILURE],
  ['update.download.cancel', BRIDGE_FAILURE],
  ['auto-update.check', BRIDGE_FAILURE],
  ['auto-update.restore-downloaded', BRIDGE_FAILURE],
  ['auto-update.download', BRIDGE_FAILURE],
  ['auto-update.download.cancel', BRIDGE_FAILURE],
  ['auto-update.quit-and-install', undefined],
  // skill files: the WebUI uses /api/fs/* instead (ipcBridge `fs`)
  ['skills.files.list', Object.freeze([])],
  ['skills.files.read', ''],
  // window controls
  ['window-controls:minimize', undefined],
  ['window-controls:maximize', undefined],
  ['window-controls:unmaximize', undefined],
  ['window-controls:close', undefined],
  ['window-controls:is-maximized', false],
  // theme: no cached custom CSS (as before TASK-89)
  ['theme:set-active', undefined],
  ['theme:request-current', null],
  // system settings: the main-process defaults (process/bridge/systemSettingsBridge.ts)
  ['system-settings:get-close-to-tray', false],
  ['system-settings:set-close-to-tray', undefined],
  ['system-settings:get-pet-enabled', false],
  ['system-settings:set-pet-enabled', undefined],
  ['system-settings:get-pet-size', 280],
  ['system-settings:set-pet-size', undefined],
  ['system-settings:get-pet-dnd', false],
  ['system-settings:set-pet-dnd', undefined],
  ['system-settings:get-pet-confirm-enabled', true],
  ['system-settings:set-pet-confirm-enabled', undefined],
  // notification: the WebUI notifies through the browser Notification API
  ['notification.show', undefined],
  // desktop WebUI server lifecycle (callers treat null as "no status")
  ['webui.get-status', null],
  ['webui.start', null],
  ['webui.stop', undefined],
]);

const win = window as CustomWindow;

/**
 * 适配electron的API到浏览器中,建立renderer和main的通信桥梁, 与preload.ts中的注入对应
 * */
if (win.electronAPI) {
  // Electron 环境 - 使用 IPC 通信
  bridge.adapter({
    emit(name, data) {
      return win.electronAPI.emit(name, data);
    },
    on(emitter) {
      win.electronAPI?.on((event) => {
        try {
          const { value } = event;
          const { name, data } = JSON.parse(value);
          emitter.emit(name, data);
        } catch (e) {
          console.warn('JSON parsing error:', e);
        }
      });
    },
  });
} else {
  // Web 环境 - 使用 WebSocket 通信，并在登录后自动补上已获取 Cookie 的连接
  // Web runtime bridge: ensure the socket reconnects after login so session cookie can be sent.
  // Path must be `/ws` — web-host's static-server only proxies WebSocket upgrades under /ws.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = `${window.location.hostname}:${WEBUI_DEFAULT_PORT}`;
  const socketUrl = `${protocol}//${window.location.host || defaultHost}/ws`;

  type QueuedMessage = { name: string; data: unknown };

  const BASE_RECONNECT_DELAY = 500;
  const MAX_RECONNECT_DELAY = 8000;
  // A connection must hold this long before the backoff is considered recovered.
  // A server that accepts the upgrade and drops it right away (rejected auth,
  // backend restarting) still fires `open`, so resetting the delay there alone
  // would keep the backoff pinned at its minimum forever.
  const STABLE_CONNECTION_MS = 5000;

  let socket: WebSocket | null = null;
  let emitterRef: { emit: (name: string, data: unknown) => void } | null = null;
  let reconnectTimer: number | null = null;
  let reconnectDelay = BASE_RECONNECT_DELAY;
  let connectedAt = 0;
  let shouldReconnect = true; // Flag to control reconnection

  const messageQueue: QueuedMessage[] = [];

  // 1.发送队列中积压的消息，确保在重新建立连接后不会丢事件
  const flushQueue = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (messageQueue.length > 0) {
      const queued = messageQueue.shift();
      if (queued) {
        socket.send(JSON.stringify(queued));
      }
    }
  };

  // 2.简单的指数退避重连，等待服务端在登录成功后接受新连接
  const scheduleReconnect = () => {
    if (reconnectTimer !== null || !shouldReconnect) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  };

  // 跳转到登录页（已在登录页则跳过，防止无限刷新循环）
  // Redirect to the login page (skipped when already there to avoid a reload loop).
  const redirectToLogin = () => {
    if (window.location.pathname === '/login' || window.location.hash.includes('/login')) {
      return;
    }

    // 短暂延迟以便展示 UI 反馈；用 hash 导航留在 SPA 内（HashRouter），
    // 避免整页刷新落到空 hash 造成白屏
    // Short delay to surface any UI feedback; hash navigation stays within the SPA
    // (HashRouter) instead of a full reload that would land on an empty hash.
    setTimeout(() => {
      window.location.hash = '/login';
    }, 1000);
  };

  // 3.建立 WebSocket 连接（或复用已有的 OPEN/CONNECTING 状态）
  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      socket = new WebSocket(socketUrl);
    } catch (error) {
      scheduleReconnect();
      return;
    }

    // Capture the socket created in this call so the close handler only
    // nulls the outer reference when it still points at THIS socket.
    // Without this guard, a late-firing close event from the OLD socket
    // could wipe the reference to a NEWLY created replacement socket.
    const currentSocket = socket;

    currentSocket.addEventListener('open', () => {
      connectedAt = Date.now();
      flushQueue();
    });

    currentSocket.addEventListener('message', (event: MessageEvent) => {
      if (!emitterRef) {
        return;
      }

      try {
        const payload = JSON.parse(event.data as string) as unknown;

        if (!isBrowserWebSocketPayload(payload)) {
          return;
        }

        // 处理服务端心跳 ping，立即回复 pong 以保持连接
        // Handle server heartbeat ping - respond with pong immediately to keep connection alive
        if (payload.name === 'ping') {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ name: 'pong', data: { timestamp: Date.now() } }));
          }
          return;
        }

        // 处理认证过期 - 先静默续期，成功则重连，失败才跳转登录页
        // Handle auth expiration - try a silent refresh first; reconnect on success,
        // and only fall back to the login page when the refresh token is also dead.
        if (isRealtimeAuthTerminalError(payload)) {
          console.warn('[WebSocket] Authentication expired, attempting silent refresh');

          // 续期期间暂停自动重连，避免拿着失效 Cookie 空转（#4124 的重连风暴）
          // Pause auto-reconnect while refreshing so the dead cookie can't loop
          // (the #4124 reconnect storm).
          shouldReconnect = false;
          if (reconnectTimer !== null) {
            window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          socket?.close();

          void refreshSession().then((refreshed) => {
            if (refreshed) {
              // 新 Cookie 已就位，重连即可携带
              // Fresh cookie is in place — the reconnect carries it.
              shouldReconnect = true;
              reconnectDelay = 500;
              connect();
              return;
            }
            redirectToLogin();
          });

          return;
        }

        if (isUnrecoverableRealtimeError(payload)) {
          console.warn('[WebSocket] Unrecoverable realtime error, reconnecting');
          emitterRef.emit(payload.name, payload.data);
          currentSocket.close();
          return;
        }

        emitterRef.emit(payload.name, payload.data);
      } catch (error) {
        // 忽略格式错误的消息 / Ignore malformed payloads
      }
    });

    currentSocket.addEventListener('close', (event: CloseEvent) => {
      // Only null the outer reference if it still points at this socket.
      if (socket === currentSocket) {
        socket = null;
      }

      // Only credit the backoff if the connection actually held for a while.
      // Otherwise an accept-then-immediately-drop server keeps the delay at its
      // minimum and the client hammers it forever.
      if (connectedAt !== 0 && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
        reconnectDelay = BASE_RECONNECT_DELAY;
      }
      connectedAt = 0;

      scheduleReconnect();
    });

    currentSocket.addEventListener('error', () => {
      currentSocket.close();
    });
  };

  // 4.确保在发送/订阅前已经发起连接
  const ensureSocket = () => {
    // 认证已终止时不得重连，否则 emit 会绕过上面的“停止重连”逻辑
    // A terminal auth error deliberately stops reconnection; emit() must not restart it.
    if (!shouldReconnect) {
      return;
    }

    // 已有退避重连在排队时不要立即重拨，否则退避形同虚设
    // A backoff reconnect is already queued — let it run. Dialling here instead
    // would tie the reconnect rate to how often the app emits bridge events
    // rather than to the backoff, turning a failing connection into a storm.
    if (reconnectTimer !== null) {
      return;
    }

    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      connect();
    }
  };

  const PROVIDER_REQUEST_PREFIX = 'subscribe-';
  const loggedUnsupportedKeys = new Set<string>();

  /**
   * Answers a provider request (`subscribe-<key>`) that AionCore does not serve,
   * without sending it. Returns `true` when the request was answered here.
   * Allowlisted keys and every non-provider frame (realtime names, callbacks)
   * return `false` and go over the socket unchanged.
   */
  const answerLocally = (name: string, data: unknown): boolean => {
    if (!name.startsWith(PROVIDER_REQUEST_PREFIX)) {
      return false;
    }
    const key = name.slice(PROVIDER_REQUEST_PREFIX.length);
    if (WS_PROVIDER_KEYS.has(key)) {
      return false;
    }
    let value: unknown;
    if (ELECTRON_ONLY_PROVIDER_DEFAULTS.has(key)) {
      value = ELECTRON_ONLY_PROVIDER_DEFAULTS.get(key);
    } else {
      value = WEB_UNSUPPORTED_RESULT;
      if (!loggedUnsupportedKeys.has(key)) {
        loggedUnsupportedKeys.add(key);
        console.debug(`[bridge] "${key}" is not available in the WebUI; answered as unsupported`);
      }
    }
    if (isRecord(data) && typeof data.id === 'string') {
      // A fresh copy per answer, like a deserialised reply: callers own their result.
      const answer = Array.isArray(value) ? [...value] : isRecord(value) ? { ...value } : value;
      emitterRef?.emit(`subscribe.callback-${key}${data.id}`, answer);
    }
    return true;
  };

  bridge.adapter({
    emit(name, data) {
      if (answerLocally(name, data)) {
        return;
      }

      const message: QueuedMessage = { name, data };

      ensureSocket();

      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(message));
          return;
        } catch (error) {
          scheduleReconnect();
        }
      }

      messageQueue.push(message);
    },
    on(emitter) {
      emitterRef = emitter;
      win.__bridgeEmitter = emitter;

      ensureSocket();
    },
  });

  connect();

  // Expose reconnection control for login flow
  win.__websocketReconnect = () => {
    shouldReconnect = true;
    reconnectDelay = BASE_RECONNECT_DELAY;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connect();
  };
}

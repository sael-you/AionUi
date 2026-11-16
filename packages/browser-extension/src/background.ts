/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MV3 service worker: wires Chrome's debugger, tabs, storage and alarms into
 * the Relay and answers the popup. The worker may stop at any time; the relay
 * state lives in chrome.storage (pairing in `local`, shared tabs in `session`,
 * which a browser restart clears: nothing is re-shared automatically), and a
 * 30-second alarm reconnects when the device should be online.
 */

import { browserLabelFrom } from './protocol';
import { Relay, type PersistedState, type RelaySnapshot, type SocketLike } from './relay';
import type { PopupRequest, PopupResponse } from './popupMessages';

const PERSISTED_KEY = 'aionui_relay';
const SHARED_KEY = 'aionui_shared_tabs';
const ALARM = 'aionui-relay-keepalive';
/** Wait at most this long for a new tab to commit an http(s) URL before attaching. */
const NEW_TAB_COMMIT_TIMEOUT_MS = 15_000;
const DEBUGGER_PROTOCOL = '1.3';
/** Badge colour (Arco primary-6 as RGBA) for the shared-tab count. */
const BADGE_COLOR: [number, number, number, number] = [22, 93, 255, 255];

const lastErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : (chrome.runtime.lastError?.message ?? String(error));

/** Resolve with the tab id once it shows an http(s) URL (attach refuses blank and chrome:// pages). */
const waitForCommittedTab = (tabId: number): Promise<number> =>
  new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok) resolve(tabId);
      else reject(new Error('the new tab did not load'));
    };
    chrome.tabs.onUpdated.addListener((id, info, tab) => {
      if (id === tabId && /^https?:/i.test(info.url ?? tab.url ?? '')) finish(true);
    });
    setTimeout(() => finish(false), NEW_TAB_COMMIT_TIMEOUT_MS);
    void chrome.tabs.get(tabId).then((tab) => {
      if (/^https?:/i.test(tab.url ?? '')) finish(true);
    });
  });

/** The relay's socket interface over a browser WebSocket. */
const socketFor = (url: string): SocketLike => {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = () => socket.onclose?.();
  ws.onerror = () => socket.onerror?.();
  return socket;
};

const updateBadge = (snapshot: RelaySnapshot): void => {
  const count = snapshot.tabs.length;
  void chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
};

const relay = new Relay({
  createSocket: (url) => socketFor(url),
  attach: async (tabId) => {
    await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL);
  },
  detach: async (tabId) => {
    await chrome.debugger.detach({ tabId });
  },
  sendCommand: async (tabId, method, params) =>
    (await chrome.debugger.sendCommand({ tabId }, method, (params ?? {}) as object)) ?? {},
  getTab: async (tabId) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      return { url: tab.url ?? tab.pendingUrl ?? '', title: tab.title ?? '' };
    } catch {
      return null;
    }
  },
  createTab: async (url) => {
    const tab = await chrome.tabs.create({ url, active: false });
    if (tab.id === undefined) throw new Error('could not open a tab');
    return waitForCommittedTab(tab.id);
  },
  removeTab: async (tabId) => {
    await chrome.tabs.remove(tabId);
  },
  loadPersisted: async () =>
    ((await chrome.storage.local.get(PERSISTED_KEY))[PERSISTED_KEY] ?? {}) as Partial<PersistedState>,
  savePersisted: async (state) => {
    await chrome.storage.local.set({ [PERSISTED_KEY]: state });
  },
  loadShared: async () => {
    const value = (await chrome.storage.session.get(SHARED_KEY))[SHARED_KEY];
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : [];
  },
  saveShared: async (tabIds) => {
    await chrome.storage.session.set({ [SHARED_KEY]: tabIds });
  },
  browser: browserLabelFrom(navigator.userAgent),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  onChange: (snapshot) => {
    updateBadge(snapshot);
    // The popup listens while it is open; nobody listening is fine.
    chrome.runtime.sendMessage({ type: 'snapshot', snapshot }).catch(() => undefined);
  },
});

const ready = relay.init();

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== undefined) relay.onDebuggerEvent(source.tabId, method, params);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== undefined) void ready.then(() => relay.onDebuggerDetach(source.tabId as number, reason));
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined || info.title !== undefined) relay.onTabUpdated(tabId, info);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => relay.onTabRemoved(tabId));
});

void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void ready.then(() => relay.ensureConnected());
});
chrome.runtime.onStartup.addListener(() => void ready);
chrome.runtime.onInstalled.addListener(() => void ready);

const handlePopup = async (request: PopupRequest): Promise<PopupResponse> => {
  await ready;
  try {
    switch (request.type) {
      case 'get':
        break;
      case 'pair':
        await relay.pair(request.address, request.code, request.device_name);
        break;
      case 'share':
        await relay.share(request.tab_id);
        break;
      case 'unshare':
        await relay.unshare(request.tab_id);
        break;
      case 'new_tabs':
        await relay.setNewTabs(request.allowed);
        break;
      case 'stop':
        await relay.stop();
        break;
      case 'resume':
        await relay.resume();
        break;
      case 'unpair':
        await relay.unpair();
        break;
    }
    return { ok: true, snapshot: relay.snapshot() };
  } catch (error) {
    return { ok: false, error: lastErrorMessage(error), snapshot: relay.snapshot() };
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = message as PopupRequest;
  if (!request || typeof request !== 'object' || !('type' in request) || request.type === undefined) return false;
  void handlePopup(request).then(sendResponse);
  return true;
});

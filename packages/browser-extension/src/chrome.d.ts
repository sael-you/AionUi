/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The few Chrome extension APIs this extension uses (MV3, Chrome ≥116), typed
 * here instead of pulling in @types/chrome. Promise forms only. (`debugger` is
 * a reserved word, so this is a typed global object, not namespaces.)
 */

type ChromeTab = { id?: number; url?: string; pendingUrl?: string; title?: string; active: boolean; windowId: number };
type ChromeTabChange = { url?: string; title?: string; status?: string };
type ChromeDebuggee = { tabId?: number };
type ChromeStorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
type ChromeEvent<T extends (...args: never[]) => unknown> = { addListener(callback: T): void };

declare const chrome: {
  runtime: {
    lastError: { message?: string } | undefined;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: ChromeEvent<
      (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void
    >;
    onStartup: ChromeEvent<() => void>;
    onInstalled: ChromeEvent<() => void>;
  };
  debugger: {
    attach(target: ChromeDebuggee, requiredVersion: string): Promise<void>;
    detach(target: ChromeDebuggee): Promise<void>;
    sendCommand(target: ChromeDebuggee, method: string, commandParams?: object): Promise<object | undefined>;
    onEvent: ChromeEvent<(source: ChromeDebuggee, method: string, params?: object) => void>;
    onDetach: ChromeEvent<(source: ChromeDebuggee, reason: string) => void>;
  };
  tabs: {
    get(tabId: number): Promise<ChromeTab>;
    create(properties: { url: string; active?: boolean }): Promise<ChromeTab>;
    remove(tabId: number): Promise<void>;
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<ChromeTab[]>;
    onUpdated: ChromeEvent<(tabId: number, changeInfo: ChromeTabChange, tab: ChromeTab) => void>;
    onRemoved: ChromeEvent<(tabId: number) => void>;
  };
  storage: { local: ChromeStorageArea; session: ChromeStorageArea };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    onAlarm: ChromeEvent<(alarm: { name: string }) => void>;
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string | [number, number, number, number] }): Promise<void>;
  };
  i18n: { getUILanguage(): string };
};

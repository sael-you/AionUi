/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** AionUi Browser Bridge relay (C34 / TASK-125): wire frames, sharing rules, reconnect, revoke. */

import { describe, expect, it, vi } from 'vitest';

import { browserLabelFrom, normalizePairingCode, originFor, parseCoreFrame, socketUrlFor } from './protocol';
import { localeFor, MESSAGES, LOCALES, translate } from './i18n';
import { LAN_REGEX_FILTERS, LAN_RULE_IDS, isLanHost, isLanUrl, lanBlockRules } from './lanGuard';
import { RECONNECT_MAX_MS, Relay, errorCodeOf, type PersistedState, type RelayDeps, type SocketLike } from './relay';

type FakeSocket = SocketLike & { url: string; sent: Record<string, unknown>[]; closed: boolean };

const setup = (persisted: Partial<PersistedState> = {}, shared: number[] = []) => {
  const sockets: FakeSocket[] = [];
  const tabs = new Map<number, { url: string; title: string }>([
    [1, { url: 'https://mail.example.com/', title: 'Mail' }],
    [2, { url: 'https://docs.example.com/', title: 'Docs' }],
  ]);
  const timers: Array<{ fn: () => void; ms: number; repeat: boolean; cleared: boolean }> = [];
  let saved: PersistedState | null = null;
  let savedShared: number[] = shared;
  let lanBlocked: number[] = [];
  const deps: RelayDeps = {
    createSocket: (url) => {
      const socket: FakeSocket = {
        url,
        sent: [],
        closed: false,
        send: (data) => socket.sent.push(JSON.parse(data) as Record<string, unknown>),
        close: () => {
          socket.closed = true;
        },
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      sockets.push(socket);
      return socket;
    },
    attach: vi.fn(async (tabId: number) => {
      if (!tabs.has(tabId)) throw new Error('No tab with given id 9.');
    }),
    detach: vi.fn(async () => undefined),
    sendCommand: vi.fn(async (_tabId: number, method: string) => {
      if (method === 'Boom.fail') throw new Error('Debugger is not attached to the tab with id: 1.');
      return { value: 42 };
    }),
    getTab: vi.fn(async (tabId: number) => tabs.get(tabId) ?? null),
    createTab: vi.fn(async (url: string) => {
      tabs.set(7, { url, title: '' });
      return 7;
    }),
    removeTab: vi.fn(async (tabId: number) => {
      tabs.delete(tabId);
    }),
    loadPersisted: async () => persisted,
    savePersisted: async (state) => {
      saved = state;
    },
    loadShared: async () => savedShared,
    saveShared: async (ids) => {
      savedShared = ids;
    },
    setLanBlockedTabs: vi.fn(async (ids: number[]) => {
      lanBlocked = ids;
    }),
    browser: 'Chrome 157',
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, repeat: false, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    setInterval: (fn, ms) => {
      const timer = { fn, ms, repeat: true, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearInterval: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    random: () => 0,
  };
  const relay = new Relay(deps);
  const socket = () => sockets[sockets.length - 1];
  const receive = async (frame: Record<string, unknown>) => {
    socket().onmessage?.({ data: JSON.stringify(frame) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const open = () => socket().onopen?.();
  const drop = () => socket().onclose?.();
  const sentTypes = () => socket().sent.map((frame) => frame.type);
  return {
    relay,
    deps,
    sockets,
    socket,
    receive,
    open,
    drop,
    sentTypes,
    timers,
    saved: () => saved,
    savedShared: () => savedShared,
    lanBlocked: () => lanBlocked,
    tabs,
  };
};

const PAIRED: Partial<PersistedState> = {
  address: 'https://aionui.example.com',
  token: 'tok-1',
  device_id: 'dev_1',
  device_name: 'Mac',
};

const online = async (shared: number[] = []) => {
  const h = setup(PAIRED, shared);
  await h.relay.init();
  h.open();
  await h.receive({ type: 'welcome', device_id: 'dev_1' });
  return h;
};

describe('protocol helpers', () => {
  it('turns what the owner typed into the socket URL and origin', () => {
    expect(socketUrlFor('aionui.example.com')).toBe('wss://aionui.example.com/api/browser/extension');
    expect(socketUrlFor('https://aionui.example.com/some/page')).toBe('wss://aionui.example.com/api/browser/extension');
    expect(socketUrlFor('http://localhost:8080')).toBe('ws://localhost:8080/api/browser/extension');
    expect(socketUrlFor('http://127.0.0.1:3000')).toBe('ws://127.0.0.1:3000/api/browser/extension');
    expect(socketUrlFor('http://[::1]:8080')).toBe('ws://[::1]:8080/api/browser/extension');
    // Plain http elsewhere would send the device token unencrypted: refused.
    expect(socketUrlFor('http://aionui.example.com')).toBeNull();
    expect(socketUrlFor('http://192.168.1.10:8080')).toBeNull();
    expect(socketUrlFor('http://localhost.evil.com')).toBeNull();
    expect(originFor('http://aionui.example.com')).toBeNull();
    expect(socketUrlFor('ftp://x')).toBeNull();
    expect(socketUrlFor('  ')).toBeNull();
    expect(originFor('aionui.example.com/')).toBe('https://aionui.example.com');
  });

  it('parses only well-formed core frames', () => {
    expect(parseCoreFrame('{"type":"command","id":3,"tab_id":1,"method":"Page.reload"}')).toMatchObject({ id: 3 });
    expect(parseCoreFrame('{"type":"command","id":"3","tab_id":1,"method":"x"}')).toBeNull();
    expect(parseCoreFrame('{"type":"welcome","device_id":"d","token":"t"}')).toMatchObject({ token: 't' });
    expect(parseCoreFrame('{"type":"mystery"}')).toBeNull();
    expect(parseCoreFrame('not json')).toBeNull();
    expect(parseCoreFrame(42)).toBeNull();
  });

  it('labels the browser and normalises codes', () => {
    expect(browserLabelFrom('Mozilla/5.0 (Macintosh) Chrome/157.0.0.0 Safari/537.36')).toBe('Chrome 157');
    expect(browserLabelFrom('… Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge 140');
    expect(normalizePairingCode(' abcd-2345 ')).toBe('ABCD-2345');
  });

  it('maps debugger errors to short codes', () => {
    expect(errorCodeOf('No tab with given id 5.')).toBe('tab_closed');
    expect(errorCodeOf('Debugger is not attached to the tab with id: 1.')).toBe('not_attached');
    expect(errorCodeOf('Cannot access a chrome:// URL')).toBe('restricted_url');
    expect(errorCodeOf('something else')).toBeUndefined();
  });
});

describe('pairing and hello', () => {
  it('pairs with the one-time code, stores the token from welcome and reports the shared tabs', async () => {
    const h = setup();
    await h.relay.init();
    expect(h.relay.snapshot().status).toBe('unpaired');
    expect(h.sockets).toHaveLength(0);

    await h.relay.pair('aionui.example.com', 'abcd-2345', ' Work Mac ');
    expect(h.socket().url).toBe('wss://aionui.example.com/api/browser/extension');
    h.open();
    expect(h.socket().sent[0]).toEqual({
      type: 'pair',
      code: 'ABCD-2345',
      device_name: 'Work Mac',
      browser: 'Chrome 157',
    });

    await h.receive({ type: 'welcome', device_id: 'dev_9', token: 'secret-token' });
    expect(h.relay.snapshot()).toMatchObject({ status: 'online', device_id: 'dev_9' });
    expect(h.saved()).toMatchObject({
      token: 'secret-token',
      device_id: 'dev_9',
      address: 'https://aionui.example.com',
    });
    expect(h.socket().sent[1]).toEqual({ type: 'state', new_tabs: true, tabs: [] });
  });

  it('reconnects later with hello and the stored token (never the code)', async () => {
    const h = setup(PAIRED);
    await h.relay.init();
    h.open();
    expect(h.socket().sent[0]).toEqual({ type: 'hello', token: 'tok-1', browser: 'Chrome 157', version: 1 });
  });

  it('a wrong or expired code ends in an error state without reconnecting', async () => {
    const h = setup();
    await h.relay.init();
    await h.relay.pair('aionui.example.com', 'XXXX-0000', 'Mac');
    h.open();
    await h.receive({ type: 'error', code: 'BROWSER_PAIRING_INVALID' });
    h.drop();
    expect(h.relay.snapshot()).toMatchObject({ status: 'error', error_code: 'BROWSER_PAIRING_INVALID' });
    expect(h.timers.filter((t) => !t.repeat && !t.cleared)).toHaveLength(0);
  });

  it('rejects an address that is not http(s), and plain http to another computer', async () => {
    const h = setup();
    await h.relay.init();
    await expect(h.relay.pair('ftp://x', 'ABCD', 'Mac')).rejects.toThrow('invalid_address');
    await expect(h.relay.pair('http://aionui.example.com', 'ABCD', 'Mac')).rejects.toThrow('invalid_address');
    expect(h.sockets).toHaveLength(0);
  });

  it('a stored plain-http address of another computer never opens a socket', async () => {
    const h = setup({ ...PAIRED, address: 'http://aionui.example.com' });
    await h.relay.init();
    h.relay.ensureConnected();
    expect(h.sockets).toHaveLength(0);
  });
});

describe('sharing', () => {
  it('nothing is shared by default; sharing attaches and reports the full list', async () => {
    const h = await online();
    expect(h.relay.snapshot().tabs).toEqual([]);
    await h.relay.share(1);
    expect(h.deps.attach).toHaveBeenCalledWith(1);
    expect(h.socket().sent.at(-1)).toEqual({
      type: 'state',
      new_tabs: true,
      tabs: [{ tab_id: 1, url: 'https://mail.example.com/', title: 'Mail' }],
    });
    expect(h.savedShared()).toEqual([1]);
  });

  it('forwards commands for shared tabs only, with results and coded errors', async () => {
    const h = await online();
    await h.relay.share(1);
    await h.receive({ type: 'command', id: 1, tab_id: 1, method: 'Runtime.evaluate', params: { expression: '1' } });
    expect(h.deps.sendCommand).toHaveBeenCalledWith(1, 'Runtime.evaluate', { expression: '1' });
    expect(h.socket().sent.at(-1)).toEqual({ type: 'result', id: 1, result: { value: 42 } });

    await h.receive({ type: 'command', id: 2, tab_id: 2, method: 'Runtime.evaluate' });
    expect(h.socket().sent.at(-1)).toEqual({
      type: 'result',
      id: 2,
      error: { message: 'tab is not shared', code: 'not_shared' },
    });
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1);

    await h.receive({ type: 'command', id: 3, tab_id: 1, method: 'Boom.fail' });
    expect(h.socket().sent.at(-1)).toMatchObject({ id: 3, error: { code: 'not_attached' } });
  });

  it('sends the full state on every URL or title change of a shared tab (approvals read the origin from it)', async () => {
    const h = await online();
    await h.relay.share(1);
    const states = () => h.socket().sent.filter((frame) => frame.type === 'state');
    const before = states().length;
    h.relay.onTabUpdated(1, { url: 'https://accounts.google.com/signin' });
    expect(states().at(-1)).toEqual({
      type: 'state',
      new_tabs: true,
      tabs: [{ tab_id: 1, url: 'https://accounts.google.com/signin', title: 'Mail' }],
    });
    h.relay.onTabUpdated(1, { title: 'Sign in' });
    expect(states().at(-1)).toMatchObject({ tabs: [{ tab_id: 1, title: 'Sign in' }] });
    expect(states()).toHaveLength(before + 2);
    // No change, or a tab that is not shared: nothing is sent.
    h.relay.onTabUpdated(1, { url: 'https://accounts.google.com/signin' });
    h.relay.onTabUpdated(2, { url: 'https://evil.example.com/' });
    expect(states()).toHaveLength(before + 2);
  });

  it('forwards every debugger event of a shared tab (Fetch included) and nothing from other tabs', async () => {
    const h = await online();
    await h.relay.share(1);
    h.relay.onDebuggerEvent(1, 'Fetch.requestPaused', { requestId: 'r1' });
    h.relay.onDebuggerEvent(2, 'Page.loadEventFired', {});
    const events = h.socket().sent.filter((frame) => frame.type === 'event');
    expect(events).toEqual([{ type: 'event', tab_id: 1, method: 'Fetch.requestPaused', params: { requestId: 'r1' } }]);
  });

  it('a cancelled debugging bar, a closed tab and Unshare all remove the tab and tell AionUi', async () => {
    const h = await online();
    await h.relay.share(1);
    await h.relay.share(2);
    await h.relay.onDebuggerDetach(1, 'canceled_by_user');
    await h.relay.onTabRemoved(2);
    expect(h.socket().sent.filter((frame) => frame.type === 'detached')).toEqual([
      { type: 'detached', tab_id: 1, reason: 'canceled_by_user' },
      { type: 'detached', tab_id: 2, reason: 'tab_closed' },
    ]);
    expect(h.relay.snapshot().tabs).toEqual([]);
  });

  it('opens new tabs only while allowed, shares them and answers with the tab id', async () => {
    const h = await online();
    await h.receive({ type: 'create_tab', id: 5, url: 'https://news.example.com/' });
    expect(h.socket().sent.at(-1)).toEqual({ type: 'result', id: 5, result: { tab_id: 7 } });
    expect(h.relay.isShared(7)).toBe(true);

    await h.relay.setNewTabs(false);
    expect(h.socket().sent.at(-1)).toMatchObject({ type: 'state', new_tabs: false });
    await h.receive({ type: 'create_tab', id: 6, url: 'https://x.example.com/' });
    expect(h.socket().sent.at(-1)).toEqual({
      type: 'result',
      id: 6,
      error: { message: 'new tabs are off', code: 'new_tabs_disabled' },
    });
    expect(h.deps.createTab).toHaveBeenCalledTimes(1);

    await h.relay.setNewTabs(true);
    await h.receive({ type: 'create_tab', id: 8, url: 'file:///etc/passwd' });
    expect(h.socket().sent.at(-1)).toMatchObject({ id: 8, error: { code: 'restricted_url' } });
  });

  it('closes only shared tabs', async () => {
    const h = await online();
    await h.receive({ type: 'close_tab', id: 4, tab_id: 2 });
    expect(h.deps.removeTab).not.toHaveBeenCalled();
    await h.relay.share(2);
    await h.receive({ type: 'close_tab', id: 5, tab_id: 2 });
    expect(h.deps.removeTab).toHaveBeenCalledWith(2);
    expect(h.socket().sent.at(-1)).toEqual({ type: 'result', id: 5, result: {} });
  });

  it('after a worker restart, still-open shared tabs are restored; closed ones are dropped', async () => {
    const h = setup(PAIRED, [1, 9]);
    await h.relay.init();
    expect(h.relay.snapshot().tabs.map((tab) => tab.tab_id)).toEqual([1]);
    expect(h.savedShared()).toEqual([1]);
  });
});

describe('stop, revoke and reconnect', () => {
  it('Stop all detaches every tab, closes the socket and stays down until Resume', async () => {
    const h = await online();
    await h.relay.share(1);
    const first = h.socket();
    await h.relay.stop();
    expect(h.deps.detach).toHaveBeenCalledWith(1);
    expect(first.closed).toBe(true);
    expect(h.relay.snapshot()).toMatchObject({ status: 'stopped', tabs: [] });
    h.relay.ensureConnected();
    expect(h.sockets).toHaveLength(1);

    await h.relay.resume();
    expect(h.sockets).toHaveLength(2);
  });

  it('a revoked device forgets its token and never reconnects', async () => {
    const h = await online();
    await h.relay.share(1);
    await h.receive({ type: 'error', code: 'BROWSER_DEVICE_REVOKED' });
    expect(h.saved()).toMatchObject({ token: null, device_id: null });
    expect(h.relay.snapshot()).toMatchObject({ status: 'error', error_code: 'BROWSER_DEVICE_REVOKED', tabs: [] });
    h.relay.ensureConnected();
    expect(h.sockets).toHaveLength(1);
  });

  it('a dropped connection reconnects with backoff (1 s, 2 s, … capped at 30 s) and pings every 20 s', async () => {
    const h = await online();
    const ping = h.timers.find((t) => t.repeat);
    expect(ping?.ms).toBe(20_000);
    ping?.fn();
    expect(h.socket().sent.at(-1)).toEqual({ type: 'ping' });

    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      h.drop();
      const timer = h.timers.filter((t) => !t.repeat && !t.cleared).at(-1);
      delays.push(timer?.ms ?? -1);
      timer!.cleared = true;
      timer?.fn();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, RECONNECT_MAX_MS, RECONNECT_MAX_MS]);
    expect(h.relay.snapshot().status).toBe('connecting');
    expect(ping?.cleared).toBe(true);
  });
});

describe('popup strings', () => {
  it('every locale has every key and placeholders survive', () => {
    const keys = Object.keys(MESSAGES['en-US']);
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale])).toEqual(keys);
      for (const key of keys) expect(MESSAGES[locale][key as keyof (typeof MESSAGES)['en-US']]).toBeTruthy();
    }
    expect(translate('de-DE', 'status.online', { host: 'y.example.com' })).toBe('Verbunden mit y.example.com');
  });

  it('picks the locale from Chrome UI language', () => {
    expect(localeFor('de')).toBe('de-DE');
    expect(localeFor('pt-BR')).toBe('pt-BR');
    expect(localeFor('zh-TW')).toBe('zh-TW');
    expect(localeFor('zh-HK')).toBe('zh-TW');
    expect(localeFor('zh-CN')).toBe('zh-CN');
    expect(localeFor('nl')).toBe('en-US');
  });
});

describe('LAN guard (TASK-121)', () => {
  const LAN = [
    'http://localhost/',
    'http://LOCALHOST:8080/x',
    'https://printer.local/admin',
    'http://app.localhost/',
    'http://127.0.0.1:9222/json',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0:8000/',
    'http://[::1]:3000/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:192.168.1.1]/',
    'ws://192.168.0.2:8080/socket',
    'http://user:pw@10.1.2.3/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://localhost./',
  ];
  const PUBLIC = [
    'https://example.com/',
    'https://mail.google.com/mail/u/0/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://100.128.0.1/',
    'http://11.0.0.1/',
    'http://192.169.1.1/',
    'https://localhost.example.com/',
    'https://my.locale.com/',
    'https://example.com/?next=http://127.0.0.1/',
    'https://example.com/path/192.168.1.1',
    'http://[2001:db8::1]/',
    'chrome://settings',
  ];
  // What Chrome matches: the URL after parsing (hosts normalised), as declarativeNetRequest sees it.
  const matchesRules = (url: string) => {
    const href = new URL(url).href;
    return LAN_REGEX_FILTERS.some((filter) => new RegExp(filter, 'i').test(href));
  };

  it('recognises local-network addresses, in every literal form', () => {
    for (const url of LAN) expect([url, isLanUrl(url)]).toEqual([url, true]);
    for (const url of PUBLIC) expect([url, isLanUrl(url)]).toEqual([url, false]);
    expect(isLanHost('router.local')).toBe(true);
    expect(isLanHost('')).toBe(false);
  });

  it('the browser block rules match the same addresses and nothing public', () => {
    for (const url of LAN) expect([url, matchesRules(url)]).toEqual([url, true]);
    for (const url of PUBLIC.filter((u) => /^(https?|wss?):/.test(u)))
      expect([url, matchesRules(url)]).toEqual([url, false]);
  });

  it('rules are scoped to the shared tabs, cover page loads and sockets, and vanish when nothing is shared', () => {
    expect(lanBlockRules([])).toEqual([]);
    const rules = lanBlockRules([4, 9]);
    expect(rules.map((rule) => rule.id)).toEqual([...LAN_RULE_IDS]);
    for (const rule of rules) {
      expect(rule.action).toEqual({ type: 'block' });
      expect(rule.condition.tabIds).toEqual([4, 9]);
      expect(rule.condition.resourceTypes).toEqual(
        expect.arrayContaining(['main_frame', 'xmlhttprequest', 'websocket'])
      );
    }
  });

  it('the relay installs the block for a tab before attaching and removes it on unshare', async () => {
    const h = await online();
    const order: string[] = [];
    (h.deps.setLanBlockedTabs as ReturnType<typeof vi.fn>).mockImplementation(async (ids: number[]) => {
      order.push(`block:${ids.join(',')}`);
    });
    (h.deps.attach as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('attach');
    });
    await h.relay.share(1);
    expect(order).toEqual(['block:1', 'attach']);
    await h.relay.unshare(1);
    expect(order.at(-1)).toBe('block:');
  });

  it('a failed attach leaves no block behind', async () => {
    const h = await online();
    (h.deps.attach as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'));
    await expect(h.relay.share(1)).rejects.toThrow('chrome://');
    expect(h.lanBlocked()).toEqual([]);
    expect(h.relay.isShared(1)).toBe(false);
  });

  it('refuses to share a local-network page, to open one and to navigate to one', async () => {
    const h = await online();
    h.tabs.set(3, { url: 'http://192.168.1.1/admin', title: 'Router' });
    await expect(h.relay.share(3)).rejects.toThrow('lan_blocked');
    expect(h.deps.attach).not.toHaveBeenCalled();

    await h.receive({ type: 'create_tab', id: 1, url: 'http://127.0.0.1:9222/json' });
    expect(h.socket().sent.at(-1)).toMatchObject({ id: 1, error: { code: 'lan_blocked' } });
    expect(h.deps.createTab).not.toHaveBeenCalled();

    await h.relay.share(1);
    await h.receive({
      type: 'command',
      id: 2,
      tab_id: 1,
      method: 'Page.navigate',
      params: { url: 'http://printer.local/' },
    });
    expect(h.socket().sent.at(-1)).toMatchObject({ id: 2, error: { code: 'lan_blocked' } });
    expect(h.deps.sendCommand).not.toHaveBeenCalled();
    await h.receive({
      type: 'command',
      id: 3,
      tab_id: 1,
      method: 'Page.navigate',
      params: { url: 'https://example.com/' },
    });
    expect(h.deps.sendCommand).toHaveBeenCalledWith(1, 'Page.navigate', { url: 'https://example.com/' });
  });
});

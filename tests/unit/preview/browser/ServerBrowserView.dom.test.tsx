/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserState } from '@/common/types/platform/serverBrowser';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));

import ServerBrowserView, {
  agentTabToFollow,
} from '@/renderer/pages/conversation/Preview/browser/server/ServerBrowserView';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch('close', {});
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', {});
  }
  receive(data: unknown) {
    this.dispatch('message', {
      data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data),
    });
  }
  private dispatch(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const latest = () => FakeWebSocket.instances.at(-1) as FakeWebSocket;
const sentOfType = (type: string) => latest().sent.filter((message) => message.type === type);

const frame = (seq: number): ArrayBuffer => {
  const meta = new TextEncoder().encode(
    JSON.stringify({
      seq,
      tab_id: 't1',
      width: 1000,
      height: 500,
      device_scale_factor: 1,
      page_scale_factor: 1,
      offset_top: 0,
    })
  );
  const buffer = new ArrayBuffer(4 + meta.length + 2);
  new DataView(buffer).setUint32(0, meta.length, false);
  new Uint8Array(buffer, 4).set(meta);
  return buffer;
};

const STATE: BrowserState = {
  instance: 1,
  max_tabs: 3,
  status: 'running',
  tabs: [
    { id: 't1', url: 'https://discord.com/channels/@me', title: 'Discord', active: true, loading: false },
    { id: 't2', url: 'https://example.com/', title: 'Example', active: false, loading: false },
  ],
  can_go_back: true,
  can_go_forward: false,
  agent_active: false,
};

const decode = vi.fn(async () => ({}) as HTMLImageElement);

const PROFILES = [
  { instance: 1, name: 'Main' },
  { instance: 2, name: 'TB Discord', color: 'blue', emoji: '🎮' },
  { instance: 4, name: 'Personal' },
];

const renderView = async (profiles = PROFILES) => {
  const view = render(<ServerBrowserView profiles={profiles} decodeFrame={decode} />);
  act(() => latest().open());
  return view;
};

const surfaceRect = () => {
  const surface = screen.getByTestId('server-browser-surface');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 500,
    right: 1000,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.defineProperty(surface, 'clientWidth', { value: 1000, configurable: true });
  Object.defineProperty(surface, 'clientHeight', { value: 500, configurable: true });
  return surface;
};

describe('ServerBrowserView (C30 panel)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(Message, 'warning').mockImplementation(() => ({}) as never);
    vi.spyOn(Message, 'info').mockImplementation(() => ({}) as never);
    decode.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects to instance 1 of this host and asks the server to start it', async () => {
    await renderView();
    expect(latest().url).toBe(`ws://${window.location.host}/api/browser/ws?instance=1`);
    expect(latest().binaryType).toBe('arraybuffer');
    expect(sentOfType('start')).toHaveLength(1);
  });

  it('shows the server tabs, the active address and navigation state', async () => {
    await renderView();
    act(() => latest().receive({ type: 'state', ...STATE }));

    expect(screen.getAllByTestId('server-browser-tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Discord' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('server-browser-address')).toHaveValue('https://discord.com/channels/@me');
    expect(screen.getByRole('button', { name: 'common.historyBack' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.forward' })).toBeDisabled();
  });

  it('sends tab, navigation and address actions', async () => {
    await renderView();
    act(() => latest().receive({ type: 'state', ...STATE }));

    fireEvent.click(screen.getByRole('tab', { name: 'Example' }));
    fireEvent.click(screen.getByRole('button', { name: 'preview.serverBrowser.closeTab|{"title":"Example"}' }));
    fireEvent.click(screen.getByRole('button', { name: 'preview.browser.newTab' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.historyBack' }));
    const address = screen.getByTestId('server-browser-address');
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: 'example.org' } });
    fireEvent.keyDown(address, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(sentOfType('tab_select')).toEqual([{ type: 'tab_select', id: 't2' }]);
    expect(sentOfType('tab_close')).toEqual([{ type: 'tab_close', id: 't2' }]);
    expect(sentOfType('tab_new')).toEqual([{ type: 'tab_new' }]);
    expect(sentOfType('back')).toHaveLength(1);
    expect(sentOfType('navigate')).toEqual([{ type: 'navigate', url: 'https://example.org' }]);
  });

  it('disables a new tab at the tab limit', async () => {
    await renderView();
    act(() =>
      latest().receive({
        type: 'state',
        ...STATE,
        tabs: [...STATE.tabs, { id: 't3', url: 'about:blank', title: '', active: false, loading: false }],
      })
    );
    expect(screen.getByRole('button', { name: 'preview.browser.newTab' })).toBeDisabled();
  });

  it('draws frames and acknowledges each one, then maps clicks to page pixels', async () => {
    await renderView();
    act(() => latest().receive({ type: 'state', ...STATE }));
    const surface = surfaceRect();

    await act(async () => {
      latest().receive(frame(7));
    });
    await waitFor(() => expect(sentOfType('frame_ack')).toEqual([{ type: 'frame_ack', seq: 7 }]));
    expect(decode).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(surface, { clientX: 250, clientY: 100, button: 0, detail: 1, shiftKey: true });
    expect(sentOfType('mouse')).toEqual([
      { type: 'mouse', event: 'down', x: 250, y: 100, button: 'left', click_count: 1, modifiers: 8 },
    ]);
  });

  it('forwards keys, leaves Ctrl+V to the paste event and sends pasted text', async () => {
    await renderView();
    act(() => latest().receive({ type: 'state', ...STATE }));
    const surface = screen.getByTestId('server-browser-surface');

    fireEvent.keyDown(surface, { key: 'a', code: 'KeyA', keyCode: 65 });
    fireEvent.keyDown(surface, { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true });
    fireEvent.paste(surface, { clipboardData: { getData: () => 'hello' } });

    expect(sentOfType('key')).toEqual([
      { type: 'key', event: 'down', key: 'a', code: 'KeyA', key_code: 65, modifiers: 0, text: 'a' },
    ]);
    expect(sentOfType('insert_text')).toEqual([{ type: 'insert_text', text: 'hello' }]);
  });

  it('follows the tab an agent acts on and shows that an agent is driving', async () => {
    await renderView();
    act(() => latest().receive({ type: 'state', ...STATE, agent_active: true, agent_tab_id: 't2' }));

    expect(screen.getByTestId('server-browser-agent')).toHaveTextContent('preview.serverBrowser.agentDriving');
    expect(sentOfType('tab_select')).toEqual([{ type: 'tab_select', id: 't2' }]);
  });

  it('answers a page dialog, warns on errors and notes Google refusing sign-in', async () => {
    await renderView();
    act(() =>
      latest().receive({
        type: 'state',
        ...STATE,
        tabs: [{ ...STATE.tabs[0], url: 'https://accounts.google.com/v3/signin/rejected?x=1' }],
      })
    );
    expect(screen.getByText('preview.serverBrowser.googleRejected')).toBeInTheDocument();

    act(() => latest().receive({ type: 'error', code: 'BROWSER_URL_BLOCKED' }));
    expect(Message.warning).toHaveBeenCalledWith('preview.serverBrowser.errors.urlBlocked');

    act(() => latest().receive({ type: 'dialog', tab_id: 't1', kind: 'confirm', message: 'Leave the page?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Leave the page?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.confirm' }));
    expect(sentOfType('dialog_reply')).toEqual([{ type: 'dialog_reply', tab_id: 't1', accept: true }]);
  });

  it('shows the current profile and switches profile by reconnecting with its instance (TASK-124)', async () => {
    await renderView();
    const switcher = screen.getByTestId('server-browser-profile');
    expect(switcher).toHaveTextContent('Main');
    // The launcher finds the address bar by this marker; it must sit on the <input> itself.
    expect(screen.getByRole('textbox', { name: 'preview.browser.addressLabel' })).toHaveAttribute(
      'data-browser-address'
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'preview.serverBrowser.profileLabel' }));
    fireEvent.click(await screen.findByRole('option', { name: /Personal/ }));

    await waitFor(() => expect(latest().url).toContain('/api/browser/ws?instance=4'));
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED);
    expect(screen.getByTestId('server-browser-profile')).toHaveTextContent('Personal');
  });

  it('goes back to Main when the profile on screen is deleted', async () => {
    const view = await renderView();
    fireEvent.click(screen.getByRole('combobox', { name: 'preview.serverBrowser.profileLabel' }));
    fireEvent.click(await screen.findByRole('option', { name: /TB Discord/ }));
    await waitFor(() => expect(latest().url).toContain('instance=2'));

    view.rerender(<ServerBrowserView profiles={PROFILES.filter((p) => p.instance !== 2)} decodeFrame={decode} />);
    await waitFor(() => expect(latest().url).toContain('instance=1'));
  });
});

describe('agentTabToFollow', () => {
  const tabs = STATE.tabs;
  it('follows the agent tab only while an agent drives and the owner did not just pick a tab', () => {
    expect(agentTabToFollow({ tabs, agent_active: true, agent_tab_id: 't2' }, false)).toBe('t2');
    expect(agentTabToFollow({ tabs, agent_active: true, agent_tab_id: 't2' }, true)).toBeNull();
    expect(agentTabToFollow({ tabs, agent_active: false, agent_tab_id: 't2' }, false)).toBeNull();
    expect(agentTabToFollow({ tabs, agent_active: true, agent_tab_id: 't1' }, false)).toBeNull();
    expect(agentTabToFollow({ tabs, agent_active: true, agent_tab_id: 'gone' }, false)).toBeNull();
  });
});

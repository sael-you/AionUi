/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rfb = vi.hoisted(() => {
  type Fake = EventTarget & {
    target: unknown;
    channel: unknown;
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    disconnect: ReturnType<typeof vi.fn>;
  };
  return { instances: [] as Fake[] };
});
vi.mock('@novnc/novnc', () => ({
  default: class extends EventTarget {
    viewOnly = false;
    scaleViewport = false;
    resizeSession = true;
    disconnect = vi.fn();
    constructor(
      public target: unknown,
      public channel: unknown
    ) {
      super();
      rfb.instances.push(this as never);
    }
  },
}));
const api = vi.hoisted(() => ({ stopInstance: { invoke: vi.fn() } }));
vi.mock('@/common/adapter/ipcBridge', () => ({ serverBrowser: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${JSON.stringify(options)}` : key),
  }),
}));

import VncBrowserView from '@/renderer/pages/conversation/Preview/browser/VncBrowserView';
import {
  browserVncUrl,
  panelKindOf,
  vncCloseKey,
} from '@/renderer/pages/conversation/Preview/browser/server/streamProtocol';

const KEY = 'preview.serverBrowser.vnc';

class FakeSocket extends EventTarget {
  static all: FakeSocket[] = [];
  binaryType = '';
  close = vi.fn();
  constructor(public url: string) {
    super();
    FakeSocket.all.push(this);
  }
  end(code: number, reason = '') {
    const event = new Event('close') as Event & { code: number; reason: string };
    event.code = code;
    event.reason = reason;
    this.dispatchEvent(event);
  }
}

describe('Camoufox live view over VNC (TASK-136 U4)', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    rfb.instances.length = 0;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(Message, 'error').mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('builds the socket URL and names the close codes', () => {
    expect(browserVncUrl({ protocol: 'https:', host: 'y.example.com' }, 3)).toBe(
      'wss://y.example.com/api/browser/instances/3/vnc'
    );
    expect(browserVncUrl({ protocol: 'http:', host: 'localhost:8080' }, 1)).toBe(
      'ws://localhost:8080/api/browser/instances/1/vnc'
    );
    const engines = [{ engine: 'chrome' }, { engine: 'camoufox', panel: 'vnc' as const }];
    expect(panelKindOf('camoufox', engines)).toBe('vnc');
    expect(panelKindOf('chrome', engines)).toBe('screencast');
    expect(panelKindOf('camoufox', undefined)).toBe('screencast');
    expect(panelKindOf(undefined, engines)).toBe('screencast');
    expect(vncCloseKey(4409)).toBe('notCamoufox');
    expect(vncCloseKey(4403)).toBe('notAllowed');
    expect(vncCloseKey(4503)).toBe('startFailed');
    expect(vncCloseKey(1000)).toBe('ended');
  });

  it('connects a binary socket for that profile and hands it to noVNC: scaled, no remote resize, view-only', async () => {
    render(<VncBrowserView instance={2} switcher={<span data-testid='switcher' />} />);
    expect(screen.getByTestId('switcher')).toBeInTheDocument();
    await waitFor(() => expect(rfb.instances).toHaveLength(1));
    const socket = FakeSocket.all[0];
    expect(socket.url).toMatch(/\/api\/browser\/instances\/2\/vnc$/);
    expect(socket.binaryType).toBe('arraybuffer');
    const view = rfb.instances[0];
    expect(view.channel).toBe(socket);
    expect(view.target).toBe(screen.getByTestId('vnc-surface'));
    expect(view.scaleViewport).toBe(true);
    expect(view.resizeSession).toBe(false);
    expect(view.viewOnly).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent(`${KEY}.connecting`);
    act(() => {
      view.dispatchEvent(new Event('connect'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the owner turns view-only off to click and type', async () => {
    render(<VncBrowserView instance={2} switcher={null} />);
    await waitFor(() => expect(rfb.instances).toHaveLength(1));
    fireEvent.click(screen.getByTestId('vnc-view-only'));
    await waitFor(() => expect(rfb.instances[0].viewOnly).toBe(false));
  });

  it('says why AionCore closed the view and connects again on request', async () => {
    render(<VncBrowserView instance={2} switcher={null} />);
    await waitFor(() => expect(rfb.instances).toHaveLength(1));
    act(() => {
      FakeSocket.all[0].end(4503, 'BROWSER_ENGINE_MISSING');
    });
    expect(screen.getByTestId('vnc-closed')).toHaveTextContent(
      `${KEY}.closed.startFailed|{"reason":"BROWSER_ENGINE_MISSING"}`
    );
    fireEvent.click(screen.getByTestId('vnc-connect'));
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2));
    await waitFor(() => expect(rfb.instances).toHaveLength(2));
    expect(rfb.instances[0].disconnect).toHaveBeenCalled();
    expect(screen.queryByTestId('vnc-closed')).toBeNull();
  });

  it('Stop stops that profile; leaving the view closes the socket', async () => {
    api.stopInstance.invoke.mockResolvedValue({});
    const view = render(<VncBrowserView instance={2} switcher={null} />);
    await waitFor(() => expect(rfb.instances).toHaveLength(1));
    fireEvent.click(screen.getByTestId('vnc-stop'));
    await waitFor(() => expect(api.stopInstance.invoke).toHaveBeenCalledWith({ instance: 2 }));
    view.unmount();
    expect(FakeSocket.all[0].close).toHaveBeenCalled();
    expect(rfb.instances[0].disconnect).toHaveBeenCalled();
  });
});

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { CdpTarget, CdpTargetEvents } from '@process/resources/builtinMcp/cdpTarget';
import { SINGLE_SESSION_ID, buildTargetInfo } from '@process/resources/builtinMcp/cdpTargetProtocol';

vi.mock('electron', () => ({ webContents: { fromId: () => null } }));

/**
 * The target-agnostic bridge server (TASK-111) over a real loopback socket with a fake target:
 * discovery, the token gate, local Target.* answers, forwarding and the "not attached" error.
 */

type FakeTarget = CdpTarget & { events: CdpTargetEvents; sent: Array<[string, Record<string, unknown>]> };

const fakeTarget =
  (attached: boolean) =>
  (events: CdpTargetEvents): FakeTarget => {
    const sent: Array<[string, Record<string, unknown>]> = [];
    return {
      events,
      sent,
      targetInfo: () => buildTargetInfo('Example', attached ? 'https://example.com/' : 'about:blank'),
      isAttached: () => attached,
      send: async (method, params) => {
        sent.push([method, params]);
        if (method === 'Page.fail') throw new Error('page said no');
        return { frameId: 'f1' };
      },
    };
  };

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

const exchange = (ws: WebSocket, request: Record<string, unknown>, count = 1) =>
  new Promise<Array<Record<string, unknown>>>((resolve) => {
    const replies: Array<Record<string, unknown>> = [];
    const onMessage = (data: WebSocket.RawData) => {
      replies.push(JSON.parse(data.toString()) as Record<string, unknown>);
      if (replies.length === count) {
        ws.off('message', onMessage);
        resolve(replies);
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(request));
  });

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const start = async (attached = true) => {
  const { createCdpBridgeServer } = await import('@process/resources/builtinMcp/cdpBridge');
  const server = await createCdpBridgeServer(fakeTarget(attached), '147.0.0.0');
  servers.push(server);
  return server;
};

describe('createCdpBridgeServer', () => {
  it('serves discovery on loopback with a tokened ws url', async () => {
    const server = await start();
    const version = (await (await fetch(`http://127.0.0.1:${server.port}/json/version`)).json()) as Record<
      string,
      string
    >;
    expect(version.Browser).toBe('Chrome/147.0.0.0');
    expect(version.webSocketDebuggerUrl).toBe(`ws://127.0.0.1:${server.port}/aionui-cdp?token=${server.token}`);
    const list = (await (await fetch(`http://127.0.0.1:${server.port}/json/list`)).json()) as Array<
      Record<string, string>
    >;
    expect(list.map((entry) => entry.url)).toEqual(['https://example.com/']);
  });

  it('refuses a WebSocket without the right token', async () => {
    const server = await start();
    await expect(open(`ws://127.0.0.1:${server.port}/aionui-cdp?token=wrong`)).rejects.toThrow('403');
  });

  it('answers Target.* locally and forwards page commands to the target with the session echoed', async () => {
    const server = await start();
    const ws = await open(`ws://127.0.0.1:${server.port}/aionui-cdp?token=${server.token}`);

    const [reply, event] = await exchange(
      ws,
      { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } },
      2
    );
    expect(reply).toEqual({ id: 1, result: {} });
    expect(event?.method).toBe('Target.attachedToTarget');

    const [forwarded] = await exchange(ws, {
      id: 2,
      method: 'Page.navigate',
      params: { url: 'https://example.com' },
      sessionId: SINGLE_SESSION_ID,
    });
    expect(forwarded).toEqual({ id: 2, result: { frameId: 'f1' }, sessionId: SINGLE_SESSION_ID });
    expect(server.target.sent).toEqual([['Page.navigate', { url: 'https://example.com' }]]);

    const [failed] = await exchange(ws, { id: 3, method: 'Page.fail', sessionId: SINGLE_SESSION_ID });
    expect(failed).toEqual({ id: 3, error: { code: -32000, message: 'page said no' }, sessionId: SINGLE_SESSION_ID });

    server.target.events.emit({ method: 'Page.loadEventFired', params: {}, sessionId: SINGLE_SESSION_ID });
    const evt = await new Promise<Record<string, unknown>>((resolve) =>
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>))
    );
    expect(evt.method).toBe('Page.loadEventFired');
    ws.close();
  });

  it('tells the agent to open the panel when no page is attached', async () => {
    const server = await start(false);
    const ws = await open(`ws://127.0.0.1:${server.port}/aionui-cdp?token=${server.token}`);
    const [reply] = await exchange(ws, { id: 7, method: 'Page.navigate', params: {}, sessionId: SINGLE_SESSION_ID });
    expect(reply?.error).toMatchObject({ message: expect.stringContaining('Open the browser panel') });
    expect(reply?.sessionId).toBe(SINGLE_SESSION_ID);
    expect(server.target.sent).toEqual([]);
    ws.close();
  });
});

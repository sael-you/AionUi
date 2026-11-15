/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { rewriteUpgradeHead, stripForwardedHost, withForwardedHost } from './forwarded-host.js';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

describe('forwarded host rewrite', () => {
  it('overwrites a client X-Forwarded-Host with the received Host and drops Forwarded host=', () => {
    const out = withForwardedHost({
      host: 'y.talkseeds.com',
      'x-forwarded-host': 'evil.example',
      forwarded: 'for=1.2.3.4;host=evil.example;proto=https, host=other.example',
      origin: 'https://evil.example',
    });
    expect(out['x-forwarded-host']).toBe('y.talkseeds.com');
    expect(out.forwarded).toBe('for=1.2.3.4;proto=https');
    expect(out.origin).toBe('https://evil.example');
  });

  it('sends no X-Forwarded-Host when the request had no Host, and drops a host-only Forwarded', () => {
    const out = withForwardedHost({ 'x-forwarded-host': 'evil.example', forwarded: 'Host=evil.example' });
    expect(out).not.toHaveProperty('x-forwarded-host');
    expect(out).not.toHaveProperty('forwarded');
    expect(stripForwardedHost('host="a.example"')).toBe('');
  });

  it('rewrites an upgrade head and keeps the bytes after it', () => {
    const raw = Buffer.from(
      'GET /api/voice/ws HTTP/1.1\r\nHost: y.talkseeds.com\r\nX-Forwarded-Host: evil.example\r\n' +
        'x-forwarded-host: evil2.example\r\nForwarded: host=evil.example;proto=https\r\nUpgrade: websocket\r\n\r\nBODY',
      'latin1'
    );
    const head = rewriteUpgradeHead(raw);
    expect(Buffer.isBuffer(head)).toBe(true);
    const text = (head as Buffer).toString('latin1');
    expect(text.match(/x-forwarded-host/gi)).toHaveLength(1);
    expect(text).toContain('\r\nX-Forwarded-Host: y.talkseeds.com\r\n\r\nBODY');
    expect(text).toContain('\r\nForwarded: proto=https\r\n');
    expect(text).not.toContain('evil');
  });

  it('waits for the full head and refuses bare CR/LF or folded smuggling', () => {
    expect(rewriteUpgradeHead(Buffer.from('GET /ws HTTP/1.1\r\nHost: a\r\n'))).toBeNull();
    expect(rewriteUpgradeHead(Buffer.from('GET /ws HTTP/1.1\r\nHost: a\nX-Forwarded-Host: evil\r\n\r\n'))).toBe(
      'invalid'
    );
    const folded = rewriteUpgradeHead(
      Buffer.from('GET /ws HTTP/1.1\r\nHost: a\r\nX-Forwarded-Host: evil\r\n  more\r\n\r\n')
    ) as Buffer;
    expect(folded.toString('latin1')).not.toMatch(/evil|more/);
  });
});

describe('static server forwards the browser Host as X-Forwarded-Host', () => {
  let handle: StaticServerHandle | null = null;
  let backend: http.Server | null = null;
  let staticDir = '';

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
    if (backend) await new Promise<void>((r) => backend!.close(() => r()));
    backend = null;
    if (staticDir) await fs.rm(staticDir, { recursive: true, force: true });
  });

  async function start(
    onRequest: http.RequestListener,
    onUpgrade?: (req: http.IncomingMessage, s: net.Socket) => void
  ) {
    staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-fh-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html>');
    backend = http.createServer(onRequest);
    if (onUpgrade) backend.on('upgrade', (req, socket) => onUpgrade(req, socket as net.Socket));
    await new Promise<void>((r) => backend!.listen(0, '127.0.0.1', () => r()));
    const backendPort = (backend.address() as AddressInfo).port;
    handle = await startStaticServer({ staticDir, backendPort, port: 0 });
    return backendPort;
  }

  it('proxied request: a client-supplied X-Forwarded-Host that differs from Host is replaced', async () => {
    let seen: http.IncomingHttpHeaders = {};
    const backendPort = await start((req, res) => {
      seen = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: handle!.port,
          method: 'POST',
          path: '/api/mcp/market/instances',
          headers: {
            host: 'y.talkseeds.com',
            origin: 'https://evil.example',
            'x-forwarded-host': 'evil.example',
            forwarded: 'host=evil.example',
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(200);
    expect(seen.host).toBe(`127.0.0.1:${backendPort}`);
    expect(seen['x-forwarded-host']).toBe('y.talkseeds.com');
    expect(seen).not.toHaveProperty('forwarded');
    expect(seen.origin).toBe('https://evil.example');
  });

  it('spliced upgrade: the head reaching the backend carries only the received Host as X-Forwarded-Host', async () => {
    let seen: http.IncomingHttpHeaders = {};
    await start(
      (_req, res) => res.end(),
      (req, socket) => {
        seen = req.headers;
        socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      }
    );
    const status = await new Promise<string>((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: handle!.port }, () => {
        sock.write(
          'GET /ws HTTP/1.1\r\nHost: y.talkseeds.com\r\nOrigin: https://evil.example\r\n' +
            'X-Forwarded-Host: evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
        );
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        if (buf.includes('\r\n')) {
          sock.destroy();
          resolve(buf.slice(0, buf.indexOf('\r\n')));
        }
      });
      sock.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000).unref();
    });
    expect(status).toMatch(/101/);
    expect(seen.host).toBe('y.talkseeds.com');
    expect(seen['x-forwarded-host']).toBe('y.talkseeds.com');
  });
});

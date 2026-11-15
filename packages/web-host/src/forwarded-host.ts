/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * X-Forwarded-Host for AionCore (cards C15/C9).
 *
 * The web host rewrites `Host` to the backend's loopback address, so AionCore
 * cannot see which host the browser addressed. In local identity AionCore
 * trusts an `Origin` naming that host (same-origin) and reads it from
 * `X-Forwarded-Host`. That is only safe because this file OVERWRITES the
 * header with the `Host` the web host received — on proxied requests and on
 * spliced WebSocket upgrades — and drops every client-sent forwarded host
 * (`X-Forwarded-Host`, the `host=` part of `Forwarded`). Nothing else marks a
 * request as coming from the web host: this overwrite is the guarantee.
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

export const FORWARDED_HOST_HEADER = 'x-forwarded-host';

/** Max bytes of an upgrade request head before the connection is dropped. */
export const MAX_UPGRADE_HEAD_BYTES = 16 * 1024;

/** A `Forwarded` value without its `host=` parameters; `''` when nothing is left. */
export function stripForwardedHost(value: string): string {
  return value
    .split(',')
    .map((element) =>
      element
        .split(';')
        .map((pair) => pair.trim())
        .filter((pair) => pair && !/^host\s*=/i.test(pair))
        .join(';')
    )
    .filter(Boolean)
    .join(', ');
}

/** Headers for a proxied request: client forwarded hosts dropped, `X-Forwarded-Host` = the received `Host`. */
export function withForwardedHost(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = { ...headers };
  delete out[FORWARDED_HOST_HEADER];
  if (headers.forwarded !== undefined) {
    const kept = stripForwardedHost(String(headers.forwarded));
    if (kept) out.forwarded = kept;
    else delete out.forwarded;
  }
  if (typeof headers.host === 'string' && headers.host) out[FORWARDED_HOST_HEADER] = headers.host;
  return out;
}

/**
 * The same rewrite on the raw head of an upgrade request that is spliced at
 * TCP level. `null` = the head is not complete yet; `'invalid'` = a bare CR or
 * LF in the head (a line the backend could split differently), refuse it.
 */
export function rewriteUpgradeHead(buf: Buffer): Buffer | 'invalid' | null {
  const end = buf.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const head = buf.subarray(0, end).toString('latin1');
  if (/\r(?!\n)|(?<!\r)\n/.test(head)) return 'invalid';
  const [requestLine, ...lines] = head.split('\r\n');
  const kept: string[] = [];
  let host: string | undefined;
  let dropping = false;
  for (const line of lines) {
    // obs-fold continuation: belongs to the previous header.
    if (/^[ \t]/.test(line)) {
      if (!dropping) kept.push(line);
      continue;
    }
    const colon = line.indexOf(':');
    const name = (colon < 0 ? line : line.slice(0, colon)).trim().toLowerCase();
    const value = colon < 0 ? '' : line.slice(colon + 1).trim();
    dropping = false;
    if (name === FORWARDED_HOST_HEADER) {
      dropping = true;
      continue;
    }
    if (name === 'forwarded') {
      dropping = true;
      const stripped = stripForwardedHost(value);
      if (stripped) kept.push(`Forwarded: ${stripped}`);
      continue;
    }
    if (name === 'host' && host === undefined) host = value;
    kept.push(line);
  }
  if (host) kept.push(`X-Forwarded-Host: ${host}`);
  return Buffer.concat([
    Buffer.from(`${[requestLine, ...kept].join('\r\n')}\r\n\r\n`, 'latin1'),
    buf.subarray(end + 4),
  ]);
}

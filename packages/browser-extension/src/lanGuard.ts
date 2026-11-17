/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LAN guard (TASK-121, owner decision B): a shared tab must not reach the
 * owner's local network. Requests from shared tabs to literal private,
 * loopback, link-local and CGNAT IPs, `localhost`, `*.localhost` and `*.local`
 * are blocked in the browser (declarativeNetRequest session rules scoped to
 * the shared tab ids), and the relay refuses to share, open or navigate to
 * such an address. DNS names that merely resolve to a private IP are not
 * covered here (AionCore's Fetch guard sees the same request).
 */

/** True for an IPv4 literal in a private, loopback, link-local, CGNAT or unspecified range. */
const isPrivateIpv4 = (host: string): boolean => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};

/** True for an IPv6 literal (without brackets) that is loopback, unspecified, ULA, link-local or IPv4-mapped private. */
const isPrivateIpv6 = (host: string): boolean => {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (!mapped) return false;
  if (isPrivateIpv4(mapped[1])) return true;
  // URL parsing normalises ::ffff:127.0.0.1 to ::ffff:7f00:1.
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped[1]);
  if (!hex) return false;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
};

/** True when a URL hostname (as `new URL().hostname` gives it) is on the owner's local network. */
export const isLanHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.startsWith('[') && host.endsWith(']')) return isPrivateIpv6(host.slice(1, -1));
  return isPrivateIpv4(host);
};

/** True for an http(s)/ws(s) URL whose host is on the local network. Unparseable input is not LAN. */
export const isLanUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (!/^(https?|wss?):$/.test(parsed.protocol)) return false;
    return isLanHost(parsed.hostname);
  } catch {
    return false;
  }
};

const URL_PREFIX = '^(https?|wss?)://([^/@]*@)?';
const URL_SUFFIX = '\\.?(:\\d+)?([/?#]|$)';
const OCTET = '\\d{1,3}';

/** RE2 patterns (declarativeNetRequest `regexFilter`), kept small: one family each. */
export const LAN_REGEX_FILTERS: readonly string[] = [
  `${URL_PREFIX}(localhost|[^/:@]*\\.localhost|[^/:@]*\\.local)${URL_SUFFIX}`,
  `${URL_PREFIX}(0|10|127)\\.${OCTET}\\.${OCTET}\\.${OCTET}${URL_SUFFIX}`,
  `${URL_PREFIX}(169\\.254|192\\.168)\\.${OCTET}\\.${OCTET}${URL_SUFFIX}`,
  `${URL_PREFIX}172\\.(1[6-9]|2\\d|3[01])\\.${OCTET}\\.${OCTET}${URL_SUFFIX}`,
  `${URL_PREFIX}100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.${OCTET}\\.${OCTET}${URL_SUFFIX}`,
  `${URL_PREFIX}\\[(::1?|f[cd][0-9a-f]{0,2}:[0-9a-f:.]*|fe[89ab][0-9a-f]?:[0-9a-f:.]*)\\]${URL_SUFFIX}`,
  `${URL_PREFIX}\\[::ffff:(0|a|7f)[0-9a-f]{2}:[0-9a-f]{1,4}\\]${URL_SUFFIX}`,
  `${URL_PREFIX}\\[::ffff:(a9fe|c0a8|ac1[0-9a-f]|64[4-7][0-9a-f]):[0-9a-f]{1,4}\\]${URL_SUFFIX}`,
];

/** Rule ids used by the guard (session rules; nothing else in the extension uses DNR). */
export const LAN_RULE_ID_BASE = 1000;
export const LAN_RULE_IDS: readonly number[] = LAN_REGEX_FILTERS.map((_, index) => LAN_RULE_ID_BASE + index);

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const;

export type LanBlockRule = {
  id: number;
  priority: number;
  action: { type: 'block' };
  condition: { regexFilter: string; isUrlFilterCaseSensitive: false; tabIds: number[]; resourceTypes: string[] };
};

/** The block rules for the given shared tabs; none when nothing is shared. */
export const lanBlockRules = (tabIds: readonly number[]): LanBlockRule[] =>
  tabIds.length === 0
    ? []
    : LAN_REGEX_FILTERS.map((regexFilter, index) => ({
        id: LAN_RULE_ID_BASE + index,
        priority: 1,
        action: { type: 'block' },
        condition: {
          regexFilter,
          isUrlFilterCaseSensitive: false,
          tabIds: [...tabIds],
          resourceTypes: [...RESOURCE_TYPES],
        },
      }));

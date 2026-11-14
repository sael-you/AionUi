/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AIONUI_CHILD_RESULT_END_MARKER, AIONUI_CHILD_RESULT_MARKER_PREFIX } from '@/common/config/constants';

export type ChildResult = {
  childId: string;
  name: string;
  status: string;
  body: string;
};

/**
 * Parse the attribute header of `[[AION_CHILD_RESULT child_id=… name=… status=…]]`.
 *
 * `name` may contain spaces (and may be quoted), so it is delimited by the
 * neighbouring `child_id=` / `status=` keys instead of whitespace. Returns
 * `null` when no child id can be found.
 */
const parseHeader = (header: string): Omit<ChildResult, 'body'> | null => {
  const idMatch = /(?:^|\s)child_id=("([^"]*)"|\S+)/.exec(header);
  if (!idMatch) return null;
  const childId = (idMatch[2] ?? idMatch[1]).trim();
  if (!childId) return null;

  const statusMatch = /(?:^|\s)status=("([^"]*)"|\S+)/.exec(header);
  const status = statusMatch ? (statusMatch[2] ?? statusMatch[1]).trim() : '';

  let name = '';
  const nameIndex = header.search(/(?:^|\s)name=/);
  if (nameIndex !== -1) {
    let raw = header.slice(header.indexOf('name=', nameIndex) + 'name='.length);
    // Cut at the next known key so unquoted names with spaces survive.
    const nextKey = raw.search(/\s(?:child_id|status)=/);
    if (nextKey !== -1) raw = raw.slice(0, nextKey);
    raw = raw.trim();
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1);
    name = raw;
  }
  return { childId, name, status };
};

/**
 * Extract every well-formed child-result block from a message and return the
 * remaining text. A malformed block (no closing marker, no child id) is left in
 * the text untouched so the user still sees the raw content.
 */
export function parseChildResultBlocks(content: string): { text: string; results: ChildResult[] } {
  if (!content.includes(AIONUI_CHILD_RESULT_MARKER_PREFIX)) return { text: content, results: [] };

  const results: ChildResult[] = [];
  let remaining = '';
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(AIONUI_CHILD_RESULT_MARKER_PREFIX, cursor);
    if (start === -1) break;
    const headerEnd = content.indexOf(']]', start);
    const end = headerEnd === -1 ? -1 : content.indexOf(AIONUI_CHILD_RESULT_END_MARKER, headerEnd + 2);
    const header =
      headerEnd === -1 ? null : parseHeader(content.slice(start + AIONUI_CHILD_RESULT_MARKER_PREFIX.length, headerEnd));
    if (headerEnd === -1 || end === -1 || !header) {
      // Malformed: keep the opening marker as plain text and continue after it.
      remaining += content.slice(cursor, start + AIONUI_CHILD_RESULT_MARKER_PREFIX.length);
      cursor = start + AIONUI_CHILD_RESULT_MARKER_PREFIX.length;
      continue;
    }
    remaining += content.slice(cursor, start);
    results.push({ ...header, body: content.slice(headerEnd + 2, end).trim() });
    cursor = end + AIONUI_CHILD_RESULT_END_MARKER.length;
  }
  remaining += content.slice(cursor);
  return { text: results.length === 0 ? content : remaining.trim(), results };
}

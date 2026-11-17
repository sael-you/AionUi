/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a library scope (Global or one project) delivers for items that reach a
 * conversation only through attachments — servers (C36) and rules (C37) — and
 * what flipping "On in <scope>" writes. Same resolver rule as kits: the project
 * level wins over Global, a `remove` turns an inherited item off.
 */

import type { KitAttachmentResponse, KitItemKind } from '@/common/config/storage';

export type ScopeItems = {
  /** Added at this scope's own level. */
  here: string[];
  /** Project scope: added at Global and not turned off here. */
  fromGlobal: string[];
  /** Project scope: added at Global but turned off here (a `remove` at this project). */
  offHere: string[];
};

export type ScopeToggle =
  | { kind: 'attach'; op: 'add' | 'remove' }
  | { kind: 'detach'; attachmentId: string }
  | { kind: 'none' };

const ofKind = (attachments: readonly KitAttachmentResponse[], kind: KitItemKind) =>
  attachments.filter((row) => row.item_kind === kind);

export const scopeItems = (
  attachments: readonly KitAttachmentResponse[],
  kind: KitItemKind,
  projectId: string | null
): ScopeItems => {
  const rows = ofKind(attachments, kind);
  const at = (level: 'global' | 'project', op: 'add' | 'remove') =>
    new Set(
      rows
        .filter((row) => row.level === level && row.op === op && (level === 'global' || row.target_id === projectId))
        .map((row) => row.item_ref)
    );
  const globalOn = at('global', 'add');
  if (!projectId) return { here: [...globalOn].toSorted(), fromGlobal: [], offHere: [] };
  const projectOn = at('project', 'add');
  const projectOff = at('project', 'remove');
  return {
    here: [...projectOn].toSorted(),
    fromGlobal: [...globalOn].filter((id) => !projectOn.has(id) && !projectOff.has(id)).toSorted(),
    offHere: [...globalOn].filter((id) => projectOff.has(id) && !projectOn.has(id)).toSorted(),
  };
};

/** The attachment row of one item at a scope's own level, if any. */
export const scopeAttachment = (
  attachments: readonly KitAttachmentResponse[],
  kind: KitItemKind,
  ref: string,
  projectId: string | null
): KitAttachmentResponse | undefined =>
  ofKind(attachments, kind).find(
    (row) =>
      row.item_ref === ref &&
      (projectId ? row.level === 'project' && row.target_id === projectId : row.level === 'global')
  );

/**
 * What flipping "On in <scope>" does. On: add here (or drop a turn-off that hides
 * the Global one). Off: drop this scope's own add, or turn an inherited Global
 * item off for this project with a `remove`.
 */
export const scopeToggle = (
  attachments: readonly KitAttachmentResponse[],
  kind: KitItemKind,
  ref: string,
  projectId: string | null,
  turnOn: boolean
): ScopeToggle => {
  const own = scopeAttachment(attachments, kind, ref, projectId);
  const inherited = projectId ? scopeItems(attachments, kind, null).here.includes(ref) : false;
  if (turnOn) {
    if (own?.op === 'add') return { kind: 'none' };
    if (own?.op === 'remove' && inherited) return { kind: 'detach', attachmentId: own.id };
    return { kind: 'attach', op: 'add' };
  }
  if (own?.op === 'add') {
    // A project add over a Global add: dropping it alone would leave the item on; turn it off explicitly.
    return inherited ? { kind: 'attach', op: 'remove' } : { kind: 'detach', attachmentId: own.id };
  }
  if (inherited && own?.op !== 'remove') return { kind: 'attach', op: 'remove' };
  return { kind: 'none' };
};

/** Number of items a project delivers (rail counts). */
export const projectItemCount = (
  attachments: readonly KitAttachmentResponse[],
  kind: KitItemKind,
  projectId: string
): number => {
  const scope = scopeItems(attachments, kind, projectId);
  return scope.here.length + scope.fromGlobal.length;
};

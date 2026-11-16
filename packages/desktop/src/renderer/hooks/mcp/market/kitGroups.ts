/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Kit helpers shared by the kit panels (C27/C28): the builtin Global kit key
 * and which kits may be attached at a level. Skills are grouped by the
 * library layout (`SkillsSettings/skillLibraryModel.ts`).
 */

import type { KitLevel, KitResponse } from '@/common/config/storage';

/** The builtin Global kit (C28). */
export const GLOBAL_KIT_KEY = 'K0';
/**
 * Kits that may be attached at `level` (C28, server rule `KIT_INVALID_TARGET`):
 * a project kit already applies implicitly in its project, so it is never
 * offered at global or project level; at assistant level it is allowed (it
 * only takes effect inside its project); at conversation level only the kit
 * of that conversation's project (`projectId`) is.
 */
export const attachableKits = (
  kits: readonly KitResponse[],
  level: KitLevel,
  projectId?: string | null
): KitResponse[] =>
  kits.filter((kit) => {
    if (!kit.project_id) return true;
    if (level === 'assistant') return true;
    if (level === 'conversation') return Boolean(projectId) && kit.project_id === projectId;
    return false;
  });

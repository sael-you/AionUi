/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Library skills grouped by kit (C28): **Global** (skills of kits attached at
 * the global level plus single skills attached globally), **This project's
 * kit** (when a project is given), **Shared kits** (every kit without a
 * project, except the builtin Global kit K0, which is the Global group) and
 * **Not in any kit**. A skill can be in several groups. Skills stay in the one
 * library (D47); kits only reference them by name.
 */

import type { KitAttachmentResponse, KitLevel, KitResponse } from '@/common/config/storage';

export type SkillGroupKey = 'global' | 'project' | 'shared' | 'ungrouped';

export const SKILL_GROUP_KEYS: readonly SkillGroupKey[] = ['global', 'project', 'shared', 'ungrouped'];

/** The builtin Global kit (C28). */
export const GLOBAL_KIT_KEY = 'K0';

export type SharedKitGroup = { kit: KitResponse; skills: string[] };

export type SkillGroups = {
  /** Skills reaching every conversation through a global `add` (kit or single skill). */
  global: string[];
  /** The project kit of the given project, `null` when it has none or no project is given. */
  project: { kit: KitResponse; skills: string[] } | null;
  shared: SharedKitGroup[];
  /** Library skills no kit lists and no global single attaches. */
  ungrouped: string[];
  /** Per skill, every group it shows in. */
  membership: Map<string, SkillGroupKey[]>;
};

const sortedUnique = (names: Iterable<string>): string[] => [...new Set(names)].toSorted();

export const groupSkillsByKit = (input: {
  /** Library skill names. */
  skills: readonly string[];
  kits: readonly KitResponse[];
  /** Global-level attachments (any other level is ignored). */
  attachments: readonly KitAttachmentResponse[];
  projectId?: string | null;
}): SkillGroups => {
  const { skills, kits, attachments, projectId } = input;
  const library = new Set(skills);
  const inLibrary = (names: Iterable<string>) => sortedUnique([...names].filter((name) => library.has(name)));
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));

  const globalAdds = attachments.filter((row) => row.level === 'global' && row.op === 'add');
  const global = inLibrary(
    globalAdds.flatMap((row) => {
      if (row.item_kind === 'skill') return [row.item_ref];
      if (row.item_kind === 'kit') return kitById.get(row.item_ref)?.skills ?? [];
      return [];
    })
  );

  const projectKit = projectId ? (kits.find((kit) => kit.project_id === projectId) ?? null) : null;
  const project = projectKit ? { kit: projectKit, skills: inLibrary(projectKit.skills) } : null;

  const shared = kits
    .filter((kit) => !kit.project_id && kit.builtin_key !== GLOBAL_KIT_KEY)
    .map((kit) => ({ kit, skills: inLibrary(kit.skills) }))
    .toSorted((a, b) => a.kit.name.localeCompare(b.kit.name));

  const inSomeKit = new Set([...global, ...kits.flatMap((kit) => kit.skills)]);
  const ungrouped = sortedUnique(skills.filter((name) => !inSomeKit.has(name)));

  const membership = new Map<string, SkillGroupKey[]>();
  const mark = (name: string, key: SkillGroupKey) => {
    const keys = membership.get(name) ?? [];
    if (!keys.includes(key)) keys.push(key);
    membership.set(name, keys);
  };
  global.forEach((name) => mark(name, 'global'));
  project?.skills.forEach((name) => mark(name, 'project'));
  shared.forEach((group) => group.skills.forEach((name) => mark(name, 'shared')));
  ungrouped.forEach((name) => mark(name, 'ungrouped'));

  return { global, project, shared, ungrouped, membership };
};

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

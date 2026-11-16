/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skills in the library layout (C33, TASK-119). Pure:
 *
 * - **Categories**: a skill's category is every shared kit that lists it
 *   (K1…K12 and the owner's kits; several = shown under each); otherwise
 *   built-in skills are "Built-in" and the rest "Other". In a project scope a
 *   leading "Project" category holds the project kit's skills.
 * - **Scope resolution** mirrors the server (`aionui-db::kit_resolve`): levels
 *   global → project, a lower level wins, inside one level `remove` beats
 *   `add`, and a project kit is an implicit project-level `add` in its own
 *   project. Used for the rail counts and "Used in"; the Active tab itself
 *   reads the server's effective set.
 * - **Active groups** from the effective set, by WHERE an item comes from.
 * - **Toggle plan**: the writes that turn one skill on or off in a scope.
 */

import type {
  AttachKitItemRequest,
  KitAttachmentResponse,
  KitEffectiveItem,
  KitResponse,
} from '@/common/config/storage';
import { GLOBAL_KIT_KEY } from '@/renderer/hooks/mcp/market/kitGroups';

export type SkillSource = 'builtin' | 'custom' | 'cron' | 'extension';

export type LibrarySkill = {
  name: string;
  description?: string;
  source?: SkillSource;
  is_auto_inject?: boolean;
};

/** Source filter chips (C33): All · Mine · Official · Imported. */
export type SkillSourceFilter = 'all' | 'mine' | 'official' | 'imported';
export const SKILL_SOURCE_FILTERS: readonly SkillSourceFilter[] = ['all', 'mine', 'official', 'imported'];

/** Mine = the owner's own skills; Official = built-in; Imported = from extensions. */
export const skillMatchesSource = (skill: LibrarySkill, filter: SkillSourceFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'official') return skill.source === 'builtin';
  if (filter === 'imported') return skill.source === 'extension';
  return skill.source === 'custom' || skill.source === undefined;
};

/** Built-in skills loaded into every conversation regardless of kits. */
export const isAlwaysOn = (skill: LibrarySkill): boolean => skill.source === 'builtin' && skill.is_auto_inject === true;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type SkillCategoryKind = 'project' | 'kit' | 'builtin' | 'other';

export type SkillCategory = {
  /** `project`, `kit:<id>`, `builtin`, `other`. */
  key: string;
  kind: SkillCategoryKind;
  /** The shared kit (kind `kit`) or the project kit (kind `project`). */
  kit?: KitResponse;
  skills: string[];
};

const builtinOrder = (kit: KitResponse): number => {
  const match = /^K(\d+)$/.exec(kit.builtin_key ?? '');
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/** Shared kits = no project, not the Global kit K0; seeded ones in K order, then the owner's by name. */
export const sharedKits = (kits: readonly KitResponse[]): KitResponse[] =>
  kits
    .filter((kit) => !kit.project_id && kit.builtin_key !== GLOBAL_KIT_KEY)
    .toSorted((a, b) => builtinOrder(a) - builtinOrder(b) || a.name.localeCompare(b.name));

/** The project kit of a project, if any. */
export const projectKitOf = (kits: readonly KitResponse[], projectId: string | null): KitResponse | null =>
  projectId ? (kits.find((kit) => kit.project_id === projectId) ?? null) : null;

/** Every non-empty category of the given skills, in display order. */
export const buildSkillCategories = (
  skills: readonly LibrarySkill[],
  kits: readonly KitResponse[],
  projectId: string | null
): SkillCategory[] => {
  const names = new Set(skills.map((skill) => skill.name));
  const inLibrary = (list: readonly string[]) => [...new Set(list.filter((name) => names.has(name)))].toSorted();
  const out: SkillCategory[] = [];

  const projectKit = projectKitOf(kits, projectId);
  if (projectKit) out.push({ key: 'project', kind: 'project', kit: projectKit, skills: inLibrary(projectKit.skills) });

  const inSharedKit = new Set<string>();
  for (const kit of sharedKits(kits)) {
    const members = inLibrary(kit.skills);
    members.forEach((name) => inSharedKit.add(name));
    out.push({ key: `kit:${kit.id}`, kind: 'kit', kit, skills: members });
  }

  const rest = skills.filter((skill) => !inSharedKit.has(skill.name));
  out.push({
    key: 'builtin',
    kind: 'builtin',
    skills: inLibrary(rest.filter((skill) => skill.source === 'builtin').map((skill) => skill.name)),
  });
  out.push({
    key: 'other',
    kind: 'other',
    skills: inLibrary(rest.filter((skill) => skill.source !== 'builtin').map((skill) => skill.name)),
  });
  return out.filter((category) => category.skills.length > 0);
};

/**
 * "Suggested for <project>": skills without a category of their own (Other)
 * that name the project — the project name in the name or description, or
 * the project's first word as a name prefix (`tb-…` for TB-test). Skills
 * already in the project kit are left out.
 */
export const suggestedForProject = (
  skills: readonly LibrarySkill[],
  categories: readonly SkillCategory[],
  projectName: string,
  projectKitSkills: readonly string[] = []
): string[] => {
  const key = projectName.trim().toLowerCase();
  if (!key) return [];
  const prefix = key.split(/[^a-z0-9]+/).find((word) => word.length >= 2);
  const other = new Set(categories.find((category) => category.kind === 'other')?.skills ?? []);
  const inKit = new Set(projectKitSkills);
  return skills
    .filter((skill) => other.has(skill.name) && !inKit.has(skill.name))
    .filter((skill) => {
      const name = skill.name.toLowerCase();
      return (
        name.includes(key) ||
        (skill.description ?? '').toLowerCase().includes(key) ||
        (prefix !== undefined && name.startsWith(`${prefix}-`))
      );
    })
    .map((skill) => skill.name)
    .toSorted();
};

// ---------------------------------------------------------------------------
// Scope resolution (mirror of the server, for counts and "Used in")
// ---------------------------------------------------------------------------

export type SkillDecision = { included: boolean; level: 'global' | 'project'; kitId?: string };

/** Each skill's decision for Global (`projectId` null) or one project. */
export const resolveSkills = (
  kits: readonly KitResponse[],
  attachments: readonly KitAttachmentResponse[],
  projectId: string | null
): Map<string, SkillDecision> => {
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  const out = new Map<string, SkillDecision>();
  const levels: Array<{ level: 'global' | 'project'; target: string }> = [{ level: 'global', target: '' }];
  if (projectId) levels.push({ level: 'project', target: projectId });

  for (const { level, target } of levels) {
    const adds = new Map<string, string | undefined>();
    const removes = new Set<string>();
    const put = (op: string, name: string, kitId?: string) => {
      if (op === 'remove') {
        removes.add(name);
        return;
      }
      // A single item beats a kit as provenance.
      if (!adds.has(name) || kitId === undefined) adds.set(name, kitId);
    };
    const rows = attachments.filter((row) => row.level === level && row.target_id === target);
    const projectKit = level === 'project' ? projectKitOf(kits, projectId) : null;
    if (projectKit) projectKit.skills.forEach((name) => put('add', name, projectKit.id));
    for (const row of rows) {
      if (row.item_kind === 'skill') put(row.op, row.item_ref);
      if (row.item_kind !== 'kit') continue;
      const kit = kitById.get(row.item_ref);
      if (!kit) continue;
      if (kit.project_id && kit.project_id !== projectId) continue;
      kit.skills.forEach((name) => put(row.op, name, kit.id));
    }
    for (const [name, kitId] of adds) {
      if (!removes.has(name)) out.set(name, { included: true, level, kitId });
    }
    for (const name of removes) out.set(name, { included: false, level });
  }
  return out;
};

/** Skills a scope delivers (Global) or decides itself (a project): the rail count. */
export const scopeOwnCount = (decisions: Map<string, SkillDecision>, projectId: string | null): number => {
  const level = projectId ? 'project' : 'global';
  let count = 0;
  for (const decision of decisions.values()) if (decision.included && decision.level === level) count += 1;
  return count;
};

// ---------------------------------------------------------------------------
// Active tab: groups by where an item comes from (server effective set)
// ---------------------------------------------------------------------------

export type ActiveGroupKind = 'projectKit' | 'single' | 'kit' | 'fromGlobal' | 'removed';

export type ActiveGroup = {
  key: string;
  kind: ActiveGroupKind;
  kit?: KitResponse;
  /** The attachment that brings a kit into this scope (detachable). */
  attachmentId?: string;
  skills: string[];
};

export type ActiveSummary = { active: number; fromGlobal: number; kits: number };

const GROUP_ORDER: Record<ActiveGroupKind, number> = { projectKit: 0, single: 1, kit: 2, fromGlobal: 3, removed: 4 };

export const buildActiveGroups = (input: {
  effective: readonly KitEffectiveItem[];
  kits: readonly KitResponse[];
  attachments: readonly KitAttachmentResponse[];
  projectId: string | null;
}): { groups: ActiveGroup[]; summary: ActiveSummary } => {
  const { effective, kits, attachments, projectId } = input;
  const scopeLevel = projectId ? 'project' : 'global';
  const target = projectId ?? '';
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  const projectKit = projectKitOf(kits, projectId);
  const groups = new Map<string, ActiveGroup>();
  const add = (key: string, group: Omit<ActiveGroup, 'skills' | 'key'>, name: string) => {
    const entry = groups.get(key) ?? { key, ...group, skills: [] };
    if (!entry.skills.includes(name)) entry.skills.push(name);
    groups.set(key, entry);
  };

  for (const item of effective) {
    const { level, kit_id: kitId } = item.provenance;
    if (!item.included) {
      if (level === scopeLevel) add('removed', { kind: 'removed' }, item.item_ref);
      continue;
    }
    if (projectId && level === 'global') {
      add('fromGlobal', { kind: 'fromGlobal' }, item.item_ref);
      continue;
    }
    if (level !== scopeLevel) continue;
    if (kitId && projectKit && kitId === projectKit.id) {
      add('projectKit', { kind: 'projectKit', kit: projectKit }, item.item_ref);
    } else if (kitId) {
      const attachment = attachments.find(
        (row) =>
          row.level === scopeLevel &&
          row.target_id === target &&
          row.item_kind === 'kit' &&
          row.item_ref === kitId &&
          row.op === 'add'
      );
      add(`kit:${kitId}`, { kind: 'kit', kit: kitById.get(kitId), attachmentId: attachment?.id }, item.item_ref);
    } else {
      add('single', { kind: 'single' }, item.item_ref);
    }
  }
  // A project kit is always shown in its project, even before it has skills.
  if (projectKit && !groups.has('projectKit'))
    groups.set('projectKit', { key: 'projectKit', kind: 'projectKit', kit: projectKit, skills: [] });

  const list = [...groups.values()]
    .map((group) => ({ ...group, skills: group.skills.toSorted() }))
    .toSorted(
      (a, b) =>
        GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind] ||
        Number(b.kit?.builtin_key === GLOBAL_KIT_KEY) - Number(a.kit?.builtin_key === GLOBAL_KIT_KEY) ||
        (a.kit?.name ?? '').localeCompare(b.kit?.name ?? '')
    );
  const active = effective.filter((item) => item.included).length;
  const fromGlobal = projectId
    ? effective.filter((item) => item.included && item.provenance.level === 'global').length
    : 0;
  const kitsCount = list.filter((group) => group.kind === 'kit' || group.kind === 'projectKit').length;
  return { groups: list, summary: { active, fromGlobal, kits: kitsCount } };
};

// ---------------------------------------------------------------------------
// Turning one skill on or off in a scope
// ---------------------------------------------------------------------------

export type SkillWrite =
  | { type: 'attach'; request: AttachKitItemRequest }
  | { type: 'detach'; attachmentId: string }
  | { type: 'setProjectKitSkills'; kit: KitResponse; skills: string[] };

const scopeRequest = (projectId: string | null): Pick<AttachKitItemRequest, 'level' | 'target_id'> =>
  projectId ? { level: 'project', target_id: projectId } : { level: 'global' };

/**
 * The writes that make `name` on (`on = true`) or off in a scope, in order.
 * On: drop a same-level `remove`, then add it to the project kit (a project
 * with a kit) or attach it as a single skill. Off: take it out of the project
 * kit, detach a same-level single `add`, and when something else would still
 * deliver it (a kit attached at this level, or Global for a project) add a
 * same-level `remove`.
 */
export const planSkillToggle = (input: {
  name: string;
  on: boolean;
  projectId: string | null;
  kits: readonly KitResponse[];
  attachments: readonly KitAttachmentResponse[];
}): SkillWrite[] => {
  const { name, on, projectId, kits, attachments } = input;
  const level = projectId ? 'project' : 'global';
  const target = projectId ?? '';
  const here = attachments.filter((row) => row.level === level && row.target_id === target);
  const removeRow = here.find((row) => row.item_kind === 'skill' && row.item_ref === name && row.op === 'remove');
  const singleAdd = here.find((row) => row.item_kind === 'skill' && row.item_ref === name && row.op === 'add');
  const projectKit = projectKitOf(kits, projectId);
  const writes: SkillWrite[] = [];

  if (on) {
    if (removeRow) writes.push({ type: 'detach', attachmentId: removeRow.id });
    if (projectKit) {
      if (!projectKit.skills.includes(name)) {
        writes.push({ type: 'setProjectKitSkills', kit: projectKit, skills: [...projectKit.skills, name] });
      }
      return writes;
    }
    if (!singleAdd) {
      writes.push({
        type: 'attach',
        request: { ...scopeRequest(projectId), item_kind: 'skill', item_ref: name, op: 'add' },
      });
    }
    return writes;
  }

  if (projectKit?.skills.includes(name)) {
    writes.push({
      type: 'setProjectKitSkills',
      kit: projectKit,
      skills: projectKit.skills.filter((skill) => skill !== name),
    });
  }
  if (singleAdd) writes.push({ type: 'detach', attachmentId: singleAdd.id });
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  const viaKitHere = here.some(
    (row) => row.item_kind === 'kit' && row.op === 'add' && Boolean(kitById.get(row.item_ref)?.skills.includes(name))
  );
  const viaGlobal = projectId ? resolveSkills(kits, attachments, null).get(name)?.included === true : false;
  if ((viaKitHere || viaGlobal) && !removeRow) {
    writes.push({
      type: 'attach',
      request: { ...scopeRequest(projectId), item_kind: 'skill', item_ref: name, op: 'remove' },
    });
  }
  return writes;
};

/** Attach a whole shared kit ("Add whole category") to a scope. */
export const attachKitRequest = (kitId: string, projectId: string | null): AttachKitItemRequest => ({
  ...scopeRequest(projectId),
  item_kind: 'kit',
  item_ref: kitId,
  op: 'add',
});

/** The attachment that brings `kitId` into the scope, if any. */
export const kitAttachmentIn = (
  attachments: readonly KitAttachmentResponse[],
  kitId: string,
  projectId: string | null
): KitAttachmentResponse | undefined =>
  attachments.find(
    (row) =>
      row.level === (projectId ? 'project' : 'global') &&
      row.target_id === (projectId ?? '') &&
      row.item_kind === 'kit' &&
      row.item_ref === kitId &&
      row.op === 'add'
  );

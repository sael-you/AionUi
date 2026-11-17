/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data hooks for Kits (C27). Reads are SWR-cached under `kits.*` keys; every
 * write goes through the `kits` httpBridge providers (CSRF and session refresh
 * included) and then revalidates every `kits.*` key, so the kit list, the
 * attachments of every level and the effective set stay in step.
 */

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { kits as kitsApi, mcpService } from '@/common/adapter/ipcBridge';
import type {
  AttachKitItemRequest,
  KitAttachmentResponse,
  KitAttachmentsQuery,
  KitEffectiveQuery,
  KitEffectiveSetResponse,
  KitImportPreviewResponse,
  KitImportServerRequest,
  KitResponse,
  McpMarketInstance,
  McpMarketTemplate,
  UpdateKitRequest,
} from '@/common/config/storage';
import { createKitRequest, updateKitRequest, type KitFormValues } from './kitModel';

const KITS_KEY = 'kits.list';
const isKitsKey = (key: unknown): boolean => typeof key === 'string' && key.startsWith('kits.');

/** Item filters (C36/C37 "Used in") get their own entry; unfiltered keys are unchanged. */
export const kitAttachmentsKey = (query: KitAttachmentsQuery): string =>
  `kits.attachments:${query.level ?? ''}:${query.target_id ?? ''}` +
  (query.item_kind ? `:${query.item_kind}:${query.item_ref ?? ''}` : '');

export const kitEffectiveKey = (query: KitEffectiveQuery): string =>
  `kits.effective:${query.conversation_id ?? ''}:${query.project_id ?? ''}:${query.assistant_id ?? ''}`;

export const useKitList = () => {
  const { data, error, isLoading, mutate } = useSWR<KitResponse[]>(KITS_KEY, () => kitsApi.list.invoke({}));
  return { kits: data ?? [], error: error as unknown, isLoading, reload: mutate };
};

export const projectKitKey = (projectId: string): string => `kits.project:${projectId}`;

/** The kit of one project (C28), or `null` when it has none (404). */
export const useProjectKit = (projectId: string | null) => {
  const { data, error, isLoading } = useSWR<KitResponse | null>(
    projectId ? projectKitKey(projectId) : null,
    async () => {
      try {
        return await kitsApi.projectKit.invoke({ project_id: projectId ?? '' });
      } catch (fetchError) {
        if (isBackendHttpError(fetchError) && fetchError.status === 404) return null;
        throw fetchError;
      }
    }
  );
  return { projectKit: data ?? null, error: error as unknown, isLoading };
};

/** The `.mcp.json` import preview of a project (C28 §5); `null` = not loaded (closed). */
export const useKitImportPreview = (projectId: string | null) => {
  const { data, error, isLoading } = useSWR<KitImportPreviewResponse>(
    projectId ? `kits.import-preview:${projectId}` : null,
    () => kitsApi.importPreview.invoke({ project_id: projectId ?? '' })
  );
  return { preview: data ?? null, error: error as unknown, isLoading };
};

/** Attachments at one level/target; no query fields = every attachment of the user. */
export const useKitAttachments = (query: KitAttachmentsQuery | null) => {
  const { data, error, isLoading } = useSWR<KitAttachmentResponse[]>(query ? kitAttachmentsKey(query) : null, () =>
    kitsApi.listAttachments.invoke(query ?? {})
  );
  return { attachments: data ?? [], error: error as unknown, isLoading };
};

export const useKitEffective = (query: KitEffectiveQuery | null) => {
  const { data, error, isLoading, mutate } = useSWR<KitEffectiveSetResponse>(
    query ? kitEffectiveKey(query) : null,
    () => kitsApi.effective.invoke(query ?? {})
  );
  return { effective: data ?? null, error: error as unknown, isLoading, reload: mutate };
};

type SkillListItem = { name: string };

/**
 * What a kit or an attachment can point at: library skills (shared
 * `skills.list` cache with the Skills page), MCP market instances and
 * catalogue templates. Each source fails on its own.
 */
export const useKitLibrary = () => {
  const skills = useSWR<SkillListItem[]>('skills.list', () => ipcBridge.fs.listAvailableSkills.invoke());
  const instances = useSWR<McpMarketInstance[]>('kits.library.instances', () =>
    mcpService.market.listInstances.invoke()
  );
  const templates = useSWR<McpMarketTemplate[]>('kits.library.templates', () =>
    mcpService.market.listTemplates.invoke()
  );
  return {
    skillNames: (skills.data ?? []).map((skill) => skill.name).toSorted(),
    instances: instances.data ?? [],
    templates: templates.data ?? [],
    error: (skills.error ?? instances.error ?? templates.error) as unknown,
  };
};

/** Writes; each one revalidates every `kits.*` key afterwards, also when it fails. */
export const useKitActions = () => {
  const { mutate } = useSWRConfig();

  const after = useCallback(
    async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } finally {
        await mutate(isKitsKey);
      }
    },
    [mutate]
  );

  const createKit = useCallback(
    (values: KitFormValues, projectId?: string) => after(kitsApi.create.invoke(createKitRequest(values, projectId))),
    [after]
  );
  /** Partial update (only the given fields, e.g. one member list), guarded by the kit's `updated_at`. */
  const patchKit = useCallback(
    (kit: KitResponse, data: Omit<UpdateKitRequest, 'expected_updated_at'>) =>
      after(kitsApi.update.invoke({ id: kit.id, data: { ...data, expected_updated_at: kit.updated_at } })),
    [after]
  );
  const updateKit = useCallback(
    (kit: KitResponse, values: KitFormValues) =>
      after(kitsApi.update.invoke({ id: kit.id, data: updateKitRequest(kit, values) })),
    [after]
  );
  /** Import keys from the project's `.mcp.json` (C28 §5); creates the project kit when missing. */
  const importKeys = useCallback(
    (projectId: string, servers: KitImportServerRequest[]) =>
      after(kitsApi.importKeys.invoke({ project_id: projectId, data: { servers } })),
    [after]
  );
  const deleteKit = useCallback((kitId: string) => after(kitsApi.remove.invoke({ id: kitId })), [after]);
  const attach = useCallback((request: AttachKitItemRequest) => after(kitsApi.attach.invoke(request)), [after]);
  const detach = useCallback((attachmentId: string) => after(kitsApi.detach.invoke({ id: attachmentId })), [after]);

  return { createKit, updateKit, patchKit, deleteKit, attach, detach, importKeys };
};

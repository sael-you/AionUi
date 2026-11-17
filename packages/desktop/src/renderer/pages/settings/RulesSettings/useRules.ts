/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data of the Rules page (C37): the rule list, what a scope or a conversation
 * gets, the imported files, and the writes. Attaching uses the kit attachments
 * (`item_kind: 'rule'`) through useKitActions, so every kit view stays in step.
 */

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ipcBridge } from '@/common';
import type {
  CreateRuleRequest,
  RuleEffectiveQuery,
  RuleEffectiveResponse,
  RuleImportPreviewResponse,
  RuleImportScope,
  RuleResponse,
  RuleSourceResponse,
  UpdateRuleRequest,
} from '@/common/types/platform/rules';

export const RULES_KEY = 'rules.list';
const SOURCES_KEY = 'rules.sources';
const isRulesKey = (key: unknown): boolean => typeof key === 'string' && key.startsWith('rules.');

export const ruleEffectiveKey = (query: RuleEffectiveQuery): string =>
  `rules.effective:${query.conversation_id ?? ''}:${query.project_id ?? ''}:${query.assistant_id ?? ''}`;

export const useRuleList = () => {
  const { data, error, isLoading, mutate } = useSWR<RuleResponse[]>(RULES_KEY, () => ipcBridge.rules.list.invoke());
  return { rules: data ?? [], error: error as unknown, isLoading, reload: mutate };
};

/** What a session of this scope gets; `null` query = nothing to ask. */
export const useRuleEffective = (query: RuleEffectiveQuery | null) => {
  const { data, error, isLoading, mutate } = useSWR<RuleEffectiveResponse>(
    query ? ruleEffectiveKey(query) : null,
    () => ipcBridge.rules.effective.invoke(query ?? {}),
    // An older core has no rules: stay quiet instead of retrying.
    { shouldRetryOnError: false }
  );
  return { effective: data ?? null, error: error as unknown, isLoading, reload: mutate };
};

export const useRuleSources = () => {
  const { data, error } = useSWR<RuleSourceResponse[]>(SOURCES_KEY, () => ipcBridge.rules.sources.invoke());
  return { sources: data ?? [], error: error as unknown };
};

export const useRuleImportPreview = (scope: RuleImportScope | null, projectId: string | null) => {
  const key = scope ? `rules.importPreview:${scope}:${projectId ?? ''}` : null;
  const { data, error, isLoading, mutate } = useSWR<RuleImportPreviewResponse>(key, () =>
    ipcBridge.rules.importPreview.invoke({
      scope: scope ?? 'global',
      ...(scope === 'project' && projectId ? { project_id: projectId } : {}),
    })
  );
  return { preview: data ?? null, error: error as unknown, isLoading, reload: mutate };
};

/** Writes; each one revalidates every `rules.*` and `kits.*` key afterwards, also when it fails. */
export const useRuleActions = () => {
  const { mutate } = useSWRConfig();

  const after = useCallback(
    async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise;
      } finally {
        await mutate((key) => isRulesKey(key) || (typeof key === 'string' && key.startsWith('kits.')));
      }
    },
    [mutate]
  );

  const create = useCallback((request: CreateRuleRequest) => after(ipcBridge.rules.create.invoke(request)), [after]);
  const update = useCallback(
    (id: string, data: UpdateRuleRequest) => after(ipcBridge.rules.update.invoke({ id, data })),
    [after]
  );
  const remove = useCallback((id: string) => after(ipcBridge.rules.remove.invoke({ id })), [after]);
  const importScope = useCallback(
    (scope: RuleImportScope, projectId: string | null) =>
      after(
        ipcBridge.rules.import.invoke({
          scope,
          ...(scope === 'project' && projectId ? { project_id: projectId } : {}),
          confirm: true,
        })
      ),
    [after]
  );
  const manageFiles = useCallback(
    (scope: RuleImportScope, projectId: string | null) =>
      after(
        ipcBridge.rules.manageFiles.invoke({
          scope,
          ...(scope === 'project' && projectId ? { project_id: projectId } : {}),
          confirm: true,
        })
      ),
    [after]
  );

  return { create, update, remove, importScope, manageFiles };
};

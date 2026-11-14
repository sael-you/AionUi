/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Lookups the board needs from the rest of the app: the project's workspace path and the assistants. */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';

/** Workspace path of a project (its `role=workspace` root), for matching the project's teams. */
export const useProjectWorkspace = (projectId: string): string | null => {
  const { data } = useSWR(projectId ? ['board-project', projectId] : null, ([, id]: [string, string]) =>
    ipcBridge.project.get.invoke({ project_id: id })
  );
  if (!data) return null;
  return data.explorer.entries.find((entry) => entry.pe_id === data.explorer.workspace_pe_id)?.display_path ?? null;
};

/** Enabled assistants, as the rest of the app lists them. */
export const useAssistantOptions = (): Array<{ value: string; label: string }> => {
  const { i18n } = useTranslation();
  const { data } = useSWR('assistants.list', () => ipcBridge.assistants.list.invoke());
  return useMemo(
    () =>
      (data ?? [])
        .filter((assistant) => assistant.enabled)
        .map((assistant) => ({ value: assistant.id, label: assistant.name_i18n?.[i18n.language] || assistant.name })),
    [data, i18n.language]
  );
};

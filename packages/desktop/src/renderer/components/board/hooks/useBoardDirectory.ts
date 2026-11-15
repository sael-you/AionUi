/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Lookups between the board and the rest of the app: project workspace, assistants, the keeper conversation. */

import { Notification } from '@arco-design/web-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { ipcBridge } from '@/common';

import { boardErrorKey } from '../utils/boardErrors';

/** Workspace path of a project (its `role=workspace` root), for matching the project's teams. */
export type ProjectWorkspace = {
  /** The workspace root path; null while unknown or when the project has none. */
  workspace: string | null;
  /** The project lookup answered (successfully or not). */
  loaded: boolean;
};

export const useProjectWorkspace = (projectId: string): ProjectWorkspace => {
  const { data, error } = useSWR(projectId ? ['board-project', projectId] : null, ([, id]: [string, string]) =>
    ipcBridge.project.get.invoke({ project_id: id })
  );
  const workspace = data
    ? (data.explorer.entries.find((entry) => entry.pe_id === data.explorer.workspace_pe_id)?.display_path ?? null)
    : null;
  return { workspace, loaded: Boolean(data) || Boolean(error) };
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

/**
 * Opens a project's Board Keeper conversation from outside the board (sidebar
 * project menu, D40): the server returns the existing keeper or creates it.
 */
export const useOpenBoardKeeper = (): ((projectId: string) => Promise<void>) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return useCallback(
    async (projectId: string) => {
      try {
        const keeper = await ipcBridge.board.ensureKeeper.invoke({ project_id: projectId });
        void navigate(`/conversation/${encodeURIComponent(keeper.conversation_id)}`);
      } catch (error) {
        Notification.error({ title: t('board.keeper.failed'), content: t(boardErrorKey(error)) });
      }
    },
    [navigate, t]
  );
};

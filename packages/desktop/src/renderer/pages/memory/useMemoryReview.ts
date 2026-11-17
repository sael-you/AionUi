/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { workspaceFromUri } from '@/renderer/pages/conversation/GroupedHistory/utils/standardProjects';
import { emitter } from '@/renderer/utils/emitter';

import { pickClaudeAssistant, reviewBrief } from './memoryModel';

/**
 * "Review with AI" (C29 §3): a Claude Code conversation in the project's
 * workspace, created through the ordinary conversation-create route, whose
 * first message is the fixed audit brief (handed over like the Guid page does).
 *
 * `workspace` is the project's folder as its caller knows it: a plain path
 * (the project record) or a `file://` URI (the sidebar read model, used by
 * Settings → Memory). AionCore takes a path only — a URI was refused with
 * `WORKSPACE_PATH_UNAVAILABLE` — so it is converted here, as the sidebar does
 * for every other "new conversation in this project". The project itself is
 * resolved by AionCore from that workspace.
 */
export function useMemoryReview(workspace: string | null): {
  start: (files: string[]) => Promise<void>;
  starting: boolean;
} {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  const start = useCallback(
    async (files: string[]) => {
      if (!workspace || starting) return;
      const workspacePath = workspaceFromUri(workspace);
      if (!workspacePath) {
        Message.error(t('memory.review.noWorkspace'));
        return;
      }
      setStarting(true);
      try {
        const assistant = pickClaudeAssistant(await ipcBridge.assistants.list.invoke());
        if (!assistant) {
          Message.error(t('memory.review.noClaude'));
          return;
        }
        const conversation = await ipcBridge.conversation.create.invoke({
          name: t('memory.review.conversationName'),
          assistant: { id: assistant.id, locale: i18n.language },
          extra: { workspace: workspacePath, custom_workspace: true },
        });
        if (!conversation?.id) {
          Message.error(t('memory.review.failed'));
          return;
        }
        sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify({ input: reviewBrief(files) }));
        emitter.emit('chat.history.refresh');
        await navigate(`/conversation/${conversation.id}`);
      } catch (error) {
        console.error('Memory review conversation failed:', error);
        // Say which rule refused it (e.g. WORKSPACE_PATH_UNAVAILABLE), not only that it failed.
        const code = isBackendHttpError(error) ? error.code : '';
        Message.error(code ? t('memory.review.failedCode', { code }) : t('memory.review.failed'));
      } finally {
        setStarting(false);
      }
    },
    [i18n.language, navigate, starting, t, workspace]
  );

  return { start, starting };
}

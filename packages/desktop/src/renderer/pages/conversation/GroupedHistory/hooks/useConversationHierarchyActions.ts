/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { emitter } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getHierarchyErrorMessage } from '../utils/hierarchyErrors';

type UseConversationHierarchyActionsParams = {
  /** Expand the given parent ids in the tree (so a new child is visible). */
  expand: (ids: readonly string[]) => void;
  /** Close any open row menu / mobile drawer before navigating. */
  onBeforeNavigate?: () => void;
  onSessionClick?: () => void;
};

/**
 * Sidebar actions for hierarchical conversations: create a sub-conversation,
 * detach to root, and reparent ("Move under…"). All failures surface as
 * friendly i18n toasts keyed by the backend `parent_*` error codes.
 */
export const useConversationHierarchyActions = ({
  expand,
  onBeforeNavigate,
  onSessionClick,
}: UseConversationHierarchyActionsParams) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const creatingRef = useRef(false);
  const [moveTarget, setMoveTarget] = useState<TChatConversation | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);

  const handleCreateChild = useCallback(
    async (parent: TChatConversation) => {
      if (creatingRef.current) return;
      onBeforeNavigate?.();
      const workspace = parent.extra?.workspace;
      const extra = {
        workspace,
        custom_workspace: parent.extra?.custom_workspace,
      };
      // Inherit assistant + workspace like the "new conversation in this
      // workspace" flow; parents without an assistant identity fall back to the
      // parent's own backend type.
      const assistantId = parent.assistant?.id;
      const type = parent.type === 'aionrs' ? 'aionrs' : parent.type === 'acp' ? 'acp' : undefined;
      if (!assistantId && !type) {
        Message.error(t('conversation.hierarchy.errors.unsupportedParent'));
        return;
      }
      creatingRef.current = true;
      try {
        const created = await ipcBridge.conversation.create.invoke({
          parent_conversation_id: parent.id,
          ...(assistantId
            ? { assistant: { id: assistantId, locale: i18n.language } }
            : { type, model: parent.type === 'aionrs' ? parent.model : undefined }),
          extra,
        });
        if (!created?.id) {
          Message.error(t('conversation.hierarchy.errors.createFailed'));
          return;
        }
        expand([parent.id]);
        emitter.emit('chat.history.refresh');
        void navigate(`/conversation/${created.id}`);
        onSessionClick?.();
      } catch (error) {
        console.error('Failed to create sub-conversation:', error);
        Message.error(getHierarchyErrorMessage(error, t, 'conversation.hierarchy.errors.createFailed'));
      } finally {
        creatingRef.current = false;
      }
    },
    [expand, i18n.language, navigate, onBeforeNavigate, onSessionClick, t]
  );

  const setParent = useCallback(
    async (conversation: TChatConversation, parentId: string | null): Promise<boolean> => {
      try {
        await ipcBridge.conversation.setParent.invoke({ id: conversation.id, parent_conversation_id: parentId });
        if (parentId) expand([parentId]);
        emitter.emit('chat.history.refresh');
        return true;
      } catch (error) {
        console.error('Failed to set conversation parent:', error);
        Message.error(getHierarchyErrorMessage(error, t, 'conversation.hierarchy.errors.moveFailed'));
        return false;
      }
    },
    [expand, t]
  );

  const handleDetach = useCallback(
    async (conversation: TChatConversation) => {
      onBeforeNavigate?.();
      if (await setParent(conversation, null)) {
        Message.success(t('conversation.hierarchy.detachSuccess'));
      }
    },
    [onBeforeNavigate, setParent, t]
  );

  const handleMoveUnderStart = useCallback(
    (conversation: TChatConversation) => {
      onBeforeNavigate?.();
      setMoveTarget(conversation);
    },
    [onBeforeNavigate]
  );

  const handleMoveUnderCancel = useCallback(() => {
    if (!moveLoading) setMoveTarget(null);
  }, [moveLoading]);

  const handleMoveUnderConfirm = useCallback(
    async (parentId: string) => {
      if (!moveTarget) return;
      setMoveLoading(true);
      const ok = await setParent(moveTarget, parentId);
      setMoveLoading(false);
      if (ok) {
        setMoveTarget(null);
        Message.success(t('conversation.hierarchy.moveSuccess'));
      }
    },
    [moveTarget, setParent, t]
  );

  return {
    handleCreateChild,
    handleDetach,
    moveTarget,
    moveLoading,
    handleMoveUnderStart,
    handleMoveUnderCancel,
    handleMoveUnderConfirm,
  };
};

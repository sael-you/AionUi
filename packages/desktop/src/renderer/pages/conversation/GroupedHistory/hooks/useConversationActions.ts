/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import { isLegacyReadOnlyConversationType } from '@/renderer/pages/conversation/utils/conversationRuntime';
import { emitter } from '@/renderer/utils/emitter';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/ui/focus';
import { Message, Modal } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { isConversationPinned } from '../utils/groupingHelpers';

type UseConversationActionsParams = {
  batchMode: boolean;
  onSessionClick?: () => void;
  onBatchModeChange?: (value: boolean) => void;
  selectedConversationIds: Set<string>;
  setSelectedConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelectedConversation: (conversation: TChatConversation) => void;
  markAsRead: (conversation_id: string) => void;
  markManualUnread: (conversation_id: string) => void;
  clearManualUnread: (conversation_id: string) => void;
  isManualUnread: (conversation_id: string) => boolean;
  /** Hierarchy lookups so archive confirmations can account for sub-conversations. */
  hierarchy?: ConversationHierarchyLookup;
};

export type ConversationHierarchyLookup = {
  getParentId: (conversation_id: string) => string | undefined;
  /** All descendants (every level) of a conversation. */
  getDescendantIds: (conversation_id: string) => string[];
};

/**
 * Resolve a batch selection to the ids to archive plus the total affected count.
 * Selecting a parent implies its whole subtree, so selected ids with a selected
 * ancestor are skipped (the backend archives the subtree with the parent) and
 * the count includes every descendant.
 */
export const resolveBatchArchiveSelection = (
  selected: ReadonlySet<string>,
  hierarchy?: ConversationHierarchyLookup
): { ids: string[]; totalCount: number } => {
  if (!hierarchy) return { ids: [...selected], totalCount: selected.size };
  const hasSelectedAncestor = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let parent = hierarchy.getParentId(id);
    while (parent && !seen.has(parent)) {
      if (selected.has(parent)) return true;
      seen.add(parent);
      parent = hierarchy.getParentId(parent);
    }
    return false;
  };
  const ids = [...selected].filter((id) => !hasSelectedAncestor(id));
  const all = new Set<string>(ids);
  ids.forEach((id) => hierarchy.getDescendantIds(id).forEach((d) => all.add(d)));
  return { ids, totalCount: all.size };
};

export const useConversationActions = ({
  batchMode,
  onSessionClick,
  onBatchModeChange,
  selectedConversationIds,
  setSelectedConversationIds,
  toggleSelectedConversation,
  markAsRead,
  markManualUnread,
  clearManualUnread,
  isManualUnread,
  hierarchy,
}: UseConversationActionsParams) => {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameModalName, setRenameModalName] = useState<string>('');
  const [renameModalId, setRenameModalId] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [dropdownVisibleId, setDropdownVisibleId] = useState<string | null>(null);
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Close dropdown when entering batch mode
  useEffect(() => {
    if (batchMode) {
      setDropdownVisibleId(null);
    }
  }, [batchMode]);

  const handleConversationClick = useCallback(
    (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      if (batchMode) {
        toggleSelectedConversation(conversation);
        return;
      }
      blockMobileInputFocus();
      blurActiveElement();

      markAsRead(conversation.id);

      void navigate(`/conversation/${conversation.id}`);
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [batchMode, toggleSelectedConversation, markAsRead, navigate, onSessionClick]
  );

  const removeConversation = useCallback(
    async (conversation_id: string) => {
      const success = await ipcBridge.conversation.remove.invoke({ id: conversation_id });
      if (!success) {
        return false;
      }

      emitter.emit('conversation.deleted', conversation_id);
      if (id === conversation_id) {
        void navigate('/');
      }
      return true;
    },
    [id, navigate]
  );

  const handleBatchArchive = useCallback(() => {
    if (selectedConversationIds.size === 0) {
      Message.warning(t('conversation.history.batchNoSelection'));
      return;
    }

    const { ids: selectedIds, totalCount } = resolveBatchArchiveSelection(selectedConversationIds, hierarchy);
    Modal.confirm({
      title: t('conversation.history.batchArchive'),
      content:
        totalCount > selectedIds.length
          ? t('conversation.hierarchy.batchArchiveConfirmWithSub', { count: totalCount })
          : t('conversation.history.batchArchiveConfirm', { count: selectedIds.length }),
      okText: t('conversation.history.batchArchive'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        // No batch endpoint exists; archive each selected conversation on its
        // own. The active list (both read models) drops archived rows, so the
        // refresh clears the selection's rows and the archive page picks them up.
        try {
          const results = await Promise.allSettled(
            selectedIds.map((item_id) => ipcBridge.sidebar.archive.invoke({ item_type: 'conversation', item_id }))
          );
          const successCount = results.filter((r) => r.status === 'fulfilled').length;
          emitter.emit('chat.history.refresh');
          if (successCount > 0) {
            Message.success(t('conversation.history.batchArchiveSuccess', { count: successCount }));
          } else {
            Message.error(t('conversation.history.archiveFailed'));
          }
        } catch (error) {
          console.error('Failed to batch archive conversations:', error);
          Message.error(t('conversation.history.archiveFailed'));
        } finally {
          setSelectedConversationIds(new Set());
          onBatchModeChange?.(false);
        }
      },
      style: { borderRadius: '12px' },
      alignCenter: true,
      getPopupContainer: () => document.body,
    });
  }, [hierarchy, onBatchModeChange, selectedConversationIds, t, setSelectedConversationIds]);

  const handleEditStart = useCallback((conversation: TChatConversation) => {
    setRenameModalId(conversation.id);
    setRenameModalName(conversation.name);
    setRenameModalVisible(true);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameModalId || !renameModalName.trim()) return;

    setRenameLoading(true);
    try {
      const success = await ipcBridge.conversation.update.invoke({
        id: renameModalId,
        updates: { name: renameModalName.trim() },
      });

      if (success) {
        await refreshConversationCache(renameModalId);
        emitter.emit('chat.history.refresh');
        setRenameModalVisible(false);
        setRenameModalId(null);
        setRenameModalName('');
        Message.success(t('conversation.history.renameSuccess'));
      } else {
        Message.error(t('conversation.history.renameFailed'));
      }
    } catch (error) {
      console.error('Failed to update conversation name:', error);
      Message.error(t('conversation.history.renameFailed'));
    } finally {
      setRenameLoading(false);
    }
  }, [renameModalId, renameModalName, t]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalVisible(false);
    setRenameModalId(null);
    setRenameModalName('');
  }, []);

  const handleTogglePin = useCallback(
    async (conversation: TChatConversation) => {
      const pinned = isConversationPinned(conversation);

      try {
        const success = await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          updates: {
            extra: {
              pinned: !pinned,
              pinned_at: pinned ? undefined : Date.now(),
            } as Partial<TChatConversation['extra']>,
          } as Partial<TChatConversation>,
          merge_extra: true,
        });

        if (success) {
          emitter.emit('chat.history.refresh');
        } else {
          Message.error(t('conversation.history.pinFailed'));
        }
      } catch (error) {
        console.error('Failed to toggle pin conversation:', error);
        Message.error(t('conversation.history.pinFailed'));
      }
    },
    [t]
  );

  const handleMenuVisibleChange = useCallback((conversation_id: string, visible: boolean) => {
    setDropdownVisibleId(visible ? conversation_id : null);
  }, []);

  const handleToggleManualUnread = useCallback(
    (conversation: TChatConversation) => {
      if (isManualUnread(conversation.id)) {
        clearManualUnread(conversation.id);
      } else {
        markManualUnread(conversation.id);
      }
    },
    [clearManualUnread, isManualUnread, markManualUnread]
  );

  const handleOpenMenu = useCallback((conversation: TChatConversation) => {
    setDropdownVisibleId(conversation.id);
  }, []);

  const handleCreateCronTask = useCallback(
    (conversation: TChatConversation) => {
      const prefillPrompt = t('cron.status.defaultPrompt');
      setDropdownVisibleId(null);

      if (isLegacyReadOnlyConversationType(conversation.type)) {
        void navigate('/guid', {
          state: {
            prefillPrompt,
            preservePrefillDraft: true,
            focusPrefill: true,
          },
        });
      } else {
        requestConversationSendBoxPrefill(conversation.id, prefillPrompt);
        if (id !== conversation.id) {
          void navigate(`/conversation/${conversation.id}`);
        }
      }

      onSessionClick?.();
    },
    [id, navigate, onSessionClick, t]
  );

  /**
   * Archive-project state — rendered via AionModal in the GroupedHistory component.
   * The left panel groups conversations by workspace folder (not by a bound
   * project record), so there is no project id to hand the `archiveProject`
   * endpoint. Archiving the group therefore archives each conversation in it —
   * the same soft move as the per-row and batch archive actions.
   */
  const [archiveProjectTarget, setArchiveProjectTarget] = useState<{
    name: string;
    conversations: TChatConversation[];
  } | null>(null);
  const [archiveProjectLoading, setArchiveProjectLoading] = useState(false);

  const handleArchiveProject = useCallback((projectName: string, conversations: TChatConversation[]) => {
    if (conversations.length === 0) return;
    setArchiveProjectTarget({ name: projectName, conversations });
  }, []);

  const handleArchiveProjectCancel = useCallback(() => {
    if (archiveProjectLoading) return;
    setArchiveProjectTarget(null);
  }, [archiveProjectLoading]);

  const handleArchiveProjectConfirm = useCallback(async () => {
    if (!archiveProjectTarget) return;
    setArchiveProjectLoading(true);
    try {
      const results = await Promise.allSettled(
        archiveProjectTarget.conversations.map((c) =>
          ipcBridge.sidebar.archive.invoke({ item_type: 'conversation', item_id: c.id })
        )
      );
      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      emitter.emit('chat.history.refresh');
      if (successCount > 0) {
        Message.success(t('conversation.history.batchArchiveSuccess', { count: successCount }));
      } else {
        Message.error(t('conversation.history.archiveFailed'));
      }
      setArchiveProjectTarget(null);
    } catch (error) {
      console.error('Failed to archive project:', error);
      Message.error(t('conversation.history.archiveFailed'));
    } finally {
      setArchiveProjectLoading(false);
    }
  }, [archiveProjectTarget, t]);

  const archiveConversation = useCallback(
    async (conversation: TChatConversation) => {
      // Archiving moves the conversation into the archived slice (the backend
      // also unpins it). Both the new sidebar read model and the legacy list
      // exclude archived rows, so the refresh drops the row from the active
      // list on its own; the archived management page picks it up.
      setDropdownVisibleId(null);
      try {
        await ipcBridge.sidebar.archive.invoke({ item_type: 'conversation', item_id: conversation.id });
        emitter.emit('chat.history.refresh');
        Message.success(t('conversation.history.archiveSuccess'));
      } catch (error) {
        console.error('Failed to archive conversation:', error);
        Message.error(t('conversation.history.archiveFailed'));
      }
    },
    [t]
  );

  const handleArchive = useCallback(
    async (conversation: TChatConversation) => {
      const subCount = hierarchy?.getDescendantIds(conversation.id).length ?? 0;
      if (subCount === 0) {
        await archiveConversation(conversation);
        return;
      }
      // A parent archives together with its sub-conversations: confirm first.
      setDropdownVisibleId(null);
      Modal.confirm({
        title: t('conversation.history.archive'),
        content: t('conversation.hierarchy.archiveConfirmWithSub', { name: conversation.name, count: subCount }),
        okText: t('conversation.history.archive'),
        cancelText: t('common.cancel'),
        onOk: () => archiveConversation(conversation),
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [archiveConversation, hierarchy, t]
  );

  return {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleBatchArchive,
    handleArchive,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleToggleManualUnread,
    handleCreateCronTask,
    handleArchiveProject,
    archiveProjectTarget,
    archiveProjectLoading,
    handleArchiveProjectCancel,
    handleArchiveProjectConfirm,
  };
};

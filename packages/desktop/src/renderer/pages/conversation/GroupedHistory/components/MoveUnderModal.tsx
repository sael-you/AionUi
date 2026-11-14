/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { Modal, Select } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getEligibleParents, type ConversationTreeNode } from '../utils/conversationTree';

type MoveUnderModalProps = {
  /** The conversation being moved; `null` keeps the modal closed. */
  target: TChatConversation | null;
  /** Tree node for every root (including childless roots). */
  rootNodes: readonly ConversationTreeNode[];
  /** Tree node of the moving conversation (to exclude its own subtree and respect depth). */
  targetNode: ConversationTreeNode | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (parentId: string) => void;
};

/** Pick a new parent among eligible nodes (excludes self + descendants, respects depth/fan-out limits). */
const MoveUnderModal: React.FC<MoveUnderModalProps> = ({
  target,
  rootNodes,
  targetNode,
  loading,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [parentId, setParentId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setParentId(undefined);
  }, [target?.id]);

  const options = useMemo(() => {
    if (!target || !targetNode) return [];
    return getEligibleParents(rootNodes, targetNode).map((node) => ({
      value: node.conversation.id,
      label: `${'  '.repeat(node.depth)}${node.conversation.name || t('conversation.welcome.newConversation')}`,
    }));
  }, [rootNodes, t, target, targetNode]);

  return (
    <Modal
      title={t('conversation.hierarchy.moveUnderTitle')}
      visible={target !== null}
      onOk={() => parentId && onConfirm(parentId)}
      onCancel={onCancel}
      okText={t('conversation.hierarchy.moveUnderConfirm')}
      cancelText={t('common.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: !parentId }}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <Select
        showSearch
        value={parentId}
        onChange={setParentId}
        options={options}
        placeholder={t('conversation.hierarchy.moveUnderPlaceholder')}
        notFoundContent={t('conversation.hierarchy.moveUnderEmpty')}
        getPopupContainer={() => document.body}
        filterOption={(input, option) => {
          const label = (option as { props?: { children?: React.ReactNode } }).props?.children;
          return typeof label === 'string' && label.toLowerCase().includes(input.toLowerCase());
        }}
      />
    </Modal>
  );
};

export default MoveUnderModal;

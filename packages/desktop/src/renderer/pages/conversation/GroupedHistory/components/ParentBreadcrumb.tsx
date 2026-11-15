/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { getSnapshotConversation } from '../hooks/useConversationListSync';
import { MAX_CONVERSATION_DEPTH } from '../utils/conversationTree';
import { Button } from '@arco-design/web-react';
import { CornerUpLeft } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

/**
 * Header breadcrumb for a sub-conversation: "root › ↰ parent", each linking to
 * that conversation (the project chip and the title complete the path).
 * Renders nothing for root conversations. A deleted/unreachable parent
 * degrades to a generic label.
 */
const ParentBreadcrumb: React.FC<{ conversation?: Pick<TChatConversation, 'id' | 'parent_conversation_id'> }> = ({
  conversation,
}) => {
  // Hook-free guard: root conversations render nothing and never touch the router,
  // so headers rendered outside a <Router> (e.g. legacy runtime views) keep working.
  const parentId = conversation?.parent_conversation_id;
  if (!parentId) return null;
  return <ParentBreadcrumbLink parentId={parentId} />;
};

const ParentBreadcrumbLink: React.FC<{ parentId: string }> = ({ parentId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: parent } = useSWR(`conversation/${parentId}`, () => getConversationOrNull(parentId));

  // Ancestors above the parent, from the loaded list (root first): the header
  // reads "root › parent › (this conversation's title)" (C21).
  const ancestors: Array<{ id: string; name: string }> = [];
  let cursor = getSnapshotConversation(parentId)?.parent_conversation_id ?? parent?.parent_conversation_id;
  for (let guard = 0; cursor && guard < MAX_CONVERSATION_DEPTH; guard += 1) {
    const row = getSnapshotConversation(cursor);
    ancestors.unshift({ id: cursor, name: row?.name || t('conversation.hierarchy.parentFallback') });
    cursor = row?.parent_conversation_id;
  }

  const name = parent?.name || getSnapshotConversation(parentId)?.name || t('conversation.hierarchy.parentFallback');

  return (
    <nav
      className='flex items-center min-w-0 shrink'
      aria-label={t('conversation.orchestration.breadcrumb')}
      data-testid='conversation-parent-breadcrumb-trail'
    >
      {ancestors.map((ancestor) => (
        <React.Fragment key={ancestor.id}>
          <Button
            type='text'
            size='mini'
            className='!max-w-160px !px-4px shrink-0'
            aria-label={t('conversation.hierarchy.backToParent', { name: ancestor.name })}
            onClick={() => void navigate(`/conversation/${ancestor.id}`)}
          >
            <span className='truncate inline-block max-w-150px align-bottom'>{ancestor.name}</span>
          </Button>
          <span className='text-t-tertiary text-12px px-2px' aria-hidden='true'>
            ›
          </span>
        </React.Fragment>
      ))}
      <Button
        type='text'
        size='mini'
        className='!max-w-200px shrink-0'
        data-testid='conversation-parent-breadcrumb'
        aria-label={t('conversation.hierarchy.backToParent', { name })}
        icon={<CornerUpLeft theme='outline' size='14' />}
        onClick={() => void navigate(`/conversation/${parentId}`)}
      >
        <span className='truncate inline-block max-w-150px align-bottom'>{name}</span>
      </Button>
    </nav>
  );
};

export default ParentBreadcrumb;

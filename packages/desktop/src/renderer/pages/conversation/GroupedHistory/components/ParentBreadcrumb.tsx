/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { Button } from '@arco-design/web-react';
import { CornerUpLeft } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

/**
 * Header breadcrumb for a sub-conversation: "↰ Parent name", linking to the
 * parent. Renders nothing for root conversations. A deleted/unreachable parent
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

  const name = parent?.name || t('conversation.hierarchy.parentFallback');

  return (
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
  );
};

export default ParentBreadcrumb;

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chat header entry for Kits (C27): opens "What this conversation gets" and the
 * conversation-level attachments for this conversation.
 */

import { Button, Tooltip } from '@arco-design/web-react';
import { Box } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconColors } from '@/renderer/styles/colors';
import { touchClass, useIsMobileLayout } from '../market/shared';
import KitLevelModal from './KitLevelModal';

const ConversationKitsButton: React.FC<{ conversationId: string; projectId?: string | null }> = ({
  conversationId,
  projectId,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const label = t('mcp.kits.headerButton');

  return (
    <>
      <Tooltip content={label}>
        <Button
          type='text'
          size='small'
          aria-label={label}
          aria-haspopup='dialog'
          data-testid='conversation-kits-button'
          className={`!h-auto !w-auto !min-w-0 !px-0 !py-0 ${touchClass(isMobile)}`}
          onClick={() => setOpen(true)}
        >
          <span className='inline-flex items-center rounded-full px-8px py-2px bg-2'>
            <Box theme='outline' size={16} fill={iconColors.primary} />
          </span>
        </Button>
      </Tooltip>
      <KitLevelModal
        target={open ? { level: 'conversation', conversationId, projectId } : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

export default ConversationKitsButton;

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chat header entry for Rules (C37), next to the kits button: how many rules
 * this conversation's sessions get (orange when the 24 KB cap left one out);
 * opens what it gets, with the exact text. Hidden when no rule applies or the
 * core has no rules.
 */

import { Button, Modal, Tooltip } from '@arco-design/web-react';
import { BookOpen } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { iconColors } from '@/renderer/styles/colors';
import { touchClass, useIsMobileLayout } from '../ToolsSettings/market/shared';
import RulesEffectivePanel from './RulesEffectivePanel';
import { useRuleEffective } from './useRules';

const ConversationRulesButton: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const { effective } = useRuleEffective({ conversation_id: conversationId });
  const delivered = effective?.rules.filter((rule) => rule.delivered).length ?? 0;
  const capped = effective?.rules.some((rule) => !rule.delivered) ?? false;
  if (!effective || effective.rules.length === 0) return null;

  const label = t('settings.rules.header.label', { count: delivered });
  return (
    <>
      <Tooltip content={capped ? t('settings.rules.header.capped') : label}>
        <Button
          type='text'
          size='small'
          aria-label={label}
          aria-haspopup='dialog'
          data-testid='conversation-rules-button'
          className={`!h-auto !w-auto !min-w-0 !px-0 !py-0 ${touchClass(isMobile)}`}
          onClick={() => setOpen(true)}
        >
          <span
            className={`inline-flex items-center gap-4px rounded-full px-8px py-2px text-12px ${capped ? 'bg-warning-light-1 text-warning' : 'bg-2 text-t-secondary'}`}
          >
            <BookOpen theme='outline' size={14} fill={capped ? 'currentColor' : iconColors.primary} />
            {delivered}
          </span>
        </Button>
      </Tooltip>
      <Modal
        visible={open}
        title={t('settings.rules.header.title')}
        onCancel={() => setOpen(false)}
        footer={
          <Button
            onClick={() => {
              setOpen(false);
              void navigate('/settings/rules');
            }}
          >
            {t('settings.rules.header.manage')}
          </Button>
        }
        unmountOnExit
        style={{ maxWidth: 'calc(100vw - 32px)', width: 560 }}
      >
        <RulesEffectivePanel query={{ conversation_id: conversationId }} />
      </Modal>
    </>
  );
};

export default ConversationRulesButton;

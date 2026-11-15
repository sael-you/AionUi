/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Modal } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CardDetailController } from '../../hooks/useCardDetail';

/** Block a card with an optional reason (PATCH `blocked`, R5). */
export const BlockDialog: React.FC<{
  refLabel: string;
  visible: boolean;
  onClose: () => void;
  controller: CardDetailController;
}> = ({ refLabel, visible, onClose, controller }) => {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('board.drawer.blockTitle', { ref: refLabel })}
      visible={visible}
      onCancel={onClose}
      afterClose={() => setReason('')}
      okText={t('board.drawer.block')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      autoFocus
      focusLock
      onOk={async () => {
        setBusy(true);
        try {
          if (await controller.setBlocked(true, reason)) onClose();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className='flex flex-col gap-6px text-13px text-t-secondary'>
        {t('board.drawer.blockReason')}
        <Input
          autoFocus
          value={reason}
          onChange={setReason}
          maxLength={500}
          placeholder={t('board.drawer.blockReasonPlaceholder')}
        />
      </label>
    </Modal>
  );
};

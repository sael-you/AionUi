/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCard } from '@/common/types/board';

import { BoardSelect } from '../../BoardSelect';
import { useAssistantOptions } from '../../hooks/useBoardDirectory';
import { newIdempotencyKey, type CardDetailController } from '../../hooks/useCardDetail';
import { cardRef } from '../../utils/boardModel';

const BrainstormForm: React.FC<{ controller: CardDetailController; onClose: () => void }> = ({
  controller,
  onClose,
}) => {
  const { t } = useTranslation();
  const assistants = useAssistantOptions();
  const [assistantId, setAssistantId] = useState<string | undefined>();
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      if (await controller.brainstorm(assistantId, key)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      <p className='m-0 text-13px text-t-secondary'>{t('board.brainstorm.description')}</p>
      <BoardSelect
        ariaLabel={t('board.brainstorm.assistant')}
        allowClear
        showSearch
        placeholder={t('board.brainstorm.defaultAssistant')}
        value={assistantId}
        onChange={(value: string | undefined) => {
          setAssistantId(value);
          setKey(newIdempotencyKey());
        }}
        options={assistants}
      />
      <div className='flex justify-end gap-8px'>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type='primary' loading={busy} onClick={() => void start()}>
          {t('board.brainstorm.submit')}
        </Button>
      </div>
    </div>
  );
};

/** Brainstorm a card: a conversation with role `brainstorm` and the card packet (SPEC §5). */
export const BrainstormDialog: React.FC<{
  card: BoardCard;
  visible: boolean;
  onClose: () => void;
  controller: CardDetailController;
}> = ({ card, visible, onClose, controller }) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('board.brainstorm.title', { ref: cardRef(card.number) })}
      visible={visible}
      onCancel={onClose}
      footer={null}
      unmountOnExit
      autoFocus
      focusLock
    >
      {visible && <BrainstormForm controller={controller} onClose={onClose} />}
    </Modal>
  );
};

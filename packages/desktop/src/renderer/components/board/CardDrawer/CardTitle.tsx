/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input } from '@arco-design/web-react';
import { Edit } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_LIMITS, type BoardCard } from '@/common/types/board';

import type { CardDetailController } from '../hooks/useCardDetail';

/** Card title with edit-in-place (Enter saves, Escape cancels without closing the drawer). */
export const CardTitle: React.FC<{
  card: BoardCard;
  editable: boolean;
  controller: CardDetailController;
  titleId: string;
}> = ({ card, editable, controller, titleId }) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.title);
  const [busy, setBusy] = useState(false);

  const start = () => {
    setValue(card.title);
    setEditing(true);
  };
  const save = async () => {
    const next = value.trim();
    if (!next || next === card.title) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      if (await controller.updateFields({ title: next })) setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className='flex flex-col gap-6px'>
        <Input
          autoFocus
          value={value}
          onChange={setValue}
          maxLength={BOARD_LIMITS.title}
          showWordLimit
          aria-label={t('board.drawer.titleLabel')}
          onPressEnter={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <div className='flex gap-8px'>
          <Button size='small' type='primary' loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
          <Button size='small' onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className='flex items-start gap-6px min-w-0'>
      <h2 id={titleId} className='m-0 text-16px leading-24px font-medium text-t-primary break-words min-w-0 flex-1'>
        {card.title}
      </h2>
      {editable && (
        <Button
          type='text'
          size='mini'
          icon={<Edit theme='outline' size='14' fill='currentColor' />}
          aria-label={t('board.drawer.editTitle')}
          onClick={start}
        />
      )}
    </div>
  );
};

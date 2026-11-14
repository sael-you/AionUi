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
import MarkdownView from '@/renderer/components/Markdown';

import type { CardDetailController } from '../hooks/useCardDetail';

/**
 * Description rendered through the default MarkdownView pipeline (sanitised, R9).
 * Board surfaces never pass `allowHtml`: card text comes from agents too.
 */
export const CardDescription: React.FC<{
  card: BoardCard;
  editable: boolean;
  controller: CardDetailController;
}> = ({ card, editable, controller }) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(card.description);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (value === card.description) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      if (await controller.updateFields({ description: value })) setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby='board-drawer-description' className='flex flex-col gap-6px'>
      <div className='flex items-center gap-6px'>
        <h3 id='board-drawer-description' className='m-0 text-13px font-medium text-t-secondary flex-1'>
          {t('board.drawer.description')}
        </h3>
        {editable && !editing && (
          <Button
            type='text'
            size='mini'
            icon={<Edit theme='outline' size='14' fill='currentColor' />}
            aria-label={t('board.drawer.editDescription')}
            onClick={() => {
              setValue(card.description);
              setEditing(true);
            }}
          />
        )}
      </div>
      {editing ? (
        <div className='flex flex-col gap-6px'>
          <Input.TextArea
            autoFocus
            value={value}
            onChange={setValue}
            autoSize={{ minRows: 4, maxRows: 16 }}
            maxLength={BOARD_LIMITS.description}
            aria-label={t('board.drawer.description')}
            placeholder={t('board.drawer.descriptionPlaceholder')}
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
      ) : card.description.trim() ? (
        <div className='text-13px' data-testid='board-card-description'>
          <MarkdownView>{card.description}</MarkdownView>
        </div>
      ) : (
        <p className='m-0 text-13px text-t-secondary'>{t('board.drawer.noDescription')}</p>
      )}
    </section>
  );
};

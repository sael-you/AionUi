/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BOARD_LIMITS } from '@/common/types/board';

import { useBoardRef } from '../hooks/boardContext';

/** One-line card creation at the end of a column. Focus stays in the field for rapid entry. */
export const QuickAddCard: React.FC<{ readOnly: boolean; columnKey: string; columnLabel: string }> = ({
  readOnly,
  columnKey,
  columnLabel,
}) => {
  const { t } = useTranslation();
  const boardRef = useBoardRef();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const label = t('board.quickAdd.label', { column: columnLabel });

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const created = (await boardRef.current?.createCard(columnKey, title)) ?? null;
      if (created) setTitle('');
    } finally {
      setBusy(false);
    }
  };

  if (readOnly) return null;
  return (
    <div className='flex items-center gap-4px'>
      <Input
        size='small'
        value={title}
        onChange={setTitle}
        onPressEnter={() => void submit()}
        placeholder={t('board.quickAdd.placeholder')}
        aria-label={label}
        maxLength={BOARD_LIMITS.title}
      />
      <Button
        size='small'
        type='text'
        icon={<Plus theme='outline' size='14' fill='currentColor' />}
        aria-label={label}
        loading={busy}
        disabled={!title.trim()}
        onClick={() => void submit()}
      />
    </div>
  );
};

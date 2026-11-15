/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Modal } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardController } from '../hooks/useBoard';

const REASON_MAX = 500;

/**
 * Asks for the reason a "Move anyway" out of a gate (or Deploying) needs (R3);
 * the move is then sent through the reasoned force path.
 */
export const ForceReasonDialog: React.FC<{ board: BoardController }> = ({ board }) => {
  const { t } = useTranslation();
  const request = board.forceRequest;
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setError(true);
      return;
    }
    setBusy(true);
    try {
      await board.confirmForce(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={request ? t('board.gate.forceReasonTitle', { ref: request.ref, column: request.fromName }) : ''}
      visible={Boolean(request)}
      onCancel={board.cancelForce}
      onOk={() => void submit()}
      okText={t('board.gate.forceSubmit')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      afterClose={() => {
        setReason('');
        setError(false);
      }}
      autoFocus
      focusLock
    >
      <div className='flex flex-col gap-6px text-13px text-t-secondary'>
        <p className='m-0'>{t('board.gate.forceDescription')}</p>
        <label className='flex flex-col gap-4px'>
          {t('board.gate.forceReason')}
          <Input
            autoFocus
            value={reason}
            maxLength={REASON_MAX}
            status={error && !reason.trim() ? 'error' : undefined}
            aria-invalid={(error && !reason.trim()) || undefined}
            aria-describedby={error && !reason.trim() ? 'board-force-reason-error' : undefined}
            placeholder={t('board.gate.reasonPlaceholder')}
            onChange={(value) => {
              setReason(value);
              if (value.trim()) setError(false);
            }}
            onPressEnter={() => void submit()}
          />
        </label>
        {error && !reason.trim() && (
          <span id='board-force-reason-error' role='alert' className='text-danger'>
            {t('board.gate.forceReasonRequired')}
          </span>
        )}
      </div>
    </Modal>
  );
};

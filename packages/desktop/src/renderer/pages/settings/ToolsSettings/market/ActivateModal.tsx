/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Confirmation for activating a market instance. A production write instance
 * stays dormant until the owner's written approval of the exact change is
 * recorded: its approval id (`OA-<yyyymmdd>-<slug>`) is a required field that
 * starts empty every time and is never filled in for the user.
 */

import { Alert, Input, Modal } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketInstance } from '@/common/config/storage';
import { describeMarketError, isValidApprovalRef, needsApprovalRef } from '@/renderer/hooks/mcp/market/marketModel';
import { touchClass, useIsMobileLayout } from './shared';

type ActivateModalProps = {
  instance: McpMarketInstance | null;
  onCancel: () => void;
  /** `approvalRef` is given exactly when the instance needs one. */
  onConfirm: (approvalRef?: string) => Promise<void>;
};

const ActivateModal: React.FC<ActivateModalProps> = ({ instance, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [approvalRef, setApprovalRef] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh, empty field for every opening: the approval never defaults.
  useEffect(() => {
    setApprovalRef('');
    setTouched(false);
    setError(null);
  }, [instance?.id]);

  if (!instance) return null;
  const approvalNeeded = needsApprovalRef(instance);
  const value = approvalRef.trim();
  const approvalValid = isValidApprovalRef(value);
  const blocked = instance.missing.length > 0;

  const confirm = async () => {
    setTouched(true);
    if (blocked || (approvalNeeded && !approvalValid)) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(approvalNeeded ? value : undefined);
    } catch (err) {
      setError(describeMarketError(t, err, 'activate'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible
      title={t('mcp.market.activate.title', { name: instance.name })}
      onCancel={onCancel}
      onOk={() => void confirm()}
      okText={t('mcp.market.actions.activate')}
      cancelText={t('mcp.market.actions.cancel')}
      confirmLoading={busy}
      okButtonProps={{ disabled: blocked || (approvalNeeded && !approvalValid), className: touchClass(isMobile) }}
      cancelButtonProps={{ className: touchClass(isMobile) }}
      style={isMobile ? { width: '100%', top: 0 } : undefined}
      unmountOnExit
    >
      <div className='flex flex-col gap-12px'>
        <p className='m-0 text-14px text-t-primary'>{t('mcp.market.activate.body')}</p>
        {blocked && (
          <Alert type='warning' content={t('mcp.market.activate.missing', { keys: instance.missing.join(', ') })} />
        )}
        {approvalNeeded && (
          <div className='flex flex-col gap-6px'>
            <Alert type='warning' content={t('mcp.market.activate.productionWrite')} />
            <label className='text-13px text-t-primary font-medium' htmlFor='mcp-market-approval-ref'>
              {t('mcp.market.activate.approvalLabel')}
              <span className='text-danger ms-2px' aria-hidden='true'>
                *
              </span>
            </label>
            <Input
              id='mcp-market-approval-ref'
              value={approvalRef}
              onChange={setApprovalRef}
              onBlur={() => setTouched(true)}
              autoComplete='off'
              aria-required='true'
              aria-invalid={touched && !approvalValid}
              aria-describedby='mcp-market-approval-help'
              status={touched && !approvalValid ? 'error' : undefined}
              className={touchClass(isMobile)}
            />
            <span id='mcp-market-approval-help' className='text-12px text-t-secondary'>
              {t('mcp.market.activate.approvalHelp')} · {t('mcp.market.activate.approvalFormat')}
            </span>
            {touched && !approvalValid && (
              <span role='alert' className='text-12px text-danger'>
                {value ? t('mcp.market.activate.approvalInvalid') : t('mcp.market.activate.approvalRequired')}
              </span>
            )}
          </div>
        )}
        {error && <Alert type='error' content={error} />}
      </div>
    </Modal>
  );
};

export default ActivateModal;

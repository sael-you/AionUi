/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Confirmation for activating a market instance. D50: a production write
 * instance is not gated on a recorded approval; the modal states instead that
 * the agent asks the owner before every call to it, on every CLI (TASK-97).
 */

import { Alert, Modal } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpMarketInstance } from '@/common/config/storage';
import { describeMarketError, isProductionWrite } from '@/renderer/hooks/mcp/market/marketModel';
import { touchClass, useIsMobileLayout } from './shared';

type ActivateModalProps = {
  instance: McpMarketInstance | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
};

const ActivateModal: React.FC<ActivateModalProps> = ({ instance, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobileLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [instance?.id]);

  if (!instance) return null;
  const blocked = instance.missing.length > 0;

  const confirm = async () => {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
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
      okButtonProps={{ disabled: blocked, className: touchClass(isMobile) }}
      cancelButtonProps={{ className: touchClass(isMobile) }}
      style={isMobile ? { width: '100%', top: 0 } : undefined}
      unmountOnExit
    >
      <div className='flex flex-col gap-12px'>
        <p className='m-0 text-14px text-t-primary'>{t('mcp.market.activate.body')}</p>
        {blocked && (
          <Alert type='warning' content={t('mcp.market.activate.missing', { keys: instance.missing.join(', ') })} />
        )}
        {isProductionWrite(instance) && (
          <Alert
            type='warning'
            content={t('mcp.market.activate.productionWrite')}
            data-testid='mcp-market-prod-write-rule'
          />
        )}
        {error && <Alert type='error' content={error} />}
      </div>
    </Modal>
  );
};

export default ActivateModal;

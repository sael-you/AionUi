/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App-wide prompts for agent actions on a phone, the Mac or an add-on that
 * wait for the owner (C38 §3, TASK-136): launching or typing into payment,
 * banking, messaging and store apps, installs and deletes, Chrome high-value
 * origins — and a whole add-on task, whose text is shown because its single
 * taps cannot be gated. Allow / Deny with a countdown; silence = refused.
 */

import { Button, Message } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { devices as devicesApi } from '@/common/adapter/ipcBridge';
import type { DeviceApproval, DeviceApprovalDecision } from '@/common/types/platform/devices';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { pendingDeviceApprovals, useDeviceApprovals } from '../useDevices';

const KEY = 'settings.devices.approval';
/** Wording shared with the own-browser approvals (C34). */
const SHARED = 'preview.browserDevices.approval';

const secondsLeft = (expiresAt: number, now: number) => Math.max(0, Math.ceil((expiresAt - now) / 1000));

export const DeviceApprovalCard: React.FC<{
  approval: DeviceApproval;
  now: number;
  onDecided: (id: string) => void;
}> = ({ approval, now, onDecided }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState<DeviceApprovalDecision | null>(null);
  const target = approval.package ?? approval.origin;

  const decide = async (decision: DeviceApprovalDecision) => {
    setBusy(decision);
    try {
      await devicesApi.decideApproval.invoke({ id: approval.id, decision });
      Message.success(t(decision === 'allow' ? `${KEY}.allowed` : `${SHARED}.denied`));
    } catch (error) {
      Message.error(t(isBackendHttpError(error) && error.status === 410 ? `${SHARED}.expired` : `${SHARED}.failed`));
    } finally {
      setBusy(null);
      onDecided(approval.id);
    }
  };

  return (
    <div
      role='alertdialog'
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className='flex flex-col gap-8px p-12px rd-12px border border-solid border-warning-3 bg-1 shadow-lg'
      data-testid='device-approval'
    >
      <div className='flex items-center gap-8px'>
        <Shield theme='outline' size={16} className='text-warning-6 flex-shrink-0' aria-hidden />
        <span id={titleId} className='text-14px font-medium text-t-primary'>
          {t(approval.task ? `${KEY}.titleTask` : `${KEY}.title`, { device: approval.device_name })}
        </span>
      </div>
      <div id={bodyId} className='flex flex-col gap-4px text-12px text-t-secondary'>
        {target ? <span>{t(`${KEY}.target`, { target })}</span> : null}
        <code
          className='block px-8px py-4px rd-6px bg-fill-2 text-t-primary break-all whitespace-pre-wrap max-h-160px overflow-y-auto'
          data-testid='device-approval-summary'
        >
          {approval.task ?? approval.summary}
        </code>
        {approval.task ? <span>{t(`${KEY}.taskHint`)}</span> : null}
        <span aria-live='polite'>{t(`${SHARED}.countdown`, { count: secondsLeft(approval.expires_at, now) })}</span>
      </div>
      <div className='flex flex-wrap gap-8px justify-end'>
        <Button
          size='small'
          loading={busy === 'deny'}
          disabled={busy !== null}
          onClick={() => void decide('deny')}
          data-testid='device-approval-deny'
        >
          {t(`${SHARED}.deny`)}
        </Button>
        <Button
          size='small'
          type='primary'
          status='warning'
          loading={busy === 'allow'}
          disabled={busy !== null}
          onClick={() => void decide('allow')}
          data-testid='device-approval-allow'
        >
          {t(`${KEY}.allow`)}
        </Button>
      </div>
    </div>
  );
};

const DeviceApprovalPrompts: React.FC = () => {
  const isMobile = useLayoutContext()?.isMobile ?? false;
  // Devices pair with the WebUI's AionCore only.
  const { approvals, reload } = useDeviceApprovals(!isElectronDesktop());
  const [now, setNow] = useState(() => Date.now());
  const pending = pendingDeviceApprovals(approvals, now);

  useEffect(() => {
    if (approvals.length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [approvals.length]);

  if (pending.length === 0) return null;
  const drop = (id: string): void => {
    void reload((current) => (current ?? []).filter((row) => row.id !== id), { revalidate: true });
  };

  return (
    <div
      className={
        isMobile
          ? 'fixed left-8px right-8px bottom-8px z-1000 flex flex-col gap-8px'
          : 'fixed right-16px bottom-16px z-1000 w-360px flex flex-col gap-8px'
      }
      data-testid='device-approvals'
    >
      {pending.map((approval) => (
        <DeviceApprovalCard key={approval.id} approval={approval} now={now} onDecided={drop} />
      ))}
    </div>
  );
};

export default DeviceApprovalPrompts;

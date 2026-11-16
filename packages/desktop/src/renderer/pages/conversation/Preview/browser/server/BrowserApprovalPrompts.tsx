/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App-wide prompts for paused agent actions on high-value origins in the
 * owner's own browser (C34 / TASK-125, owner decision a): Google sign-in,
 * Gmail, banks, payment pages. One card per pending action with what the agent
 * wants to do, a live countdown, Allow (that device + tab + origin for 60 s)
 * and Deny (that command only). Silence = refused when the countdown ends.
 */

import { Button, Message } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { serverBrowser } from '@/common/adapter/ipcBridge';
import type { BrowserApproval } from '@/common/types/platform/serverBrowser';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { pendingApprovals, useBrowserApprovals } from './useBrowserDevices';

const secondsLeft = (expiresAt: number, now: number) => Math.max(0, Math.ceil((expiresAt - now) / 1000));

const ApprovalCard: React.FC<{
  approval: BrowserApproval;
  now: number;
  onDecided: (approvalId: string) => void;
}> = ({ approval, now, onDecided }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'deny');
    try {
      await serverBrowser.decideApproval.invoke({ approval_id: approval.approval_id, approve });
      Message.success(t(approve ? 'preview.browserDevices.approval.allowed' : 'preview.browserDevices.approval.denied'));
    } catch (error) {
      Message.error(
        t(
          isBackendHttpError(error) && error.status === 410
            ? 'preview.browserDevices.approval.expired'
            : 'preview.browserDevices.approval.failed'
        )
      );
    } finally {
      setBusy(null);
      onDecided(approval.approval_id);
    }
  };

  return (
    <div
      role='alertdialog'
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className='flex flex-col gap-8px p-12px rd-12px border border-solid border-warning-3 bg-1 shadow-lg'
      data-testid='browser-approval'
    >
      <div className='flex items-center gap-8px'>
        <Shield theme='outline' size={16} className='text-warning-6 flex-shrink-0' aria-hidden />
        <span id={titleId} className='text-14px font-medium text-t-primary'>
          {t('preview.browserDevices.approval.title', { origin: approval.origin })}
        </span>
      </div>
      <div id={bodyId} className='flex flex-col gap-4px text-12px text-t-secondary'>
        <span>{t('preview.browserDevices.approval.where', { device: approval.device_name })}</span>
        <code className='block px-8px py-4px rd-6px bg-fill-2 text-t-primary break-all whitespace-pre-wrap'>
          {approval.summary}
        </code>
        <span aria-live='polite'>
          {t('preview.browserDevices.approval.countdown', { count: secondsLeft(approval.expires_at, now) })}
        </span>
      </div>
      <div className='flex flex-wrap gap-8px justify-end'>
        <Button
          size='small'
          loading={busy === 'deny'}
          disabled={busy !== null}
          onClick={() => void decide(false)}
          data-testid='browser-approval-deny'
        >
          {t('preview.browserDevices.approval.deny')}
        </Button>
        <Button
          size='small'
          type='primary'
          status='warning'
          loading={busy === 'approve'}
          disabled={busy !== null}
          onClick={() => void decide(true)}
          data-testid='browser-approval-allow'
        >
          {t('preview.browserDevices.approval.allow')}
        </Button>
      </div>
    </div>
  );
};

const BrowserApprovalPrompts: React.FC = () => {
  const isMobile = useLayoutContext()?.isMobile ?? false;
  // The owner's own browser pairs with the WebUI's AionCore only.
  const { approvals, reload } = useBrowserApprovals(!isElectronDesktop());
  const [now, setNow] = useState(() => Date.now());
  const pending = pendingApprovals(approvals, now);

  useEffect(() => {
    if (approvals.length === 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [approvals.length]);

  if (pending.length === 0) return null;
  const drop = (approvalId: string): void => {
    void reload((current) => (current ?? []).filter((row) => row.approval_id !== approvalId), { revalidate: true });
  };

  return (
    <div
      className={
        isMobile
          ? 'fixed left-8px right-8px bottom-8px z-1000 flex flex-col gap-8px'
          : 'fixed right-16px bottom-16px z-1000 w-360px flex flex-col gap-8px'
      }
      data-testid='browser-approvals'
    >
      {pending.map((approval) => (
        <ApprovalCard key={approval.approval_id} approval={approval} now={now} onDecided={drop} />
      ))}
    </div>
  );
};

export default BrowserApprovalPrompts;

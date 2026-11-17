/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns interrupted by an AionUi restart (TASK-44). AionCore marks the
 * conversation at startup (`extra.restart_interrupted`); the chat shows what
 * was going on with Continue / Dismiss, and the per-conversation switch
 * "Auto-continue after restarts" (`extra.auto_continue_after_restart`, off by
 * default) lets AionCore continue by itself next time.
 */

import { Button, Message, Popover, Switch, Tooltip } from '@arco-design/web-react';
import { PlayCycle } from '@icon-park/react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import type { RestartInterrupted } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { readAutoContinue, readRestartInterrupted } from './runState';
import StatusGlyph from './StatusGlyph';

const KEY = 'conversation.orchestration.restart';

/** The SWR key the conversation page keeps fresh on `conversation.listChanged`. */
const conversationKey = (conversationId: string): string => `conversation/${conversationId}`;

/** i18n key + values of the line saying what the turn was doing. */
export const restartDetail = (record: RestartInterrupted): { key: string; tool?: string } => {
  if (record.kind === 'text') return { key: `${KEY}.kind.text` };
  if (record.kind === 'approval') {
    return record.tool ? { key: `${KEY}.kind.approvalNamed`, tool: record.tool } : { key: `${KEY}.kind.approval` };
  }
  return record.tool ? { key: `${KEY}.kind.toolNamed`, tool: record.tool } : { key: `${KEY}.kind.tool` };
};

/** The switch itself, with its one-line explanation. */
export const AutoContinueSwitch: React.FC<{ conversationId: string; enabled: boolean }> = ({
  conversationId,
  enabled,
}) => {
  const { t } = useTranslation();
  const labelId = useId();
  const [saving, setSaving] = useState(false);
  // Shown until the refreshed conversation arrives.
  const [local, setLocal] = useState<boolean | null>(null);
  const checked = local ?? enabled;

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const result = await ipcBridge.conversation.setAutoContinue.invoke({
        conversation_id: conversationId,
        enabled: next,
      });
      setLocal(result.enabled);
      void mutate(conversationKey(conversationId));
      Message.success(t(result.enabled ? `${KEY}.auto.on` : `${KEY}.auto.off`));
    } catch {
      Message.error(t(`${KEY}.auto.failed`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex items-start gap-12px' data-testid='restart-auto-continue'>
      <div className='min-w-0 flex-1 flex flex-col gap-2px'>
        <span id={labelId} className='text-13px text-t-primary'>
          {t(`${KEY}.auto.label`)}
        </span>
        <span className='text-12px text-t-secondary leading-relaxed'>{t(`${KEY}.auto.desc`)}</span>
      </div>
      <Switch
        size='small'
        checked={checked}
        loading={saving}
        aria-labelledby={labelId}
        onChange={(next: boolean) => void toggle(next)}
        data-testid='restart-auto-continue-switch'
      />
    </div>
  );
};

/** Chat header: the switch behind a small button (it must be reachable before any restart). */
export const AutoContinueButton: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const { t } = useTranslation();
  const enabled = readAutoContinue(conversation.extra);
  return (
    <Popover
      trigger='click'
      position='br'
      content={
        <div className='w-280px max-w-[calc(100vw-48px)]'>
          <AutoContinueSwitch conversationId={conversation.id} enabled={enabled} />
        </div>
      }
    >
      <Tooltip content={t(`${KEY}.auto.label`)}>
        <Button
          size='mini'
          type={enabled ? 'outline' : 'secondary'}
          icon={<PlayCycle theme='outline' size={14} />}
          aria-label={t(`${KEY}.auto.label`)}
          aria-pressed={enabled}
          data-testid='restart-auto-continue-button'
        />
      </Tooltip>
    </Popover>
  );
};

/**
 * The row at the end of the chat. `waiting`: what was interrupted, why it did
 * not continue by itself (if the switch is on), Continue / Dismiss and the
 * switch. `auto_continued`: a small hint. Otherwise nothing.
 */
export const RestartInterruptedNotice: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const titleId = useId();
  // Read-only: the conversation page owns the fetch and refreshes it on list-changed events.
  const { data: conversation } = useSWR<TChatConversation | null>(conversationKey(conversationId));
  const [busy, setBusy] = useState<'continue' | 'dismiss' | null>(null);
  const record = readRestartInterrupted(conversation?.extra);

  if (!record) return null;
  if (record.state === 'auto_continued') {
    return (
      <div className='flex items-center gap-6px text-12px text-t-secondary' data-testid='restart-auto-continued'>
        <PlayCycle theme='outline' size={12} aria-hidden />
        <span>{t(`${KEY}.autoContinued`)}</span>
      </div>
    );
  }
  if (record.state !== 'waiting') return null;

  const act = async (action: 'continue' | 'dismiss') => {
    setBusy(action);
    try {
      await ipcBridge.conversation.restartResume.invoke({ conversation_id: conversationId, action });
    } catch (error) {
      // 400: another tab (or the auto-continue) already handled it.
      Message.error(t(isBackendHttpError(error) && error.status === 400 ? `${KEY}.alreadyHandled` : `${KEY}.failed`));
    } finally {
      setBusy(null);
      void mutate(conversationKey(conversationId));
    }
  };

  const detail = restartDetail(record);
  return (
    <section
      aria-labelledby={titleId}
      className='flex flex-col gap-8px p-12px rd-12px border border-solid border-warning-3 bg-1'
      data-testid='restart-interrupted'
    >
      <div className='flex items-center gap-8px'>
        <StatusGlyph state='waiting' size={14} label={null} />
        <span id={titleId} className='text-14px font-medium text-t-primary'>
          {t(`${KEY}.title`)}
        </span>
      </div>
      <div className='flex flex-col gap-4px text-12px text-t-secondary leading-relaxed'>
        <span>{t(detail.key, detail.tool ? { tool: detail.tool } : undefined)}</span>
        {record.summary ? (
          <code className='block px-8px py-4px rd-6px bg-fill-2 text-t-primary break-all whitespace-pre-wrap'>
            {record.summary}
          </code>
        ) : null}
        {record.auto_blocked ? (
          <span data-testid='restart-auto-blocked'>{t(`${KEY}.blocked.${record.auto_blocked}`)}</span>
        ) : null}
      </div>
      <div className='flex flex-wrap gap-8px'>
        <Button
          size='small'
          type='primary'
          loading={busy === 'continue'}
          disabled={busy !== null}
          onClick={() => void act('continue')}
          data-testid='restart-continue'
        >
          {t(`${KEY}.continue`)}
        </Button>
        <Button
          size='small'
          loading={busy === 'dismiss'}
          disabled={busy !== null}
          onClick={() => void act('dismiss')}
          data-testid='restart-dismiss'
        >
          {t(`${KEY}.dismiss`)}
        </Button>
      </div>
      <div className='pt-8px border-t border-t-solid border-3'>
        <AutoContinueSwitch conversationId={conversationId} enabled={readAutoContinue(conversation?.extra)} />
      </div>
    </section>
  );
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { BoardAssignRequest, BoardEvent, BoardLink } from '@/common/types/board';

import type { CardDetailController } from '../../hooks/useCardDetail';
import { departmentName } from '../../utils/boardFormat';

const REMOVED = 'removed';

/** The latest event of `kind` that names this conversation. */
const lastEventFor = (events: BoardEvent[], kind: string, conversationId: string): BoardEvent | undefined =>
  events
    .filter((event) => event.kind === kind && event.payload?.conversation_id === conversationId)
    .toSorted((a, b) => b.seq - a.seq)[0];

type ResendPayload = { idempotency_key?: unknown; request?: unknown };

/**
 * Whether the packet to this conversation is still undelivered, and how to resend
 * it: the `packet_send_failed` event carries the original assign request and its
 * idempotency key, so a resend resumes the same assignment (SPEC §6).
 */
const pendingResend = (
  events: BoardEvent[],
  conversationId: string
): { key: string; request: Omit<BoardAssignRequest, 'idempotency_key'> } | null => {
  const failed = lastEventFor(events, 'packet_send_failed', conversationId);
  if (!failed) return null;
  const sent = lastEventFor(events, 'packet_sent', conversationId);
  if (sent && sent.seq > failed.seq) return null;
  const payload = failed.payload as ResendPayload;
  if (typeof payload.idempotency_key !== 'string' || !payload.request || typeof payload.request !== 'object') {
    return null;
  }
  return { key: payload.idempotency_key, request: payload.request as Omit<BoardAssignRequest, 'idempotency_key'> };
};

const LinkRow: React.FC<{
  link: BoardLink;
  events: BoardEvent[];
  editable: boolean;
  controller: CardDetailController;
}> = ({ link, events, editable, controller }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const removed = link.conversation_status === REMOVED;
  const name = link.conversation_name || t('board.conversations.untitled', { id: link.conversation_id.slice(0, 8) });
  const resend = removed ? null : pendingResend(events, link.conversation_id);
  const fallback = lastEventFor(events, 'link_parent_fallback', link.conversation_id);
  const fallbackReason = typeof fallback?.payload?.reason === 'string' ? fallback.payload.reason : null;

  return (
    <li className='rd-6px bg-2 p-8px flex flex-col gap-4px' data-link={link.conversation_id}>
      <div className='flex flex-wrap items-center gap-6px'>
        <span className='text-13px font-medium text-t-primary truncate max-w-full'>{name}</span>
        <Tag size='small'>{t(`board.roles.${link.role}`)}</Tag>
        {link.department && <Tag size='small'>{departmentName(link.department, t)}</Tag>}
        {removed ? (
          <Tag size='small' color='gray'>
            {t('board.conversations.removed')}
          </Tag>
        ) : (
          <span className='text-12px text-t-secondary'>
            {t('board.conversations.status', { status: link.conversation_status })}
          </span>
        )}
        <Button
          className='ms-auto'
          size='mini'
          disabled={removed}
          aria-label={t('board.conversations.open', { name })}
          onClick={() => void navigate(`/conversation/${encodeURIComponent(link.conversation_id)}`)}
        >
          {t('board.conversations.openShort')}
        </Button>
      </div>
      {fallback && (
        <span className='text-12px text-t-secondary'>
          {fallbackReason === 'depth' || fallbackReason === 'fanout' || fallbackReason === 'team'
            ? t(`board.assign.fallback.${fallbackReason}`)
            : t('board.conversations.separate')}
        </span>
      )}
      {resend && (
        <div className='flex flex-wrap items-center gap-6px text-12px text-warning' role='status'>
          <Attention theme='outline' size='12' fill='currentColor' aria-hidden />
          <span>{t('board.assign.packetFailed')}</span>
          {editable && (
            <Button
              size='mini'
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await controller.assign(resend.request, resend.key);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('board.assign.resend')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
};

/** Conversations linked to the card (its tree): role, department, status, one-click open, "removed". */
export const CardConversations: React.FC<{
  links: BoardLink[];
  events: BoardEvent[];
  editable: boolean;
  controller: CardDetailController;
}> = ({ links, events, editable, controller }) => {
  const { t } = useTranslation();
  return (
    <section aria-labelledby='board-drawer-conversations' className='flex flex-col gap-6px'>
      <h3 id='board-drawer-conversations' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.conversations.title')}
      </h3>
      {links.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.conversations.empty')}</p>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-col gap-6px'>
          {links.map((link) => (
            <LinkRow
              key={link.conversation_id}
              link={link}
              events={events}
              editable={editable}
              controller={controller}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

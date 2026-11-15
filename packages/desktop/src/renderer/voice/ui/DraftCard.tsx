/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Draft card (plan §1 "Read-back"/"Confirm", §3.3): target (or the "A or B?"
 * choices), delivery mode, the rewritten request as a diff against your
 * transcript (transform by transform), the 4 s hold countdown, and Send /
 * Edit / Cancel taps. Spoken "send" is offered only when the backend accepts
 * it for this draft and a call is live; otherwise the card says "tap Send".
 */

import { Button, Progress, Tag, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CANCELLABLE_DRAFT_STATES, CONFIRMABLE_DRAFT_STATES, type VoiceDraft } from '../core/types';
import { HOLD_MS } from '../core/VoiceController';
import styles from './voice.module.css';

export type DraftCardProps = {
  draft: VoiceDraft;
  holdUntil: number | null;
  readbackPlaying: boolean;
  /** A provider call is live: spoken "send" and voice edits are possible. */
  inCall: boolean;
  /** A tap for this draft version is on its way. */
  tap?: 'confirm' | 'cancel' | null;
  /** Last line Jarvis said about this draft (e.g. a refused spoken "send"). */
  hint?: string | null;
  onSend: () => void;
  onCancel: () => void;
  /** Open the target conversation (offered when the message was saved but did not start). */
  onOpenTarget?: (conversationId: string) => void;
  now?: () => number;
};

/** Status line under the diff: a tap-only draft never invites a spoken "send". */
function stateKey(draft: VoiceDraft, inCall: boolean): string {
  if (draft.state === 'drafted' && !(draft.spokenConfirm && inCall)) return 'voice.draft.state.draftedTapOnly';
  return `voice.draft.state.${draft.state}`;
}

function useHoldRemaining(holdUntil: number | null, now: () => number): number | null {
  const [remaining, setRemaining] = useState<number | null>(holdUntil ? Math.max(0, holdUntil - now()) : null);
  useEffect(() => {
    if (!holdUntil) {
      setRemaining(null);
      return undefined;
    }
    const tick = () => setRemaining(Math.max(0, holdUntil - now()));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [holdUntil, now]);
  return remaining;
}

const DraftCard: React.FC<DraftCardProps> = ({
  draft,
  holdUntil,
  readbackPlaying,
  inCall,
  tap = null,
  hint = null,
  onSend,
  onCancel,
  onOpenTarget,
  now = Date.now,
}) => {
  const { t } = useTranslation();
  const [editHint, setEditHint] = useState(false);
  // The backend owns the hold deadline; it may freeze it while you speak (§3.3.5).
  const frozen = draft.state === 'committing' && draft.holdFrozen === true;
  const remaining = useHoldRemaining(draft.state === 'committing' && !frozen ? holdUntil : null, now);
  const canSend = CONFIRMABLE_DRAFT_STATES.has(draft.state) && Boolean(draft.hash) && tap === null;
  const canCancel = CANCELLABLE_DRAFT_STATES.has(draft.state) && tap !== 'cancel';
  // Edits are spoken ("change it to …") to the call that built the draft.
  const canEdit = inCall && (CONFIRMABLE_DRAFT_STATES.has(draft.state) || draft.state === 'ambiguous');
  const ambiguous = draft.state === 'ambiguous' && draft.options.length > 0;
  // "Saved, not started": starting it is a fresh action in the conversation itself.
  const savedIn = draft.state === 'saved_not_started' && draft.target?.kind !== 'project' ? draft.target : null;
  const transforms = Array.from(new Set(draft.diff.map((d) => d.transform).filter(Boolean))) as Array<
    'filler' | 'reference' | 'reorder'
  >;

  useEffect(() => setEditHint(false), [draft.draftId, draft.version]);

  return (
    <section className={styles.card} aria-label={t('voice.draft.title')} data-testid='voice-draft-card'>
      <div className='flex items-center justify-between gap-8px flex-wrap'>
        <Typography.Text bold>
          {t('voice.draft.to')}:{' '}
          {draft.target ? draft.target.name : ambiguous ? t('voice.draft.chooseTarget') : t('voice.draft.noTarget')}
        </Typography.Text>
        {draft.delivery && <Tag size='small'>{t(`voice.draft.delivery.${draft.delivery}`)}</Tag>}
      </div>

      {ambiguous && (
        <ul className='list-none m-0 p-0 flex flex-wrap gap-4px' aria-label={t('voice.draft.options')}>
          {draft.options.map((option) => (
            <li key={option.id}>
              <Tag size='small' color='orange'>
                {option.name}
              </Tag>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.diff} dir='auto'>
        {draft.diff.length > 0
          ? draft.diff.map((seg, i) =>
              seg.op === 'insert' ? (
                <ins key={i} className={styles.diffInsert}>
                  {seg.text}
                </ins>
              ) : seg.op === 'delete' ? (
                <del key={i} className={styles.diffDelete}>
                  {seg.text}
                </del>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )
          : draft.text}
      </p>
      {transforms.length > 0 && (
        <div className='flex flex-wrap gap-4px' aria-label={t('voice.draft.diffLabel')}>
          {transforms.map((tr) => (
            <Tag key={tr} size='small' color='arcoblue'>
              {t(`voice.draft.transform.${tr}`)}
            </Tag>
          ))}
        </div>
      )}

      {/* Announced once per state change (polite); the per-second countdown below is visual only. */}
      <Typography.Text type='secondary' role='status' aria-live='polite'>
        {readbackPlaying
          ? t('voice.status.readback')
          : frozen
            ? t('voice.draft.holdFrozen')
            : t(stateKey(draft, inCall))}
      </Typography.Text>
      {hint && (
        <Typography.Text type='warning' dir='auto' data-testid='voice-draft-hint'>
          {hint}
        </Typography.Text>
      )}

      {remaining !== null && (
        <div aria-hidden='true' data-testid='voice-hold-countdown'>
          <Progress percent={Math.round((remaining / HOLD_MS) * 100)} showText={false} status='warning' size='small' />
          <Typography.Text>{t('voice.draft.holding', { seconds: Math.ceil(remaining / 1000) })}</Typography.Text>
        </div>
      )}

      {editHint && <Typography.Text type='secondary'>{t('voice.draft.editHint')}</Typography.Text>}

      <div className={styles.controls}>
        {savedIn && onOpenTarget ? (
          <Button type='primary' onClick={() => onOpenTarget(savedIn.id)}>
            {t('voice.draft.openTarget')}
          </Button>
        ) : (
          <Button type='primary' disabled={!canSend} loading={tap === 'confirm'} onClick={onSend}>
            {t('voice.draft.send')}
          </Button>
        )}
        <Button
          disabled={!canEdit}
          title={canEdit ? undefined : t('voice.draft.editNeedsCall')}
          onClick={() => setEditHint(true)}
        >
          {t('voice.draft.edit')}
        </Button>
        <Button status='danger' disabled={!canCancel} loading={tap === 'cancel'} onClick={onCancel}>
          {t('voice.draft.cancel')}
        </Button>
      </div>
    </section>
  );
};

export default DraftCard;

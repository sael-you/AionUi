/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Draft card (plan §1 "Read-back"/"Confirm", §3.3): target, delivery mode,
 * the rewritten request as a diff against your transcript (transform by
 * transform), the 4 s hold countdown, and Send / Edit / Cancel taps.
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
  onSend: () => void;
  onCancel: () => void;
  now?: () => number;
};

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
  onSend,
  onCancel,
  now = Date.now,
}) => {
  const { t } = useTranslation();
  const [editHint, setEditHint] = useState(false);
  // The backend owns the hold deadline; it may freeze it while you speak (§3.3.5).
  const frozen = draft.state === 'committing' && draft.holdFrozen === true;
  const remaining = useHoldRemaining(draft.state === 'committing' && !frozen ? holdUntil : null, now);
  const canSend = CONFIRMABLE_DRAFT_STATES.has(draft.state) && Boolean(draft.hash);
  const canCancel = CANCELLABLE_DRAFT_STATES.has(draft.state);
  const transforms = Array.from(new Set(draft.diff.map((d) => d.transform).filter(Boolean))) as Array<
    'filler' | 'reference' | 'reorder'
  >;

  useEffect(() => setEditHint(false), [draft.draftId, draft.version]);

  return (
    <section className={styles.card} aria-label={t('voice.draft.title')} data-testid='voice-draft-card'>
      <div className='flex items-center justify-between gap-8px flex-wrap'>
        <Typography.Text bold>
          {t('voice.draft.to')}: {draft.target ? draft.target.name : t('voice.draft.noTarget')}
        </Typography.Text>
        {draft.delivery && <Tag size='small'>{t(`voice.draft.delivery.${draft.delivery}`)}</Tag>}
      </div>

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
            : t(`voice.draft.state.${draft.state}`)}
      </Typography.Text>

      {remaining !== null && (
        <div aria-hidden='true' data-testid='voice-hold-countdown'>
          <Progress percent={Math.round((remaining / HOLD_MS) * 100)} showText={false} status='warning' size='small' />
          <Typography.Text>{t('voice.draft.holding', { seconds: Math.ceil(remaining / 1000) })}</Typography.Text>
        </div>
      )}

      {editHint && <Typography.Text type='secondary'>{t('voice.draft.editHint')}</Typography.Text>}

      <div className={styles.controls}>
        <Button type='primary' disabled={!canSend} onClick={onSend}>
          {t('voice.draft.send')}
        </Button>
        <Button disabled={!canSend} onClick={() => setEditHint(true)}>
          {t('voice.draft.edit')}
        </Button>
        <Button status='danger' disabled={!canCancel} onClick={onCancel}>
          {t('voice.draft.cancel')}
        </Button>
      </div>
    </section>
  );
};

export default DraftCard;

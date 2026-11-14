/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The owner's controls on a locked card (R3):
 * - Decision gate: Approve / Reject (reason optional, idempotent by key) and an
 *   override "Move out without a decision" (target + required reason).
 * - Ready to deploy (until the deploy automation exists) and Deploying: read-only
 *   status plus the two override presets "Mark deployed manually" / "Back to Local test".
 */

import { Button, Input } from '@arco-design/web-react';
import { CheckOne, CloseOne, Info, Lock } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { READY_TO_DEPLOY_COLUMN, type BoardCard, type BoardColumn } from '@/common/types/board';

import { BoardSelect } from '../../BoardSelect';
import type { BoardController } from '../../hooks/useBoard';
import { newIdempotencyKey, type CardDetailController } from '../../hooks/useCardDetail';
import { columnName, columnNameByKey } from '../../utils/boardFormat';
import { isManualMoveTarget, moveLock, visibleColumns } from '../../utils/boardModel';

const DEPLOYED = 'deployed';
const LOCAL_TEST = 'local_test';
const REASON_MAX = 500;

export const GatePanel: React.FC<{
  card: BoardCard;
  column: BoardColumn | undefined;
  board: BoardController;
  controller: CardDetailController;
}> = ({ card, column, board, controller }) => {
  const { t } = useTranslation();
  const columns = board.snapshot?.columns ?? [];
  const lock = moveLock(card, column);
  const [reason, setReason] = useState('');
  // One key per decision, renewed when the request changes (same key + other request → 409).
  const [keys, setKeys] = useState(() => ({ approve: newIdempotencyKey(), reject: newIdempotencyKey() }));
  const [busy, setBusy] = useState<string | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [forceTarget, setForceTarget] = useState<string | undefined>(undefined);
  const [forceReason, setForceReason] = useState('');
  const [forceError, setForceError] = useState(false);

  if (!lock || !column || board.readOnly || card.archived_at) return null;
  const deployStage = lock === 'automation' || column.key === READY_TO_DEPLOY_COLUMN;

  const run = async (id: string, action: () => Promise<boolean>) => {
    setBusy(id);
    try {
      return await action();
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    const ok = await run(decision, () => controller.decideGate(decision, reason, keys[decision]));
    if (ok) {
      setReason('');
      setKeys({ approve: newIdempotencyKey(), reject: newIdempotencyKey() });
    }
  };

  const force = async (target: string | undefined, text: string) => {
    if (!target || !text.trim()) {
      setForceError(true);
      return;
    }
    setForceError(false);
    const ok = await run(`force:${target}`, () => board.forceMove(card.id, target, text));
    if (ok) {
      setForceReason('');
      setForceOpen(false);
    }
  };

  const reasonError = forceError && !forceReason.trim();
  const reasonField = (
    <div className='flex flex-col gap-4px text-12px text-t-secondary'>
      <label className='flex flex-col gap-4px'>
        {t('board.gate.forceReason')}
        <Input
          size='small'
          value={forceReason}
          maxLength={REASON_MAX}
          status={reasonError ? 'error' : undefined}
          aria-invalid={reasonError || undefined}
          aria-describedby={reasonError ? 'board-gate-reason-error' : undefined}
          placeholder={t('board.gate.reasonPlaceholder')}
          onChange={(value) => {
            setForceReason(value);
            if (value.trim()) setForceError(false);
          }}
        />
      </label>
      {reasonError && (
        <span id='board-gate-reason-error' role='alert' className='text-danger'>
          {t('board.gate.forceReasonRequired')}
        </span>
      )}
    </div>
  );

  if (deployStage) {
    return (
      <section
        aria-labelledby='board-gate-title'
        className='rd-8px border border-solid border-warning p-12px flex flex-col gap-8px'
      >
        <h3 id='board-gate-title' className='m-0 flex items-center gap-6px text-14px font-medium text-t-primary'>
          <Lock theme='outline' size='14' fill='currentColor' aria-hidden />
          {columnName(column, t)}
        </h3>
        <p className='m-0 text-13px text-t-secondary'>
          {t(lock === 'automation' ? 'board.gate.deployingDescription' : 'board.gate.readyDescription')}
        </p>
        {column.key === READY_TO_DEPLOY_COLUMN && (
          <p className='m-0 flex items-center gap-6px rd-6px bg-2 p-8px text-13px text-t-primary'>
            <Info theme='outline' size='14' fill='currentColor' aria-hidden />
            {t('board.gate.deployLater')}
          </p>
        )}
        <p className='m-0 text-12px text-t-secondary'>{t('board.gate.forceDescription')}</p>
        {reasonField}
        <div className='flex flex-wrap gap-8px'>
          <Button size='small' loading={busy === `force:${DEPLOYED}`} onClick={() => void force(DEPLOYED, forceReason)}>
            {t('board.gate.markDeployed')}
          </Button>
          <Button
            size='small'
            loading={busy === `force:${LOCAL_TEST}`}
            onClick={() => void force(LOCAL_TEST, forceReason)}
          >
            {t('board.gate.backToLocalTest')}
          </Button>
        </div>
      </section>
    );
  }

  const approveTo = column.gate?.on_approve;
  const rejectTo = column.gate?.on_reject;
  const targets = visibleColumns(columns).filter(
    (candidate) => candidate.key !== column.key && isManualMoveTarget(candidate)
  );

  return (
    <section
      aria-labelledby='board-gate-title'
      className='rd-8px border border-solid border-warning p-12px flex flex-col gap-8px'
    >
      <h3 id='board-gate-title' className='m-0 flex items-center gap-6px text-14px font-medium text-t-primary'>
        <Lock theme='outline' size='14' fill='currentColor' aria-hidden />
        {t('board.gate.title')}
      </h3>
      <p className='m-0 text-13px text-t-secondary'>{t('board.gate.description', { column: columnName(column, t) })}</p>
      <label className='flex flex-col gap-4px text-12px text-t-secondary'>
        {t('board.gate.reasonOptional')}
        <Input.TextArea
          value={reason}
          maxLength={REASON_MAX}
          autoSize={{ minRows: 2, maxRows: 6 }}
          placeholder={t('board.gate.reasonPlaceholder')}
          onChange={(value) => {
            setReason(value);
            setKeys({ approve: newIdempotencyKey(), reject: newIdempotencyKey() });
          }}
        />
      </label>
      <div className='flex flex-wrap gap-8px'>
        <Button
          type='primary'
          size='small'
          status='success'
          loading={busy === 'approve'}
          disabled={busy !== null && busy !== 'approve'}
          icon={<CheckOne theme='outline' size='14' fill='currentColor' />}
          onClick={() => void decide('approve')}
        >
          {approveTo
            ? t('board.gate.approveTo', { column: columnNameByKey(columns, approveTo, t) })
            : t('board.gate.approve')}
        </Button>
        <Button
          size='small'
          status='danger'
          loading={busy === 'reject'}
          disabled={busy !== null && busy !== 'reject'}
          icon={<CloseOne theme='outline' size='14' fill='currentColor' />}
          onClick={() => void decide('reject')}
        >
          {rejectTo
            ? t('board.gate.rejectTo', { column: columnNameByKey(columns, rejectTo, t) })
            : t('board.gate.reject')}
        </Button>
      </div>
      <div>
        <Button
          type='text'
          size='mini'
          aria-expanded={forceOpen}
          aria-controls='board-gate-force'
          onClick={() => setForceOpen(!forceOpen)}
        >
          {t('board.gate.forceTitle')}
        </Button>
      </div>
      {forceOpen && (
        <div id='board-gate-force' className='flex flex-col gap-8px'>
          <p className='m-0 text-12px text-t-secondary'>{t('board.gate.forceDescription')}</p>
          <BoardSelect
            ariaLabel={t('board.gate.forceTarget')}
            size='small'
            placeholder={t('board.gate.forceTarget')}
            value={forceTarget}
            onChange={(value: string) => setForceTarget(value)}
            options={targets.map((candidate) => ({ value: candidate.key, label: columnName(candidate, t) }))}
          />
          {reasonField}
          <div>
            <Button
              size='small'
              status='warning'
              disabled={!forceTarget}
              loading={busy === `force:${forceTarget}`}
              onClick={() => void force(forceTarget, forceReason)}
            >
              {t('board.gate.forceSubmit')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

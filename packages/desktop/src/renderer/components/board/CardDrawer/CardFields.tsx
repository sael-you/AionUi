/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BOARD_CARD_TYPES,
  BOARD_DEPARTMENTS,
  BOARD_LIMITS,
  BOARD_PRIORITIES,
  BOARD_SIZES,
  BOARD_TIERS,
  type BoardCard,
  type BoardCardType,
  type BoardPriority,
  type BoardSize,
  type BoardTier,
} from '@/common/types/board';

import { BoardSelect } from '../BoardSelect';
import type { BoardController } from '../hooks/useBoard';
import type { CardDetailController } from '../hooks/useCardDetail';
import { actorName, assigneeLabel, columnName, departmentName, formatBoardTime } from '../utils/boardFormat';
import { endAnchor, sanitizeTagList, visibleColumns } from '../utils/boardModel';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <span className='text-13px text-t-secondary py-4px'>{label}</span>
    <div className='min-w-0'>{children}</div>
  </>
);

/** Editable card fields + read-only facts (assignee, creator, dates). Every change saves immediately. */
export const CardFields: React.FC<{
  card: BoardCard;
  editable: boolean;
  board: BoardController;
  controller: CardDetailController;
}> = ({ card, editable, board, controller }) => {
  const { t, i18n } = useTranslation();
  const snapshot = board.snapshot;
  const columns = snapshot ? visibleColumns(snapshot.columns) : [];

  // Suggestions: every label / skill already used on this board.
  const { labelOptions, skillOptions } = useMemo(() => {
    const labels = new Set<string>();
    const skills = new Set<string>();
    for (const other of snapshot?.cards ?? []) {
      other.labels.forEach((label) => labels.add(label));
      other.skills.forEach((skill) => skills.add(skill));
    }
    return { labelOptions: [...labels].toSorted(), skillOptions: [...skills].toSorted() };
  }, [snapshot?.cards]);

  const listHelp = t('board.drawer.listLimit', { count: BOARD_LIMITS.listItems, max: BOARD_LIMITS.listItemLength });

  return (
    <section aria-labelledby='board-drawer-details' className='flex flex-col gap-8px'>
      <h3 id='board-drawer-details' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.drawer.details')}
      </h3>
      <div className='grid grid-cols-[minmax(96px,max-content)_1fr] gap-x-12px gap-y-8px items-center'>
        <Row label={t('board.drawer.column')}>
          <BoardSelect
            ariaLabel={t('board.drawer.column')}
            size='small'
            value={card.column_key}
            disabled={!editable || !snapshot}
            onChange={(toColumn: string) => {
              if (!snapshot || toColumn === card.column_key) return;
              void board.moveCard(card.id, toColumn, endAnchor(snapshot.cards, toColumn, card.id));
            }}
            options={columns.map((column) => ({ value: column.key, label: columnName(column, t) }))}
          />
        </Row>
        <Row label={t('board.type.label')}>
          <BoardSelect
            ariaLabel={t('board.type.label')}
            size='small'
            value={card.type}
            disabled={!editable}
            onChange={(type: BoardCardType) => void controller.updateFields({ type })}
            options={BOARD_CARD_TYPES.map((type) => ({ value: type, label: t(`board.type.${type}`) }))}
          />
        </Row>
        <Row label={t('board.priority.label')}>
          <BoardSelect
            ariaLabel={t('board.priority.label')}
            size='small'
            value={card.priority}
            disabled={!editable}
            onChange={(priority: BoardPriority) => void controller.updateFields({ priority })}
            options={BOARD_PRIORITIES.map((priority) => ({ value: priority, label: t(`board.priority.${priority}`) }))}
          />
        </Row>
        <Row label={t('board.size.label')}>
          <BoardSelect
            ariaLabel={t('board.size.label')}
            size='small'
            allowClear
            placeholder={t('board.drawer.notSet')}
            value={card.size ?? undefined}
            disabled={!editable}
            onChange={(size: BoardSize | undefined) => void controller.updateFields({ size: size ?? null })}
            options={BOARD_SIZES.map((size) => ({ value: size, label: t(`board.size.${size}`) }))}
          />
        </Row>
        <Row label={t('board.tier.label')}>
          <BoardSelect
            ariaLabel={t('board.tier.label')}
            size='small'
            allowClear
            placeholder={t('board.drawer.notSet')}
            value={card.tier ?? undefined}
            disabled={!editable}
            onChange={(tier: BoardTier | undefined) => void controller.updateFields({ tier: tier ?? null })}
            options={BOARD_TIERS.map((tier) => ({ value: tier, label: t(`board.tier.${tier}`) }))}
          />
        </Row>
        <Row label={t('board.drawer.labels')}>
          <BoardSelect
            ariaLabel={t('board.drawer.labels')}
            size='small'
            mode='multiple'
            allowCreate
            allowClear
            placeholder={t('board.drawer.labelsPlaceholder')}
            value={card.labels}
            disabled={!editable}
            onChange={(labels: string[]) => void controller.updateFields({ labels: sanitizeTagList(labels) })}
            options={labelOptions}
          />
          {editable && <div className='text-11px text-t-secondary mt-2px'>{listHelp}</div>}
        </Row>
        <Row label={t('board.drawer.skills')}>
          <BoardSelect
            ariaLabel={t('board.drawer.skills')}
            size='small'
            mode='multiple'
            allowCreate
            allowClear
            placeholder={t('board.drawer.skillsPlaceholder')}
            value={card.skills}
            disabled={!editable}
            onChange={(skills: string[]) => void controller.updateFields({ skills: sanitizeTagList(skills) })}
            options={skillOptions}
          />
        </Row>
        <Row label={t('board.drawer.routing')}>
          <BoardSelect
            ariaLabel={t('board.drawer.routing')}
            size='small'
            mode='multiple'
            allowCreate
            allowClear
            placeholder={t('board.drawer.routingPlaceholder')}
            value={card.routing}
            disabled={!editable}
            onChange={(routing: string[]) =>
              void controller.updateFields({ routing: sanitizeTagList(routing).slice(0, BOARD_LIMITS.routing) })
            }
            options={[...new Set([...BOARD_DEPARTMENTS, ...card.routing])].map((department) => ({
              value: department,
              label: departmentName(department, t),
            }))}
          />
          {editable && (
            <div className='text-11px text-t-secondary mt-2px'>
              {t('board.drawer.routingHelp', { count: BOARD_LIMITS.routing })}
            </div>
          )}
        </Row>
        <Row label={t('board.drawer.assignee')}>
          <span className='text-13px text-t-primary'>{assigneeLabel(card, t)}</span>
        </Row>
        <Row label={t('board.drawer.creator')}>
          <span className='text-13px text-t-primary'>{actorName(card.creator_kind, card.creator_ref, t)}</span>
        </Row>
        <Row label={t('board.drawer.created')}>
          <span className='text-13px text-t-primary'>{formatBoardTime(card.created_at, i18n.language)}</span>
        </Row>
        <Row label={t('board.drawer.updated')}>
          <span className='text-13px text-t-primary'>{formatBoardTime(card.updated_at, i18n.language)}</span>
        </Row>
      </div>
    </section>
  );
};

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import { CheckOne, Time } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { BoardCard } from '@/common/types/board';

import { BoardSelect } from '../BoardSelect';
import type { BoardController } from '../hooks/useBoard';
import type { CardDetailController } from '../hooks/useCardDetail';
import { columnNameByKey } from '../utils/boardFormat';
import { cardRef } from '../utils/boardModel';

/**
 * "Depends on" chips (R5: an open dependency blocks forward moves) with add and
 * remove. A cycle is refused by the server (422 `board_dependency_cycle`).
 */
export const CardDependencies: React.FC<{
  card: BoardCard;
  editable: boolean;
  board: BoardController;
  controller: CardDetailController;
}> = ({ card, editable, board, controller }) => {
  const { t } = useTranslation();
  const columns = board.snapshot?.columns ?? [];
  const taken = new Set([card.id, ...card.dependencies.map((dependency) => dependency.card_id)]);
  const candidates = (board.snapshot?.cards ?? [])
    .filter((other) => !taken.has(other.id) && !other.archived_at)
    .toSorted((a, b) => a.number - b.number);

  return (
    <section aria-labelledby='board-drawer-dependencies' className='flex flex-col gap-6px'>
      <h3 id='board-drawer-dependencies' className='m-0 text-13px font-medium text-t-secondary'>
        {t('board.drawer.dependencies')}
      </h3>
      {card.dependencies.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.drawer.noDependencies')}</p>
      ) : (
        <ul className='m-0 p-0 list-none flex flex-wrap gap-6px'>
          {card.dependencies.map((dependency) => {
            const ref = cardRef(dependency.number);
            return (
              <li key={dependency.card_id} className='max-w-full'>
                <Tag
                  visible
                  color={dependency.resolved ? 'green' : 'orangered'}
                  closable={editable}
                  icon={
                    dependency.resolved ? (
                      <CheckOne theme='outline' size='12' fill='currentColor' aria-hidden />
                    ) : (
                      <Time theme='outline' size='12' fill='currentColor' aria-hidden />
                    )
                  }
                  onClose={() => void controller.removeDependency(dependency.card_id)}
                  __closeIconProps={{ 'aria-label': t('board.drawer.removeDependency', { ref }) }}
                  className='max-w-full'
                  title={`${columnNameByKey(columns, dependency.column_key, t)}`}
                >
                  <span className='truncate inline-block max-w-260px align-bottom'>
                    {ref} {dependency.title} ·{' '}
                    {t(dependency.resolved ? 'board.drawer.dependencyDone' : 'board.drawer.dependencyOpen')}
                  </span>
                </Tag>
              </li>
            );
          })}
        </ul>
      )}
      {editable && candidates.length > 0 && (
        <BoardSelect
          ariaLabel={t('board.drawer.addDependency')}
          size='small'
          showSearch
          value={undefined}
          placeholder={t('board.drawer.addDependency')}
          filterOption={(input, option) =>
            String((option as { props?: { children?: unknown } })?.props?.children ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          onChange={(dependsOn: string) => {
            if (dependsOn) void controller.addDependency(dependsOn);
          }}
          options={candidates.map((other) => ({ value: other.id, label: `${cardRef(other.number)} ${other.title}` }))}
        />
      )}
    </section>
  );
};

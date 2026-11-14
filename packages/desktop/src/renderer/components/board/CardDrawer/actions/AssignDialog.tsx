/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Assign a card (G5, SPEC §6) to an assistant (a new department conversation in
 * the project, packet as first message) or to a Team of the project, with a
 * department and a role. The idempotency key lives as long as the request stays
 * the same, so a retry resumes the earlier attempt instead of opening a second
 * conversation.
 */

import { Button, Modal, Radio } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ipcBridge } from '@/common';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
import { BOARD_ASSIGN_ROLES, BOARD_DEPARTMENTS, type BoardCard, type BoardLinkRole } from '@/common/types/board';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { normalizeWorkspace } from '@/renderer/utils/workspace/workspace';

import { BoardSelect } from '../../BoardSelect';
import { useAssistantOptions, useProjectWorkspace } from '../../hooks/useBoardDirectory';
import { newIdempotencyKey, type CardDetailController } from '../../hooks/useCardDetail';
import { departmentName } from '../../utils/boardFormat';
import { cardRef } from '../../utils/boardModel';

type Target = 'assistant' | 'team';

const AssignForm: React.FC<{
  card: BoardCard;
  controller: CardDetailController;
  onDone: () => void;
  onCancel: () => void;
}> = ({ card, controller, onDone, onCancel }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const assistants = useAssistantOptions();
  const workspace = useProjectWorkspace(card.project_id);
  const { data: teams } = useSWR(
    TEAM_MODE_ENABLED && user ? ['board-teams', user.id] : null,
    ([, id]: [string, string]) => ipcBridge.team.list.invoke({ user_id: id })
  );
  const projectTeams = useMemo(() => {
    const key = workspace ? normalizeWorkspace(workspace) : null;
    return (teams ?? []).filter((team) => !key || normalizeWorkspace(team.workspace) === key);
  }, [teams, workspace]);

  const [target, setTarget] = useState<Target>('assistant');
  const [assistantId, setAssistantId] = useState<string | undefined>();
  const [teamId, setTeamId] = useState<string | undefined>();
  const [department, setDepartment] = useState<string>(card.routing[0] ?? 'lead');
  const [role, setRole] = useState<BoardLinkRole>('review');
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);

  /** Any change of the request needs a fresh key (same key + other request → 409). */
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setKey(newIdempotencyKey());
    };

  const chosen = target === 'assistant' ? assistantId : teamId;
  const departmentOptions = [...new Set([...card.routing, ...BOARD_DEPARTMENTS])];

  const submit = async () => {
    if (!chosen || !department) return;
    setBusy(true);
    try {
      const response = await controller.assign(
        { ...(target === 'assistant' ? { assistant_id: chosen } : { team_id: chosen }), department, role },
        key
      );
      if (response) onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      {TEAM_MODE_ENABLED && (
        <Radio.Group
          type='button'
          aria-label={t('board.assign.kind')}
          value={target}
          onChange={change((value: Target) => setTarget(value))}
        >
          <Radio value='assistant'>{t('board.assign.assistant')}</Radio>
          <Radio value='team'>{t('board.assign.team')}</Radio>
        </Radio.Group>
      )}
      {target === 'assistant' ? (
        <BoardSelect
          ariaLabel={t('board.assign.assistant')}
          showSearch
          placeholder={t('board.assign.pickAssistant')}
          value={assistantId}
          onChange={change((value: string) => setAssistantId(value))}
          options={assistants}
        />
      ) : projectTeams.length === 0 ? (
        <p className='m-0 text-13px text-t-secondary'>{t('board.assign.noTeams')}</p>
      ) : (
        <BoardSelect
          ariaLabel={t('board.assign.team')}
          placeholder={t('board.assign.pickTeam')}
          value={teamId}
          onChange={change((value: string) => setTeamId(value))}
          options={projectTeams.map((team) => ({ value: team.id, label: team.name }))}
        />
      )}
      <BoardSelect
        ariaLabel={t('board.assign.department')}
        allowCreate
        showSearch
        value={department}
        onChange={change((value: string) => setDepartment(value))}
        options={departmentOptions.map((value) => ({ value, label: departmentName(value, t) }))}
      />
      <BoardSelect
        ariaLabel={t('board.assign.role')}
        value={role}
        onChange={change((value: BoardLinkRole) => setRole(value))}
        options={BOARD_ASSIGN_ROLES.map((value) => ({ value, label: t(`board.roles.${value}`) }))}
      />
      <div className='flex justify-end gap-8px'>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type='primary' loading={busy} disabled={!chosen || !department} onClick={() => void submit()}>
          {t('board.assign.submit')}
        </Button>
      </div>
    </div>
  );
};

export const AssignDialog: React.FC<{
  card: BoardCard;
  visible: boolean;
  onClose: () => void;
  controller: CardDetailController;
}> = ({ card, visible, onClose, controller }) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={t('board.assign.title', { ref: cardRef(card.number) })}
      visible={visible}
      onCancel={onClose}
      footer={null}
      unmountOnExit
      autoFocus
      focusLock
    >
      {visible && <AssignForm card={card} controller={controller} onDone={onClose} onCancel={onClose} />}
    </Modal>
  );
};

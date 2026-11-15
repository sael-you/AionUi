/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The team route publishes its project colour identity before paint and clears
 * it when the team unmounts, so a team / project switch never paints a frame
 * with the previous identity (the sidebar group and mobile titlebar read it).
 */

import React, { useLayoutEffect } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { ProjectIdentity } from '@/renderer/components/workspace/ProjectIdentity';

const { getConversationOrNullMock, cronJobManagerMock, ensureSessionMock, makeTeamEventChannel } = vi.hoisted(() => {
  const handlers: Record<string, Array<(event: unknown) => void>> = {};
  const makeChannel = (name: string) => ({
    on: vi.fn((handler: (event: unknown) => void) => {
      handlers[name] = [...(handlers[name] ?? []), handler];
      return vi.fn();
    }),
  });
  return {
    getConversationOrNullMock: vi.fn(),
    cronJobManagerMock: vi.fn(),
    ensureSessionMock: vi.fn(async () => undefined),
    makeTeamEventChannel: makeChannel,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      error: vi.fn(),
      useMessage: () => [null, null],
    },
  };
});

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      get: { invoke: vi.fn() },
      renameTeam: { invoke: vi.fn() },
      addAgent: { invoke: vi.fn() },
      removeAgent: { invoke: vi.fn() },
      pauseSlotWork: { invoke: vi.fn() },
      getRunState: {
        invoke: vi.fn(async () => ({ session_generation: null, active_run: null, slot_work: [] })),
      },
      activeLease: { invoke: vi.fn(async () => ({ renewed_count: 2 })) },
      ensureSession: { invoke: (...args: unknown[]) => ensureSessionMock(...args) },
      agentStatusChanged: makeTeamEventChannel('agentStatusChanged'),
      agentSpawned: makeTeamEventChannel('agentSpawned'),
      agentRemoved: makeTeamEventChannel('agentRemoved'),
      agentRenamed: makeTeamEventChannel('agentRenamed'),
      agentRuntimeStatusChanged: makeTeamEventChannel('agentRuntimeStatusChanged'),
      sessionStatusChanged: makeTeamEventChannel('sessionStatusChanged'),
      taskChanged: makeTeamEventChannel('taskChanged'),
      sessionChanged: makeTeamEventChannel('sessionChanged'),
      runAccepted: makeTeamEventChannel('runAccepted'),
      runStarted: makeTeamEventChannel('runStarted'),
      runUpdated: makeTeamEventChannel('runUpdated'),
      runCompleted: makeTeamEventChannel('runCompleted'),
      runCancelled: makeTeamEventChannel('runCancelled'),
      runFailed: makeTeamEventChannel('runFailed'),
      childTurnStarted: makeTeamEventChannel('childTurnStarted'),
      childTurnCompleted: makeTeamEventChannel('childTurnCompleted'),
      childTurnCancelled: makeTeamEventChannel('childTurnCancelled'),
      slotWorkChanged: makeTeamEventChannel('slotWorkChanged'),
      listChanged: makeTeamEventChannel('listChanged'),
    },
    cron: {
      removeJob: { invoke: vi.fn() },
    },
    assistant: {
      list: { invoke: vi.fn(async () => []) },
    },
    conversation: {
      listChanged: makeTeamEventChannel('conversationListChanged'),
      confirmation: {
        list: { invoke: vi.fn(async () => []) },
        add: makeTeamEventChannel('confirmationAdd'),
        remove: makeTeamEventChannel('confirmationRemove'),
      },
    },
    realtime: {
      reconnected: makeTeamEventChannel('reconnected'),
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: (...args: unknown[]) => getConversationOrNullMock(...args),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  __esModule: true,
  default: ({ children, tabsSlot }: { children: React.ReactNode; tabsSlot?: React.ReactNode }) => (
    <div>
      <div data-testid='team-tabs-slot'>{tabsSlot}</div>
      <div data-testid='team-chat-layout'>{children}</div>
    </div>
  ),
}));

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-acp-model-selector' />,
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid='mock-aionrs-model-selector' />,
}));

vi.mock('@/renderer/pages/team/components/TeamChatView', () => ({
  __esModule: true,
  default: ({ conversation: chatConversation }: { conversation: TChatConversation }) => (
    <div data-testid={`team-chat-view-${chatConversation.id}`} />
  ),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobManager: (props: { conversation_id: string; cron_job_id?: string }) => {
    cronJobManagerMock(props);
    return <div data-testid={`team-cron-job-manager-${props.conversation_id}`} />;
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {}, closePreviewIfScopeChanged: () => {} }),
}));

import TeamPage from '@/renderer/pages/team/TeamPage';
import {
  getCurrentProjectIdentity,
  resetCurrentProjectIdentityForTest,
  setCurrentProjectIdentity,
} from '@/renderer/components/workspace/ProjectIdentity/currentProjectIdentityStore';

/** Records the identity in a layout effect after TeamPage's: what the first paint of each commit shows. */
const painted: Array<ProjectIdentity | null> = [];
const PaintProbe: React.FC = () => {
  useLayoutEffect(() => {
    painted.push(getCurrentProjectIdentity());
  });
  return null;
};

const view = (current: TTeam | null) => (
  <MemoryRouter>
    {current && <TeamPage key={current.id} team={current} />}
    <PaintProbe />
  </MemoryRouter>
);

describe('TeamPage project identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationOrNullMock.mockReset();
    getConversationOrNullMock.mockImplementation(() => new Promise(() => {})); // leader conversation pending
    ensureSessionMock.mockReset();
    ensureSessionMock.mockResolvedValue(undefined);
    localStorage.clear();
    painted.length = 0;
    resetCurrentProjectIdentityForTest();
    // The previous route's project.
    setCurrentProjectIdentity({ projectId: 'p-old', workspace: '/root/projects/old' });
  });

  it('publishes the team project before the first paint', () => {
    render(view(team('team-a', '/root/projects/alpha')));
    expect(painted[0]).toEqual({ projectId: null, workspace: '/root/projects/alpha' });
  });

  it('never paints the previous team project on a switch, nor while the next team loads', () => {
    const { rerender } = render(view(team('team-a', '/root/projects/alpha')));
    painted.length = 0;

    rerender(view(team('team-b', '/root/projects/beta')));
    expect(painted[0]).toEqual({ projectId: null, workspace: '/root/projects/beta' });

    // Route switched, next team still loading (TeamIndex shows a spinner): no project.
    painted.length = 0;
    rerender(view(null));
    expect(painted[0]).toBeNull();
    expect(painted.some((identity) => identity?.workspace === '/root/projects/beta')).toBe(false);
  });

  it('shows no project for a team with a temporary workspace', () => {
    render(view(team('team-t', '')));
    expect(painted[0]).toBeNull();
  });
});

function team(id = 'team-1', workspace = '/root/projects/alpha'): TTeam {
  return {
    id,
    user_id: 'user-1',
    name: `Team ${id}`,
    workspace,
    workspace_mode: 'shared',
    leader_assistant_id: 'leader-assistant',
    created_at: 1,
    updated_at: 1,
    assistants: [
      {
        slot_id: 'leader-slot',
        conversation_id: 'leader-conv',
        role: 'leader',
        assistant_backend: 'codex',
        assistant_name: 'Leader',
        status: 'idle',
        context_reset: { supported: false, availability: 'leader_not_targetable' },
      },
      {
        slot_id: 'member-slot',
        conversation_id: 'member-conv',
        role: 'teammate',
        assistant_backend: 'codex',
        assistant_name: 'Member',
        status: 'idle',
        context_reset: { supported: true, availability: 'ready' },
      },
    ],
  };
}

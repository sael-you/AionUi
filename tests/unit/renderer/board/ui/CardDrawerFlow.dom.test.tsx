/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Drawer, department flow: reviews, questions, routing, the Decision gate and the
 * owner override, Ready to deploy, Assign / Brainstorm, linked conversations with
 * Resend.
 */

import { Message, Notification } from '@arco-design/web-react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', async (importOriginal) =>
  (await import('../boardTestUtils')).mockCommonModule(await importOriginal())
);
// Each test drives the whole board page plus the drawer and its dialogs.
vi.setConfig({ testTimeout: 60000 });

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'me' } }) }));

import type {
  BoardAssignResponse,
  BoardCardSummary,
  BoardLink,
  BoardQuestion,
  BoardReview,
} from '@/common/types/board';
import { BoardPage } from '@/renderer/pages/board';

import {
  backendError,
  bridge,
  fullCard,
  makeCard,
  makeDetail,
  makeEvent,
  makeSnapshot,
  renderWithBoard,
  resetBridge,
  studioColumns,
} from '../boardTestUtils';

const review = (department: string, over: Partial<BoardReview> = {}): BoardReview => ({
  id: `r-${department}`,
  card_id: 'card-1',
  department,
  reviewer_ref: 'assistant:x@claude',
  conversation_id: null,
  verdict: 'approve',
  summary: `${department} summary`,
  findings: [],
  recommendation: '',
  assumptions: [],
  confidence: 0.8,
  tokens_used: 0,
  version: 1,
  created_at: 1,
  updated_at: 1,
  ...over,
});

const question = (id: string, over: Partial<BoardQuestion> = {}): BoardQuestion => ({
  id,
  card_id: 'card-1',
  from_department: 'technical',
  to_department: 'owner',
  text: `Question ${id}?`,
  answered_by_event: null,
  version: 1,
  created_at: 1,
  updated_at: 1,
  ...over,
});

const link = (conversationId: string, over: Partial<BoardLink> = {}): BoardLink => ({
  card_id: 'card-1',
  conversation_id: conversationId,
  role: 'review',
  department: 'technical',
  conversation_name: `TASK-1 · ${conversationId}`,
  conversation_status: 'idle',
  created_at: 1,
  ...over,
});

const assignResponse = (summary: BoardCardSummary, over: Partial<BoardAssignResponse> = {}): BoardAssignResponse => ({
  card: fullCard(summary),
  link: link('c-new'),
  conversation_id: 'c-new',
  parent_fallback: null,
  packet_sent: true,
  ...over,
});

/** The flow columns these tests touch (the full 15-column board makes every render slower). */
const DRAWER_COLUMNS = studioColumns().filter((column) =>
  [
    'triage',
    'review',
    'decision',
    'planned',
    'building',
    'local_test',
    'ready_to_deploy',
    'deployed',
    'parked',
  ].includes(column.key)
);

const withWorkspace = (path: string) =>
  bridge.projectGet.mockResolvedValue({
    project_id: 'p1',
    name: 'Alpha',
    explorer: {
      workspace_pe_id: 'pe1',
      entries: [{ pe_id: 'pe1', role: 'workspace', display_path: path, order_index: 0, runtime_status: 'available' }],
    },
  });

/** Open the Assign dialog on the Team tab. */
const openTeamAssign = async (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
  const modal = await screen.findByRole('dialog', { name: 'Assign TASK-1' });
  fireEvent.click(within(modal).getByRole('radio', { name: 'Team' }));
  return modal;
};

const renderAt = (summary: BoardCardSummary, detail = makeDetail(fullCard(summary))) => {
  bridge.get.mockResolvedValue(makeSnapshot({ columns: DRAWER_COLUMNS, cards: [summary] }));
  bridge.getCard.mockResolvedValue(detail);
  return renderWithBoard(
    <Routes>
      <Route path='/' element={<BoardPage projectId='p1' />} />
      <Route path='/conversation/:id' element={<div>conversation page</div>} />
    </Routes>
  );
};

const openDrawer = async (number: number, title: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Open TASK-${number}: ${title}` }));
  return screen.findByRole('dialog', { name: `Card TASK-${number}` });
};

let messageInfo: ReturnType<typeof vi.spyOn>;
let messageWarning: ReturnType<typeof vi.spyOn>;
let notifyError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetBridge();
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  messageInfo = vi.spyOn(Message, 'info').mockImplementation(() => undefined as never);
  messageWarning = vi.spyOn(Message, 'warning').mockImplementation(() => undefined as never);
  notifyError = vi.spyOn(Notification, 'error').mockImplementation(() => undefined as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('reviews and questions', () => {
  const summary = makeCard(1, 'review', 1024, { title: 'Dark mode' });
  const detail = () => ({
    ...makeDetail(fullCard(summary, { routing: ['technical', 'business', 'accuracy'] })),
    reviews: [
      review('technical', {
        verdict: 'change',
        findings: [{ severity: 'high', claim: 'Breaks contrast', evidence: 'axe run' }],
        assumptions: ['Users want it'],
      }),
      review('business', { verdict: 'approve', confidence: 0.65 }),
    ],
    questions: [question('q1'), question('q2', { answered_by_event: 'ev-9' })],
  });

  it('shows one row per routed department with verdict text, confidence and expandable details', async () => {
    renderAt(summary, detail());
    const dialog = await openDrawer(1, 'Dark mode');
    const reviews = within(dialog).getByRole('region', { name: 'Reviews' });

    const rows = within(reviews).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-review-department'))).toEqual([
      'technical',
      'business',
      'accuracy',
    ]);
    expect(within(rows[0]).getByText('Changes requested')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Confidence 65%')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Not reviewed yet')).toBeInTheDocument();

    const toggle = within(rows[0]).getByRole('button', { name: 'Show findings and assumptions (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(rows[0]).getByText('Breaks contrast')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Evidence: axe run')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Users want it')).toBeInTheDocument();
  });

  it('lists open questions first and answers through a comment with `answers`', async () => {
    bridge.addComment.mockResolvedValue(makeEvent(20, 'commented'));
    renderAt(summary, detail());
    const dialog = await openDrawer(1, 'Dark mode');
    const questions = within(dialog).getByRole('region', { name: 'Questions' });

    const rows = within(questions).getAllByRole('listitem');
    expect(within(rows[0]).getByText('Technical → You (owner)')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Open')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Answered')).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: 'Answer' })).not.toBeInTheDocument();

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(rows[0]).getByRole('textbox'), { target: { value: ' Yes, ship it ' } });
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Send answer' }));

    await waitFor(() =>
      expect(bridge.addComment).toHaveBeenCalledWith({
        card_id: 'card-1',
        body: 'Yes, ship it',
        answers: 'q1',
        to_department: 'technical',
      })
    );
  });

  it('edits the routing', async () => {
    bridge.updateCard.mockResolvedValue(fullCard(summary));
    renderAt(summary, detail());
    const dialog = await openDrawer(1, 'Dark mode');
    expect(within(dialog).getByRole('combobox', { name: 'Routing' })).toBeInTheDocument();
    expect(within(dialog).getByText('The departments that review this card, up to 10.')).toBeInTheDocument();
  });
});

describe('Decision gate', () => {
  const summary = makeCard(2, 'decision', 1024, { title: 'Big change', needs_decision: true });

  it('approves with the reason and an idempotency key, reusing the key on retry', async () => {
    bridge.decideGate.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    bridge.decideGate.mockResolvedValueOnce(fullCard({ ...summary, column_key: 'planned', needs_decision: false }));
    renderAt(summary);
    const dialog = await openDrawer(2, 'Big change');
    const gate = within(dialog).getByRole('region', { name: 'Needs your decision' });

    fireEvent.change(within(gate).getByRole('textbox'), { target: { value: 'Worth it' } });
    fireEvent.click(within(gate).getByRole('button', { name: 'Approve → Planned' }));
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    fireEvent.click(within(gate).getByRole('button', { name: 'Approve → Planned' }));
    await waitFor(() => expect(bridge.decideGate).toHaveBeenCalledTimes(2));

    const [first, second] = bridge.decideGate.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({ card_id: 'card-2', decision: 'approve', reason: 'Worth it' });
    expect(first.idempotency_key).toBeTruthy();
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  it('rejects towards Parked', async () => {
    bridge.decideGate.mockResolvedValue(fullCard({ ...summary, column_key: 'parked', needs_decision: false }));
    renderAt(summary);
    const dialog = await openDrawer(2, 'Big change');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject → Parked' }));
    await waitFor(() =>
      expect(bridge.decideGate).toHaveBeenCalledWith(expect.objectContaining({ decision: 'reject', card_id: 'card-2' }))
    );
  });

  it('moves out without a decision only with a reason (owner override)', async () => {
    bridge.moveCard.mockResolvedValue(fullCard({ ...summary, column_key: 'planned', needs_decision: false }));
    renderAt(summary);
    const dialog = await openDrawer(2, 'Big change');

    const toggle = within(dialog).getByRole('button', { name: 'Move out without a decision' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Move to' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Building' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move out' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a reason');
    expect(bridge.moveCard).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Urgent fix' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move out' }));
    await waitFor(() =>
      expect(bridge.moveCard).toHaveBeenCalledWith({
        card_id: 'card-2',
        to_column: 'building',
        expected_column: 'decision',
        force: true,
        reason: 'Urgent fix',
      })
    );
  });
});

describe('Ready to deploy (before the deploy automation)', () => {
  const summary = makeCard(5, 'ready_to_deploy', 1024, { title: 'Release 1.2', needs_decision: true });

  it('is read-only with the two owner overrides; each needs a reason', async () => {
    bridge.moveCard.mockResolvedValue(fullCard({ ...summary, column_key: 'deployed', needs_decision: false }));
    renderAt(summary);
    const dialog = await openDrawer(5, 'Release 1.2');

    expect(within(dialog).getByText('The Deploy button arrives with the deploy automation.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark deployed manually' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a reason');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Shipped by hand' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark deployed manually' }));
    await waitFor(() =>
      expect(bridge.moveCard).toHaveBeenCalledWith(
        expect.objectContaining({ to_column: 'deployed', force: true, reason: 'Shipped by hand' })
      )
    );
  });
});

describe('assign, brainstorm and conversations', () => {
  const summary = makeCard(1, 'triage', 1024, { title: 'Dark mode' });

  beforeEach(() => {
    bridge.assistantsList.mockResolvedValue([
      { id: 'a-tech', name: 'Architect', name_i18n: {}, enabled: true },
      { id: 'a-off', name: 'Disabled one', name_i18n: {}, enabled: false },
    ]);
  });

  it('assigns to an assistant with department, role and a key, and explains a parent fallback', async () => {
    bridge.assign.mockResolvedValue(assignResponse(summary, { parent_fallback: 'fanout', packet_sent: false }));
    renderAt(summary);
    const dialog = await openDrawer(1, 'Dark mode');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    const modal = await screen.findByRole('dialog', { name: 'Assign TASK-1' });
    fireEvent.click(within(modal).getByRole('combobox', { name: 'Assistant' }));
    expect(screen.queryByRole('option', { name: 'Disabled one' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'Architect' }));
    fireEvent.click(within(modal).getByRole('combobox', { name: 'Department' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Technical' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(bridge.assign).toHaveBeenCalled());
    expect(bridge.assign.mock.calls[0][0]).toMatchObject({
      card_id: 'card-1',
      assistant_id: 'a-tech',
      department: 'technical',
      role: 'review',
    });
    expect(bridge.assign.mock.calls[0][0].idempotency_key).toBeTruthy();
    expect(messageInfo).toHaveBeenCalledWith(
      'The lead conversation already has the most sub-conversations allowed, so a separate conversation was opened.'
    );
    expect(messageWarning).toHaveBeenCalledWith('The card packet was not delivered.');
  });

  it('starts a brainstorm', async () => {
    bridge.brainstorm.mockResolvedValue(assignResponse(summary));
    renderAt(summary);
    const dialog = await openDrawer(1, 'Dark mode');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Brainstorm' }));
    const modal = await screen.findByRole('dialog', { name: 'Brainstorm TASK-1' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Start brainstorm' }));
    await waitFor(() => expect(bridge.brainstorm).toHaveBeenCalledWith(expect.objectContaining({ card_id: 'card-1' })));
  });

  it('maps "already linked" to its message', async () => {
    bridge.assign.mockRejectedValue(backendError(409, 'board_already_linked'));
    bridge.teamList.mockResolvedValue([{ id: 't1', name: 'Council', workspace: '/x' }]);
    withWorkspace('/x');
    renderAt(summary);
    const modal = await openTeamAssign(await openDrawer(1, 'Dark mode'));
    fireEvent.click(await within(modal).findByRole('combobox', { name: 'Team' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Council' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith({
        title: "Couldn't assign the card",
        content: 'This team is already linked to the card.',
      })
    );
  });

  it('offers only the teams of the project workspace', async () => {
    bridge.teamList.mockResolvedValue([
      { id: 't1', name: 'Council', workspace: '/x/' },
      { id: 't2', name: 'Elsewhere', workspace: '/y' },
    ]);
    withWorkspace('/x');
    renderAt(summary);
    const modal = await openTeamAssign(await openDrawer(1, 'Dark mode'));
    fireEvent.click(await within(modal).findByRole('combobox', { name: 'Team' }));
    expect(await screen.findByRole('option', { name: 'Council' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Elsewhere' })).not.toBeInTheDocument();
  });

  it('offers no team while the project workspace is unknown, and none for a project without one', async () => {
    bridge.teamList.mockResolvedValue([{ id: 't1', name: 'Council', workspace: '/x' }]);
    let answer: ((value: unknown) => void) | undefined;
    bridge.projectGet.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderAt(summary);
    const modal = await openTeamAssign(await openDrawer(1, 'Dark mode'));
    expect(within(modal).queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument();
    expect(within(modal).queryByText('This project has no team yet.')).not.toBeInTheDocument();

    answer?.({ project_id: 'p1', name: 'Alpha', explorer: { workspace_pe_id: '', entries: [] } });
    expect(await within(modal).findByText('This project has no team yet.')).toBeInTheDocument();
    expect(within(modal).queryByRole('combobox', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('lists linked conversations: opens one in one click, marks removed ones, resends a failed packet', async () => {
    const request = { assistant_id: 'a-tech', department: 'technical', role: 'review' };
    const detail = {
      ...makeDetail(fullCard(summary), [
        makeEvent(3, 'packet_send_failed', { payload: { conversation_id: 'c-live', idempotency_key: 'k-1', request } }),
      ]),
      links: [link('c-live'), link('c-gone', { conversation_status: 'removed', conversation_name: null })],
    };
    bridge.assign.mockResolvedValue(assignResponse(summary));
    renderAt(summary, detail);
    const dialog = await openDrawer(1, 'Dark mode');
    const section = within(dialog).getByRole('region', { name: 'Conversations' });

    expect(within(section).getByText('Removed')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /^Open Conversation c-gone/ })).toBeDisabled();
    expect(within(section).getByText('The card packet was not delivered.')).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: 'Resend packet' }));
    await waitFor(() =>
      expect(bridge.assign).toHaveBeenCalledWith({ card_id: 'card-1', ...request, idempotency_key: 'k-1' })
    );

    fireEvent.click(within(section).getByRole('button', { name: 'Open TASK-1 · c-live' }));
    expect(await screen.findByText('conversation page')).toBeInTheDocument();
  });
});

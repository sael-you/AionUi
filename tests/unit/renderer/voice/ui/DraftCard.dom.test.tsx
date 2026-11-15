import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceDraft } from '@/renderer/voice/core/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && 'seconds' in opts ? `${key}:${opts.seconds}` : key),
  }),
}));

import DraftCard from '@/renderer/voice/ui/DraftCard';

const draft = (patch: Partial<VoiceDraft> = {}): VoiceDraft => ({
  draftId: 'd1',
  version: 1,
  state: 'drafted',
  target: { id: 'c1', name: 'Kanban build' },
  text: 'Run the tests',
  diff: [
    { op: 'equal', text: 'Run the ' },
    { op: 'delete', text: 'uh ', transform: 'filler' },
    { op: 'insert', text: 'unit tests', transform: 'reference' },
  ],
  delivery: 'steer',
  hash: 'h',
  options: [],
  spokenConfirm: true,
  ...patch,
});

const renderCard = (d: VoiceDraft, extra: Partial<React.ComponentProps<typeof DraftCard>> = {}) => {
  const onSend = vi.fn();
  const onCancel = vi.fn();
  render(
    <DraftCard
      draft={d}
      holdUntil={null}
      readbackPlaying={false}
      inCall
      onSend={onSend}
      onCancel={onCancel}
      {...extra}
    />
  );
  return { onSend, onCancel };
};

describe('DraftCard', () => {
  it('shows the target, the delivery mode and the diff transform by transform', () => {
    renderCard(draft());
    expect(screen.getByText(/Kanban build/)).toBeInTheDocument();
    expect(screen.getByText('voice.draft.delivery.steer')).toBeInTheDocument();
    expect(screen.getByText('uh').tagName).toBe('DEL');
    expect(screen.getByText('unit tests').tagName).toBe('INS');
    expect(screen.getByText('voice.draft.transform.filler')).toBeInTheDocument();
    expect(screen.getByText('voice.draft.transform.reference')).toBeInTheDocument();
  });

  it('Send and Cancel call back', () => {
    const { onSend, onCancel } = renderCard(draft());
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.send' }));
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.cancel' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Send without a version hash', () => {
    renderCard(draft({ hash: null }));
    expect(screen.getByRole('button', { name: 'voice.draft.send' })).toBeDisabled();
  });

  it('during the hold only Cancel is possible and the countdown is shown', () => {
    renderCard(draft({ state: 'committing' }), { holdUntil: 4000, now: () => 1000 });
    expect(screen.getByRole('button', { name: 'voice.draft.send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'voice.draft.cancel' })).not.toBeDisabled();
    expect(screen.getByText('voice.draft.holding:3')).toBeInTheDocument();
  });

  it('announces the hold once (polite status); the per-second countdown is not announced', () => {
    renderCard(draft({ state: 'committing' }), { holdUntil: 4000, now: () => 1000 });
    expect(screen.getByRole('status')).toHaveTextContent('voice.draft.state.committing');
    expect(screen.getByTestId('voice-hold-countdown')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
  });

  it('a frozen hold (you are speaking) shows no countdown', () => {
    renderCard(draft({ state: 'committing', holdFrozen: true }), { holdUntil: 4000, now: () => 1000 });
    expect(screen.queryByTestId('voice-hold-countdown')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('voice.draft.holdFrozen');
  });

  it('after sending, neither Send nor Cancel is possible', () => {
    renderCard(draft({ state: 'sent' }));
    expect(screen.getByRole('button', { name: 'voice.draft.send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'voice.draft.cancel' })).toBeDisabled();
    expect(screen.getByText('voice.draft.state.sent')).toBeInTheDocument();
  });

  it('Edit explains how to change the draft by voice', () => {
    renderCard(draft());
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.edit' }));
    expect(screen.getByText('voice.draft.editHint')).toBeInTheDocument();
  });

  it('Edit is a spoken change: disabled without a live call', () => {
    renderCard(draft(), { inCall: false });
    expect(screen.getByRole('button', { name: 'voice.draft.edit' })).toBeDisabled();
  });

  it('asks for a tap when spoken "send" is not accepted for this draft', () => {
    renderCard(draft({ spokenConfirm: false }));
    expect(screen.getByRole('status')).toHaveTextContent('voice.draft.state.draftedTapOnly');
  });

  it('asks for a tap when no call is live, even if spoken "send" would be accepted', () => {
    renderCard(draft(), { inCall: false });
    expect(screen.getByRole('status')).toHaveTextContent('voice.draft.state.draftedTapOnly');
  });

  it('invites a spoken "send" only with a live call and an accepted read-back', () => {
    renderCard(draft());
    expect(screen.getByRole('status')).toHaveTextContent('voice.draft.state.drafted');
    expect(screen.getByRole('status')).not.toHaveTextContent('draftedTapOnly');
  });

  it('an ambiguous draft lists the choices and cannot be sent', () => {
    renderCard(
      draft({
        state: 'ambiguous',
        target: null,
        options: [
          { id: 'c1', name: 'Kanban build', kind: 'conversation' },
          { id: 'c2', name: 'Kanban docs', kind: 'conversation' },
        ],
      })
    );
    expect(screen.getByText(/voice\.draft\.chooseTarget/)).toBeInTheDocument();
    expect(screen.getByText('Kanban build')).toBeInTheDocument();
    expect(screen.getByText('Kanban docs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voice.draft.send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'voice.draft.cancel' })).not.toBeDisabled();
  });

  it('a pending tap blocks a second Send; a pending cancel blocks a second Cancel', () => {
    renderCard(draft(), { tap: 'confirm' });
    expect(screen.getByRole('button', { name: /voice.draft.send/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /voice.draft.cancel/ })).not.toBeDisabled();
  });

  it('saved but not started offers to open the conversation', () => {
    const onOpenTarget = vi.fn();
    renderCard(draft({ state: 'saved_not_started' }), { onOpenTarget });
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.openTarget' }));
    expect(onOpenTarget).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('button', { name: 'voice.draft.send' })).toBeNull();
  });

  it('shows the last line Jarvis said about the draft', () => {
    renderCard(draft(), { hint: 'Please tap the card to confirm this one.' });
    expect(screen.getByTestId('voice-draft-hint')).toHaveTextContent('Please tap the card');
  });

  it('falls back to the plain text when there is no diff', () => {
    renderCard(draft({ diff: [], target: null }));
    expect(screen.getByText('Run the tests')).toBeInTheDocument();
    expect(screen.getByText(/voice\.draft\.noTarget/)).toBeInTheDocument();
  });
});

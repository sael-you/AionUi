/**
 * Conversation voice bar (C26): state chip, live caption (ARIA live region), Done, Stop task,
 * End voice; only for the bound conversation; keyboard reachable.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import type { FollowUpStatus } from '@/renderer/voice/core/types';
import { createFakeEffects, flush } from '../fakes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import ConversationVoiceBar from '@/renderer/voice/ui/ConversationVoiceBar';

const LocationProbe: React.FC = () => <span data-testid='location'>{useLocation().pathname}</span>;

const RouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter initialEntries={['/conversation/c1']}>
    {children}
    <LocationProbe />
  </MemoryRouter>
);

async function setup({ running = false, conversationId = 'c1' } = {}) {
  const f = createFakeEffects();
  const controller = new VoiceController(f.fx);
  const onStopTask = vi.fn();
  const view = render(
    <ConversationVoiceBar
      conversationId={conversationId}
      running={running}
      onStopTask={onStopTask}
      controller={controller}
    />,
    { wrapper: RouterWrapper }
  );
  const start = async () => {
    act(() => controller.toggle({ focusConversationId: 'c1', mode: 'conversation' }));
    await act(flush);
    act(() => f.openSocket());
    await act(flush);
    act(() => f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' }));
  };
  const followUp = (status: FollowUpStatus, clipId: string | null = null) =>
    act(() =>
      f.frame({ name: 'voice.followUp', voiceSessionId: 'vs-1', conversationId: 'c1', status, line: status, clipId })
    );
  return { f, controller, onStopTask, view, start, followUp };
}

const bar = () => screen.queryByTestId('conversation-voice-bar');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ConversationVoiceBar', () => {
  it('is hidden until conversation voice mode is on for this conversation', async () => {
    const { start } = await setup();
    expect(bar()).toBeNull();
    await start();
    expect(bar()).toBeInTheDocument();
    expect(bar()).toHaveAttribute('aria-label', 'voice.bar.label');
  });

  it('stays hidden for another conversation and for Jarvis', async () => {
    const other = await setup({ conversationId: 'c2' });
    await other.start();
    expect(bar()).toBeNull();
    other.view.unmount();
    const jarvis = await setup();
    act(() => jarvis.controller.toggle());
    await act(flush);
    expect(bar()).toBeNull();
  });

  it('listening: state chip, live caption in an aria-live region, Done commits the utterance', async () => {
    const { f, start } = await setup();
    await start();
    expect(bar()).toHaveAttribute('data-state', 'listening');
    expect(screen.getByTestId('voice-bar-talk')).toHaveTextContent('voice.bar.state.listening');
    act(() =>
      f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'also run the', final: false })
    );
    const caption = screen.getByTestId('voice-bar-caption');
    expect(caption).toHaveAttribute('role', 'status');
    expect(caption).toHaveAttribute('aria-live', 'polite');
    expect(caption).toHaveTextContent('also run the');
    fireEvent.click(screen.getByTestId('voice-bar-done'));
    expect(f.sent('voice.commit')).toHaveLength(1);
  });

  it('after the send: the transcript with its outcome ("added"), working, Stop task cancels the turn', async () => {
    const { f, start, followUp, onStopTask, view, controller } = await setup({ running: true });
    await start();
    act(() =>
      f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'also run the tests', final: true })
    );
    followUp('added');
    expect(bar()).toHaveAttribute('data-state', 'working');
    expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.bar.outcome.added');
    expect(screen.getByTestId('voice-bar-transcript')).toHaveTextContent('also run the tests');
    expect(screen.queryByTestId('voice-bar-done')).toBeNull();
    fireEvent.click(screen.getByTestId('voice-bar-stop-task'));
    expect(onStopTask).toHaveBeenCalledTimes(1);
    view.rerender(
      <ConversationVoiceBar conversationId='c1' running={false} onStopTask={onStopTask} controller={controller} />
    );
    expect(screen.queryByTestId('voice-bar-stop-task')).toBeNull();
    expect(bar()).toHaveAttribute('data-state', 'waiting');
  });

  it('speaking: a tap on the state chip stops the clip at once and listens (barge-in)', async () => {
    const { f, start, followUp } = await setup({ running: true });
    await start();
    followUp('sent');
    const playing = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
    f.clips.play.mockImplementationOnce(async () => playing.promise);
    f.clips.stop.mockImplementation(() => playing.resolve({ completed: false, tStart: 11, tEnd: 12 }));
    followUp('says', 'say1');
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(bar()).toHaveAttribute('data-state', 'speaking');
    fireEvent.click(screen.getByTestId('voice-bar-talk'));
    expect(f.clips.stop).toHaveBeenCalled();
    await act(flush);
    expect(bar()).toHaveAttribute('data-state', 'listening');
  });

  it('End voice and Escape end voice mode', async () => {
    const a = await setup();
    await a.start();
    fireEvent.click(screen.getByTestId('voice-bar-end'));
    expect(a.controller.state.mode).toBe('off');
    expect(bar()).toBeNull();
    a.view.unmount();
    const b = await setup();
    await b.start();
    fireEvent.keyDown(screen.getByTestId('voice-bar-end'), { key: 'Escape' });
    expect(b.controller.state.mode).toBe('off');
  });

  it('every control is a real, focusable button with a name', async () => {
    const { start } = await setup({ running: true });
    await start();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) expect(button.tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'voice.bar.done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice.bar.end/ })).toBeInTheDocument();
  });

  it('after a restart: still armed, says the restart interrupted the task', async () => {
    const { f, start } = await setup();
    await start();
    act(() => f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' }));
    expect(bar()).toHaveAttribute('data-state', 'armed');
    expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.notice.restartInterrupted');
  });

  it('after 3 idle minutes: still armed with the idle notice', async () => {
    const { f, start } = await setup();
    await start();
    act(() => f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' }));
    expect(bar()).toHaveAttribute('data-state', 'armed');
    expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.notice.conversationIdle');
  });

  it('"Not sent" vs "The task failed"', async () => {
    const { f, start } = await setup();
    await start();
    act(() =>
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: 'vs-1',
        conversationId: 'c1',
        status: 'failed',
        line: 'x',
        clipId: null,
      })
    );
    expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.bar.outcome.failed');
    act(() =>
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: null,
        conversationId: 'c1',
        status: 'turn_failed',
        line: 'y',
        clipId: null,
      })
    );
    expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.bar.outcome.turn_failed');
  });

  describe('"No voice provider" (TASK-90)', () => {
    it('the call is refused with 412 no_provider: notice, hint and "Set up key" → Settings → Model', async () => {
      const { f, controller } = await setup();
      f.fx.startCall.mockRejectedValueOnce(
        new BackendHttpError({
          method: 'POST',
          path: '/api/voice/sessions',
          status: 412,
          body: { success: false, code: 'no_provider', error: 'no voice provider' },
        })
      );
      act(() => controller.toggle({ focusConversationId: 'c1', mode: 'conversation' }));
      await act(flush);
      act(() => f.openSocket());
      await act(flush);
      expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.notice.noProvider');
      expect(screen.getByText('voice.providerSetup.hint')).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'voice.providerSetup.actionLabel' });
      expect(button).toHaveAccessibleDescription('voice.providerSetup.hint');
      expect(screen.getByTestId('location')).toHaveTextContent('/conversation/c1');
      fireEvent.click(button);
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/model');
    });

    it('does not appear for other notices', async () => {
      const { f, start } = await setup();
      await start();
      act(() => f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' }));
      expect(screen.getByTestId('voice-bar-caption')).toHaveTextContent('voice.notice.restartInterrupted');
      expect(screen.queryByTestId('voice-provider-setup')).toBeNull();
      expect(screen.queryByRole('button', { name: 'voice.providerSetup.actionLabel' })).toBeNull();
    });
  });
});

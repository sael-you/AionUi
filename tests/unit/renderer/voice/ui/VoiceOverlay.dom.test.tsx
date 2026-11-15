import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import { createFakeEffects, flush } from '../fakes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import VoiceOverlay from '@/renderer/voice/ui/VoiceOverlay';

async function mount(isMobile = false) {
  const f = createFakeEffects();
  const controller = new VoiceController(f.fx);
  const onOpen = vi.fn();
  render(<VoiceOverlay controller={controller} isMobile={isMobile} onOpenConversation={onOpen} />);
  act(() => controller.arm());
  await act(flush);
  act(() => f.openSocket());
  return { f, controller, onOpen };
}

describe('VoiceOverlay', () => {
  it('armed: shows the state, the wake hint, Talk and Stop', async () => {
    await mount();
    expect(screen.getByTestId('voice-orb-state')).toHaveTextContent('voice.orb.state.armed');
    expect(screen.getByText('voice.status.wakeWordLoading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice.actions.talk/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice.actions.disarm/ })).toBeInTheDocument();
  });

  it('in a call: Hang up and Mute replace Talk; captions are a live log', async () => {
    const { f, controller } = await mount();
    act(() => controller.talk());
    await act(flush);
    act(() => f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: '', model: '' }));
    act(() =>
      f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'hello there', final: true })
    );
    expect(screen.getByTestId('voice-orb-state')).toHaveTextContent('voice.orb.state.listening');
    expect(screen.queryByRole('button', { name: /voice.actions.talk/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /voice.actions.mute/ }));
    expect(screen.getByRole('button', { name: /voice.actions.unmute/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('log')).toHaveTextContent('hello there');
  });

  it('shows the draft card and sends a confirm tap from it', async () => {
    const { f } = await mount();
    act(() =>
      f.frame({
        name: 'voice.draftUpdated',
        voiceSessionId: null,
        draftId: 'd1',
        version: 1,
        state: 'drafted',
        target: { id: 'c1', name: 'Kanban build' },
        text: 'Run tests',
        diff: [],
        delivery: 'new_turn',
        hash: 'h',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.send' }));
    expect(f.sent('voice.confirmTap')).toHaveLength(1);
  });

  it('lists follow-ups and opens their conversation', async () => {
    const { f, onOpen } = await mount();
    act(() =>
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: null,
        conversationId: 'c7',
        status: 'finished',
        line: 'Build done',
        clipId: null,
      })
    );
    expect(screen.getByText('Build done')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'voice.followUps.open' }));
    expect(onOpen).toHaveBeenCalledWith('c7');
  });

  it('shows notices and lets them be dismissed', async () => {
    const { f, controller } = await mount();
    act(() => f.frame({ name: 'voice.error', voiceSessionId: null, code: 'provider', message: 'x' }));
    expect(screen.getByText('voice.notice.server')).toBeInTheDocument();
    act(() => controller.dismissNotice());
    expect(screen.queryByText('voice.notice.server')).toBeNull();
  });

  it('opens the settings panel', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
    await act(flush);
    expect(screen.getByTestId('voice-settings')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'voice.settings.enabled' })).toBeInTheDocument();
  });

  it('settings panel saves the voice switch through the API', async () => {
    const { f } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
    await act(flush);
    fireEvent.click(screen.getByRole('switch', { name: 'voice.settings.carMode' }));
    await act(flush);
    expect(f.fx.api.putSettings).toHaveBeenCalledWith({ car_mode: true });
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { VoiceSettings } from '@/renderer/voice/core/types';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import { createFakeEffects, flush } from '../fakes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import VoiceOverlay from '@/renderer/voice/ui/VoiceOverlay';

const LocationProbe: React.FC = () => <span data-testid='location'>{useLocation().pathname}</span>;

const RouterWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter initialEntries={['/conversation/c1']}>
    {children}
    <LocationProbe />
  </MemoryRouter>
);

async function mount(isMobile = false, settings?: Partial<VoiceSettings>) {
  const f = createFakeEffects(settings);
  const controller = new VoiceController(f.fx);
  const onOpen = vi.fn();
  render(<VoiceOverlay controller={controller} isMobile={isMobile} onOpenConversation={onOpen} />, {
    wrapper: RouterWrapper,
  });
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
        options: [],
        spokenConfirm: true,
      })
    );
    expect(screen.getByText('voice.status.awaitingConfirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.send' }));
    // A second tap before the backend answers is not sent again.
    fireEvent.click(screen.getByRole('button', { name: 'voice.draft.send' }));
    expect(f.sent('voice.confirmTap')).toHaveLength(1);
  });

  it('a refused spoken "send" shows Jarvis\'s line on the card, not in the follow-ups', async () => {
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
        options: [],
        spokenConfirm: true,
      })
    );
    act(() =>
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: null,
        conversationId: 'c1',
        status: 'confirm_rejected',
        line: 'Say it again, or tap the card.',
        clipId: null,
      })
    );
    expect(screen.getByTestId('voice-draft-hint')).toHaveTextContent('Say it again, or tap the card.');
    expect(screen.queryByText('voice.followUps.title')).toBeNull();
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

  describe('today in the settings panel (TASK-37 #5)', () => {
    it("shows today's calls and minutes next to the budget", async () => {
      const m = await mount();
      const now = Date.now();
      m.f.fx.api.listSessions.mockResolvedValue([
        {
          id: 's1',
          engine: 'openai-realtime',
          model: 'm',
          state: 'ended',
          created_at: now - 1000,
          ready_at: now - 1000,
          ended_at: now,
          cost_usd: 0.2,
        },
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
      await act(flush);
      expect(screen.getByText('voice.settings.today')).toBeInTheDocument();
      expect(screen.getByTestId('voice-settings-today')).toHaveTextContent('voice.settings.todayUsage');
      expect(screen.getByLabelText('voice.budget.title', { selector: 'section' })).toBeInTheDocument();
    });

    it('shows no today row when the session list cannot be read', async () => {
      const m = await mount();
      m.f.fx.api.listSessions.mockRejectedValue(new Error('offline'));
      fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
      await act(flush);
      expect(screen.getByTestId('voice-settings')).toBeInTheDocument();
      expect(screen.queryByTestId('voice-settings-today')).toBeNull();
    });
  });

  describe('MiniMax engine (TASK-91)', () => {
    it('offers minimax-cascade as a choice and saves it', async () => {
      const { f } = await mount();
      fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
      await act(flush);
      expect(screen.queryByText('voice.settings.engineHint.minimaxCascade')).toBeNull();
      fireEvent.click(screen.getByRole('combobox', { name: 'voice.settings.engine' }));
      const option = await screen.findByRole('option', { name: 'voice.settings.engineName.minimaxCascade' });
      expect(option).not.toHaveAttribute('aria-disabled', 'true');
      expect(option).not.toHaveTextContent('voice.settings.engineLater');
      fireEvent.click(option);
      await act(flush);
      expect(f.fx.api.putSettings).toHaveBeenCalledWith({ engine: 'minimax-cascade' });
    });

    it('says which two keys the MiniMax engine needs once it is chosen', async () => {
      await mount(false, { enabled: true, engine: 'minimax-cascade' });
      fireEvent.click(screen.getByRole('button', { name: 'voice.actions.settings' }));
      await act(flush);
      expect(screen.getByText('voice.settings.engineHint.minimaxCascade')).toBeInTheDocument();
    });

    it('a 412 VOICE_NO_MINIMAX_PROVIDER shows its notice with the MiniMax hint and "Set up key"', async () => {
      const m = await mount();
      m.f.fx.startCall.mockRejectedValueOnce(
        new BackendHttpError({
          method: 'POST',
          path: '/api/voice/sessions',
          status: 412,
          body: { success: false, code: 'VOICE_NO_MINIMAX_PROVIDER', error: 'no MiniMax provider' },
        })
      );
      act(() => m.controller.talk());
      await act(flush);
      expect(screen.getByText('voice.notice.noMinimaxProvider')).toBeInTheDocument();
      expect(screen.getByText('voice.providerSetup.minimaxHint')).toBeInTheDocument();
      expect(screen.queryByText('voice.providerSetup.hint')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'voice.providerSetup.actionLabel' }));
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/model');
    });
  });

  describe('"No voice provider" (TASK-90)', () => {
    /** Talk fails the way the backend refuses a call without a provider: 412 `no_provider`. */
    async function failTalkWithoutProvider(isMobile = false) {
      const m = await mount(isMobile);
      m.f.fx.startCall.mockRejectedValueOnce(
        new BackendHttpError({
          method: 'POST',
          path: '/api/voice/sessions',
          status: 412,
          body: { success: false, code: 'no_provider', error: 'no voice provider' },
        })
      );
      act(() => m.controller.talk());
      await act(flush);
      return m;
    }

    it('shows the hint and a labelled "Set up key" button under the notice', async () => {
      await failTalkWithoutProvider();
      expect(screen.getByText('voice.notice.noProvider')).toBeInTheDocument();
      expect(screen.getByText('voice.providerSetup.hint')).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'voice.providerSetup.actionLabel' });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveTextContent('voice.providerSetup.action');
      expect(button).toHaveAccessibleDescription('voice.providerSetup.hint');
    });

    it('"Set up key" opens Settings → Model; the desktop panel stays open', async () => {
      const { controller } = await failTalkWithoutProvider();
      expect(screen.getByTestId('location')).toHaveTextContent('/conversation/c1');
      fireEvent.click(screen.getByTestId('voice-provider-setup-button'));
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/model');
      expect(controller.store.getSnapshot().overlayOpen).toBe(true);
    });

    it('on a phone the bottom sheet closes so Settings is visible', async () => {
      const { controller } = await failTalkWithoutProvider(true);
      act(() => controller.setOverlayOpen(true));
      fireEvent.click(screen.getByTestId('voice-provider-setup-button'));
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/model');
      expect(controller.store.getSnapshot().overlayOpen).toBe(false);
    });

    it('does not appear for other notices, and goes away with the notice', async () => {
      const { f, controller } = await failTalkWithoutProvider();
      act(() => controller.dismissNotice());
      expect(screen.queryByTestId('voice-provider-setup')).toBeNull();
      act(() => f.frame({ name: 'voice.error', voiceSessionId: null, code: 'provider', message: 'x' }));
      expect(screen.getByText('voice.notice.server')).toBeInTheDocument();
      expect(screen.queryByTestId('voice-provider-setup')).toBeNull();
      expect(screen.queryByRole('button', { name: 'voice.providerSetup.actionLabel' })).toBeNull();
    });
  });
});

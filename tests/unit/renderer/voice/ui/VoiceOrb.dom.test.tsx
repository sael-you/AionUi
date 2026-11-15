import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import { createFakeEffects, flush } from '../fakes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.shortcut ? `${key}:${opts.shortcut}` : key),
  }),
}));

import VoiceOrb from '@/renderer/voice/VoiceOrb';
import VoiceComposerButton from '@/renderer/voice/VoiceComposerButton';
import { runVoiceSlashCommand, buildVoiceSlashCommand } from '@/renderer/voice/slashCommand';

const setup = async () => {
  const f = createFakeEffects();
  const controller = new VoiceController(f.fx);
  render(
    <MemoryRouter>
      <VoiceOrb controller={controller} />
    </MemoryRouter>
  );
  await act(flush);
  return { f, controller, orb: screen.getByTestId('voice-orb') };
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('VoiceOrb', () => {
  it('labels its state and shortcut for screen readers', async () => {
    const { orb } = await setup();
    expect(orb).toHaveAttribute('aria-label', expect.stringContaining('voice.orb.state.off'));
    expect(orb).toHaveAttribute('aria-label', expect.stringContaining('Alt+J'));
    expect(orb).toHaveAttribute('aria-pressed', 'false');
  });

  it('a tap arms inside the click (AudioContext created synchronously) and opens the overlay', async () => {
    const { f, orb } = await setup();
    fireEvent.click(orb);
    expect(f.fx.createAudioContext).toHaveBeenCalledTimes(1);
    await act(flush);
    expect(screen.getByTestId('voice-overlay')).toBeInTheDocument();
    expect(orb).toHaveAttribute('aria-pressed', 'true');
  });

  it('a tap while armed with the panel open stops voice', async () => {
    const { controller, orb } = await setup();
    fireEvent.click(orb);
    await act(flush);
    fireEvent.click(orb);
    expect(controller.state.mode).toBe('off');
  });

  it('Alt+J toggles voice mode', async () => {
    const { controller } = await setup();
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j', altKey: true });
    expect(controller.state.mode).toBe('arming');
    await act(flush);
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j', altKey: true });
    expect(controller.state.mode).toBe('off');
  });

  it('ignores other key combos', async () => {
    const { controller } = await setup();
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j', ctrlKey: true });
    expect(controller.state.mode).toBe('off');
  });

  it('is hidden while voice is off in settings (the default) and Alt+J does nothing', async () => {
    const f = createFakeEffects({ enabled: false });
    const controller = new VoiceController(f.fx);
    render(
      <MemoryRouter>
        <VoiceOrb controller={controller} />
      </MemoryRouter>
    );
    await act(flush);
    expect(screen.queryByTestId('voice-orb')).toBeNull();
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j', altKey: true });
    expect(f.fx.createAudioContext).not.toHaveBeenCalled();
  });

  it('appears once voice is turned on in settings', async () => {
    const f = createFakeEffects({ enabled: false });
    const controller = new VoiceController(f.fx);
    render(
      <MemoryRouter>
        <VoiceOrb controller={controller} />
      </MemoryRouter>
    );
    await act(flush);
    await act(async () => {
      await controller.saveSettings({ enabled: true });
    });
    expect(screen.getByTestId('voice-orb')).toBeInTheDocument();
  });

  it('fetches settings once, not on every mount', async () => {
    const f = createFakeEffects();
    const controller = new VoiceController(f.fx);
    const view = render(
      <MemoryRouter>
        <VoiceOrb controller={controller} />
      </MemoryRouter>
    );
    await act(flush);
    view.unmount();
    render(
      <MemoryRouter>
        <VoiceOrb controller={controller} />
      </MemoryRouter>
    );
    await act(flush);
    expect(f.fx.api.getSettings).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceComposerButton and /voice', () => {
  it('arms focused on the conversation', async () => {
    const f = createFakeEffects();
    const controller = new VoiceController(f.fx);
    render(<VoiceComposerButton conversationId='c42' controller={controller} />);
    await act(flush);
    fireEvent.click(screen.getByTestId('voice-composer-button'));
    expect(controller.store.getSnapshot().focusConversationId).toBe('c42');
  });

  it('the composer mic is hidden while voice is off', async () => {
    const f = createFakeEffects({ enabled: false });
    const controller = new VoiceController(f.fx);
    render(<VoiceComposerButton conversationId='c42' controller={controller} />);
    await act(flush);
    expect(screen.queryByTestId('voice-composer-button')).toBeNull();
  });

  it('/voice is a builtin that toggles voice mode for the conversation', () => {
    const f = createFakeEffects();
    const controller = new VoiceController(f.fx);
    expect(buildVoiceSlashCommand((k) => k)).toMatchObject({ name: 'voice', kind: 'builtin', source: 'builtin' });
    expect(runVoiceSlashCommand('copy', 'c1', controller)).toBe(false);
    expect(runVoiceSlashCommand('voice', 'c1', controller)).toBe(true);
    expect(f.fx.createAudioContext).toHaveBeenCalledTimes(1);
    expect(controller.store.getSnapshot().focusConversationId).toBe('c1');
  });
});

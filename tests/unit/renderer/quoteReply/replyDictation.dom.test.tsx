/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type SpeechOptions = { onLiveTranscript?: (text: string | null) => void; onTranscript: (text: string) => void };
type SpeechInstance = { options: SpeechOptions; start: Mock; stop: Mock };

const speech = vi.hoisted(() => ({ instances: [] as SpeechInstance[] }));
const settings = vi.hoisted(() => ({ current: null as Record<string, unknown> | null, set: vi.fn() }));
const voice = vi.hoisted(() => ({
  machine: { call: null as object | null, userMuted: false },
  toggleMute: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/system/useSpeechInput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useSpeechInput')>();
  const { useRef, useState } = await import('react');
  return {
    ...actual,
    useSpeechInput: (options: SpeechOptions) => {
      const [status, setStatus] = useState<'idle' | 'recording'>('idle');
      const instance = useRef<SpeechInstance | null>(null);
      if (!instance.current) {
        instance.current = {
          options,
          start: vi.fn(async () => setStatus('recording')),
          stop: vi.fn(() => setStatus('idle')),
        };
        speech.instances.push(instance.current);
      }
      instance.current.options = options;
      return {
        availability: 'record',
        clearError: vi.fn(),
        errorCode: null,
        errorMessage: null,
        recordingDurationMs: 3000,
        recordingLevels: [0.2, 0.6, 0.4],
        startRecording: instance.current.start,
        status,
        stopRecording: instance.current.stop,
        transcribeFile: vi.fn(),
      };
    },
  };
});

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn(async () => settings.current),
  setClientBusinessSetting: settings.set,
}));

vi.mock('@/renderer/voice/core/effects', () => ({
  getVoiceController: () => ({
    store: { getSnapshot: () => ({ machine: voice.machine }) },
    toggleMute: voice.toggleMute,
  }),
}));

import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';
import ReplyPopover from '@/renderer/components/chat/SendBox/ReplyPopover';

const ON = { enabled: true, provider: 'openai', openai: { api_key: 'k', model: 'whisper-1' } };
const OFF_WITH_PROVIDER = { ...ON, enabled: false };
// Deepgram needs its own key; OpenAI with an empty key counts as set up (core uses the model key).
const OFF_NO_PROVIDER = { enabled: false, provider: 'deepgram', deepgram: { api_key: '', model: 'nova-3' } };
const OFF_OPENAI_NO_KEY = { enabled: false, provider: 'openai', openai: { api_key: '', model: 'whisper-1' } };

const composerTranscript = vi.fn();
const onAdd = vi.fn();
const onClose = vi.fn();

/** The composer's dictation (real SpeechInputButton) next to an open reply popover. */
const renderScene = (autoDictate = false) =>
  render(
    <MemoryRouter initialEntries={['/conversation/c1']}>
      <Routes>
        <Route
          path='/conversation/:id'
          element={
            <>
              <div className='sendbox-panel'>
                <SpeechInputButton onTranscript={composerTranscript} />
              </div>
              <ReplyPopover
                anchor={{ top: 10, left: 200 }}
                quote='The outside reading stays at 30 days.'
                autoDictate={autoDictate}
                onAdd={onAdd}
                onClose={onClose}
              />
            </>
          }
        />
        <Route path='/settings/system' element={<div data-testid='speech-settings-page' />} />
      </Routes>
    </MemoryRouter>
  );

const composer = () => speech.instances.find((instance) => instance.options.onTranscript === composerTranscript)!;
const reply = () => speech.instances.find((instance) => instance.options.onTranscript !== composerTranscript)!;
const replyText = () => screen.getByTestId('quote-reply-text') as HTMLTextAreaElement;
const mic = async (setup: string) => {
  // The loading mic is replaced by another button once the setting is known: query again each time.
  await waitFor(() => expect(screen.getByTestId('reply-dictation-mic')).toHaveAttribute('data-setup', setup));
  return screen.getByTestId('reply-dictation-mic');
};

describe('reply dictation is bound to the reply field (TASK-126)', () => {
  beforeEach(() => {
    speech.instances.length = 0;
    settings.current = ON;
    voice.machine = { call: null, userMuted: false };
    voice.toggleMute.mockImplementation(() => {
      voice.machine = { ...voice.machine, userMuted: !voice.machine.userMuted };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records into the reply with live text and a level meter, and never touches the composer', async () => {
    renderScene();
    fireEvent.click(await mic('ready'));

    expect(reply().start).toHaveBeenCalledTimes(1);
    expect(composer().start).not.toHaveBeenCalled();
    expect(await screen.findByTestId('reply-dictation-meter')).toBeInTheDocument();

    act(() => reply().options.onLiveTranscript?.('hello wor'));
    expect(replyText()).toHaveValue('hello wor');

    act(() => reply().options.onTranscript('hello world'));
    expect(replyText()).toHaveValue('hello world');
    expect(composerTranscript).not.toHaveBeenCalled();
  });

  it('Ctrl/Cmd+M in the reply field dictates there, even after the composer mic was hovered', async () => {
    renderScene();
    await mic('ready');
    const composerControl = document.querySelector('.speech-input-control') as HTMLElement;
    fireEvent.mouseEnter(composerControl);

    replyText().focus();
    fireEvent.keyDown(replyText(), { key: 'm', code: 'KeyM', ctrlKey: true });

    expect(reply().start).toHaveBeenCalledTimes(1);
    expect(composer().start).not.toHaveBeenCalled();
  });

  it('while recording, Enter and Esc stop instead of adding or closing; a second click stops', async () => {
    renderScene();
    const button = await mic('ready');

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(replyText(), { key: 'Enter' });
    expect(reply().stop).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.keyDown(replyText(), { key: 'Escape' });
    expect(reply().stop).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(button);
    expect(reply().stop).toHaveBeenCalledTimes(3);
  });

  it('the toolbar mic starts recording in the reply field as soon as it opens', async () => {
    renderScene(true);
    await waitFor(() => expect(reply().start).toHaveBeenCalledTimes(1));
    expect(composer().start).not.toHaveBeenCalled();
  });

  it('Speech to Text off with a saved provider: one click turns it on and records here', async () => {
    settings.current = OFF_WITH_PROVIDER;
    settings.set.mockResolvedValue(undefined);
    renderScene();

    fireEvent.click(await mic('offConfigured'));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.quoteReply.dictation.turnOn' }));

    await waitFor(() =>
      expect(settings.set).toHaveBeenCalledWith(
        'tools.speechToText',
        expect.objectContaining({ enabled: true, provider: 'openai' })
      )
    );
    await waitFor(() => expect(reply().start).toHaveBeenCalledTimes(1));
    expect(composerTranscript).not.toHaveBeenCalled();
  });

  it('OpenAI with an empty key still offers the one-click turn on (core uses the model key)', async () => {
    settings.current = OFF_OPENAI_NO_KEY;
    renderScene();
    expect(await mic('offConfigured')).toBeInTheDocument();
  });

  it('Speech to Text off without a provider: the mic opens Settings', async () => {
    settings.current = OFF_NO_PROVIDER;
    renderScene();

    fireEvent.click(await mic('offUnconfigured'));

    expect(await screen.findByTestId('speech-settings-page')).toBeInTheDocument();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('mutes a live voice call while the reply records and gives the mic back after', async () => {
    voice.machine = { call: {}, userMuted: false };
    renderScene();
    const button = await mic('ready');

    fireEvent.click(button);
    expect(voice.toggleMute).toHaveBeenCalledTimes(1);
    expect(voice.machine.userMuted).toBe(true);

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(button);
    await waitFor(() => expect(voice.toggleMute).toHaveBeenCalledTimes(2));
    expect(voice.machine.userMuted).toBe(false);
  });
});

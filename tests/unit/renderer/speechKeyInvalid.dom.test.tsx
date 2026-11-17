/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { speechErrorContent } from '@/renderer/components/chat/SpeechInputButton';
import { getSpeechInputErrorMessageKey, mapSpeechInputError } from '@/renderer/hooks/system/useSpeechInput';

const t = (key: string) => key;

describe('invalid Speech-to-Text key (STT_KEY_INVALID)', () => {
  it('is recognised from the REST error and from the stream error frame', () => {
    expect(mapSpeechInputError(new Error('STT_KEY_INVALID: the Speech-to-Text API key is invalid'))).toBe(
      'key-invalid'
    );
    expect(mapSpeechInputError(new Error('STT_KEY_INVALID'))).toBe('key-invalid');
    expect(mapSpeechInputError(new Error('STT_REQUEST_FAILED:502 Bad Gateway'))).toBe('transcription-failed');
    expect(getSpeechInputErrorMessageKey('key-invalid')).toBe('conversation.chat.speech.keyInvalid');
  });

  it('shows the message with a link to the voice-input settings', () => {
    render(<>{speechErrorContent(t, 'key-invalid', '[REDACTED]')}</>);
    const box = screen.getByTestId('speech-key-invalid');
    expect(box).toHaveTextContent('conversation.chat.speech.keyInvalid');
    expect(box).not.toHaveTextContent('REDACTED');
    expect(screen.getByRole('link', { name: 'conversation.chat.speech.openSettings' })).toHaveAttribute(
      'href',
      '#/settings/system'
    );
  });

  it('keeps the text and detail for other errors', () => {
    expect(speechErrorContent(t, 'transcription-failed', ' 502 Bad Gateway ')).toBe(
      'conversation.chat.speech.transcriptionFailed: 502 Bad Gateway'
    );
    expect(speechErrorContent(t, 'network')).toBe('conversation.chat.speech.networkError');
  });
});

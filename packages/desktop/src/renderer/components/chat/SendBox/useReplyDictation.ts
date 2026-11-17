/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dictation bound to ONE reply field (TASK-126): its own speech-input session,
 * so the words land in that field and never in the composer. Also:
 * - Speech to Text off but a provider set up → one click turns it on and records;
 *   no provider → the caller sends the owner to Settings;
 * - a live voice-mode call is muted while the field records (its mic would
 *   otherwise send the same words to the chat) and unmuted afterwards.
 */

import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpeechToTextConfig } from '@/common/types/provider/speech';
import { normalizeSpeechToTextConfig } from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/speechSettingsUtils';
import {
  appendSpeechTranscript,
  getSpeechInputErrorMessageKey,
  useSpeechInput,
} from '@/renderer/hooks/system/useSpeechInput';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT } from '@/renderer/services/SpeechToTextService';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { speechErrorContent } from '@/renderer/components/chat/SpeechInputButton';
import { getVoiceController } from '@/renderer/voice/core/effects';

/** `ready` = can record; `offConfigured` = off, one click turns it on; `offUnconfigured` = needs Settings. */
export type ReplyDictationSetup = 'loading' | 'ready' | 'offConfigured' | 'offUnconfigured';

/**
 * Whether turning Speech to Text on is enough. Deepgram needs its own key; OpenAI does
 * not (an empty key makes core use the OpenAI key from Settings → Model).
 */
export const hasSpeechProvider = (config?: Partial<SpeechToTextConfig> | null): boolean => {
  if (!config) return false;
  if (config.provider !== 'deepgram') return true;
  return Boolean(config.deepgram?.api_key?.trim());
};

export const dictationSetupOf = (config?: Partial<SpeechToTextConfig> | null): ReplyDictationSetup => {
  if (config?.enabled) return 'ready';
  return hasSpeechProvider(config) ? 'offConfigured' : 'offUnconfigured';
};

/** Mute a live voice-mode call; returns the undo, or null when there was nothing to mute. */
const muteVoiceCall = (): (() => void) | null => {
  try {
    const controller = getVoiceController();
    const { machine } = controller.store.getSnapshot();
    if (!machine.call || machine.userMuted) return null;
    controller.toggleMute();
    return () => {
      const now = controller.store.getSnapshot().machine;
      if (now.call && now.userMuted) controller.toggleMute();
    };
  } catch {
    return null;
  }
};

export const useReplyDictation = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<ReplyDictationSetup>('loading');
  const [enabling, setEnabling] = useState(false);
  const [live, setLive] = useState<string | null>(null);
  const configRef = useRef<SpeechToTextConfig | null>(null);
  const valueRef = useLatestRef(value);
  const onChangeRef = useLatestRef(onChange);
  const unmuteRef = useRef<(() => void) | null>(null);

  const speech = useSpeechInput({
    onLiveTranscript: setLive,
    onTranscript: (transcript) => {
      setLive(null);
      onChangeRef.current(appendSpeechTranscript(valueRef.current, transcript));
    },
  });
  const { clearError, errorCode, errorMessage, status, startRecording, stopRecording } = speech;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const config = await getClientBusinessSetting('tools.speechToText');
        if (cancelled) return;
        configRef.current = config ? normalizeSpeechToTextConfig(config) : null;
        setSetup(dictationSetupOf(config));
      } catch {
        if (!cancelled) setSetup('offUnconfigured');
      }
    };
    void load();
    const onConfigChanged = (): void => {
      void load();
    };
    window.addEventListener(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT, onConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT, onConfigChanged);
    };
  }, []);

  useEffect(() => {
    if (!errorCode) return;
    const base = t(getSpeechInputErrorMessageKey(errorCode));
    const detail = errorMessage?.trim();
    if (errorCode === 'empty-transcript') Message.warning(base);
    else
      Message.error({
        content: speechErrorContent(t, errorCode, detail),
        duration: errorCode === 'key-invalid' ? 8000 : 3000,
      });
    clearError();
  }, [clearError, errorCode, errorMessage, t]);

  // Give the voice call its mic back once this field is done (stopped, failed or unmounted).
  useEffect(() => {
    if (status === 'idle' || status === 'error') {
      unmuteRef.current?.();
      unmuteRef.current = null;
    }
  }, [status]);
  useEffect(
    () => () => {
      unmuteRef.current?.();
    },
    []
  );

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'transcribing') return;
    unmuteRef.current ??= muteVoiceCall();
    await startRecording();
  }, [startRecording, status]);

  const stop = useCallback(() => {
    if (status === 'recording') stopRecording();
  }, [status, stopRecording]);

  /** The owner's one click: turn Speech to Text on with the provider already set up, then record. */
  const enableAndStart = useCallback(async () => {
    const current = configRef.current;
    if (!current || !hasSpeechProvider(current)) return;
    setEnabling(true);
    try {
      const next = normalizeSpeechToTextConfig({ ...current, enabled: true });
      await setClientBusinessSetting('tools.speechToText', next);
      configRef.current = next;
      window.dispatchEvent(new CustomEvent(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT));
      setSetup('ready');
      unmuteRef.current ??= muteVoiceCall();
      await startRecording();
    } catch {
      Message.error(t('conversation.quoteReply.dictation.enableFailed'));
    } finally {
      setEnabling(false);
    }
  }, [startRecording, t]);

  return {
    setup,
    enabling,
    status,
    live,
    availability: speech.availability,
    levels: speech.recordingLevels,
    durationMs: speech.recordingDurationMs,
    start,
    stop,
    toggle: status === 'recording' ? stop : start,
    enableAndStart,
  };
};

export type ReplyDictation = ReturnType<typeof useReplyDictation>;

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reply text of one quote (C32, TASK-126), typed or dictated. Used by the
 * reply popover and the edit modal. The mic belongs to THIS field (its own
 * speech session, see useReplyDictation): the words appear here live and never
 * in the composer.
 *
 * Keys: Enter or Ctrl/Cmd+Enter submits, Shift+Enter is a new line, Esc cancels,
 * Ctrl/Cmd+M starts or stops dictation. While recording, Enter and Esc only stop.
 */

import { Button, Input, Popconfirm, Tooltip } from '@arco-design/web-react';
import { Microphone, Square } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { appendSpeechTranscript } from '@/renderer/hooks/system/useSpeechInput';
import styles from './quoteReply.module.css';
import { useReplyDictation, type ReplyDictation } from './useReplyDictation';

type QuoteReplyFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Start dictation as soon as the field opens (the toolbar's mic). */
  autoDictate?: boolean;
  autoFocus?: boolean;
  /** Buttons on the right of the mic row (the popover's Cancel / Add). */
  actions?: React.ReactNode;
};

const METER_BARS = 5;
const SPEECH_SETTINGS_PATH = '/settings/system';

const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const isDictationShortcut = (event: React.KeyboardEvent) =>
  event.code === 'KeyM' && !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);

/** Live input level: a few bars scaled from the recorder's levels (transform only). */
const LevelMeter: React.FC<{ levels: number[] }> = ({ levels }) => {
  const recent = levels.slice(-METER_BARS);
  const bars = Array.from({ length: METER_BARS }, (_, index) => recent[index] ?? 0.08);
  return (
    <span className={styles.meter} aria-hidden data-testid='reply-dictation-meter'>
      {bars.map((level, index) => (
        <span
          key={index}
          className={styles.meterBar}
          style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, level * 1.6))})` }}
        />
      ))}
    </span>
  );
};

/** No speech provider yet: the mic leads to Settings → Speech to Text (only this state needs the router). */
const SetUpSpeechButton: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Tooltip content={t('conversation.quoteReply.dictation.setUp')} mini>
      <Button
        shape='circle'
        size='small'
        className={styles.mic}
        icon={<Microphone theme='outline' size='15' />}
        aria-label={t('conversation.quoteReply.dictation.setUp')}
        data-testid='reply-dictation-mic'
        data-setup='offUnconfigured'
        onClick={() => navigate(SPEECH_SETTINGS_PATH)}
      />
    </Tooltip>
  );
};

/** The field's mic: record / stop, or the one-click "turn on", or the way to Settings. */
const ReplyMic: React.FC<{ dictation: ReplyDictation; onBeforeStart: () => void }> = ({ dictation, onBeforeStart }) => {
  const { t } = useTranslation();
  const { setup, status, availability } = dictation;
  const recording = status === 'recording';
  const transcribing = status === 'transcribing';
  const shortcut = 'Control+M Meta+M';

  if (setup === 'offConfigured') {
    return (
      <Popconfirm
        title={t('conversation.quoteReply.dictation.offTitle')}
        content={t('conversation.quoteReply.dictation.offContent')}
        okText={t('conversation.quoteReply.dictation.turnOn')}
        cancelText={t('common.cancel')}
        position='tr'
        onOk={() => {
          onBeforeStart();
          return dictation.enableAndStart();
        }}
      >
        <Button
          shape='circle'
          size='small'
          className={styles.mic}
          loading={dictation.enabling}
          icon={<Microphone theme='outline' size='15' />}
          aria-label={t('conversation.quoteReply.dictation.offLabel')}
          data-testid='reply-dictation-mic'
          data-setup='offConfigured'
        />
      </Popconfirm>
    );
  }

  if (setup === 'offUnconfigured') return <SetUpSpeechButton />;

  const unsupported = setup === 'ready' && availability !== 'record';
  const label = transcribing
    ? t('conversation.chat.speech.processing')
    : recording
      ? t('conversation.quoteReply.dictation.stop')
      : unsupported
        ? t('conversation.chat.speech.unsupported')
        : t('conversation.quoteReply.dictation.start');

  return (
    <span className='inline-flex items-center gap-8px'>
      {recording ? (
        <span className='inline-flex items-center gap-6px text-12px text-t-secondary tabular-nums' role='status'>
          <LevelMeter levels={dictation.levels} />
          <span>{formatDuration(dictation.durationMs)}</span>
        </span>
      ) : null}
      <Tooltip content={label} mini>
        <Button
          shape='circle'
          size='small'
          status={recording ? 'danger' : undefined}
          type={recording ? 'primary' : 'secondary'}
          className={classNames(styles.mic, recording && styles.micRecording)}
          loading={transcribing || setup === 'loading'}
          disabled={unsupported}
          icon={recording ? <Square theme='filled' size='12' /> : <Microphone theme='outline' size='15' />}
          aria-label={label}
          aria-pressed={recording}
          aria-keyshortcuts={shortcut}
          data-testid='reply-dictation-mic'
          data-setup={setup}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!recording) onBeforeStart();
            void dictation.toggle();
          }}
        />
      </Tooltip>
    </span>
  );
};

const QuoteReplyField: React.FC<QuoteReplyFieldProps> = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  autoDictate = false,
  autoFocus = true,
  actions,
}) => {
  const { t } = useTranslation();
  const dictation = useReplyDictation({ value, onChange });
  const textAreaRef = useRef<{ dom?: HTMLTextAreaElement } | null>(null);
  const autoStarted = useRef(false);
  const busy = dictation.status === 'recording' || dictation.status === 'transcribing';
  const shown = dictation.live ? appendSpeechTranscript(value, dictation.live) : value;

  // The toolbar's mic: record as soon as the field can (never turns a setting on by itself).
  useEffect(() => {
    if (!autoDictate || autoStarted.current || dictation.setup !== 'ready' || dictation.availability !== 'record')
      return;
    autoStarted.current = true;
    void dictation.start();
  }, [autoDictate, dictation]);

  const focusField = () => textAreaRef.current?.dom?.focus();

  return (
    <div className='flex flex-col gap-6px'>
      <Input.TextArea
        ref={textAreaRef as never}
        className='!rd-8px'
        value={shown}
        readOnly={busy}
        autoFocus={autoFocus}
        autoSize={{ minRows: 2, maxRows: 8 }}
        placeholder={
          dictation.status === 'recording'
            ? t('conversation.quoteReply.dictation.listening')
            : t('conversation.quoteReply.replyPlaceholder')
        }
        aria-label={t('conversation.quoteReply.replyLabel')}
        aria-busy={busy}
        data-testid='quote-reply-text'
        onChange={onChange}
        onKeyDown={(event) => {
          if (isDictationShortcut(event)) {
            // Handled here, so the composer's own Ctrl/Cmd+M never takes it.
            event.preventDefault();
            event.stopPropagation();
            if (dictation.setup === 'ready') void dictation.toggle();
            return;
          }
          if (dictation.status === 'recording' && (event.key === 'Enter' || event.key === 'Escape')) {
            event.preventDefault();
            event.stopPropagation();
            dictation.stop();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy) onSubmit();
          }
        }}
      />
      <div className='flex items-center gap-8px min-h-28px'>
        <ReplyMic dictation={dictation} onBeforeStart={focusField} />
        <span className={classNames('flex-1 min-w-0 text-11px truncate', styles.live)} aria-live='polite'>
          {dictation.status === 'recording'
            ? t('conversation.quoteReply.dictation.stopHint')
            : dictation.status === 'transcribing'
              ? t('conversation.chat.speech.processing')
              : ''}
        </span>
        {actions ? <span className='flex flex-shrink-0 items-center gap-6px'>{actions}</span> : null}
      </div>
    </div>
  );
};

export default QuoteReplyField;

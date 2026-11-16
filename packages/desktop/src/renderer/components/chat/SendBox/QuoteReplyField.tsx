/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reply text of one quote (C32), typed or dictated with the existing speech
 * input. Used by the reply popover and the edit modal. Enter submits, Shift+Enter
 * is a new line, Esc cancels.
 */

import { Input } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';
import { appendSpeechTranscript } from '@/renderer/hooks/system/useSpeechInput';

type QuoteReplyFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Start dictation as soon as the field opens (the toolbar's mic). */
  autoDictate?: boolean;
  autoFocus?: boolean;
};

const QuoteReplyField: React.FC<QuoteReplyFieldProps> = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  autoDictate = false,
  autoFocus = true,
}) => {
  const { t } = useTranslation();
  const micRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [live, setLive] = useState<string | null>(null);

  // The speech button owns its session; starting it is the same click the user would make.
  useEffect(() => {
    if (!autoDictate) return;
    micRef.current?.querySelector<HTMLElement>('button')?.click();
  }, [autoDictate]);

  return (
    <div className='flex flex-col gap-4px'>
      <div className='flex items-end gap-6px'>
        <Input.TextArea
          className='flex-1 min-w-0'
          value={value}
          autoFocus={autoFocus}
          autoSize={{ minRows: 1, maxRows: 6 }}
          placeholder={t('conversation.quoteReply.replyPlaceholder')}
          aria-label={t('conversation.quoteReply.replyLabel')}
          onChange={onChange}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <div ref={micRef} className='flex-shrink-0'>
          <SpeechInputButton
            onLiveTranscript={setLive}
            onTranscript={(transcript) => {
              setLive(null);
              onChange(appendSpeechTranscript(valueRef.current, transcript));
            }}
          />
        </div>
      </div>
      {live ? (
        <span className='text-12px text-t-secondary italic' aria-live='polite'>
          {live}
        </span>
      ) : null}
    </div>
  );
};

export default QuoteReplyField;

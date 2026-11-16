/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation voice bar (C26): a slim strip above the composer while voice mode is on for THIS
 * conversation. State (listening · working · speaking), the live caption or the last outcome, and
 * Done · Stop task · End voice. Tapping the state talks / barges in (the agent's speech stops and
 * the mic opens; your words are added to the running turn).
 */

import { Button, Tag } from '@arco-design/web-react';
import { CloseSmall, PauseOne } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getVoiceController } from '../core/effects';
import type { VoiceController } from '../core/VoiceController';
import { useVoiceView, type VoiceView } from '../core/voiceStore';
import VoiceOrbGlyph from './VoiceOrbGlyph';
import { NO_PROVIDER_NOTICE, VoiceProviderSetup } from './VoiceOverlay';
import styles from './voice.module.css';
import { formatQuoteItems, useQuoteStack } from '@/renderer/components/chat/SendBox/quoteStack';

export type ConversationVoiceBarProps = {
  conversationId: string;
  /** The conversation's turn is running (SendBox `loading`). */
  running: boolean;
  /** The composer's Stop (cancels the running turn). */
  onStopTask?: () => void;
  controller?: VoiceController;
};

export type VoiceBarState = 'connecting' | 'armed' | 'listening' | 'working' | 'speaking' | 'waiting' | 'offline';

/** What the bar shows, from the controller view and the conversation's running state. */
export function voiceBarState(view: VoiceView, running: boolean): VoiceBarState {
  const { machine } = view;
  if (machine.mode === 'arming') return 'connecting';
  if (view.orb === 'offline') return 'offline';
  if (view.agentSpeaking) return 'speaking';
  if (!machine.call) return 'armed';
  if (machine.call.phase !== 'ready') return 'connecting';
  if (!machine.held) return 'listening';
  return running ? 'working' : 'waiting';
}

const ORB_OF: Record<VoiceBarState, React.ComponentProps<typeof VoiceOrbGlyph>['state']> = {
  connecting: 'connecting',
  armed: 'armed',
  listening: 'listening',
  working: 'thinking',
  speaking: 'speaking',
  waiting: 'armed',
  offline: 'offline',
};

/**
 * C32: the conversation's stacked quotes ride with the next spoken message. While a
 * conversation-mode call of this conversation is ready and its backend advertised
 * `attachQuotes`, the whole stack is sent on every change (`""` once it empties); the
 * stack clears only when the backend confirms the quotes were posted.
 */
const useVoiceQuotes = (
  controller: VoiceController,
  view: VoiceView,
  conversationId: string,
  active: boolean
): { count: number; attached: boolean; tooLarge: boolean } => {
  const stack = useQuoteStack(conversationId);
  const text = formatQuoteItems(stack.items);
  const live = active && view.quotesSupported && view.machine.call?.phase === 'ready';
  const sentRef = useRef(false);
  const [accepted, setAccepted] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    if (!live) {
      setAccepted(false);
      return;
    }
    if (text) {
      setTooLarge(false);
      setAccepted(controller.attachQuotes(text));
      sentRef.current = true;
    } else if (sentRef.current) {
      controller.attachQuotes('');
      sentRef.current = false;
      setAccepted(false);
    }
  }, [live, text, controller]);

  const ack = view.quotesAck;
  const { clear } = stack;
  useEffect(() => {
    if (!ack || !active) return;
    if (ack.consumed && ack.reason === 'posted') {
      sentRef.current = false;
      clear();
    } else if (ack.reason === 'too_large') {
      setTooLarge(true);
      setAccepted(false);
    } else if (ack.reason !== 'cleared') {
      setAccepted(false);
    }
  }, [ack, active, clear]);

  return { count: stack.items.length, attached: live && accepted && !tooLarge, tooLarge };
};

const ConversationVoiceBar: React.FC<ConversationVoiceBarProps> = ({
  conversationId,
  running,
  onStopTask,
  controller: injected,
}) => {
  const { t } = useTranslation();
  const controller = injected ?? getVoiceController();
  const view = useVoiceView(controller.store);
  const active =
    view.machine.mode !== 'off' && view.voiceMode === 'conversation' && view.focusConversationId === conversationId;
  const quotes = useVoiceQuotes(controller, view, conversationId, active);
  if (!active) return null;

  const state = voiceBarState(view, running);
  const lastCaption = view.captions.findLast((c) => c.role === 'user') ?? null;
  // Your words as they are heard; after the send, what happened to them ("Added to the running task").
  const outcome =
    view.lastOutcome && !(state === 'listening' && lastCaption && !lastCaption.final)
      ? t(`voice.bar.outcome.${view.lastOutcome.status}`, { defaultValue: view.lastOutcome.line })
      : null;
  const notice = view.notice ? t(`voice.notice.${view.notice.code}`, { message: view.notice.message ?? '' }) : null;
  const needsProvider = view.notice?.code === NO_PROVIDER_NOTICE;
  const stateLabel = t(`voice.bar.state.${state}`);
  const canTalk = state !== 'connecting' && state !== 'offline' && state !== 'listening';

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Escape inside the bar ends voice mode (the buttons cover Tab / Enter / Space).
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    controller.disarm('tap');
  };

  return (
    <section
      className={needsProvider ? `${styles.voiceBar} ${styles.voiceBarWithHelp}` : styles.voiceBar}
      aria-label={t('voice.bar.label')}
      data-testid='conversation-voice-bar'
      data-state={state}
      onKeyDown={onKeyDown}
    >
      <Button
        type='text'
        size='small'
        className={styles.voiceBarState}
        data-state={state}
        aria-label={canTalk ? `${stateLabel} · ${t('voice.bar.talk')}` : stateLabel}
        onClick={() => controller.talk()}
        data-testid='voice-bar-talk'
      >
        <VoiceOrbGlyph state={ORB_OF[state]} size={16} />
        <span className={styles.voiceBarStateText}>{stateLabel}</span>
      </Button>
      <div className={styles.voiceBarCaption} role='status' aria-live='polite' data-testid='voice-bar-caption'>
        {notice ? (
          <span className={styles.voiceBarNotice}>{notice}</span>
        ) : (
          <>
            {quotes.count > 0 && (
              <Tag
                size='small'
                color={quotes.attached ? 'arcoblue' : 'orange'}
                data-testid='voice-bar-quotes'
                title={quotes.attached ? undefined : t('voice.bar.quotesWaitingHint')}
              >
                {quotes.tooLarge
                  ? t('voice.bar.quotesTooLarge', { count: quotes.count })
                  : quotes.attached
                    ? t('voice.bar.quotesAttached', { count: quotes.count })
                    : t('voice.bar.quotesWaiting', { count: quotes.count })}
              </Tag>
            )}
            {outcome && <span className={styles.voiceBarOutcome}>{outcome}</span>}
            {lastCaption && <span data-testid='voice-bar-transcript'>{lastCaption.text}</span>}
          </>
        )}
      </div>
      <div className={styles.voiceBarActions}>
        {state === 'listening' && (
          <Button size='mini' type='primary' onClick={() => controller.commitUtterance()} data-testid='voice-bar-done'>
            {t('voice.bar.done')}
          </Button>
        )}
        {running && onStopTask && (
          <Button
            size='mini'
            status='warning'
            icon={<PauseOne theme='outline' size='12' />}
            onClick={onStopTask}
            data-testid='voice-bar-stop-task'
          >
            {t('voice.bar.stopTask')}
          </Button>
        )}
        <Button
          size='mini'
          icon={<CloseSmall theme='outline' size='12' />}
          onClick={() => controller.disarm('tap')}
          aria-keyshortcuts='Escape'
          data-testid='voice-bar-end'
        >
          {t('voice.bar.end')}
        </Button>
      </div>
      {needsProvider && (
        <div className={styles.voiceBarHelp}>
          <VoiceProviderSetup />
        </div>
      )}
    </section>
  );
};

export default ConversationVoiceBar;

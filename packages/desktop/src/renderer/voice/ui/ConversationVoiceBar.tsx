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

import { Button } from '@arco-design/web-react';
import { CloseSmall, PauseOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getVoiceController } from '../core/effects';
import type { VoiceController } from '../core/VoiceController';
import { useVoiceView, type VoiceView } from '../core/voiceStore';
import VoiceOrbGlyph from './VoiceOrbGlyph';
import styles from './voice.module.css';

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
  if (!active) return null;

  const state = voiceBarState(view, running);
  const lastCaption = view.captions.findLast((c) => c.role === 'user') ?? null;
  // Your words as they are heard; after the send, what happened to them ("Added to the running task").
  const outcome =
    view.lastOutcome && !(state === 'listening' && lastCaption && !lastCaption.final)
      ? t(`voice.bar.outcome.${view.lastOutcome.turnFailed ? 'turnFailed' : view.lastOutcome.status}`, {
          defaultValue: view.lastOutcome.line,
        })
      : null;
  const notice = view.notice ? t(`voice.notice.${view.notice.code}`, { message: view.notice.message ?? '' }) : null;
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
      className={styles.voiceBar}
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
    </section>
  );
};

export default ConversationVoiceBar;

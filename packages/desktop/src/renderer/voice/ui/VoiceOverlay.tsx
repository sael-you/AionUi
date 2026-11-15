/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Voice overlay (plan §3.8 "Web Voice mode"): mobile-first bottom sheet on
 * phones, a non-modal side panel on desktop. Orb state, live captions, the
 * draft card, recent follow-ups, budget, and the settings panel.
 */

import { Alert, Button, Drawer, Typography } from '@arco-design/web-react';
import { Close, Left, Microphone, VoiceOff, PhoneOff, Power, SettingTwo } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceController } from '../core/VoiceController';
import { useVoiceView, type VoiceView } from '../core/voiceStore';
import BudgetMeter from './BudgetMeter';
import CaptionList from './CaptionList';
import DraftCard from './DraftCard';
import FollowUpList from './FollowUpList';
import VoiceOrbGlyph from './VoiceOrbGlyph';
import VoiceSettingsPanel from './VoiceSettingsPanel';
import styles from './voice.module.css';

/** Notices that report a normal event rather than a problem. */
const INFO_NOTICES: ReadonlySet<string> = new Set(['busy', 'networkLost', 'callIdle', 'callHardCap']);

export type VoiceOverlayProps = {
  controller: VoiceController;
  isMobile: boolean;
  onOpenConversation: (conversationId: string) => void;
};

/** Second line under the orb state: what Jarvis waits for right now. */
function statusLine(view: VoiceView, t: (key: string) => string): string | null {
  if (view.orb === 'frozen') return t('voice.orb.state.frozen');
  if (view.systemPaused) return t('voice.status.systemPaused');
  if (view.machine.call && view.machine.userMuted) return t('voice.status.muted');
  if (view.readbackPlaying) return t('voice.status.readback');
  const draftState = view.draft?.state;
  if (draftState === 'drafted' || draftState === 'pending_transcript') return t('voice.status.awaitingConfirm');
  if (draftState === 'ambiguous') return t('voice.status.awaitingChoice');
  if (draftState === 'committing') return t('voice.status.holding');
  if (view.asking) return t('voice.status.asking');
  if (view.orb !== 'armed') return null;
  switch (view.wakeWord) {
    case 'loading':
      return t('voice.status.wakeWordLoading');
    case 'ready':
      return t('voice.status.wakeWordReady');
    case 'unavailable':
      return t('voice.status.wakeWordUnavailable');
    default:
      return t('voice.status.wakeWordOff');
  }
}

const VoiceOverlay: React.FC<VoiceOverlayProps> = ({ controller, isMobile, onOpenConversation }) => {
  const { t } = useTranslation();
  const view = useVoiceView(controller.store);
  const armed = view.machine.mode !== 'off';
  const inCall = Boolean(view.machine.call);
  const status = statusLine(view, t);

  const header = (
    <div className='flex items-center gap-8px min-w-0 w-full'>
      {view.settingsOpen && (
        <Button
          size='small'
          type='text'
          aria-label={t('voice.actions.back')}
          icon={<Left theme='outline' size={16} fill='currentColor' className='rtl-mirror' />}
          onClick={() => controller.setSettingsOpen(false)}
        />
      )}
      <span className='truncate flex-1'>
        {view.settingsOpen ? t('voice.settings.title') : t('voice.overlay.title')}
      </span>
      <Button
        size='small'
        type='text'
        aria-label={t('voice.overlay.close')}
        title={t('voice.overlay.close')}
        icon={<Close theme='outline' size={16} fill='currentColor' />}
        onClick={() => controller.setOverlayOpen(false)}
      />
    </div>
  );

  return (
    <Drawer
      visible={view.overlayOpen}
      placement={isMobile ? 'bottom' : 'right'}
      width={isMobile ? undefined : 400}
      height={isMobile ? 'auto' : undefined}
      mask={isMobile}
      maskClosable
      escToExit
      focusLock={isMobile}
      footer={null}
      title={header}
      onCancel={() => controller.setOverlayOpen(false)}
      unmountOnExit={false}
      bodyStyle={isMobile ? { maxHeight: '80vh', overflowY: 'auto' } : undefined}
      className={styles.drawer}
      wrapClassName={isMobile ? undefined : styles.desktopWrap}
      closable={false}
      headerStyle={{ paddingInline: 12 }}
    >
      {view.settingsOpen ? (
        <VoiceSettingsPanel controller={controller} />
      ) : (
        <div className={styles.panel} data-testid='voice-overlay'>
          <div className={styles.stateRow}>
            <VoiceOrbGlyph state={view.orb} />
            <div className='flex flex-col min-w-0'>
              <Typography.Text bold role='status' aria-live='polite' data-testid='voice-orb-state'>
                {t(`voice.orb.state.${view.orb}`)}
              </Typography.Text>
              {status && (
                <Typography.Text type='secondary' className='text-12px'>
                  {status}
                </Typography.Text>
              )}
              {armed && view.screenMaySleep && (
                <Typography.Text type='warning' className='text-12px'>
                  {t('voice.status.screenMaySleep')}
                </Typography.Text>
              )}
            </div>
          </div>

          {view.notice && (
            <Alert
              type={INFO_NOTICES.has(view.notice.code) ? 'info' : 'warning'}
              closable
              onClose={() => controller.dismissNotice()}
              content={t(`voice.notice.${view.notice.code}`, { message: view.notice.message ?? '' })}
            />
          )}

          <div className={styles.controls}>
            {!armed && (
              <Button type='primary' icon={<Power theme='outline' size={16} />} onClick={() => controller.arm()}>
                {t('voice.actions.arm')}
              </Button>
            )}
            {armed && !inCall && (
              <Button
                type='primary'
                icon={<Microphone theme='outline' size={16} />}
                disabled={view.machine.mode !== 'armed'}
                onClick={() => controller.talk()}
              >
                {t('voice.actions.talk')}
              </Button>
            )}
            {inCall && (
              <>
                <Button
                  status='danger'
                  icon={<PhoneOff theme='outline' size={16} />}
                  onClick={() => controller.hangUp()}
                >
                  {t('voice.actions.hangUp')}
                </Button>
                <Button
                  aria-pressed={view.machine.userMuted}
                  icon={
                    view.machine.userMuted ? (
                      <VoiceOff theme='outline' size={16} />
                    ) : (
                      <Microphone theme='outline' size={16} />
                    )
                  }
                  onClick={() => controller.toggleMute()}
                >
                  {view.machine.userMuted ? t('voice.actions.unmute') : t('voice.actions.mute')}
                </Button>
              </>
            )}
            {armed && (
              <Button icon={<Power theme='outline' size={16} />} onClick={() => controller.disarm('tap')}>
                {t('voice.actions.disarm')}
              </Button>
            )}
            <Button
              type='text'
              aria-label={t('voice.actions.settings')}
              title={t('voice.actions.settings')}
              data-testid='voice-settings-button'
              icon={<SettingTwo theme='outline' size={16} />}
              onClick={() => controller.setSettingsOpen(true)}
            />
          </div>

          {view.draft && (
            <DraftCard
              draft={view.draft}
              holdUntil={view.holdUntil}
              readbackPlaying={view.readbackPlaying}
              inCall={view.machine.call?.phase === 'ready'}
              tap={view.draftTap}
              hint={view.draftHint}
              onSend={() => controller.confirmDraft()}
              onCancel={() => controller.cancelDraft()}
              onOpenTarget={onOpenConversation}
            />
          )}

          <CaptionList captions={view.captions} />
          <FollowUpList followUps={view.followUps} onOpen={onOpenConversation} />
          {view.budget && <BudgetMeter budget={view.budget} />}
        </div>
      )}
    </Drawer>
  );
};

export default VoiceOverlay;

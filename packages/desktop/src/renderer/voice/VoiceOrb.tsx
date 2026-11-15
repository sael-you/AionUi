/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Title-bar orb: arms voice mode from any page (plan §1 "Arm, global"), shows
 * the live state, owns the arm shortcut (default Alt+J) and mounts the voice
 * overlay. Self-contained: the title bar only renders `<VoiceOrb />`.
 *
 * Hidden while voice is off in settings (the default) and nothing is armed;
 * `/settings/voice` is the way to turn it on.
 *
 * Tap semantics: off → arm; armed with the panel hidden → show the panel;
 * armed with the panel open → stop ("tap again", plan §1). The shortcut always
 * toggles arm/stop.
 */

import { Button, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isShortcutBlockedByTarget } from '@/renderer/utils/ui/keyboardShortcuts';
import { getVoiceController } from './core/effects';
import { loadVoiceShortcut, matchesShortcut, VOICE_SHORTCUT_CHANGED_EVENT } from './core/shortcut';
import type { VoiceController } from './core/VoiceController';
import { useVoiceView } from './core/voiceStore';
import VoiceOrbGlyph from './ui/VoiceOrbGlyph';
import VoiceOverlay from './ui/VoiceOverlay';
import { useVoiceAvailable } from './ui/useVoiceAvailable';

export type VoiceOrbProps = {
  isMobile?: boolean;
  className?: string;
  /** Injected in tests; the app uses the page-wide controller. */
  controller?: VoiceController;
};

/** Conversation id of the current route (HashRouter `/conversation/:id`). */
function currentConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location.hash.match(/^#\/conversation\/([^/?#]+)/)?.[1] ?? null;
}

const VoiceOrb: React.FC<VoiceOrbProps> = ({ isMobile = false, className, controller: injected }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const controller = injected ?? getVoiceController();
  const view = useVoiceView(controller.store);
  const [shortcut, setShortcut] = useState(loadVoiceShortcut);

  const available = useVoiceAvailable(controller);

  useEffect(() => {
    const onChanged = () => setShortcut(loadVoiceShortcut());
    window.addEventListener(VOICE_SHORTCUT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(VOICE_SHORTCUT_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!available || event.defaultPrevented || event.isComposing || event.repeat) return;
      if (!matchesShortcut(event, shortcut) || isShortcutBlockedByTarget(event, 'embedded-editor')) return;
      event.preventDefault();
      // Runs inside the keydown gesture, so the AudioContext may start.
      controller.toggle({ focusConversationId: currentConversationId() });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [available, controller, shortcut]);

  const onClick = useCallback(() => {
    const mode = controller.state.mode;
    if (mode === 'off') controller.arm({ focusConversationId: currentConversationId() });
    else if (!controller.store.getSnapshot().overlayOpen) controller.setOverlayOpen(true);
    else controller.disarm('tap');
  }, [controller]);

  const openConversation = useCallback(
    (conversationId: string) => {
      void navigate(`/conversation/${encodeURIComponent(conversationId)}`);
      if (isMobile) controller.setOverlayOpen(false);
    },
    [controller, isMobile, navigate]
  );

  const label = `${t(`voice.orb.state.${view.orb}`)} — ${t('voice.orb.tooltip', { shortcut })}`;

  return (
    <>
      {available && (
        <Tooltip content={label} position='bottom' mini>
          <Button
            type='text'
            size={isMobile ? 'default' : 'small'}
            className={classNames('app-titlebar__button', isMobile && 'app-titlebar__button--mobile', className)}
            aria-label={label}
            aria-pressed={view.machine.mode !== 'off'}
            aria-keyshortcuts={shortcut}
            data-testid='voice-orb'
            data-voice-state={view.orb}
            icon={<VoiceOrbGlyph state={view.orb} size={18} />}
            onClick={onClick}
          />
        </Tooltip>
      )}
      <VoiceOverlay controller={controller} isMobile={isMobile} onOpenConversation={openConversation} />
    </>
  );
};

export default VoiceOrb;

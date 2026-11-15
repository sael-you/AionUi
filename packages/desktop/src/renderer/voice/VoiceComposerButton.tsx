/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Composer mic for voice mode (plan §1 "Arm, in a conversation"): arms voice
 * focused on this conversation, or stops it. Distinct from the dictation
 * button (SpeechInputButton), which only transcribes into the text box.
 */

import { Button, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getVoiceController } from './core/effects';
import type { VoiceController } from './core/VoiceController';
import { useVoiceView } from './core/voiceStore';
import VoiceOrbGlyph from './ui/VoiceOrbGlyph';
import { useVoiceAvailable } from './ui/useVoiceAvailable';

export type VoiceComposerButtonProps = {
  conversationId: string;
  disabled?: boolean;
  controller?: VoiceController;
};

const VoiceComposerButton: React.FC<VoiceComposerButtonProps> = ({
  conversationId,
  disabled,
  controller: injected,
}) => {
  const { t } = useTranslation();
  const controller = injected ?? getVoiceController();
  const view = useVoiceView(controller.store);
  const available = useVoiceAvailable(controller);
  const label = t('voice.composer.tooltip');
  const pressed =
    view.machine.mode !== 'off' && view.voiceMode === 'conversation' && view.focusConversationId === conversationId;
  if (!available) return null;
  return (
    // While voice mode is on, the bar above the composer explains itself: no tooltip over its buttons.
    <Tooltip content={label} mini disabled={pressed}>
      <Button
        type='text'
        shape='circle'
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        data-testid='voice-composer-button'
        icon={<VoiceOrbGlyph state={view.orb} size={16} />}
        onClick={() => controller.toggle({ focusConversationId: conversationId, mode: 'conversation' })}
      />
    </Tooltip>
  );
};

export default VoiceComposerButton;

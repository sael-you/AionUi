/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Voice mode ("Jarvis", card C9) — public entry points for the integration patch. */

export { default as VoiceOrb } from './VoiceOrb';
export type { VoiceOrbProps } from './VoiceOrb';
export { default as VoiceComposerButton } from './VoiceComposerButton';
export { default as ConversationVoiceBar } from './ui/ConversationVoiceBar';
export { buildVoiceSlashCommand, runVoiceSlashCommand, VOICE_SLASH_COMMAND } from './slashCommand';
export { getVoiceController } from './core/effects';
export { useVoiceAvailable } from './ui/useVoiceAvailable';
export type { VoiceController } from './core/VoiceController';

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/voice` SendBox built-in (plan §1 "Arm, in a conversation"; §3.8 "opened
 * in the same gesture"). SendBox pushes `buildVoiceSlashCommand(t)` into its
 * built-ins and calls `runVoiceSlashCommand(conversationId)` from
 * `onExecuteBuiltin` — that callback runs inside the Enter/click handler, so
 * the AudioContext is created within the user gesture. SendBox registers the
 * command only while `useVoiceAvailable()` is true (voice is off by default).
 */

import type { SlashCommandItem } from '@/common/chat/slash/types';
import { getVoiceController } from './core/effects';
import type { VoiceController } from './core/VoiceController';

export const VOICE_SLASH_COMMAND = 'voice';

export function buildVoiceSlashCommand(t: (key: string) => string): SlashCommandItem {
  return {
    name: VOICE_SLASH_COMMAND,
    description: t('voice.slash.description'),
    kind: 'builtin',
    source: 'builtin',
    selectionBehavior: 'execute',
  };
}

/** Toggle conversation voice mode (C26) for the conversation. Returns true when handled. */
export function runVoiceSlashCommand(
  name: string,
  conversationId: string | null | undefined,
  controller: VoiceController = getVoiceController()
): boolean {
  if (name !== VOICE_SLASH_COMMAND) return false;
  controller.toggle({ focusConversationId: conversationId ?? null, mode: conversationId ? 'conversation' : 'jarvis' });
  return true;
}

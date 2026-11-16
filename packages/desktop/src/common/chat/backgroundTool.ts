/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

/**
 * "Continue in background" on a running tool call (TASK-8). AionCore advertises
 * it only for claude (`supported_commands.background_tool`: the CLI's
 * `background_tasks` control request); the conversation detail does not carry
 * the command set, so the UI uses the same backend rule as the side question
 * (`sideQuestion.ts`) and core refuses every other backend.
 */
export function isBackgroundToolSupported(target: { type?: TChatConversation['type']; backend?: string }): boolean {
  return target.type === 'acp' && target.backend === 'claude';
}

/** Refusals that hold for the whole session: the button hides everywhere. */
const SESSION_WIDE_REFUSALS: ReadonlySet<string> = new Set(['TOOL_BACKGROUND_DISABLED', 'TOOL_BACKGROUND_UNSUPPORTED']);
const CALL_REFUSALS: ReadonlySet<string> = new Set(['TOOL_BACKGROUND_NOT_RUNNING', 'TOOL_BACKGROUND_FAILED']);

/**
 * Whether the stream has refused backgrounding `callId` (its own refusal) or
 * every call (disabled / unsupported in this session). The refusal tips stay
 * in the conversation, so this also holds after a reload.
 */
export function backgroundRefused(messages: readonly TMessage[], callId: string): boolean {
  return messages.some((message) => {
    if (message.type !== 'tips') return false;
    const code = message.content.code;
    if (!code) return false;
    if (SESSION_WIDE_REFUSALS.has(code)) return true;
    return CALL_REFUSALS.has(code) && message.content.params?.call_id === callId;
  });
}

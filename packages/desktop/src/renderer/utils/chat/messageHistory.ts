import type { TMessage } from '@/common/chat/chatLib';
import { AIONUI_VOICE_MARKER } from '@/common/config/constants';

/** A spoken message (C26) recalls as its transcript: the `[[AION_VOICE]]` block is for the agent only. */
function withoutVoiceBlock(content: string): string {
  const start = content.indexOf(AIONUI_VOICE_MARKER);
  return start === -1 ? content : content.slice(0, start).trim();
}

export function getConversationInputHistory(messages: TMessage[], conversation_id?: string): string[] {
  if (!conversation_id) {
    return [];
  }

  const history: string[] = [];
  const seen = new Set<string>();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.conversation_id !== conversation_id ||
      message.type !== 'text' ||
      message.position !== 'right' ||
      !message.content.content.trim()
    ) {
      continue;
    }

    const content = withoutVoiceBlock(message.content.content);
    if (!content || seen.has(content)) {
      continue;
    }

    seen.add(content);
    history.push(content);
  }

  return history;
}

export function isCaretOnFirstLine(textarea: HTMLTextAreaElement): boolean {
  const selectionStart = textarea.selectionStart ?? 0;
  return !textarea.value.slice(0, selectionStart).includes('\n');
}

export function isCaretOnLastLine(textarea: HTMLTextAreaElement): boolean {
  const selectionEnd = textarea.selectionEnd ?? textarea.value.length;
  return !textarea.value.slice(selectionEnd).includes('\n');
}

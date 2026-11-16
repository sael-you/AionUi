/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-active-focus-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';
import { quoteStackStore, type QuoteItem } from '@/renderer/components/chat/SendBox/quoteStack';

const CONVERSATION = 'sendbox-active-focus-conversation';

const quote = (id: string, content: string, reply = ''): QuoteItem => ({
  id,
  messageId: `m-${id}`,
  position: 'left',
  content,
  reply,
});

const Harness = ({
  onSend,
  initialValue = '',
}: {
  onSend: (message: string) => Promise<void | false>;
  initialValue?: string;
}) => {
  const [value, setValue] = useState(initialValue);
  return <SendBox value={value} onChange={setValue} onSend={onSend} />;
};

describe('SendBox with stacked quotes (C32)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    quoteStackStore.resetForTests();
  });

  it('shows the stack and sends every quote with its reply, then the text, in order', async () => {
    quoteStackStore.set(CONVERSATION, [quote('a', 'first\nquote', 'Yes.'), quote('b', 'second quote')]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} initialValue='And the rest.' />);

    expect(screen.getAllByTestId('quote-chip')).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('> first\n> quote\n\nYes.\n\n> second quote\n\nAnd the rest.');
    await waitFor(() => expect(screen.queryByTestId('quote-stack')).toBeNull());
    expect(quoteStackStore.get(CONVERSATION)).toEqual([]);
  });

  it('sends quotes alone with an empty composer', () => {
    quoteStackStore.set(CONVERSATION, [quote('a', 'only a quote', 'my reply')]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} />);

    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('> only a quote\n\nmy reply');
  });

  it('gives the quotes and the text back when the send is refused', async () => {
    const stack = [quote('a', 'kept quote', 'kept reply')];
    quoteStackStore.set(CONVERSATION, stack);
    const onSend = vi.fn().mockResolvedValue(false);
    render(<Harness onSend={onSend} initialValue='kept text' />);

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(textarea.value).toBe('kept text'));
    expect(quoteStackStore.get(CONVERSATION)).toEqual(stack);
    expect(screen.getAllByTestId('quote-chip')).toHaveLength(1);
  });

  it('does not send an empty composer without quotes', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} />);
    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('removes, reorders with Alt+Arrow and edits a quote in the modal', async () => {
    quoteStackStore.set(CONVERSATION, [quote('a', 'alpha'), quote('b', 'beta', 'old reply')]);
    render(<Harness onSend={vi.fn().mockResolvedValue(undefined)} />);

    const chips = () => screen.getAllByTestId('quote-chip');
    expect(chips()[1]).toHaveTextContent('conversation.quoteReply.withReply');

    const betaButton = chips()[1]?.querySelector('[data-quote-chip]') as HTMLElement;
    fireEvent.keyDown(betaButton, { key: 'ArrowUp', altKey: true });
    expect(quoteStackStore.get(CONVERSATION).map((item) => item.id)).toEqual(['b', 'a']);

    fireEvent.click(chips()[0]?.querySelector('[data-quote-chip]') as HTMLElement);
    const modal = await screen.findByTestId('quote-edit-modal');
    expect(modal).toHaveTextContent('beta');
    const reply = modal.querySelector('textarea') as HTMLTextAreaElement;
    expect(reply.value).toBe('old reply');
    fireEvent.change(reply, { target: { value: 'new reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(quoteStackStore.get(CONVERSATION)[0]?.reply).toBe('new reply'));

    const alphaRemove = within(chips()[1] as HTMLElement).getByRole('button', {
      name: 'conversation.quoteReply.removeLabel',
    });
    fireEvent.click(alphaRemove);
    expect(quoteStackStore.get(CONVERSATION).map((item) => item.id)).toEqual(['b']);
  });
});

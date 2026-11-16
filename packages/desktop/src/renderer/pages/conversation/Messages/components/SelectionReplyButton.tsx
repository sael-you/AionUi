/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import ReplyPopover, { type ReplyPopoverAnchor } from '@/renderer/components/chat/SendBox/ReplyPopover';
import { useQuoteStack, type QuotePosition } from '@/renderer/components/chat/SendBox/quoteStack';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { openExternalUrl } from '@/renderer/utils/platform';
import { resolveSelectionHttpUrl } from '@/renderer/utils/url';
import { Button } from '@arco-design/web-react';
import { Browser, Earth, Quote, Voice } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ReplyPos = {
  top: number;
  left: number;
  /** Selection edges, to anchor the reply popover. */
  selectionTop: number;
  selectionBottom: number;
  text: string;
  msgId: string;
  msgPos: QuotePosition;
  url: string | null;
};

type PopoverState = {
  anchor: ReplyPopoverAnchor;
  text: string;
  msgId: string;
  msgPos: QuotePosition;
  dictate: boolean;
};

/**
 * Get the current selection, checking Shadow DOM roots if needed.
 * MarkdownView renders inside Shadow DOM, so document.getSelection() may
 * return a collapsed/empty selection while the real selection lives inside
 * a shadowRoot.
 */
function getEffectiveSelection(target: EventTarget | null): Selection | null {
  // First try the standard selection
  const docSel = document.getSelection();
  if (docSel && !docSel.isCollapsed && docSel.toString().trim()) {
    return docSel;
  }

  // If standard selection is empty, search for selection inside Shadow DOM
  // Walk up from the mouseup target to find a shadow host
  let el = target instanceof Node ? target : null;
  while (el) {
    if (el instanceof Element && el.shadowRoot) {
      const shadowSel = (el.shadowRoot as unknown as { getSelection?: () => Selection | null }).getSelection?.();
      if (shadowSel && !shadowSel.isCollapsed && shadowSel.toString().trim()) {
        return shadowSel;
      }
    }
    el = el.parentNode;
  }

  return docSel;
}

/**
 * Find the closest message container from a selection's anchor node.
 * Handles both regular DOM and Shadow DOM cases.
 */
function findMessageElement(sel: Selection): Element | null {
  let node: Node | null = sel.anchorNode;
  if (!node) return null;

  // In Shadow DOM, anchorNode is inside the shadow tree.
  // We need to walk up through shadow boundaries to find the message container.
  let el: Element | null = node instanceof Element ? node : node.parentElement;

  // Try finding within current DOM tree first
  const msgEl = el?.closest?.('[id^="message-"]');
  if (msgEl) return msgEl;

  // If not found, walk up through shadow host boundaries
  while (el) {
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) {
      el = root.host;
      const hostMsgEl = el.closest('[id^="message-"]');
      if (hostMsgEl) return hostMsgEl;
    } else {
      break;
    }
  }

  return null;
}

const BUTTON_HEIGHT = 32;
const POPOVER_ESTIMATED_HEIGHT = 170;
/** Touch: wait for the selection handles to settle before showing the toolbar. */
const TOUCH_SETTLE_MS = 350;

/** Selections in the composer, the quote stack/popover/modal or any editable never open the toolbar. */
const isInQuoteUiOrEditable = (node: Node | null): boolean => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return Boolean(el?.closest('[data-quote-ui], textarea, input, [contenteditable="true"]'));
};

/** Toolbar buttons must not take focus away from (and collapse) the selection. */
const keepSelection = (event: React.MouseEvent) => event.preventDefault();

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest('textarea, input, select, [contenteditable="true"]'));

/**
 * The selection toolbar of the message list (C32): Reply and dictated reply on any
 * selected message text (Shadow DOM aware), plus the URL actions for a selected
 * link. Reply opens a popover whose result goes onto the conversation's quote
 * stack. Keyboard: R or Ctrl/Cmd+Shift+R while the toolbar shows. Touch: the
 * toolbar appears below the selection, clear of the native selection menu.
 */
const SelectionReplyButton: React.FC<{ messages: TMessage[] }> = ({ messages }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const preview = useOptionalPreviewContext();
  const isMobile = layout?.isMobile ?? false;
  const [pos, setPos] = useState<ReplyPos | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const buttonRef = useRef<HTMLDivElement>(null);
  const quoteStack = useQuoteStack(messages[0]?.conversation_id);

  const readSelection = useCallback((target: EventTarget | null, touch: boolean): ReplyPos | null => {
    const sel = getEffectiveSelection(target);
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text || isInQuoteUiOrEditable(sel.anchorNode)) return null;

    const msgEl = findMessageElement(sel);
    if (!msgEl) return null;

    const msgId = msgEl.id.slice('message-'.length);
    const msg = messagesRef.current.find((m) => m.id === msgId);
    const rect = sel.getRangeAt(0).getBoundingClientRect();

    // Mouse: above the selection (below when too close to the top). Touch: always below,
    // because the native selection menu sits above it.
    const above = rect.top - BUTTON_HEIGHT - 8;
    const below = rect.bottom + (touch ? 16 : 8);
    const top = !touch && above >= 0 ? above : Math.min(below, window.innerHeight - BUTTON_HEIGHT - 8);

    return {
      top,
      left: Math.max(60, Math.min(rect.left + rect.width / 2, window.innerWidth - 60)),
      selectionTop: rect.top,
      selectionBottom: rect.bottom,
      text,
      msgId,
      msgPos: (msg?.position ?? 'left') as QuotePosition,
      // Resolve here while the live Selection (with its anchor/focus nodes) exists.
      url: resolveSelectionHttpUrl(text, sel.anchorNode, sel.focusNode),
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let touchTimer: ReturnType<typeof setTimeout> | null = null;

    const onMouseUp = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      window.setTimeout(() => {
        if (!mounted) return;
        const next = readSelection(e.target, false);
        if (next) setPos(next);
      }, 20);
    };

    // Touch (390 px): long-press selections fire no mouseup; follow the selection instead.
    const onSelectionChange = () => {
      if (touchTimer) clearTimeout(touchTimer);
      touchTimer = setTimeout(() => {
        if (!mounted) return;
        const sel = document.getSelection();
        setPos(readSelection(sel?.anchorNode ?? null, true));
      }, TOUCH_SETTLE_MS);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };

    // Clear floating button on scroll, debounced to avoid clearing during
    // the tiny scrolls that happen while selecting text
    const onScroll = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => setPos(null), 100);
    };

    if (isMobile) {
      document.addEventListener('selectionchange', onSelectionChange);
    } else {
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('mousedown', onMouseDown);
    }
    document.addEventListener('scroll', onScroll, true);
    return () => {
      mounted = false;
      if (scrollTimer) clearTimeout(scrollTimer);
      if (touchTimer) clearTimeout(touchTimer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [isMobile, readSelection]);

  const openPopover = useCallback((from: ReplyPos, dictate: boolean) => {
    const spaceBelow = window.innerHeight - from.selectionBottom;
    const top =
      spaceBelow > POPOVER_ESTIMATED_HEIGHT + 16
        ? from.selectionBottom + 8
        : Math.max(8, from.selectionTop - POPOVER_ESTIMATED_HEIGHT - 8);
    setPopover({ anchor: { top, left: from.left }, text: from.text, msgId: from.msgId, msgPos: from.msgPos, dictate });
    setPos(null);
  }, []);

  // Keyboard: R or Ctrl/Cmd+Shift+R replies to the selection while the toolbar shows.
  useEffect(() => {
    if (!pos) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const plainR =
        event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      const shortcut = event.key.toLowerCase() === 'r' && (event.ctrlKey || event.metaKey) && event.shiftKey;
      if (!plainR && !shortcut) return;
      event.preventDefault();
      openPopover(pos, false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pos, openPopover]);

  const dismiss = () => {
    setPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const popoverNode = popover ? (
    <ReplyPopover
      anchor={popover.anchor}
      quote={popover.text}
      autoDictate={popover.dictate}
      onAdd={(reply) => {
        quoteStack.add({ messageId: popover.msgId, position: popover.msgPos, content: popover.text, reply });
        setPopover(null);
        window.getSelection()?.removeAllRanges();
      }}
      onClose={() => setPopover(null)}
    />
  ) : null;

  if (!pos) return popoverNode;

  // Resolved http(s) URL for the selection (single URL text, or a link anchor);
  // when present, offer extra open actions.
  const url = pos.url;

  return (
    <>
      {popoverNode}
      <div
        ref={buttonRef}
        role='toolbar'
        aria-label={t('conversation.quoteReply.toolbarLabel')}
        className='fixed z-9999 flex items-center gap-2px px-4px py-4px rd-8px select-none bg-bg-2 border border-border-2 shadow-md'
        style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
        data-testid='selection-toolbar'
        data-quote-ui
      >
        <Button
          type='text'
          size='mini'
          icon={<Quote theme='outline' size='14' />}
          aria-keyshortcuts='R Control+Shift+R Meta+Shift+R'
          onMouseDown={keepSelection}
          onClick={() => openPopover(pos, false)}
        >
          {t('common.reply', { defaultValue: 'Reply' })}
        </Button>
        <Button
          type='text'
          size='mini'
          icon={<Voice theme='outline' size='14' />}
          aria-label={t('conversation.quoteReply.dictateReply')}
          title={t('conversation.quoteReply.dictateReply')}
          onMouseDown={keepSelection}
          onClick={() => openPopover(pos, true)}
        />
        {url && preview && (
          <Button
            type='text'
            size='mini'
            icon={<Browser theme='outline' size='14' />}
            onMouseDown={keepSelection}
            onClick={() => {
              preview.openBrowserTab(url);
              dismiss();
            }}
          >
            {t('common.openInBuiltinBrowser')}
          </Button>
        )}
        {url && (
          <Button
            type='text'
            size='mini'
            icon={<Earth theme='outline' size='14' />}
            onMouseDown={keepSelection}
            onClick={() => {
              void openExternalUrl(url).catch(console.error);
              dismiss();
            }}
          >
            {t('common.openInSystemBrowser')}
          </Button>
        )}
      </div>
    </>
  );
};

export default SelectionReplyButton;

/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyboard navigation for a tree rendered as nested DOM (the sidebar):
 * WAI-ARIA tree pattern with a roving tabindex.
 *
 * Items are the elements marked `data-tree-item` (with `data-tree-level`, and
 * `aria-expanded` when they have children), in DOM order. Exactly one item is
 * in the tab order (`tabIndex=0`): the last focused one, else the current page
 * (`aria-current="page"`), else the first. Items render `tabIndex={-1}`.
 *
 * Keys handled by the container: ↑/↓ previous / next item, Home / End, and the
 * "expand" / "collapse" arrows when the item itself did not use them (→ on an
 * expanded item moves to its first child, ← on a child moves to its parent).
 * Items handle Enter (open) and expanding / collapsing themselves, calling
 * `preventDefault()` when they did. Arrows are mirrored in RTL.
 */

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

const ITEM_SELECTOR = '[data-tree-item]';

type ArrowEvent = Pick<KeyboardEvent, 'key'> & { currentTarget: EventTarget | null; target?: EventTarget | null };

const isRtl = (element: Element | null): boolean => element?.closest('[dir]')?.getAttribute('dir') === 'rtl';

/** `'expand'` / `'collapse'` for the horizontal arrows (reading direction aware), else `null`. */
export const treeArrowIntent = (event: ArrowEvent): 'expand' | 'collapse' | null => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return null;
  const element = (event.currentTarget ?? event.target ?? null) as Element | null;
  const forward = event.key === (isRtl(element) ? 'ArrowLeft' : 'ArrowRight');
  return forward ? 'expand' : 'collapse';
};

const levelOf = (item: HTMLElement): number => Number(item.dataset.treeLevel ?? '1') || 1;

const keyOf = (item: HTMLElement): string => item.dataset.treeKey ?? item.id;

/**
 * Roving tabindex + arrow-key navigation for the tree inside `containerRef`.
 * Returns the container's `onKeyDown` and `onFocus` handlers.
 */
export const useRovingTree = (containerRef: React.RefObject<HTMLElement | null>) => {
  const currentKeyRef = useRef<string | null>(null);

  const items = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    return container ? Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
  }, [containerRef]);

  /** Put exactly one item in the tab order. */
  const sync = useCallback(() => {
    const all = items();
    if (all.length === 0) return;
    const current =
      (currentKeyRef.current && all.find((item) => keyOf(item) === currentKeyRef.current)) ||
      all.find((item) => item.getAttribute('aria-current') === 'page') ||
      all[0];
    for (const item of all) {
      const tabIndex = item === current ? 0 : -1;
      if (item.tabIndex !== tabIndex) item.tabIndex = tabIndex;
    }
  }, [items]);

  // Items mount and unmount as groups expand, filters apply, data loads.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    sync();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => sync());
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, sync]);

  const focusItem = useCallback(
    (item: HTMLElement | undefined) => {
      if (!item) return;
      currentKeyRef.current = keyOf(item);
      sync();
      item.focus();
    },
    [sync]
  );

  const onFocus = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
      if (!item || !containerRef.current?.contains(item)) return;
      currentKeyRef.current = keyOf(item);
      sync();
    },
    [containerRef, sync]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      // Only keys pressed on an item itself (not inside its menu or an editor).
      if (!target.matches(ITEM_SELECTOR)) return;
      const all = items();
      const index = all.indexOf(target);
      if (index === -1) return;
      const level = levelOf(target);

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusItem(all[index + 1]);
          return;
        case 'ArrowUp':
          event.preventDefault();
          focusItem(all[index - 1]);
          return;
        case 'Home':
          event.preventDefault();
          focusItem(all[0]);
          return;
        case 'End':
          event.preventDefault();
          focusItem(all[all.length - 1]);
          return;
        default:
          break;
      }

      const intent = treeArrowIntent({ key: event.key, currentTarget: target });
      if (intent === 'expand' && target.getAttribute('aria-expanded') === 'true') {
        const next = all[index + 1];
        if (next && levelOf(next) > level) {
          event.preventDefault();
          focusItem(next);
        }
      } else if (intent === 'collapse') {
        for (let i = index - 1; i >= 0; i -= 1) {
          if (levelOf(all[i]) < level) {
            event.preventDefault();
            focusItem(all[i]);
            return;
          }
        }
      }
    },
    [focusItem, items]
  );

  return { onKeyDown, onFocus };
};

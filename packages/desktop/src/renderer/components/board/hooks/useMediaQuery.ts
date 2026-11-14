/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';

/** Narrow layout breakpoint of the board (SPEC §8: ≤768 px = one column at a time, no drag). */
export const BOARD_NARROW_QUERY = '(max-width: 768px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getMedia = (query: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/** Live `matchMedia` result; `false` where media queries are unavailable. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = getMedia(query);
      if (!media) return () => {};
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => getMedia(query)?.matches ?? false,
    () => false
  );
}

export const useBoardNarrow = (): boolean => useMediaQuery(BOARD_NARROW_QUERY);
export const useReducedMotion = (): boolean => useMediaQuery(REDUCED_MOTION_QUERY);

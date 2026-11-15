/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Icon + label spacing for Arco buttons. Arco spaces `> svg + span` (4 / 6 / 8 px
 * for mini / small / default), but icon-park icons render as `<span class="i-icon">`,
 * which that rule never matches, so the icon touched the label. These classes give
 * the same gaps through flex layout (RTL-safe).
 */
const GAP = { mini: 'gap-4px', small: 'gap-6px', default: 'gap-8px' } as const;

export const iconLabelButton = (size: keyof typeof GAP = 'default'): string =>
  `!inline-flex !items-center !justify-center ${GAP[size]}`;

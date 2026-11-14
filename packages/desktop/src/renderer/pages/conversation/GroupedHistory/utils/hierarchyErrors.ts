/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';

const HIERARCHY_ERROR_KEYS: Record<string, string> = {
  parent_not_found: 'conversation.hierarchy.errors.parentNotFound',
  parent_depth_exceeded: 'conversation.hierarchy.errors.depthExceeded',
  parent_fanout_exceeded: 'conversation.hierarchy.errors.fanoutExceeded',
  parent_cycle: 'conversation.hierarchy.errors.cycle',
};

/**
 * Map a backend hierarchy error (`parent_not_found | parent_depth_exceeded |
 * parent_fanout_exceeded | parent_cycle`) to a friendly, translated message.
 * Unknown errors fall back to `fallbackKey`.
 */
export const getHierarchyErrorMessage = (
  error: unknown,
  t: (key: string) => string,
  fallbackKey = 'conversation.hierarchy.errors.generic'
): string => {
  if (isBackendHttpError(error)) {
    const key = HIERARCHY_ERROR_KEYS[error.code.toLowerCase()];
    if (key) return t(key);
  }
  return t(fallbackKey);
};

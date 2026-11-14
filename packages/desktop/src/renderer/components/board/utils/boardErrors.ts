/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Board error codes → i18n keys. The UI branches on the backend's machine code
 * (`BackendHttpError.code`), never on its English message.
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { BOARD_ERROR_CODES, type BoardErrorCode } from '@/common/types/board';

const C = BOARD_ERROR_CODES;

const CODE_TO_KEY: Record<BoardErrorCode, string> = {
  [C.wipLimit]: 'board.errors.wipLimitGeneric',
  [C.versionConflict]: 'board.errors.versionConflict',
  [C.archived]: 'board.errors.archived',
  [C.notFound]: 'board.errors.notFound',
  [C.invalid]: 'board.errors.invalid',
  [C.dependencyCycle]: 'board.errors.dependencyCycle',
  [C.disabled]: 'board.errors.disabled',
  [C.exitRule]: 'board.errors.exitRule',
  [C.gateUseDecision]: 'board.errors.gateUseDecision',
  [C.rateLimited]: 'board.errors.rateLimited',
  [C.noProject]: 'board.errors.noProject',
  [C.wrongProject]: 'board.errors.wrongProject',
  [C.useAgentRouter]: 'board.errors.forbidden',
  [C.systemForbidden]: 'board.errors.forbidden',
  [C.agentMoveDenied]: 'board.errors.forbidden',
  [C.departmentMismatch]: 'board.errors.forbidden',
  [C.featureNotEnabled]: 'board.errors.forbidden',
  [C.assignmentInProgress]: 'board.errors.busy',
  [C.deployInFlight]: 'board.errors.busy',
  [C.idempotencyConflict]: 'board.errors.busy',
};

/** The backend code of an error, or `''` when it is not a coded backend error. */
export const boardErrorCode = (error: unknown): string => (isBackendHttpError(error) ? error.code : '');

/**
 * A request that never reached the backend (fetch rejects with a TypeError when
 * the network or the local server is down).
 */
export const isNetworkError = (error: unknown): boolean => error instanceof TypeError;

/** i18n key describing an error for the user. Unknown codes fall back to a generic message. */
export const boardErrorKey = (error: unknown): string => {
  if (isNetworkError(error)) return 'board.errors.network';
  const code = boardErrorCode(error);
  if (code && code in CODE_TO_KEY) return CODE_TO_KEY[code as BoardErrorCode];
  if (isBackendHttpError(error) && error.status === 404) return 'board.errors.notFound';
  return 'board.errors.generic';
};

/** The project has no board at all (temp project / unknown project) — hide board entry points. */
export const isBoardUnavailableError = (error: unknown): boolean => {
  const code = boardErrorCode(error);
  if (code === C.noProject || code === C.notFound) return true;
  return isBackendHttpError(error) && error.status === 404;
};

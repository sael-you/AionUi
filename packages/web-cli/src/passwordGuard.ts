/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readIdentityMarker, resolveBackendIdentity, type BackendIdentity } from '@aionui/web-host';

/**
 * Identity that governs the local password tools (`resetpass`, first-start
 * seeding) on a data dir: `webui` when this shell says so OR the launcher last
 * ran the data dir in WebUI identity (its `identity-mode` marker). A shell that
 * lacks AIONUI_BACKEND_IDENTITY must not reset the password of a data dir served
 * in WebUI identity — that would leave the gateway's credentials stale (card C11).
 */
export function passwordToolsIdentity(dataDir: string, env: NodeJS.ProcessEnv = process.env): BackendIdentity {
  return resolveBackendIdentity(env) === 'webui' || readIdentityMarker(dataDir) === 'webui' ? 'webui' : 'local';
}

/** Password handling of one start ({@link startPasswordPolicy}). */
export type StartPasswordPolicy = {
  /** THIS start's identity (the launcher option): decides which messages are printed. */
  identity: BackendIdentity;
  /** Whether a missing password may be generated through the local-only reset endpoint. */
  seedingAllowed: boolean;
};

/**
 * What a start may do about the admin password. The messages follow the identity
 * of this start, so the first local start after a rollback from WebUI does not
 * print the WebUI procedure. Seeding additionally needs {@link passwordToolsIdentity}
 * to be `local`, so the previous run's marker still refuses it. Call before the
 * start: the launcher rewrites the marker.
 */
export function startPasswordPolicy(
  identity: BackendIdentity,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): StartPasswordPolicy {
  return { identity, seedingAllowed: identity === 'local' && passwordToolsIdentity(dataDir, env) === 'local' };
}

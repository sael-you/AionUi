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

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The page behind the single-target CDP bridge (TASK-111). The bridge server
 * (cdpBridge.ts) is target-agnostic: it answers discovery and Target.* locally
 * (cdpTargetProtocol.ts) and forwards everything else to a CdpTarget. Desktop uses
 * the in-app browser webview (electronWebviewTarget.ts); the WebUI's server-side
 * Chrome target is implemented by AionCore with the same rules (shared fixture
 * tests/fixtures/cdpTargetProtocol.cases.json).
 */

import type { TargetInfo } from './cdpTargetProtocol';

export type CdpTarget = {
  /** Discovery info of the page; an `about:blank` page while nothing is attached. */
  targetInfo: () => TargetInfo;
  /** Whether a page is attached and commands can be forwarded. */
  isAttached: () => boolean;
  /** Forward one page command; rejects when the page is gone. */
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
};

/** What a target reports back to the bridge: CDP events, already stamped with the single session id. */
export type CdpTargetEvents = {
  emit: (payload: Record<string, unknown>) => void;
};

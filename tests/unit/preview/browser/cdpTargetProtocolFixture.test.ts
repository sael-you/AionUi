/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SINGLE_BROWSER_CONTEXT_ID,
  SINGLE_SESSION_ID,
  SINGLE_TARGET_ID,
  buildTargetInfo,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
  type CdpDecision,
  type CdpRequest,
} from '@process/resources/builtinMcp/cdpTargetProtocol';

/**
 * Replays the shared fixture (TASK-111): the Rust bridge in AionCore replays a byte-identical copy,
 * so the desktop and server bridges emulate the single target the same way.
 */

type Fixture = {
  constants: { target_id: string; session_id: string; browser_context_id: string };
  target: { title: string; url: string };
  decide: Array<{ name: string; request: CdpRequest; expect: CdpDecision }>;
  session_ids: Array<{ session_id: string | null; acceptable: boolean }>;
  tokens: Array<{ a: string; b: string; match: boolean }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/cdpTargetProtocol.cases.json'), 'utf8')
) as Fixture;

describe('cdpTargetProtocol — shared fixture (TS side)', () => {
  it('uses the fixture constants', () => {
    expect(SINGLE_TARGET_ID).toBe(fixture.constants.target_id);
    expect(SINGLE_SESSION_ID).toBe(fixture.constants.session_id);
    expect(SINGLE_BROWSER_CONTEXT_ID).toBe(fixture.constants.browser_context_id);
  });

  it.each(fixture.decide.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const info = () => buildTargetInfo(fixture.target.title, fixture.target.url);
    expect(decideCdpCommand(entry.request, info)).toEqual(entry.expect);
  });

  it('accepts and refuses session ids as the fixture says', () => {
    for (const entry of fixture.session_ids) {
      expect(isAcceptableSessionId(entry.session_id ?? undefined), String(entry.session_id)).toBe(entry.acceptable);
    }
  });

  it('compares tokens as the fixture says', () => {
    for (const entry of fixture.tokens) {
      expect(tokensMatch(entry.a, entry.b), `${entry.a} vs ${entry.b}`).toBe(entry.match);
    }
  });
});

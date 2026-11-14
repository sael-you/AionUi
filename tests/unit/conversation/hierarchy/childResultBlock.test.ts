/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseChildResultBlocks } from '@/renderer/pages/conversation/Messages/components/childResult/childResultBlock';

describe('parseChildResultBlocks', () => {
  it('parses attributes (name with spaces) and the body', () => {
    const { text, results } = parseChildResultBlocks(
      'Before\n[[AION_CHILD_RESULT child_id=abc-1 name=Fix the build status=finished]]\nAll green.\n[[/AION_CHILD_RESULT]]\nAfter'
    );
    expect(results).toEqual([{ childId: 'abc-1', name: 'Fix the build', status: 'finished', body: 'All green.' }]);
    expect(text).toBe('Before\n\nAfter');
  });

  it('supports quoted names and multiple blocks', () => {
    const { results } = parseChildResultBlocks(
      '[[AION_CHILD_RESULT child_id=a name="One two" status=error]]x[[/AION_CHILD_RESULT]][[AION_CHILD_RESULT child_id=b name=B status=finished]]y[[/AION_CHILD_RESULT]]'
    );
    expect(results.map((r) => [r.childId, r.name, r.status, r.body])).toEqual([
      ['a', 'One two', 'error', 'x'],
      ['b', 'B', 'finished', 'y'],
    ]);
  });

  it('returns plain text untouched when there is no block', () => {
    expect(parseChildResultBlocks('hello')).toEqual({ text: 'hello', results: [] });
  });

  it('falls back to plain text for malformed blocks', () => {
    const noEnd = '[[AION_CHILD_RESULT child_id=a name=A status=ok]] body without end';
    expect(parseChildResultBlocks(noEnd)).toEqual({ text: noEnd, results: [] });
    const noId = '[[AION_CHILD_RESULT name=A status=ok]] body [[/AION_CHILD_RESULT]]';
    expect(parseChildResultBlocks(noId)).toEqual({ text: noId, results: [] });
    const noClose = '[[AION_CHILD_RESULT child_id=a';
    expect(parseChildResultBlocks(noClose)).toEqual({ text: noClose, results: [] });
  });

  it('keeps valid blocks when a malformed one precedes them', () => {
    const { results } = parseChildResultBlocks(
      '[[AION_CHILD_RESULT oops [[AION_CHILD_RESULT child_id=z name=Z status=ok]]done[[/AION_CHILD_RESULT]]'
    );
    expect(results.map((r) => r.childId)).toEqual(['z']);
  });
});

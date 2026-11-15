import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, MAX_CONTROL_FRAME_BYTES } from '@/renderer/voice/core/protocol';

const env = (name: string, data: Record<string, unknown>) => JSON.stringify({ name, data });

describe('voice protocol — decodeFrame', () => {
  it('decodes the core { name, data } envelope', () => {
    expect(decodeFrame(env('voice.ready', { voiceSessionId: 'vs', engine: 'openai-realtime', model: 'm' }))).toEqual({
      name: 'voice.ready',
      voiceSessionId: 'vs',
      engine: 'openai-realtime',
      model: 'm',
    });
  });

  it('also accepts a flat { type, ...fields } frame', () => {
    const frame = decodeFrame(JSON.stringify({ type: 'voice.state', state: 'thinking', reason: 'tool' }));
    expect(frame).toMatchObject({ name: 'voice.state', state: 'thinking', reason: 'tool' });
  });

  it('accepts snake_case voice_session_id', () => {
    expect(decodeFrame(env('voice.ready', { voice_session_id: 'vs' }))).toMatchObject({ voiceSessionId: 'vs' });
  });

  it('returns null for non-JSON, unknown names, non-voice names and oversized frames', () => {
    expect(decodeFrame('not json')).toBeNull();
    expect(decodeFrame(env('voice.nope', {}))).toBeNull();
    expect(decodeFrame(env('message.stream', {}))).toBeNull();
    expect(decodeFrame('x'.repeat(MAX_CONTROL_FRAME_BYTES + 1))).toBeNull();
    expect(decodeFrame(42)).toBeNull();
  });

  it('rejects frames missing required fields or with invalid enums', () => {
    expect(decodeFrame(env('voice.ready', {}))).toBeNull();
    expect(decodeFrame(env('voice.state', { state: 'dancing' }))).toBeNull();
    expect(decodeFrame(env('voice.caption', { role: 'system', text: 'x' }))).toBeNull();
    expect(decodeFrame(env('voice.draftUpdated', { draftId: 'd', version: 'one', state: 'drafted' }))).toBeNull();
    expect(decodeFrame(env('voice.followUp', { conversationId: 'c', status: 'exploded' }))).toBeNull();
    expect(decodeFrame(env('voice.budget', { usedUsd: 'a', limitUsd: 5 }))).toBeNull();
  });

  it('decodes a draft with target, diff transforms, delivery and hash', () => {
    const frame = decodeFrame(
      env('voice.draftUpdated', {
        draftId: 'd1',
        version: 3,
        state: 'drafted',
        target: { id: 'c1', name: 'Kanban build', kind: 'conversation' },
        text: 'Run tests',
        diff: [
          { op: 'equal', text: 'Run ' },
          { op: 'delete', text: 'uh ', transform: 'filler' },
          { kind: 'add', text: 'tests', transform: 'reference' },
          { op: 'bogus', text: 'x' },
        ],
        delivery: 'steer',
        hash: 'abc',
      })
    );
    expect(frame).toMatchObject({
      target: { id: 'c1', name: 'Kanban build', kind: 'conversation' },
      delivery: 'steer',
      hash: 'abc',
      diff: [
        { op: 'equal', text: 'Run ' },
        { op: 'delete', text: 'uh ', transform: 'filler' },
        { op: 'insert', text: 'tests', transform: 'reference' },
      ],
    });
  });

  it('drops unknown delivery values and a missing hash to null', () => {
    const frame = decodeFrame(
      env('voice.draftUpdated', { draftId: 'd', version: 1, state: 'queued', delivery: 'teleport' })
    );
    expect(frame).toMatchObject({ delivery: null, hash: null, target: null, diff: [] });
  });
});

describe('voice protocol — call end and hold', () => {
  it('decodes voice.callEnded', () => {
    expect(decodeFrame(env('voice.callEnded', { voiceSessionId: 'vs', reason: 'idle' }))).toEqual({
      name: 'voice.callEnded',
      voiceSessionId: 'vs',
      reason: 'idle',
    });
  });

  it('decodes the backend hold fields and clamps a negative remainder', () => {
    const frame = decodeFrame(
      env('voice.draftUpdated', {
        draftId: 'd',
        version: 1,
        state: 'committing',
        holdRemainingMs: -5,
        holdFrozen: true,
      })
    );
    expect(frame).toMatchObject({ holdRemainingMs: 0, holdFrozen: true });
  });
});

describe('voice protocol — encodeFrame', () => {
  it('wraps fields in { name, data } and adds the bound voiceSessionId', () => {
    expect(JSON.parse(encodeFrame({ name: 'voice.speechOnset', t: 1.5 }, 'vs'))).toEqual({
      name: 'voice.speechOnset',
      data: { t: 1.5, voiceSessionId: 'vs' },
    });
  });

  it('omits voiceSessionId when no session is bound', () => {
    expect(JSON.parse(encodeFrame({ name: 'voice.heartbeat', t: 1 }, null))).toEqual({
      name: 'voice.heartbeat',
      data: { t: 1 },
    });
  });
});

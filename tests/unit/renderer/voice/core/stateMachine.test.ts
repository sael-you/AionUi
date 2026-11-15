import { describe, expect, it } from 'vitest';
import {
  INITIAL_VOICE_STATE,
  decideNextMute,
  isOutgoingLive,
  orbStateOf,
  reduceVoice,
  type VoiceEvent,
  type VoiceMachineState,
} from '@/renderer/voice/core/stateMachine';

const run = (...events: VoiceEvent[]): VoiceMachineState => events.reduce(reduceVoice, INITIAL_VOICE_STATE);
const live: VoiceEvent[] = [
  { type: 'arm' },
  { type: 'armed' },
  { type: 'socketOpen' },
  { type: 'wake' },
  { type: 'sessionCreated', voiceSessionId: 'vs' },
  { type: 'ready', voiceSessionId: 'vs' },
];

describe('voice state machine', () => {
  it('arms locally without a call', () => {
    const s = run({ type: 'arm' }, { type: 'armed' }, { type: 'socketOpen' });
    expect(s.mode).toBe('armed');
    expect(s.call).toBeNull();
    expect(orbStateOf(s)).toBe('armed');
  });

  it('a wake while not armed, or while a call exists, is ignored', () => {
    expect(run({ type: 'wake' }).call).toBeNull();
    const s = run(...live);
    expect(reduceVoice(s, { type: 'wake' })).toBe(s);
  });

  it('conversation mode: a held mic sends silence; a new wake or call end clears the hold', () => {
    const held = run(...live, { type: 'hold', held: true });
    expect(isOutgoingLive(held)).toBe(false);
    expect(isOutgoingLive(reduceVoice(held, { type: 'hold', held: false }))).toBe(true);
    expect(reduceVoice(held, { type: 'callEnded' }).held).toBe(false);
    // No call: a hold is ignored.
    const armed = run({ type: 'arm' }, { type: 'armed' }, { type: 'socketOpen' });
    expect(reduceVoice(armed, { type: 'hold', held: true })).toBe(armed);
  });

  it('outgoing audio is live only when ready + socket open + not muted', () => {
    expect(isOutgoingLive(run(...live))).toBe(true);
    expect(isOutgoingLive(run(...live.slice(0, 5)))).toBe(false);
    expect(isOutgoingLive(run(...live, { type: 'userMute', muted: true }))).toBe(false);
  });

  it('socket close mutes and requires a fresh ready', () => {
    const closed = run(...live, { type: 'socketClosed' });
    expect(isOutgoingLive(closed)).toBe(false);
    expect(decideNextMute(run(...live), closed)).toBe(true);
    expect(orbStateOf(closed)).toBe('offline');
    const reopened = reduceVoice(closed, { type: 'socketOpen' });
    expect(isOutgoingLive(reopened)).toBe(false);
    expect(isOutgoingLive(reduceVoice(reopened, { type: 'ready', voiceSessionId: 'vs' }))).toBe(true);
  });

  it('ready for another session, or while the socket is down, does not unmute', () => {
    const pending = run(...live.slice(0, 5));
    expect(reduceVoice(pending, { type: 'ready', voiceSessionId: 'other' }).call?.phase).toBe('awaitingReady');
    const down = reduceVoice(pending, { type: 'socketClosed' });
    expect(reduceVoice(down, { type: 'ready', voiceSessionId: 'vs' }).call?.phase).toBe('awaitingReady');
  });

  it('maps server states to the orb', () => {
    const s = run(...live);
    expect(orbStateOf(s)).toBe('listening');
    expect(orbStateOf(reduceVoice(s, { type: 'serverState', state: 'thinking' }))).toBe('thinking');
    expect(orbStateOf(reduceVoice(s, { type: 'serverState', state: 'speaking' }))).toBe('speaking');
    expect(orbStateOf(run(...live.slice(0, 4)))).toBe('connecting');
  });

  it('call end keeps the device armed and stores resume_of', () => {
    const s = run(...live, { type: 'callEnded', resumeOf: 'vs' });
    expect(s.mode).toBe('armed');
    expect(s.call).toBeNull();
    expect(s.resumeOf).toBe('vs');
    expect(reduceVoice(s, { type: 'resumeConsumed' }).resumeOf).toBeNull();
  });

  it('freeze drops the call; resume returns to armed', () => {
    const frozen = run(...live, { type: 'frozen' });
    expect(frozen.mode).toBe('frozen');
    expect(frozen.call).toBeNull();
    expect(orbStateOf(frozen)).toBe('frozen');
    expect(reduceVoice(frozen, { type: 'resumed' }).mode).toBe('armed');
  });

  it('a suspended call (sideband reconnecting) is muted and shown offline until ready', () => {
    const s = run(...live, { type: 'callSuspended' });
    expect(isOutgoingLive(s)).toBe(false);
    expect(orbStateOf(s)).toBe('offline');
    const back = reduceVoice(s, { type: 'ready', voiceSessionId: 'vs' });
    expect(isOutgoingLive(back)).toBe(true);
    expect(orbStateOf(back)).toBe('listening');
  });

  it('disarm resets everything', () => {
    expect(run(...live, { type: 'disarm' })).toEqual(INITIAL_VOICE_STATE);
  });

  it('user mute without a call is ignored', () => {
    const s = run({ type: 'arm' }, { type: 'armed' });
    expect(reduceVoice(s, { type: 'userMute', muted: true })).toBe(s);
  });
});

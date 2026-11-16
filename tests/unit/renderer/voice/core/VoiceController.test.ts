import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VoiceController,
  MIC_EARLY_END_MS,
  SOCKET_DEAD_MAN_MS,
  DRAFT_LINGER_MS,
  REPLY_SETTLE_MS,
} from '@/renderer/voice/core/VoiceController';
import type { VoiceDraft } from '@/renderer/voice/core/types';
import { VoiceBusyError } from '@/renderer/voice/net/voiceApi';
import { createFakeEffects, flush } from '../fakes';

const draft = (patch: Partial<VoiceDraft> = {}): VoiceDraft => ({
  draftId: 'd1',
  version: 1,
  state: 'drafted',
  target: { id: 'c1', name: 'Kanban build' },
  text: 'Run the tests',
  diff: [],
  delivery: 'new_turn',
  hash: 'h1',
  options: [],
  spokenConfirm: true,
  ...patch,
});

async function armed(settings?: Parameters<typeof createFakeEffects>[0]) {
  const f = createFakeEffects(settings);
  const c = new VoiceController(f.fx);
  c.arm({ focusConversationId: 'c1' });
  await flush();
  f.openSocket();
  return { f, c };
}

async function inCall() {
  const { f, c } = await armed();
  f.state.wakeEvents?.onWake(9.2, 0.9);
  await flush();
  f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
  return { f, c };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('VoiceController — arm / disarm', () => {
  it('creates the AudioContext synchronously inside the arm call (gesture)', () => {
    const f = createFakeEffects();
    const c = new VoiceController(f.fx);
    c.arm();
    expect(f.fx.createAudioContext).toHaveBeenCalledTimes(1);
    expect(f.fx.createAudioElement).toHaveBeenCalledTimes(1);
    expect(c.state.mode).toBe('arming');
  });

  it('reaches armed with the outgoing path muted and plays the armed tone', async () => {
    const { f, c } = await armed();
    expect(c.state.mode).toBe('armed');
    expect(f.capture.mute).toHaveBeenCalled();
    expect(f.capture.setLive).not.toHaveBeenCalled();
    expect(f.earcons()).toContain('armed');
  });

  it('does not create an AudioContext when voice is known to be off', async () => {
    const f = createFakeEffects({ enabled: false });
    const c = new VoiceController(f.fx);
    await c.loadSettings();
    c.arm();
    expect(f.fx.createAudioContext).not.toHaveBeenCalled();
    expect(c.store.getSnapshot().notice?.code).toBe('disabled');
  });

  it('reports micDenied and releases everything when the permission is refused', async () => {
    const f = createFakeEffects();
    f.fx.openCapture.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const c = new VoiceController(f.fx);
    c.arm();
    await flush();
    expect(c.state.mode).toBe('off');
    expect(c.store.getSnapshot().notice?.code).toBe('micDenied');
    expect(f.fx.wakeLock.release).toHaveBeenCalled();
  });

  it('starts only the VAD (no model download) when the wake word is off', async () => {
    const { f } = await armed({ enabled: true, wake_word_enabled: false });
    const options = f.fx.wakeWord.start.mock.calls[0][3] as { loadModels: boolean };
    expect(options.loadModels).toBe(false);
  });

  it('disarm releases mic, socket, wake lock, plays bye and closes the context later', async () => {
    const { f, c } = await armed();
    c.disarm('tap');
    expect(f.capture.stop).toHaveBeenCalled();
    expect(f.socket.stop).toHaveBeenCalled();
    expect(f.fx.wakeLock.release).toHaveBeenCalled();
    expect(f.earcons()).toContain('bye');
    expect(f.ctx.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(f.ctx.close).toHaveBeenCalled();
  });

  it('ignores a duplicate arm while arming', () => {
    const f = createFakeEffects();
    const c = new VoiceController(f.fx);
    c.arm();
    c.arm();
    expect(f.fx.createAudioContext).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceController — wake and call', () => {
  it('a wake starts one call with the focus conversation and switches the worker to VAD-only', async () => {
    const { f } = await armed();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    f.state.wakeEvents?.onWake(9.3, 0.9);
    await flush();
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    expect(f.state.callOptions?.focusConversationId).toBe('c1');
    expect(f.state.callOptions?.outgoingTrack).toBe(f.capture.outgoingTrack);
    expect(f.fx.wakeWord.setMode).toHaveBeenCalledWith('vad');
    expect(f.socket.bindSession).toHaveBeenCalledWith('vs-1');
  });

  it('stays muted until voice.ready, then replays the ring buffer from the wake time', async () => {
    const { f } = await armed();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    await flush();
    expect(f.capture.setLive).not.toHaveBeenCalled();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
    expect(f.capture.setLive).toHaveBeenCalledWith(9.2);
    expect(f.earcons()).toContain('listening');
  });

  it('ignores voice.ready for another session', async () => {
    const { f, c } = await armed();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    await flush();
    f.frame({ name: 'voice.ready', voiceSessionId: 'other', engine: '', model: '' });
    expect(f.capture.setLive).not.toHaveBeenCalled();
    expect(c.store.getSnapshot().orb).toBe('connecting');
  });

  it('refuses to wake while the control socket is down', async () => {
    const f = createFakeEffects();
    const c = new VoiceController(f.fx);
    c.arm();
    await flush();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    expect(f.fx.startCall).not.toHaveBeenCalled();
    expect(c.store.getSnapshot().notice?.code).toBe('offline');
  });

  it('409 busy plays the other-device tone and stays armed', async () => {
    const { f, c } = await armed();
    f.fx.startCall.mockRejectedValueOnce(new VoiceBusyError());
    c.talk();
    await flush();
    expect(f.earcons()).toContain('otherDevice');
    expect(c.store.getSnapshot().notice?.code).toBe('busy');
    expect(c.state.call).toBeNull();
    expect(f.fx.wakeWord.setMode).toHaveBeenLastCalledWith('wake');
  });

  it('a hang-up during call setup ends the admitted session instead of keeping it', async () => {
    const { f, c } = await armed();
    const pending = Promise.withResolvers<typeof f.call>();
    f.fx.startCall.mockImplementationOnce(() => pending.promise);
    c.talk();
    c.hangUp();
    pending.resolve(f.call);
    await flush();
    expect(f.call.close).toHaveBeenCalled();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'cancelled');
  });

  it('voice.callEnded (idle hangup) closes the call locally without a second hangup', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    expect(c.state.call).toBeNull();
    expect(f.call.close).toHaveBeenCalled();
    expect(f.fx.api.endSession).not.toHaveBeenCalled();
    expect(c.state.mode).toBe('armed');
  });

  it('voice.callEnded for another session is ignored', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'other', reason: 'idle' });
    expect(c.state.call?.phase).toBe('ready');
  });

  it('"Jarvis, sleep" (callEnded reason sleep) disarms', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'sleep' });
    expect(c.state.mode).toBe('off');
    expect(f.capture.stop).toHaveBeenCalled();
  });

  it('voice.state armed without a reason (hello answered before ready) keeps the call', async () => {
    const { f, c } = await armed();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    await flush();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'armed', reason: null });
    expect(c.state.call?.voiceSessionId).toBe('vs-1');
    expect(f.call.close).not.toHaveBeenCalled();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: '', model: '' });
    expect(c.state.call?.phase).toBe('ready');
    expect(f.capture.setLive).toHaveBeenCalledWith(9.2);
  });

  it('still honours an older backend ending a ready call with voice.state armed + reason', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'armed', reason: 'idle' });
    expect(c.state.call).toBeNull();
  });

  it('plays "got it" when the backend moves from listening to thinking', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'thinking', reason: null });
    expect(f.earcons()).toContain('gotIt');
  });

  it('plays "your turn" after the measured output latency on assistantAudioFinished', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.assistantAudioFinished', voiceSessionId: 'vs-1', responseId: 'r1' });
    expect(f.earcons()).not.toContain('yourTurn');
    vi.advanceTimersByTime(61);
    expect(f.earcons()).toContain('yourTurn');
  });
});

describe('VoiceController — losing the backend or the network', () => {
  it('mutes at once on socket close and unmutes only on the next voice.ready (no pre-roll)', async () => {
    const { f } = await inCall();
    f.capture.mute.mockClear();
    f.capture.setLive.mockClear();
    f.closeSocket();
    expect(f.capture.mute).toHaveBeenCalled();
    expect(f.earcons()).toContain('reconnecting');
    f.openSocket();
    expect(f.capture.setLive).not.toHaveBeenCalled();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: '', model: '' });
    expect(f.capture.setLive).toHaveBeenCalledWith(undefined);
  });

  it('hangs up when the socket stays down for 20 s (dead-man)', async () => {
    const { f, c } = await inCall();
    f.closeSocket();
    vi.advanceTimersByTime(SOCKET_DEAD_MAN_MS - 1);
    expect(c.state.call).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(c.state.call).toBeNull();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'socket_lost');
  });

  it('a reconnect within 20 s keeps the call', async () => {
    const { f, c } = await inCall();
    f.closeSocket();
    vi.advanceTimersByTime(5000);
    f.openSocket();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: '', model: '' });
    vi.advanceTimersByTime(SOCKET_DEAD_MAN_MS);
    expect(c.state.call?.phase).toBe('ready');
  });

  it('a socket reopen alone does not cancel the dead-man: no voice.ready within 20 s → hangup', async () => {
    const { f, c } = await inCall();
    f.closeSocket();
    vi.advanceTimersByTime(2000);
    f.openSocket();
    vi.advanceTimersByTime(SOCKET_DEAD_MAN_MS);
    expect(c.state.call).toBeNull();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'socket_lost');
  });

  it('voice.state offline (sideband reconnecting) mutes until the next voice.ready', async () => {
    const { f, c } = await inCall();
    f.capture.mute.mockClear();
    f.capture.setLive.mockClear();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'offline', reason: 'reconnecting' });
    expect(f.capture.mute).toHaveBeenCalled();
    expect(c.store.getSnapshot().orb).toBe('offline');
    expect(c.state.call).not.toBeNull();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: '', model: '' });
    expect(f.capture.setLive).toHaveBeenCalledWith(undefined);
    expect(c.store.getSnapshot().orb).toBe('listening');
    vi.advanceTimersByTime(SOCKET_DEAD_MAN_MS + 1);
    expect(c.state.call?.phase).toBe('ready');
  });

  it('voice.state offline without a ready within 20 s hangs up', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'offline', reason: 'reconnecting' });
    vi.advanceTimersByTime(SOCKET_DEAD_MAN_MS + 1);
    expect(c.state.call).toBeNull();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'offline');
  });

  it('ICE loss hangs up and resumes with resume_of once connectivity is back', async () => {
    const { f } = await inCall();
    f.state.callOptions?.onNetworkLost();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'network');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
    expect(f.state.callOptions?.resumeOf).toBe('vs-1');
  });

  it('waits for the browser to be online before resuming', async () => {
    const { f } = await inCall();
    f.state.online = false;
    f.state.callOptions?.onNetworkLost();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    f.state.online = true;
    f.state.lifecycle?.onOnline();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
  });
});

describe('VoiceController — page lifecycle', () => {
  it('freeze reports voice.frozen and drops the call; resume re-arms silently and says back', async () => {
    const { f, c } = await inCall();
    f.state.lifecycle?.onFreeze();
    expect(f.sent('voice.frozen')).toHaveLength(1);
    expect(c.state.mode).toBe('frozen');
    expect(c.store.getSnapshot().orb).toBe('frozen');
    expect(f.call.close).toHaveBeenCalled();
    f.state.lifecycle?.onResume();
    expect(c.state.mode).toBe('armed');
    expect(f.sent('voice.resumed')).toHaveLength(1);
    expect(f.earcons()).toContain('back');
  });

  it('re-acquires the wake lock when the page becomes visible', async () => {
    const { f } = await armed();
    f.state.lifecycle?.onVisible();
    expect(f.fx.wakeLock.reacquireIfWanted).toHaveBeenCalled();
  });
});

describe('VoiceController — drafts and read-back', () => {
  it('a confirm tap carries draft id, version and hash', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    c.confirmDraft();
    expect(f.sent('voice.confirmTap')[0]).toMatchObject({ draftId: 'd1', version: 1, hash: 'h1' });
  });

  it('never confirms a draft without a hash', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ hash: null }) });
    c.confirmDraft();
    expect(f.sent('voice.confirmTap')).toHaveLength(0);
    expect(c.store.getSnapshot().notice?.code).toBe('cannotConfirm');
  });

  it('cannot confirm once the draft is committing, but can still cancel', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'committing' }) });
    c.confirmDraft();
    c.cancelDraft();
    expect(f.sent('voice.confirmTap')).toHaveLength(0);
    expect(f.sent('voice.cancelTap')[0]).toMatchObject({ draftId: 'd1', version: 1, hash: 'h1' });
    expect(c.store.getSnapshot().holdUntil).not.toBeNull();
  });

  it('ignores a stale draft version', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ version: 2, text: 'v2' }) });
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ version: 1, text: 'v1' }) });
    expect(c.store.getSnapshot().draft?.text).toBe('v2');
  });

  it('plays the read-back clip and reports playbackFinished with the context-clock tEnd', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    f.frame({
      name: 'voice.readbackReady',
      voiceSessionId: 'vs-1',
      draftId: 'd1',
      version: 1,
      readbackId: 'rb1',
      url: '/api/voice/readbacks/rb1',
    });
    await flush();
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('/api/voice/readbacks/rb1');
    expect(f.sent('voice.playbackFinished')[0]).toMatchObject({ readbackId: 'rb1', tEnd: 12.5 });
    expect(f.earcons()).toContain('yourTurn');
  });

  it('does not report a truncated clip as finished', async () => {
    const { f } = await inCall();
    f.clips.play.mockResolvedValueOnce({ completed: false, tStart: 11, tEnd: 11.4 });
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    f.frame({
      name: 'voice.readbackReady',
      voiceSessionId: 'vs-1',
      draftId: 'd1',
      version: 1,
      readbackId: 'rb1',
      url: '',
    });
    await flush();
    expect(f.sent('voice.playbackFinished')).toHaveLength(0);
  });

  it('ignores a read-back for a version that is no longer shown', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ version: 2 }) });
    f.frame({
      name: 'voice.readbackReady',
      voiceSessionId: 'vs-1',
      draftId: 'd1',
      version: 1,
      readbackId: 'rb1',
      url: '',
    });
    await flush();
    expect(f.fx.api.fetchClip).not.toHaveBeenCalled();
  });

  it('pauses the wake word while a clip plays', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    f.frame({
      name: 'voice.readbackReady',
      voiceSessionId: 'vs-1',
      draftId: 'd1',
      version: 1,
      readbackId: 'rb1',
      url: '',
    });
    await flush();
    // exactly while the clip is heard (tEnd incl. output latency) + 0.3 s, replacing older windows
    expect(f.fx.wakeWord.suppress).toHaveBeenCalledWith(12.8, true);
    expect(f.fx.wakeWord.suppress).not.toHaveBeenCalledWith(40);
  });

  it('plays the sent tone once and clears the card after a while', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'sent' }) });
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'sent' }) });
    expect(f.earcons().filter((e) => e === 'sent')).toHaveLength(1);
    vi.advanceTimersByTime(DRAFT_LINGER_MS + 1);
    expect(c.store.getSnapshot().draft).toBeNull();
  });

  it('forwards local VAD speech onsets only while a call exists', async () => {
    const { f } = await armed();
    f.state.wakeEvents?.onVad(true, 5);
    expect(f.sent('voice.speechOnset')).toHaveLength(0);
    f.state.wakeEvents?.onWake(9.2, 0.9);
    await flush();
    f.state.wakeEvents?.onVad(true, 12.9);
    f.state.wakeEvents?.onVad(false, 13.4);
    expect(f.sent('voice.speechOnset')).toEqual([{ name: 'voice.speechOnset', t: 12.9 }]);
  });
});

describe('VoiceController — follow-ups, budget, errors', () => {
  it('a needs-approval follow-up plays the needs-you tone, lists it and plays its clip', async () => {
    const { f, c } = await armed();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'needs_approval',
      line: 'Kanban build needs approval',
      clipId: 'clip9',
    });
    expect(f.earcons()).toContain('needsYou');
    expect(c.store.getSnapshot().followUps[0]).toMatchObject({ conversationId: 'c9', status: 'needs_approval' });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('clip9');
  });

  it('holds a follow-up clip while a draft awaits confirmation and plays it once the draft is sent', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'finished',
      line: 'x',
      clipId: 'clip9',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('clip9');
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'sent' }) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('clip9');
  });

  it('a follow-up never cuts a read-back that is playing', async () => {
    const { f } = await inCall();
    const readback = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
    f.clips.play.mockImplementationOnce(() => readback.promise);
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'confirmed' }) });
    f.frame({
      name: 'voice.readbackReady',
      voiceSessionId: 'vs-1',
      draftId: 'd1',
      version: 1,
      readbackId: 'rb1',
      url: '',
    });
    await flush();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'says',
      line: 'x',
      clipId: 'clip9',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.clips.play).toHaveBeenCalledTimes(1);
    expect(f.clips.stop).not.toHaveBeenCalled();
    readback.resolve({ completed: true, tStart: 11, tEnd: 12.5 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.clips.play).toHaveBeenCalledTimes(2);
  });

  describe('minimax-cascade answer clips (TASK-91)', () => {
    const reply = (clipId: string, line = 'Sure.') =>
      ({ name: 'voice.followUp', voiceSessionId: 'vs-1', conversationId: '', status: 'reply', line, clipId }) as const;

    it('plays reply clips in order with no tone and no follow-up entry', async () => {
      const { f, c } = await inCall();
      const before = f.earcons().length;
      f.frame(reply('k1'));
      f.frame(reply('k2', 'Done.'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.fx.api.fetchClip.mock.calls.map(([id]) => id)).toEqual(['k1', 'k2']);
      expect(f.clips.play).toHaveBeenCalledTimes(2);
      expect(f.earcons().slice(before)).toEqual([]);
      expect(c.store.getSnapshot().followUps).toEqual([]);
    });

    it("plays Jarvis's answer while a draft awaits confirmation", async () => {
      const { f } = await inCall();
      f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
      f.frame(reply('k1', 'Shall I send it?'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.fx.api.fetchClip).toHaveBeenCalledWith('k1');
    });

    it('a barge-in stops the playing reply and drops the queued ones', async () => {
      const { f } = await inCall();
      const playing = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
      f.clips.play.mockImplementationOnce(() => playing.promise);
      f.clips.stop.mockImplementation(() => playing.resolve({ completed: false, tStart: 1, tEnd: 1.2 }));
      f.frame(reply('k1'));
      f.frame(reply('k2'));
      await vi.advanceTimersByTimeAsync(100);
      expect(f.clips.play).toHaveBeenCalledTimes(1);
      // You start to speak: the backend says `listening` (not after assistantAudioFinished).
      f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'listening', reason: null });
      expect(f.clips.stop).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('k2');
      expect(f.clips.play).toHaveBeenCalledTimes(1);
    });

    it('the end of the answer (listening after assistantAudioFinished) keeps the clips playing', async () => {
      const { f } = await inCall();
      const playing = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
      f.clips.play.mockImplementationOnce(() => playing.promise);
      f.frame(reply('k1'));
      f.frame(reply('k2'));
      await vi.advanceTimersByTimeAsync(100);
      f.frame({ name: 'voice.assistantAudioFinished', voiceSessionId: 'vs-1', responseId: 'r1' });
      f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'listening', reason: null });
      expect(f.clips.stop).not.toHaveBeenCalled();
      playing.resolve({ completed: true, tStart: 1, tEnd: 2 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.fx.api.fetchClip).toHaveBeenCalledWith('k2');
      expect(f.clips.play).toHaveBeenCalledTimes(2);
    });

    it('a barge-in leaves an agent follow-up clip alone', async () => {
      const { f } = await inCall();
      const playing = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
      f.clips.play.mockImplementationOnce(() => playing.promise);
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: null,
        conversationId: 'c9',
        status: 'says',
        line: 'x',
        clipId: 'clip9',
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.clips.play).toHaveBeenCalledTimes(1);
      f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'listening', reason: null });
      expect(f.clips.stop).not.toHaveBeenCalled();
      playing.resolve({ completed: true, tStart: 1, tEnd: 2 });
    });
  });

  describe('minimax-cascade turn end and unvoiced lines (TASK-105)', () => {
    const reply = (clipId: string | null, line = 'Sure.') =>
      ({ name: 'voice.followUp', voiceSessionId: 'vs-1', conversationId: '', status: 'reply', line, clipId }) as const;
    const finished = { name: 'voice.assistantAudioFinished', voiceSessionId: 'vs-1', responseId: 'r1' } as const;

    async function cascadeCall() {
      const { f, c } = await armed();
      f.state.wakeEvents?.onWake(9.2, 0.9);
      await flush();
      f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'minimax-cascade', model: 'm' });
      return { f, c };
    }
    const yourTurns = (f: Awaited<ReturnType<typeof cascadeCall>>['f']) =>
      f.earcons().filter((name) => name === 'yourTurn').length;

    it('"your turn" waits until the last reply clip has finished', async () => {
      const { f } = await cascadeCall();
      const first = Promise.withResolvers<{ completed: boolean; tStart: number; tEnd: number }>();
      f.clips.play.mockImplementationOnce(() => first.promise);
      f.frame(reply('k1'));
      await vi.advanceTimersByTimeAsync(100);
      // The brain is done while the first sentence still plays and the second is in synthesis.
      f.frame(finished);
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS * 3);
      expect(yourTurns(f)).toBe(0);
      first.resolve({ completed: true, tStart: 1, tEnd: 2 });
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS / 2);
      f.frame(reply('k2', 'Done.'));
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS - 1);
      expect(f.clips.play).toHaveBeenCalledTimes(2);
      expect(yourTurns(f)).toBe(0);
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS);
      expect(yourTurns(f)).toBe(1);
    });

    it('"your turn" also waits for a first clip that arrives after the brain is done', async () => {
      const { f } = await cascadeCall();
      f.frame(finished);
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS / 2);
      f.frame(reply('k1'));
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS - 1);
      expect(f.clips.play).toHaveBeenCalledTimes(1);
      expect(yourTurns(f)).toBe(0);
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS);
      expect(yourTurns(f)).toBe(1);
    });

    it('a barge-in cancels the pending "your turn"', async () => {
      const { f } = await cascadeCall();
      f.frame(reply('k1'));
      f.frame(finished);
      f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'listening', reason: null });
      // That `listening` ended the answer; now you start to speak.
      f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'listening', reason: null });
      await vi.advanceTimersByTimeAsync(REPLY_SETTLE_MS * 3);
      expect(yourTurns(f)).toBe(0);
    });

    it('the realtime engine keeps the immediate "your turn"', async () => {
      const { f } = await inCall();
      f.frame(finished);
      await vi.advanceTimersByTimeAsync(100);
      expect(f.earcons()).toContain('yourTurn');
    });

    it("a reply line without a clip is shown as Jarvis's caption, then replaced by the transcript", async () => {
      const { f, c } = await cascadeCall();
      f.frame(reply(null, 'Say "send it" to send.'));
      f.frame(reply(null, 'Or tap the card.'));
      expect(c.store.getSnapshot().captions.at(-1)).toMatchObject({
        role: 'assistant',
        text: 'Say "send it" to send. Or tap the card.',
        final: false,
      });
      const answer = 'Here is the draft. Say "send it" to send. Or tap the card.';
      f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'assistant', text: answer, final: true });
      const assistant = c.store.getSnapshot().captions.filter((caption) => caption.role === 'assistant');
      expect(assistant).toEqual([expect.objectContaining({ text: answer, final: true })]);
      // A line that arrives after the transcript (slow synthesis that failed) is not shown twice.
      f.frame(reply(null, 'Or tap the card.'));
      expect(c.store.getSnapshot().captions.filter((caption) => caption.role === 'assistant')).toHaveLength(1);
      expect(c.store.getSnapshot().followUps).toEqual([]);
    });
  });

  it('keeps only the five most recent follow-ups', async () => {
    const { f, c } = await armed();
    for (let i = 0; i < 7; i++) {
      f.frame({
        name: 'voice.followUp',
        voiceSessionId: null,
        conversationId: `c${i}`,
        status: 'finished',
        line: '',
        clipId: null,
      });
    }
    expect(c.store.getSnapshot().followUps.map((x) => x.conversationId)).toEqual(['c6', 'c5', 'c4', 'c3', 'c2']);
  });

  it('stores the budget frame', async () => {
    const { f, c } = await armed();
    f.frame({ name: 'voice.budget', voiceSessionId: null, usedUsd: 4.1, limitUsd: 5, warning: '80' });
    expect(c.store.getSnapshot().budget).toEqual({ usedUsd: 4.1, limitUsd: 5, warning: '80' });
    expect(c.store.getSnapshot().notice).toBeNull();
  });

  it('a kill-switch error disarms', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.error', voiceSessionId: null, code: 'voice_disabled', message: 'off' });
    expect(c.state.mode).toBe('off');
    expect(c.store.getSnapshot().notice?.code).toBe('disabled');
  });

  it('turning voice off in settings disarms an armed device', async () => {
    const { c } = await armed();
    await c.saveSettings({ enabled: false });
    expect(c.state.mode).toBe('off');
  });

  it('caption partials are replaced in place and finals appended', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'run', final: false });
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'run the tests', final: true });
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'assistant', text: 'ok', final: true });
    expect(c.store.getSnapshot().captions.map((x) => x.text)).toEqual(['run the tests', 'ok']);
  });

  it('user mute silences the worklet and unmute resumes live audio', async () => {
    const { f, c } = await inCall();
    f.capture.mute.mockClear();
    f.capture.setLive.mockClear();
    c.toggleMute();
    expect(f.capture.mute).toHaveBeenCalled();
    c.toggleMute();
    expect(f.capture.setLive).toHaveBeenCalledWith(undefined);
  });
});

describe('VoiceController — hold display, pre-roll metric, settings cache', () => {
  it('drives the hold countdown from the backend and stops it while frozen', async () => {
    const { f, c } = await inCall();
    f.frame({
      name: 'voice.draftUpdated',
      voiceSessionId: 'vs-1',
      ...draft({ state: 'committing', holdRemainingMs: 2500 }),
    });
    expect(c.store.getSnapshot().holdUntil).toBe(Date.now() + 2500);
    f.frame({
      name: 'voice.draftUpdated',
      voiceSessionId: 'vs-1',
      ...draft({ state: 'committing', holdFrozen: true }),
    });
    expect(c.store.getSnapshot().holdUntil).toBeNull();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'committing' }) });
    expect(c.store.getSnapshot().holdUntil).toBe(Date.now() + 1000);
  });

  it('records the pre-roll replay metric from the send worklet', async () => {
    const { f, c } = await inCall();
    f.state.captureOptions?.onSendMode?.({ type: 'mode', mode: 'catchup', jumped: false, lagSec: 1.4, catchupSec: 0 });
    f.state.captureOptions?.onSendMode?.({ type: 'mode', mode: 'live', jumped: true, lagSec: 0.3, catchupSec: 2.1 });
    expect(c.store.getSnapshot().preroll).toEqual({ lagSec: 1.4, catchupSec: 2.1, jumped: true, droppedSec: 0.3 });
  });

  it('fetches settings at most once per page session for the page chrome', async () => {
    const f = createFakeEffects();
    const c = new VoiceController(f.fx);
    await Promise.all([c.ensureSettings(), c.ensureSettings()]);
    await c.ensureSettings();
    expect(f.fx.api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed settings fetch on every mount', async () => {
    const f = createFakeEffects();
    f.fx.api.getSettings.mockRejectedValue(new Error('404'));
    const c = new VoiceController(f.fx);
    await c.ensureSettings();
    await c.ensureSettings();
    expect(f.fx.api.getSettings).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await c.ensureSettings();
    expect(f.fx.api.getSettings).toHaveBeenCalledTimes(2);
  });
});

describe('VoiceController — S1b: call end reasons', () => {
  it('rotation re-dials at once with resume_of and no notice', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'rotation' });
    expect(f.fx.api.endSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
    expect(f.state.callOptions?.resumeOf).toBe('vs-1');
    expect(c.store.getSnapshot().notice).toBeNull();
  });

  it('the kill switch (reason disabled) disarms and says voice is off', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'disabled' });
    expect(c.state.mode).toBe('off');
    expect(c.store.getSnapshot().notice?.code).toBe('disabled');
  });

  it('idle and dropped calls stay armed with a notice', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    expect(c.state.mode).toBe('armed');
    expect(c.store.getSnapshot().notice?.code).toBe('callIdle');
    c.talk();
    await flush();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'control_lost' });
    expect(c.state.call).toBeNull();
    expect(c.store.getSnapshot().notice?.code).toBe('callDropped');
  });

  it('a revoked session says so; a 100 % budget frame shows the budget notice', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.error', voiceSessionId: null, code: 'AUTH_EXPIRED', message: 'Your session ended.' });
    expect(c.store.getSnapshot().notice?.code).toBe('unauthorized');
    f.frame({ name: 'voice.budget', voiceSessionId: 'vs-1', usedUsd: 5, limitUsd: 5, warning: '100' });
    expect(c.store.getSnapshot().notice?.code).toBe('budget');
  });
});

describe('VoiceController — S1b: drafts', () => {
  it('sends one confirm tap per draft version; a new state allows the next tap', async () => {
    const { f, c } = await inCall();
    f.state.socketOpen = true;
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    c.confirmDraft();
    c.confirmDraft();
    expect(f.sent('voice.confirmTap')).toHaveLength(1);
    expect(c.store.getSnapshot().draftTap).toBe('confirm');
    // Cancel still wins over a pending Send.
    c.cancelDraft();
    c.cancelDraft();
    expect(f.sent('voice.cancelTap')).toHaveLength(1);
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ version: 2 }) });
    expect(c.store.getSnapshot().draftTap).toBeNull();
    c.confirmDraft();
    expect(f.sent('voice.confirmTap')).toHaveLength(2);
    expect(f.sent('voice.confirmTap')[1]).toMatchObject({ version: 2 });
  });

  it('keeps draft frames of an earlier session (outcome after a resume)', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-old', ...draft({ state: 'queued' }) });
    expect(c.store.getSnapshot().draft?.state).toBe('queued');
  });

  it('still drops captions of another session', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-old', role: 'user', text: 'old', final: true });
    expect(c.store.getSnapshot().captions).toHaveLength(0);
  });

  it('a refused spoken "send" is played at once although the draft awaits confirmation', async () => {
    const { f, c } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft() });
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: 'vs-1',
      conversationId: 'c1',
      status: 'confirm_rejected',
      line: 'Say it again, or tap the card.',
      clipId: 'clipR',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('clipR');
    expect(c.store.getSnapshot().draftHint).toBe('Say it again, or tap the card.');
    expect(c.store.getSnapshot().followUps).toHaveLength(0);
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'committing' }) });
    expect(c.store.getSnapshot().draftHint).toBeNull();
  });

  it('an agent line still waits while an ambiguous draft asks "A or B?"', async () => {
    const { f } = await inCall();
    f.frame({ name: 'voice.draftUpdated', voiceSessionId: 'vs-1', ...draft({ state: 'ambiguous', target: null }) });
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'says',
      line: 'x',
      clipId: 'clipS',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('clipS');
  });
});

describe('VoiceController — S1b: server wake and agent ask', () => {
  it('a follow-up and the wake after it play their single-use clip once', async () => {
    const { f } = await armed();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'finished',
      line: 'Kanban build finished.',
      clipId: 'clipF',
    });
    f.frame({ name: 'voice.wake', voiceSessionId: null, reason: 'follow_up', itemId: 'clipF' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip.mock.calls.filter((call) => call[0] === 'clipF')).toHaveLength(1);
    expect(f.fx.startCall).not.toHaveBeenCalled();
  });

  it('a wake whose follow-up was missed still plays the clip, without opening a call', async () => {
    const { f, c } = await armed();
    f.frame({ name: 'voice.wake', voiceSessionId: null, reason: 'says', itemId: 'clipW' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('clipW');
    expect(f.fx.startCall).not.toHaveBeenCalled();
    expect(c.store.getSnapshot().overlayOpen).toBe(true);
  });

  it('an ask without a call plays the question, then opens a call that hangs up after the answer', async () => {
    const { f, c } = await armed();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'asks',
      line: 'Kanban build asks: which branch?',
      clipId: 'clipA',
    });
    f.frame({ name: 'voice.wake', voiceSessionId: null, reason: 'asks', itemId: 'clipA' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('clipA');
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    expect(c.store.getSnapshot().asking).toBe(true);
    await flush();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'main', final: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(c.state.call).not.toBeNull();
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'main', final: true });
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.state.call).toBeNull();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'user');
    expect(c.store.getSnapshot().asking).toBe(false);
    expect(c.state.mode).toBe('armed');
  });

  it('an ask call that cannot start (busy) leaves answer mode', async () => {
    const { f, c } = await armed();
    f.fx.startCall.mockRejectedValueOnce(new VoiceBusyError());
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'asks',
      line: 'q',
      clipId: null,
    });
    await flush();
    expect(c.state.call).toBeNull();
    expect(c.store.getSnapshot().asking).toBe(false);
    expect(c.store.getSnapshot().notice?.code).toBe('busy');
  });

  it('an unanswered ask call closes after 2 minutes', async () => {
    const { f, c } = await armed();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'asks',
      line: 'q',
      clipId: null,
    });
    await flush();
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
    await vi.advanceTimersByTimeAsync(119_000);
    expect(c.state.call).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(c.state.call).toBeNull();
  });

  it('an ask during a live call is answered in that call (no extra call, no auto hang-up)', async () => {
    const { f, c } = await inCall();
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c9',
      status: 'asks',
      line: 'q',
      clipId: 'clipQ',
    });
    await vi.advanceTimersByTimeAsync(1000);
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'yes', final: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    expect(c.state.call?.phase).toBe('ready');
    expect(c.store.getSnapshot().asking).toBe(false);
  });
});

describe('VoiceController — mic level fallback (TASK-106)', () => {
  /** The `ended` callback of the most recently opened mic. */
  const endMic = (f: ReturnType<typeof createFakeEffects>) => {
    const end = f.state.captureOptions?.onTrackEnded;
    expect(end).toBeTypeOf('function');
    end?.();
  };

  it('an early track end re-arms silently one level lower instead of reporting micLost', async () => {
    const { f, c } = await armed();
    expect(f.state.captureLevels).toEqual(['all']);
    vi.advanceTimersByTime(MIC_EARLY_END_MS - 1000);
    endMic(f);
    await flush();
    expect(f.state.captureLevels).toEqual(['all', 'standard']);
    expect(c.store.getSnapshot().notice).toBeNull();
    expect(c.state.mode).not.toBe('off');
    expect(f.capture.stop).toHaveBeenCalledTimes(1);
    f.openSocket();
    expect(c.state.mode).toBe('armed');
  });

  it('a late track end is a lost microphone, as before', async () => {
    const { f, c } = await armed();
    vi.advanceTimersByTime(MIC_EARLY_END_MS + 1);
    endMic(f);
    await flush();
    expect(f.state.captureLevels).toEqual(['all']);
    expect(c.store.getSnapshot().notice?.code).toBe('micLost');
    expect(c.state.mode).toBe('off');
  });

  it('falls back all → standard → plain, then reports micLost (two automatic re-arms per user arm)', async () => {
    const { f, c } = await armed();
    endMic(f);
    await flush();
    endMic(f);
    await flush();
    expect(f.state.captureLevels).toEqual(['all', 'standard', 'plain']);
    expect(c.store.getSnapshot().notice).toBeNull();
    endMic(f);
    await flush();
    expect(f.state.captureLevels).toEqual(['all', 'standard', 'plain']);
    expect(c.store.getSnapshot().notice?.code).toBe('micLost');
    expect(c.state.mode).toBe('off');

    // A new user arm gets the full allowance again.
    c.arm();
    await flush();
    expect(f.state.captureLevels).toHaveLength(4);
  });

  it('starts from the stored level and remembers a level once it outlived the early window', async () => {
    const f = createFakeEffects();
    f.state.storedMicLevel = 'standard';
    const c = new VoiceController(f.fx);
    c.arm();
    await flush();
    expect(f.state.captureLevels).toEqual(['standard']);
    endMic(f);
    await flush();
    expect(f.state.captureLevels).toEqual(['standard', 'plain']);
    expect(f.fx.micLevelStore.set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIC_EARLY_END_MS);
    expect(f.fx.micLevelStore.set).toHaveBeenCalledWith('plain');
    expect(f.state.storedMicLevel).toBe('plain');
    // Plain ended early as well: nothing weaker is left.
    endMic(f);
    await flush();
    expect(c.store.getSnapshot().notice?.code).toBe('micLost');
  });

  it('stores the working level only after the early window and ignores the released mic', async () => {
    const { f } = await armed();
    const firstEnd = f.state.captureOptions?.onTrackEnded;
    vi.advanceTimersByTime(MIC_EARLY_END_MS - 1);
    expect(f.fx.micLevelStore.set).not.toHaveBeenCalled();
    endMic(f);
    await flush();
    // The stale callback of the released `all` mic changes nothing.
    firstEnd?.();
    await flush();
    expect(f.state.captureLevels).toEqual(['all', 'standard']);
    vi.advanceTimersByTime(MIC_EARLY_END_MS);
    expect(f.fx.micLevelStore.set).toHaveBeenCalledTimes(1);
    expect(f.fx.micLevelStore.set).toHaveBeenCalledWith('standard');
  });
});

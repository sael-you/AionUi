import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceController, SOCKET_DEAD_MAN_MS, DRAFT_LINGER_MS } from '@/renderer/voice/core/VoiceController';
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
    f.frame({ name: 'voice.budget', voiceSessionId: null, usedUsd: 4.1, limitUsd: 5, warning: true });
    expect(c.store.getSnapshot().budget).toEqual({ usedUsd: 4.1, limitUsd: 5, warning: true });
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

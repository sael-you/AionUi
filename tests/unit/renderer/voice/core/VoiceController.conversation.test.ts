/**
 * Conversation voice mode (C26, D51): `/voice` and the composer mic bind voice to THIS
 * conversation; the transcript is posted (new turn or added mid-turn), the agent speaks when it
 * decides, "Hey Jarvis" or a tap barges in, a bare "stop" silences, "stop the task" cancels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_WINDOW_MS,
  BINDING_GRACE_MS,
  FOLLOW_UP_WINDOW_MS,
  LISTEN_WINDOW_MS,
  VoiceController,
} from '@/renderer/voice/core/VoiceController';
import type { FollowUpStatus } from '@/renderer/voice/core/types';
import { createFakeEffects, flush } from '../fakes';

type Outcome = { completed: boolean; tStart: number; tEnd: number };

async function conversationArmed(settings?: Parameters<typeof createFakeEffects>[0]) {
  const f = createFakeEffects(settings);
  const c = new VoiceController(f.fx);
  c.toggle({ focusConversationId: 'c1', mode: 'conversation' });
  await flush();
  f.openSocket();
  await flush();
  return { f, c };
}

/** Armed, the auto-opened call is ready and listening. */
async function listening(settings?: Parameters<typeof createFakeEffects>[0]) {
  const { f, c } = await conversationArmed(settings);
  f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
  return { f, c };
}

function followUp(
  f: ReturnType<typeof createFakeEffects>,
  status: FollowUpStatus,
  clipId: string | null = null,
  conversationId = 'c1'
) {
  f.frame({ name: 'voice.followUp', voiceSessionId: 'vs-1', conversationId, status, line: `line ${status}`, clipId });
}

/** A clip that keeps playing until `clips.stop()` (barge-in) or `finish()`. */
function hangingClip(f: ReturnType<typeof createFakeEffects>) {
  const playing = Promise.withResolvers<Outcome>();
  f.clips.play.mockImplementationOnce(async (_data, options) => {
    options?.onStart?.(11, 14);
    return playing.promise;
  });
  f.clips.stop.mockImplementation(() => playing.resolve({ completed: false, tStart: 11, tEnd: 12 }));
  return { finish: () => playing.resolve({ completed: true, tStart: 11, tEnd: 14 }) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('conversation voice mode — start (rule 1)', () => {
  it('/voice or the composer mic arms conversation mode and opens a bound call at once, no wake word', async () => {
    const { f, c } = await conversationArmed();
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    expect(f.state.callOptions).toMatchObject({ mode: 'conversation', focusConversationId: 'c1' });
    const view = c.store.getSnapshot();
    expect(view.voiceMode).toBe('conversation');
    expect(view.focusConversationId).toBe('c1');
    // The bar above the composer, not the Jarvis panel.
    expect(view.overlayOpen).toBe(false);
    // The wake word stays live during the call (barge-in), never switched to VAD-only.
    expect(f.fx.wakeWord.setMode).not.toHaveBeenCalledWith('vad');
  });

  it('Jarvis (orb / Alt+J) arms without a mode and opens no call until the wake word', async () => {
    const f = createFakeEffects();
    const c = new VoiceController(f.fx);
    c.toggle();
    await flush();
    f.openSocket();
    await flush();
    expect(c.store.getSnapshot().voiceMode).toBe('jarvis');
    expect(f.fx.startCall).not.toHaveBeenCalled();
    f.state.wakeEvents?.onWake(9.2, 0.9);
    await flush();
    expect(f.state.callOptions?.mode).toBeUndefined();
  });

  it('the orb while conversation mode is on switches to Jarvis (one live session); the same mic again ends it', async () => {
    const { f, c } = await listening();
    c.toggle();
    expect(f.fx.api.endSession).toHaveBeenCalledWith('vs-1', 'disarm');
    expect(c.store.getSnapshot().voiceMode).toBe('jarvis');
    c.disarm('tap');
    const again = await conversationArmed();
    again.c.toggle({ focusConversationId: 'c1', mode: 'conversation' });
    expect(again.c.state.mode).toBe('off');
  });

  it('opens the mic with a listen window that speech keeps open, then goes quiet', async () => {
    const { f, c } = await listening();
    expect(c.state.held).toBe(false);
    expect(f.capture.setLive).toHaveBeenCalled();
    f.state.wakeEvents?.onVad(true, 12);
    await vi.advanceTimersByTimeAsync(LISTEN_WINDOW_MS + 1000);
    expect(c.state.held).toBe(false);
    f.state.wakeEvents?.onVad(false, 20);
    await vi.advanceTimersByTimeAsync(LISTEN_WINDOW_MS + 1000);
    expect(c.state.held).toBe(true);
    expect(f.capture.mute).toHaveBeenCalled();
  });
});

describe('conversation voice mode — your words go in (rule 2)', () => {
  it.each([
    ['sent', 'a new turn'],
    ['added', 'added to the running turn'],
    ['queued', 'queued behind an approval'],
  ] as const)('%s (%s): the outcome is shown, "got it" tone, the mic goes quiet', async (status) => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.caption', voiceSessionId: 'vs-1', role: 'user', text: 'also run the tests', final: true });
    followUp(f, status);
    const view = c.store.getSnapshot();
    expect(view.lastOutcome).toEqual({ status, line: `line ${status}` });
    expect(view.captions.at(-1)?.text).toBe('also run the tests');
    expect(f.earcons()).toContain('gotIt');
    expect(c.state.held).toBe(true);
    // Not a Jarvis follow-up row.
    expect(view.followUps).toEqual([]);
  });

  it('Done sends voice.commit while listening, never while the mic is quiet', async () => {
    const { f, c } = await listening();
    c.commitUtterance();
    expect(f.sent('voice.commit')).toEqual([{ name: 'voice.commit' }]);
    followUp(f, 'sent');
    c.commitUtterance();
    expect(f.sent('voice.commit')).toHaveLength(1);
  });

  it('lines about another conversation keep the Jarvis follow-up path', async () => {
    const { f, c } = await listening();
    followUp(f, 'finished', null, 'c9');
    expect(c.store.getSnapshot().followUps[0]).toMatchObject({ conversationId: 'c9' });
    expect(c.store.getSnapshot().lastOutcome).toBeNull();
  });
});

describe('conversation voice mode — the agent speaks (rule 3)', () => {
  it('plays the agent clip only once your utterance is posted (never over an open mic)', async () => {
    const { f, c } = await listening();
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(500);
    expect(f.clips.play).not.toHaveBeenCalled();
    followUp(f, 'added');
    await vi.advanceTimersByTimeAsync(500);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('say1');
    expect(f.clips.play).toHaveBeenCalledTimes(1);
    expect(c.store.getSnapshot().agentSpeaking).toBe(false);
  });

  it('shows "speaking" while the clip plays', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const clip = hangingClip(f);
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(200);
    expect(c.store.getSnapshot().agentSpeaking).toBe(true);
    clip.finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(c.store.getSnapshot().agentSpeaking).toBe(false);
  });

  it('turn end: the agent line plays first, then the follow-up window opens and closes', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const clip = hangingClip(f);
    followUp(f, 'finished', 'fin1');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.clips.play).toHaveBeenCalledTimes(1);
    expect(c.state.held).toBe(true);
    clip.finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_WINDOW_MS + 100);
    expect(c.state.held).toBe(true);
  });

  it('an agent question opens a longer answer window after it was heard', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    followUp(f, 'asks', 'ask1');
    await vi.advanceTimersByTimeAsync(600);
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(ASK_WINDOW_MS - 1000);
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state.held).toBe(true);
  });

  it('a turn end without a clip plays the tone and opens the window', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    followUp(f, 'needs_approval');
    expect(f.earcons()).toContain('needsYou');
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('needs_approval');
    expect(c.state.held).toBe(false);
  });
});

describe('conversation voice mode — barge-in (rule 4)', () => {
  it('"Hey Jarvis" during a clip stops it at once and opens the mic from the wake moment', async () => {
    const { f, c } = await listening({ enabled: true });
    (f.capture.trackSettings as MediaTrackSettings).echoCancellation = 'all' as unknown as boolean;
    followUp(f, 'sent');
    hangingClip(f);
    followUp(f, 'says', 'say1');
    followUp(f, 'says', 'say2');
    await vi.advanceTimersByTimeAsync(200);
    expect(c.store.getSnapshot().agentSpeaking).toBe(true);
    f.capture.setLive.mockClear();
    f.state.wakeEvents?.onWake(13.1, 0.9);
    expect(f.clips.stop).toHaveBeenCalledTimes(1);
    expect(c.state.held).toBe(false);
    expect(f.capture.setLive).toHaveBeenCalledWith(13.1);
    expect(f.earcons()).toContain('listening');
    await vi.advanceTimersByTimeAsync(1000);
    // The queued line is dropped, not played over you.
    expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('say2');
    expect(c.store.getSnapshot().agentSpeaking).toBe(false);
    // What you say next is added mid-turn by the backend.
    followUp(f, 'added');
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('added');
    expect(c.state.held).toBe(true);
  });

  it('with full echo cancellation the wake word stays live during the clip', async () => {
    const { f } = await listening();
    (f.capture.trackSettings as MediaTrackSettings).echoCancellation = 'all' as unknown as boolean;
    followUp(f, 'sent');
    f.fx.wakeWord.suppress.mockClear();
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.clips.play).toHaveBeenCalled();
    expect(f.fx.wakeWord.suppress.mock.calls.some((call) => call[1] === true)).toBe(false);
  });

  it('without it the wake word is suppressed during the clip (tap only)', async () => {
    const { f } = await listening();
    (f.capture.trackSettings as MediaTrackSettings).echoCancellation = true;
    followUp(f, 'sent');
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.wakeWord.suppress).toHaveBeenCalledWith(12.8, true);
  });

  it('a tap while the agent works opens the mic (no clip playing)', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    expect(c.state.held).toBe(true);
    c.talk();
    expect(c.state.held).toBe(false);
    expect(f.fx.startCall).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LISTEN_WINDOW_MS + 100);
    expect(c.state.held).toBe(true);
  });

  it('a clip still being fetched at the barge-in is dropped, never played later', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const fetched = Promise.withResolvers<ArrayBuffer>();
    f.fx.api.fetchClip.mockImplementationOnce(() => fetched.promise);
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(10);
    c.talk();
    fetched.resolve(new ArrayBuffer(8));
    await vi.advanceTimersByTimeAsync(LISTEN_WINDOW_MS + 1000);
    expect(f.clips.play).not.toHaveBeenCalled();
  });

  it('a tap during a clip with no live call stops the clip and dials', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' });
    expect(c.state.call).toBeNull();
    expect(c.state.mode).toBe('armed');
    hangingClip(f);
    f.frame({ name: 'voice.wake', voiceSessionId: null, reason: 'says', itemId: 'say1' });
    await vi.advanceTimersByTimeAsync(200);
    c.talk();
    expect(f.clips.stop).toHaveBeenCalled();
    await flush();
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
    expect(f.state.callOptions?.mode).toBe('conversation');
  });
});

describe('conversation voice mode — stop vs cancel (rule 5)', () => {
  it('a bare "stop" (silenced) stops the speech only', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    hangingClip(f);
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(200);
    followUp(f, 'silenced');
    expect(f.clips.stop).toHaveBeenCalled();
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('silenced');
    expect(c.state.mode).toBe('armed');
    expect(c.state.call).not.toBeNull();
  });

  it('"stop the task" (stopped) drops queued speech and plays only the "Stopped." clip', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    hangingClip(f);
    followUp(f, 'says', 'say1');
    followUp(f, 'says', 'say2');
    await vi.advanceTimersByTimeAsync(200);
    followUp(f, 'stopped', 'stop1');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('stop1');
    expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('say2');
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('stopped');
  });

  it('only "stop voice" (sleep), End voice or the kill switch end voice mode', async () => {
    const a = await listening();
    a.f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'sleep' });
    expect(a.c.state.mode).toBe('off');
    const b = await listening();
    b.c.disarm('tap');
    expect(b.c.state.mode).toBe('off');
    const k = await listening();
    k.f.frame({ name: 'voice.error', voiceSessionId: null, code: 'voice_disabled', message: 'off' });
    expect(k.c.state.mode).toBe('off');
  });
});

describe('conversation voice mode — idle, failures, restart (director decisions)', () => {
  it('3 idle minutes end the CALL only: still armed, wake word live, a wake re-opens the same conversation', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    expect(c.state.mode).toBe('armed');
    expect(c.state.call).toBeNull();
    expect(c.store.getSnapshot().voiceMode).toBe('conversation');
    expect(c.store.getSnapshot().notice?.code).toBe('conversationIdle');
    expect(f.earcons()).not.toContain('bye');
    expect(f.fx.wakeWord.setMode).toHaveBeenLastCalledWith('wake');
    f.state.wakeEvents?.onWake(20, 0.9);
    await flush();
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
    expect(f.state.callOptions).toMatchObject({ mode: 'conversation', focusConversationId: 'c1' });
    expect(c.store.getSnapshot().notice).toBeNull();
  });

  it('after an idle hang-up the agent may still speak: its clip plays without a call', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    f.frame({ name: 'voice.wake', voiceSessionId: null, reason: 'says', itemId: 'late1' });
    followUp(f, 'says', 'late1');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('late1');
    expect(f.clips.play).toHaveBeenCalledTimes(1);
    expect(c.state.call).toBeNull();
  });

  it('failed = your words were not sent; turn_failed = the task failed (explicit core status)', async () => {
    const { f, c } = await listening();
    followUp(f, 'failed');
    expect(c.store.getSnapshot().lastOutcome).toEqual({ status: 'failed', line: 'line failed' });
    followUp(f, 'turn_failed', 'err1');
    expect(c.store.getSnapshot().lastOutcome).toEqual({ status: 'turn_failed', line: 'line turn_failed' });
    expect(f.earcons()).toContain('needsYou');
    // The failed send opened the mic for a retry: the agent's line waits until it closes.
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).not.toHaveBeenCalledWith('err1');
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_WINDOW_MS + 1000);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('err1');
    expect(c.store.getSnapshot().followUps).toEqual([]);
  });

  it('a restart (callEnded restart) stays armed and says voice reconnected (no task cut yet)', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' });
    expect(c.state.mode).toBe('armed');
    expect(c.store.getSnapshot().notice?.code).toBe('restartReconnected');
    expect(f.earcons()).toContain('needsYou');
    // No `interrupted` line from core: the notice never claims a task was cut.
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.store.getSnapshot().notice?.code).toBe('restartReconnected');
  });

  it("a restart followed by core's `interrupted` line switches to the interrupted text", async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' });
    followUp(f, 'interrupted');
    expect(c.store.getSnapshot().notice?.code).toBe('restartInterrupted');
  });

  it('the voice socket says which mode the device is armed in (core ends an old binding on jarvis)', async () => {
    const { f, c } = await conversationArmed();
    expect(f.fx.createSocket).toHaveBeenLastCalledWith(expect.anything(), 'conversation');
    // Switching to Jarvis opens a new socket that says so.
    c.toggle({ mode: 'jarvis' });
    await flush();
    expect(f.fx.createSocket).toHaveBeenCalledTimes(2);
    expect(f.fx.createSocket).toHaveBeenLastCalledWith(expect.anything(), 'jarvis');
  });

  it('a restart seen from the socket: it drops, comes back, and the backend no longer knows the call', async () => {
    const { f, c } = await listening();
    f.closeSocket();
    f.openSocket();
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'armed', reason: null });
    expect(c.state.call).toBeNull();
    expect(c.state.mode).toBe('armed');
    expect(c.store.getSnapshot().notice?.code).toBe('restartReconnected');
  });

  it('a network blip whose call comes back (voice.ready) is not a restart', async () => {
    const { f, c } = await listening();
    f.closeSocket();
    f.openSocket();
    f.frame({ name: 'voice.ready', voiceSessionId: 'vs-1', engine: 'openai-realtime', model: 'm' });
    f.frame({ name: 'voice.state', voiceSessionId: 'vs-1', state: 'armed', reason: null });
    expect(c.state.call).not.toBeNull();
    expect(c.store.getSnapshot().notice).toBeNull();
  });

  it('an `interrupted` line about the bound conversation is shown and its clip spoken', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    followUp(f, 'interrupted', 'int1');
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('interrupted');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('int1');
    expect(c.store.getSnapshot().followUps).toEqual([]);
  });
});

describe('conversation voice mode — review round fixes (#1, #2, #3, #17)', () => {
  it('#1 a text-only `finished` during a `says` clip never opens the mic over it', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const clip = hangingClip(f);
    followUp(f, 'says', 'result1');
    await vi.advanceTimersByTimeAsync(200);
    expect(c.store.getSnapshot().agentSpeaking).toBe(true);
    followUp(f, 'finished');
    expect(c.state.held).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.state.held).toBe(true);
    clip.finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_WINDOW_MS + 100);
    expect(c.state.held).toBe(true);
  });

  it('#1 a text-only `finished` while a clip is still queued waits for that clip too', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const first = hangingClip(f);
    followUp(f, 'says', 'a1');
    followUp(f, 'says', 'a2');
    await vi.advanceTimersByTimeAsync(200);
    followUp(f, 'finished');
    first.finish();
    await vi.advanceTimersByTimeAsync(5);
    // a2 is the last line: the mic stays quiet until it has been heard.
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('a2');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.clips.play).toHaveBeenCalledTimes(2);
    expect(c.state.held).toBe(false);
  });

  it('#2 a `turn_failed` clip queued behind a playing line plays right after it, then the window opens', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    const clip = hangingClip(f);
    followUp(f, 'says', 'say1');
    await vi.advanceTimersByTimeAsync(200);
    followUp(f, 'turn_failed', 'fail1');
    clip.finish();
    await vi.advanceTimersByTimeAsync(600);
    // Played at once, not re-queued behind an open mic and heard 8-12 s late.
    expect(f.clips.play).toHaveBeenCalledTimes(2);
    expect(f.fx.api.fetchClip.mock.calls.map((call) => call[0])).toEqual(['say1', 'fail1']);
    expect(c.state.held).toBe(false);
  });

  it('#3 long continuous speech in the follow-up window is never cut; the mic closes after the speech ends', async () => {
    const { f, c } = await listening();
    followUp(f, 'sent');
    followUp(f, 'finished');
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_WINDOW_MS - 500);
    f.state.wakeEvents?.onVad(true, 20);
    // 20 s of speech without a pause: no onset after the first one.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(c.state.held).toBe(false);
    f.state.wakeEvents?.onVad(false, 40);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_WINDOW_MS - 1000);
    expect(c.state.held).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.state.held).toBe(true);
  });

  it('#17 30 min after an idle hang-up the bar says the agent answers in the chat; a wake re-binds the same conversation', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    await vi.advanceTimersByTimeAsync(BINDING_GRACE_MS - 1000);
    expect(c.store.getSnapshot().notice?.code).toBe('conversationIdle');
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.store.getSnapshot().notice?.code).toBe('conversationRested');
    expect(c.state.mode).toBe('armed');
    f.state.wakeEvents?.onWake(50, 0.9);
    await flush();
    expect(f.fx.startCall).toHaveBeenCalledTimes(2);
    expect(f.state.callOptions).toMatchObject({ mode: 'conversation', focusConversationId: 'c1' });
    expect(c.store.getSnapshot().notice).toBeNull();
  });

  it('#17 a re-bind that fails is never silent: the bar shows why and voice stays armed', async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    await vi.advanceTimersByTimeAsync(BINDING_GRACE_MS + 1000);
    f.fx.startCall.mockRejectedValueOnce(new Error('offline'));
    c.talk();
    await flush();
    expect(c.state.mode).toBe('armed');
    expect(c.state.call).toBeNull();
    expect(c.store.getSnapshot().notice?.code).toBe('callFailed');
  });

  it("#21 core's spoken `interrupted` after the bar already showed the restart: one cue only", async () => {
    const { f, c } = await listening();
    f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'restart' });
    const tones = f.earcons().filter((e) => e === 'needsYou').length;
    f.frame({
      name: 'voice.followUp',
      voiceSessionId: null,
      conversationId: 'c1',
      status: 'interrupted',
      line: 'x',
      clipId: 'int1',
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.fx.api.fetchClip).toHaveBeenCalledWith('int1');
    expect(f.earcons().filter((e) => e === 'needsYou').length).toBe(tones);
    expect(c.store.getSnapshot().notice?.code).toBe('restartInterrupted');
  });
});

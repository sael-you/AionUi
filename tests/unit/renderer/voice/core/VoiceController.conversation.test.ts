/**
 * Conversation voice mode (C26, D51): `/voice` and the composer mic bind voice to THIS
 * conversation; the transcript is posted (new turn or added mid-turn), the agent speaks when it
 * decides, "Hey Jarvis" or a tap barges in, a bare "stop" silences, "stop the task" cancels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_WINDOW_MS,
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

  it('"stop voice" (call ended with sleep) and 3 idle minutes end voice mode', async () => {
    const a = await listening();
    a.f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'sleep' });
    expect(a.c.state.mode).toBe('off');
    const b = await listening();
    b.f.frame({ name: 'voice.callEnded', voiceSessionId: 'vs-1', reason: 'idle' });
    expect(b.c.state.mode).toBe('off');
    expect(b.f.earcons()).toContain('bye');
  });
});

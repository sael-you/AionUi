import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceController } from '@/renderer/voice/core/VoiceController';
import { withMockBackend } from '@/renderer/voice/net/mockBackend';
import { createFakeEffects, flush } from '../fakes';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('in-page mock voice backend (manual checks)', () => {
  async function start() {
    const f = createFakeEffects();
    const c = new VoiceController(withMockBackend(f.fx));
    c.arm();
    await vi.advanceTimersByTimeAsync(200);
    c.talk();
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    return { f, c };
  }

  it('walks wake → ready → draft with read-back', async () => {
    const { f, c } = await start();
    const view = c.store.getSnapshot();
    expect(view.machine.call?.phase).toBe('ready');
    expect(view.draft).toMatchObject({ draftId: 'mock-draft', state: 'drafted', hash: 'mock-hash-1' });
    expect(f.clips.play).toHaveBeenCalled();
    expect(view.captions.at(-1)?.final).toBe(true);
  });

  it('Send holds 4 s, then reports sent and a follow-up', async () => {
    const { c } = await start();
    c.confirmDraft();
    expect(c.store.getSnapshot().draft?.state).toBe('committing');
    await vi.advanceTimersByTimeAsync(4500);
    expect(c.store.getSnapshot().draft?.state).toBe('sent');
    await vi.advanceTimersByTimeAsync(4000);
    expect(c.store.getSnapshot().followUps[0]?.status).toBe('finished');
  });

  it('Cancel during the hold prevents the send', async () => {
    const { c } = await start();
    c.confirmDraft();
    await vi.advanceTimersByTimeAsync(3800);
    c.cancelDraft();
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.store.getSnapshot().draft?.state).toBe('cancelled');
  });
});

describe('in-page mock voice backend — conversation voice mode (C26)', () => {
  it('walks ready → caption → sent → the agent speaks → finished, for the bound conversation', async () => {
    const f = createFakeEffects();
    const c = new VoiceController(withMockBackend(f.fx));
    c.toggle({ focusConversationId: 'conv-7', mode: 'conversation' });
    await vi.advanceTimersByTimeAsync(1900);
    await flush();
    expect(c.store.getSnapshot().machine.call?.phase).toBe('ready');
    c.commitUtterance();
    await vi.advanceTimersByTimeAsync(400);
    expect(c.store.getSnapshot().lastOutcome?.status).toBe('sent');
    expect(c.store.getSnapshot().captions.at(-1)?.text).toBe('Also run the unit tests, please');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.clips.play).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9000);
    expect(c.state.held).toBe(false);
  });
});

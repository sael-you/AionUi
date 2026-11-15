import { describe, expect, it, vi } from 'vitest';
import { createKws, KWS_CHUNK, type OrtSession, type OrtTensor } from '@/renderer/voice/capture/kwsCore';
import { createKwsRuntime, type KwsWorkerOut } from '@/renderer/voice/capture/kws.worker';
import { flush, sequential } from '../fakes';

class Tensor implements OrtTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: number[]
  ) {}
}

/** Fake openWakeWord sessions: mel → 8 frames per call, emb → 96-d, ww → fixed score. */
function fakeSessions(score: () => number) {
  const melInputs: number[] = [];
  const mel: OrtSession = {
    inputNames: ['input'],
    outputNames: ['output'],
    run: vi.fn(async (feeds: Record<string, OrtTensor>) => {
      const len = (feeds.input as Tensor).dims[1];
      melInputs.push(len);
      const frames = Math.max(1, Math.floor((len - 400) / 160) + 1);
      return { output: { data: new Float32Array(frames * 32).fill(-10) } };
    }),
  };
  const emb: OrtSession = {
    inputNames: ['input_1'],
    outputNames: ['conv2d_19'],
    run: vi.fn(async (feeds: Record<string, OrtTensor>) => {
      const b = (feeds.input_1 as Tensor).dims[0];
      return { conv2d_19: { data: new Float32Array(b * 96).fill(0.1) } };
    }),
  };
  const ww: OrtSession = {
    inputNames: ['x'],
    outputNames: ['y'],
    run: vi.fn(async () => ({ y: { data: new Float32Array([score()]) } })),
  };
  return { sessions: { mel, emb, ww }, melInputs };
}

describe('kwsCore (openWakeWord streaming port)', () => {
  it('forces the first five predictions to 0 like model.py', async () => {
    const { sessions } = fakeSessions(() => 0.9);
    const kws = createKws(Tensor as never, sessions, { random: () => 0.5 });
    await kws.reset();
    const scores = (await sequential(7, () => kws.process(new Float32Array(KWS_CHUNK)))).map((r) => r.score);
    expect(scores).toEqual([0, 0, 0, 0, 0, 0.9, 0.9].map((s) => expect.closeTo(s, 5)));
  });

  it('rejects chunks that are not 1280 samples', async () => {
    const { sessions } = fakeSessions(() => 0);
    const kws = createKws(Tensor as never, sessions);
    await expect(kws.process(new Float32Array(1000))).rejects.toThrow(/1280/);
  });

  it('keeps bounded state: the mel input never grows past 1760 samples', async () => {
    const { sessions, melInputs } = fakeSessions(() => 0);
    const kws = createKws(Tensor as never, sessions);
    await kws.reset();
    melInputs.length = 0;
    await sequential(200, () => kws.process(new Float32Array(KWS_CHUNK)));
    expect(Math.max(...melInputs)).toBe(1760);
  });
});

const pcm = (amp: number) => new Float32Array(1280).fill(amp);
const settle = () => flush(30);

describe('wake-word worker runtime', () => {
  const setup = (score: number) => {
    const posts: KwsWorkerOut[] = [];
    const kws = {
      reset: vi.fn(async () => undefined),
      process: vi.fn(async () => ({ score, tMel: 0, tEmb: 0, tWw: 0 })),
    };
    const rt = createKwsRuntime({ post: (m) => posts.push(m), loadKws: vi.fn(async () => kws) });
    return { posts, kws, rt };
  };

  it('posts loaded, then a wake for a high score during speech', async () => {
    const { posts, rt } = setup(0.95);
    rt.onMessage({ type: 'init', assetBase: '/voice/' });
    await settle();
    rt.onFrame({ pcm: pcm(0.2), t: 1 });
    await settle();
    expect(posts.map((p) => p.type)).toEqual(['loaded', 'vad', 'wake']);
  });

  it('in VAD-only mode reports speech onsets but never runs the model', async () => {
    const { posts, rt, kws } = setup(0.95);
    rt.onMessage({ type: 'init', assetBase: '/voice/' });
    rt.onMessage({ type: 'mode', mode: 'vad' });
    await settle();
    rt.onFrame({ pcm: pcm(0.2), t: 1 });
    await settle();
    expect(kws.process).not.toHaveBeenCalled();
    expect(posts.filter((p) => p.type === 'vad')).toHaveLength(1);
  });

  it('reports a model load failure instead of crashing', async () => {
    const posts: KwsWorkerOut[] = [];
    const rt = createKwsRuntime({ post: (m) => posts.push(m), loadKws: async () => Promise.reject(new Error('404')) });
    rt.onMessage({ type: 'init', assetBase: '/voice/' });
    await settle();
    expect(posts[0]).toMatchObject({ type: 'error', message: expect.stringContaining('404') });
  });

  it('a re-arm closes the previous capture port', () => {
    const { rt } = setup(0);
    const port = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn(), start: vi.fn(), close: vi.fn() });
    const first = port();
    const second = port();
    rt.onMessage({ type: 'port', port: first as unknown as MessagePort });
    rt.onMessage({ type: 'port', port: second as unknown as MessagePort });
    expect(first.close).toHaveBeenCalled();
    expect(first.removeEventListener).toHaveBeenCalled();
    expect(second.start).toHaveBeenCalled();
  });

  it('resets the wake model when switching back to wake mode after a call', async () => {
    const { rt, kws } = setup(0.1);
    rt.onMessage({ type: 'init', assetBase: '/voice/' });
    await settle();
    rt.onMessage({ type: 'mode', mode: 'vad' });
    rt.onMessage({ type: 'mode', mode: 'wake' });
    rt.onFrame({ pcm: pcm(0.2), t: 1 });
    await settle();
    expect(kws.reset).toHaveBeenCalledTimes(1);
    expect(kws.process).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed frames', async () => {
    const { posts, rt } = setup(0.95);
    rt.onFrame({ pcm: [1, 2, 3], t: 1 });
    rt.onFrame({ pcm: pcm(0.2) });
    await settle();
    expect(posts).toEqual([]);
  });
});

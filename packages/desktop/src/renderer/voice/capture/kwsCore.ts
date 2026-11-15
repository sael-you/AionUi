/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * openWakeWord streaming pipeline (port of `openwakeword/utils.py`
 * AudioFeatures + `model.py` predict), ported from the S0-C `kws-core.js`
 * whose scores matched Python within 0.0002 on 18 clips.
 *
 * Input: 16 kHz mono chunks of exactly 1280 samples (80 ms) at int16 scale.
 * Per chunk: melspectrogram(last 1760 samples) → x/10+2 → mel frames →
 * embedding(last 76 mel frames) → 96-d feature → hey_jarvis(last 16) → score.
 *
 * Bounded state: ≤ 120 mel frames and ≤ 120 features are kept (no growth).
 */

export type OrtTensor = { data: ArrayLike<number> };
export type OrtSession = {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
};
export type OrtTensorCtor = new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor;

export const KWS_CHUNK = 1280;
const CTX = 480;
const MEL_WIN = 76;
const MEL_KEEP = 120;
const FEAT_KEEP = 120;
const N_FEAT = 16;
const MEL_BINS = 32;
const FEAT_DIM = 96;
/** model.py: the first 5 predictions are forced to 0. */
const WARMUP_PREDICTIONS = 5;

export type KwsSessions = { mel: OrtSession; emb: OrtSession; ww: OrtSession };

export type KwsResult = { score: number; tMel: number; tEmb: number; tWw: number };

export type Kws = {
  reset(): Promise<void>;
  process(chunk: Float32Array): Promise<KwsResult>;
};

export function createKws(
  Tensor: OrtTensorCtor,
  sessions: KwsSessions,
  deps: { now?: () => number; random?: () => number } = {}
): Kws {
  const { mel, emb, ww } = sessions;
  const now = deps.now ?? (() => performance.now());
  const random = deps.random ?? Math.random;
  const raw = new Float32Array(KWS_CHUNK + CTX);
  let rawFilled = 0;
  let melFrames: Float32Array[] = [];
  let feats: Float32Array[] = [];
  let nPred = 0;

  const resetMel = () => {
    melFrames = [];
    for (let i = 0; i < MEL_WIN; i++) melFrames.push(new Float32Array(MEL_BINS).fill(1));
  };

  const melspec = async (samples: Float32Array): Promise<Float32Array[]> => {
    const out = await mel.run({ [mel.inputNames[0]]: new Tensor('float32', samples, [1, samples.length]) });
    const d = out[mel.outputNames[0]].data;
    const n = Math.floor(d.length / MEL_BINS);
    const frames: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      const f = new Float32Array(MEL_BINS);
      for (let j = 0; j < MEL_BINS; j++) f[j] = d[i * MEL_BINS + j] / 10 + 2;
      frames.push(f);
    }
    return frames;
  };

  const embedBatch = async (windows: Float32Array[][]): Promise<Float32Array[]> => {
    const b = windows.length;
    const buf = new Float32Array(b * MEL_WIN * MEL_BINS);
    for (let k = 0; k < b; k++) {
      for (let i = 0; i < MEL_WIN; i++) buf.set(windows[k][i], (k * MEL_WIN + i) * MEL_BINS);
    }
    const out = await emb.run({ [emb.inputNames[0]]: new Tensor('float32', buf, [b, MEL_WIN, MEL_BINS, 1]) });
    const d = out[emb.outputNames[0]].data;
    const res: Float32Array[] = [];
    for (let k = 0; k < b; k++)
      res.push(Float32Array.from(Array.prototype.slice.call(d, k * FEAT_DIM, (k + 1) * FEAT_DIM)));
    return res;
  };

  // Python seeds the feature buffer with embeddings of 4 s of random noise.
  const reset = async () => {
    raw.fill(0);
    rawFilled = 0;
    nPred = 0;
    resetMel();
    const noise = new Float32Array(16000 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(random() * 2000) - 1000;
    const spec = await melspec(noise);
    const wins: Float32Array[][] = [];
    for (let s = 0; s + MEL_WIN <= spec.length; s += 8) wins.push(spec.slice(s, s + MEL_WIN));
    feats = wins.length ? await embedBatch(wins) : [];
  };

  const process = async (chunk: Float32Array): Promise<KwsResult> => {
    if (chunk.length !== KWS_CHUNK) throw new Error(`chunk must be ${KWS_CHUNK} samples`);
    raw.copyWithin(0, KWS_CHUNK);
    raw.set(chunk, CTX);
    rawFilled = Math.min(rawFilled + KWS_CHUNK, KWS_CHUNK + CTX);
    const t0 = now();
    const frames = await melspec(raw.slice(raw.length - rawFilled));
    melFrames.push(...frames);
    if (melFrames.length > MEL_KEEP) melFrames = melFrames.slice(melFrames.length - MEL_KEEP);
    const t1 = now();
    const [feature] = await embedBatch([melFrames.slice(melFrames.length - MEL_WIN)]);
    feats.push(feature);
    if (feats.length > FEAT_KEEP) feats = feats.slice(feats.length - FEAT_KEEP);
    const t2 = now();
    const x = new Float32Array(N_FEAT * FEAT_DIM);
    const tail = feats.slice(-N_FEAT);
    // Fewer than 16 features only before reset(); left-pad with zeros.
    const offset = N_FEAT - tail.length;
    tail.forEach((f, k) => x.set(f, (offset + k) * FEAT_DIM));
    const out = await ww.run({ [ww.inputNames[0]]: new Tensor('float32', x, [1, N_FEAT, FEAT_DIM]) });
    let score = Number(out[ww.outputNames[0]].data[0]);
    const t3 = now();
    if (nPred < WARMUP_PREDICTIONS) score = 0;
    nPred++;
    return { score, tMel: t1 - t0, tEmb: t2 - t1, tWw: t3 - t2 };
  };

  return { reset, process };
}

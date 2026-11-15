/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wake-word + VAD worker (port of S0-C `kws-worker.js`).
 *
 * Receives 16 kHz frames from the capture worklet over a MessagePort, runs the
 * energy VAD on every frame and openWakeWord `hey_jarvis` (onnxruntime-web,
 * wasm, 1 thread — no cross-origin isolation needed) while in `wake` mode.
 * During a call the controller switches to `vad` mode: only VAD runs (speech
 * onsets for confirmation evidence), saving ~90 % of the CPU.
 *
 * The runtime and models are static assets served next to the app
 * (`voice/ort/*`, `voice/models/*`, see `assets.ts`), loaded lazily on first
 * arm and kept in the HTTP cache. The frame queue is bounded (no backlog
 * growth under CPU starvation: oldest frames are dropped from inference).
 */

import { floatTo16BitPcm } from '@/renderer/services/speech/pcmRecorder';
import { ORT_ASSET, ORT_DIR, WAKE_MODEL_ASSETS } from './assets';
import { createKws, type Kws, type OrtSession, type OrtTensorCtor } from './kwsCore';
import { DEFAULT_WAKE_THRESHOLD, EnergyVad, WakeGate } from './wakeDetector';

export type KwsMode = 'wake' | 'vad' | 'idle';

export type KwsWorkerIn =
  | { type: 'init'; assetBase: string; threshold?: number }
  | { type: 'port'; port: MessagePort }
  | { type: 'mode'; mode: KwsMode }
  | { type: 'suppress'; untilT: number; replace?: boolean }
  | { type: 'reset' };

export type KwsWorkerOut =
  | { type: 'loaded'; ms: number }
  | { type: 'error'; message: string }
  | { type: 'vad'; speech: boolean; t: number }
  | { type: 'wake'; t: number; score: number }
  | { type: 'stats'; frames: number; inferenceMsP50: number; dropped: number };

type OrtModule = {
  Tensor: OrtTensorCtor;
  InferenceSession: { create(model: Uint8Array, options: Record<string, unknown>): Promise<OrtSession> };
  env: { wasm: { wasmPaths?: string; numThreads?: number; proxy?: boolean } };
};

export type KwsRuntimeDeps = {
  post: (msg: KwsWorkerOut) => void;
  loadKws: (assetBase: string) => Promise<Kws>;
  now?: () => number;
};

const MAX_QUEUE = 25; // 2 s of 80 ms frames
const STATS_EVERY = 125; // ~10 s

/** Load onnxruntime-web and the three openWakeWord models from static assets. */
export async function loadKwsFromAssets(assetBase: string): Promise<Kws> {
  const ort = (await import(/* @vite-ignore */ `${assetBase}${ORT_ASSET}`)) as OrtModule;
  ort.env.wasm.wasmPaths = `${assetBase}${ORT_DIR}`;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const session = async (path: string) => {
    const response = await fetch(`${assetBase}${path}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return ort.InferenceSession.create(new Uint8Array(await response.arrayBuffer()), options);
  };
  const [mel, emb, ww] = await Promise.all([
    session(WAKE_MODEL_ASSETS.mel),
    session(WAKE_MODEL_ASSETS.emb),
    session(WAKE_MODEL_ASSETS.ww),
  ]);
  const kws = createKws(ort.Tensor, { mel, emb, ww });
  await kws.reset();
  return kws;
}

/** Worker logic, separated from the global scope so it can be unit-tested. */
export function createKwsRuntime(deps: KwsRuntimeDeps) {
  const now = deps.now ?? (() => performance.now());
  const vad = new EnergyVad();
  const gate = new WakeGate({ threshold: DEFAULT_WAKE_THRESHOLD });
  let kws: Kws | null = null;
  let mode: KwsMode = 'wake';
  let queue: Array<{ pcm: Float32Array; t: number }> = [];
  let busy = false;
  let frames = 0;
  let dropped = 0;
  let procMs: number[] = [];
  let port: MessagePort | null = null;
  let needsReset = false;
  const onPortMessage = (ev: MessageEvent) => onFrame(ev.data as { pcm?: unknown; t?: unknown });

  const handle = async (pcm: Float32Array, t: number) => {
    frames++;
    const ev = vad.frame(pcm, t);
    if (ev) deps.post({ type: 'vad', speech: ev.speech, t: ev.t });
    if (mode !== 'wake' || !kws) return;
    if (needsReset) {
      // Back from a call / idle: drop the stale feature history (runs between frames, never concurrently).
      needsReset = false;
      await kws.reset();
    }
    const t0 = now();
    const r = await kws.process(Float32Array.from(floatTo16BitPcm(pcm)));
    procMs.push(now() - t0);
    if (gate.check(r.score, t, vad.lastVoicedT)) deps.post({ type: 'wake', t, score: r.score });
    if (procMs.length >= STATS_EVERY) {
      const sorted = procMs.toSorted((a, b) => a - b);
      deps.post({ type: 'stats', frames, inferenceMsP50: sorted[Math.floor(sorted.length / 2)], dropped });
      procMs = [];
    }
  };

  /** Sequential processing: one frame at a time, in order. */
  const pump = (): void => {
    if (busy) return;
    const next = queue.shift();
    if (!next) return;
    busy = true;
    handle(next.pcm, next.t)
      .catch((e: unknown) => deps.post({ type: 'error', message: String((e as Error)?.message ?? e) }))
      .finally(() => {
        busy = false;
        pump();
      });
  };

  const onFrame = (data: { pcm?: unknown; t?: unknown }) => {
    if (!(data.pcm instanceof Float32Array) || typeof data.t !== 'number') return;
    queue.push({ pcm: data.pcm, t: data.t });
    if (queue.length > MAX_QUEUE) {
      dropped += queue.length - MAX_QUEUE;
      queue = queue.slice(queue.length - MAX_QUEUE);
    }
    pump();
  };

  const onMessage = (msg: KwsWorkerIn) => {
    switch (msg.type) {
      case 'init': {
        if (typeof msg.threshold === 'number') gate.configure({ threshold: msg.threshold });
        const t0 = now();
        deps
          .loadKws(msg.assetBase)
          .then((loaded) => {
            kws = loaded;
            deps.post({ type: 'loaded', ms: now() - t0 });
          })
          .catch((e: unknown) =>
            deps.post({ type: 'error', message: `load failed: ${String((e as Error)?.message ?? e)}` })
          );
        break;
      }
      case 'port':
        // One capture port at a time: a re-arm closes the previous one.
        if (port) {
          port.removeEventListener('message', onPortMessage);
          port.close();
        }
        port = msg.port;
        port.addEventListener('message', onPortMessage);
        port.start();
        break;
      case 'mode':
        if (msg.mode === 'wake' && mode !== 'wake') needsReset = true;
        mode = msg.mode;
        break;
      case 'suppress':
        gate.suppress(msg.untilT, msg.replace === true);
        break;
      case 'reset':
        queue = [];
        gate.reset();
        break;
      default:
        break;
    }
  };

  return { onMessage, onFrame };
}

declare const WorkerGlobalScope: { prototype: object } | undefined;

if (
  typeof WorkerGlobalScope !== 'undefined' &&
  typeof self !== 'undefined' &&
  self instanceof (WorkerGlobalScope as unknown as typeof Object)
) {
  const scope = self as unknown as {
    postMessage(m: unknown, transfer: Transferable[]): void;
    addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
  };
  const runtime = createKwsRuntime({ post: (m) => scope.postMessage(m, []), loadKws: loadKwsFromAssets });
  scope.addEventListener('message', (e: MessageEvent) => runtime.onMessage(e.data as KwsWorkerIn));
}

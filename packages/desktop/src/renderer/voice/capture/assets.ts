/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static wake-word assets, served from the renderer's public dir at
 * `voice/` (copied to `out/renderer/voice/` by Vite, served by the web host).
 *
 * They are NOT committed: onnxruntime-web is ~15 MB of wasm and the
 * openWakeWord pre-trained models are CC BY-NC-SA 4.0 (personal use only),
 * which must not enter the Apache-2.0 tree. `scripts/fetch-voice-assets.js`
 * downloads pinned versions and verifies their sha256. When they are missing
 * the wake word reports "unavailable" and tap-to-talk still works.
 */

export const VOICE_ASSET_DIR = 'voice/';
export const ORT_DIR = 'ort/';
export const ORT_ASSET = 'ort/ort.wasm.min.mjs';
export const WAKE_MODEL_ASSETS = {
  mel: 'models/melspectrogram.onnx',
  emb: 'models/embedding_model.onnx',
  ww: 'models/hey_jarvis_v0.1.onnx',
} as const;

/** Absolute base URL of the voice assets for the current document. */
export function voiceAssetBase(baseUri: string = typeof document === 'undefined' ? '' : document.baseURI): string {
  try {
    return new URL(VOICE_ASSET_DIR, baseUri).href;
  } catch {
    return `/${VOICE_ASSET_DIR}`;
  }
}

#!/usr/bin/env node
/**
 * Fetch the static wake-word assets for voice mode ("Jarvis", card C9) into
 * public/voice/ (gitignored). Vite copies public/ into out/renderer/, where the
 * web host serves it next to the app.
 *
 * Why not committed:
 * - onnxruntime-web (MIT) ships a ~15 MB wasm runtime;
 * - the openWakeWord pre-trained models are CC BY-NC-SA 4.0 (personal /
 *   non-commercial use only) and must not enter this Apache-2.0 tree or a
 *   commercial build. A commercial release needs a self-trained wake model.
 *
 * Every file is pinned by sha256; a mismatch aborts and nothing is written.
 *
 * Usage:
 *   node scripts/fetch-voice-assets.js                 # download (jsDelivr npm mirror + GitHub release)
 *   node scripts/fetch-voice-assets.js --from <dir>    # copy from a local dir (searched recursively by file name)
 *   node scripts/fetch-voice-assets.js --check         # verify what is installed, exit 1 if anything is missing
 *
 * Without these files the app still works: the wake word reports "unavailable"
 * and voice mode is started with the Talk button.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ORT_VERSION = '1.31.1';
const OWW_RELEASE = 'v0.5.1';
const DEST = path.resolve(__dirname, '../public/voice');

const ASSETS = [
  {
    dest: 'ort/ort.wasm.min.mjs',
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.mjs`,
    sha256: 'c21d9c326d453a4a61398270c804d5979e118540597cb0c07f7b3d64e6098234',
  },
  {
    dest: 'ort/ort-wasm-simd-threaded.mjs',
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.mjs`,
    sha256: '30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3',
  },
  {
    dest: 'ort/ort-wasm-simd-threaded.wasm',
    url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`,
    sha256: '4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d',
  },
  {
    dest: 'models/melspectrogram.onnx',
    url: `https://github.com/dscripka/openWakeWord/releases/download/${OWW_RELEASE}/melspectrogram.onnx`,
    sha256: 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f',
  },
  {
    dest: 'models/embedding_model.onnx',
    url: `https://github.com/dscripka/openWakeWord/releases/download/${OWW_RELEASE}/embedding_model.onnx`,
    sha256: '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f',
  },
  {
    dest: 'models/hey_jarvis_v0.1.onnx',
    url: `https://github.com/dscripka/openWakeWord/releases/download/${OWW_RELEASE}/hey_jarvis_v0.1.onnx`,
    sha256: '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb',
  },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'aionui-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(download(new URL(res.headers.location, url).href, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${url} → HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function findLocal(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findLocal(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function installed(asset) {
  const file = path.join(DEST, asset.dest);
  return fs.existsSync(file) && sha256(fs.readFileSync(file)) === asset.sha256;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const missing = ASSETS.filter((a) => !installed(a));
    for (const a of missing) console.error(`missing or changed: public/voice/${a.dest}`);
    console.log(missing.length ? `${missing.length} voice asset(s) missing` : 'voice assets OK');
    process.exit(missing.length ? 1 : 0);
  }
  const fromIdx = args.indexOf('--from');
  const from = fromIdx >= 0 ? path.resolve(args[fromIdx + 1] || '.') : null;

  const pending = [];
  for (const asset of ASSETS) {
    if (installed(asset)) {
      console.log(`ok       ${asset.dest}`);
      continue;
    }
    let buf;
    if (from) {
      const local = findLocal(from, path.basename(asset.dest));
      if (!local) throw new Error(`${path.basename(asset.dest)} not found under ${from}`);
      buf = fs.readFileSync(local);
    } else {
      buf = await download(asset.url);
    }
    const got = sha256(buf);
    if (got !== asset.sha256) throw new Error(`sha256 mismatch for ${asset.dest}: ${got}`);
    pending.push({ asset, buf });
  }
  for (const { asset, buf } of pending) {
    const file = path.join(DEST, asset.dest);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    console.log(`fetched  ${asset.dest} (${(buf.length / 1048576).toFixed(1)} MB)`);
  }
}

main().catch((error) => {
  console.error(`fetch-voice-assets: ${error.message}`);
  process.exit(1);
});

// Determinism guard: converting the same editor_map twice must produce
// byte-identical Apollo artifacts (base/sim/routing .bin, base_map.txt, and the
// JSON sidecars). Protects against re-introducing wall-clock timestamps or other
// non-deterministic state into the encoded output (breaks diffing / caching).
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');

const { convertEditorMapToApolloPackage } = require('../backend/runtime/editorMapConverter');
const appRoot = path.resolve(__dirname, '..');

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function findFixture() {
  const dir = path.join(appRoot, 'data', 'editor_map');
  if (!fs.existsSync(dir)) return null;
  const preferred = ['2026-5-25-3.fixed.json', 'yuanqu_1_apollo_complete.json'];
  for (const p of preferred) {
    if (fs.existsSync(path.join(dir, p))) return path.join(dir, p);
  }
  const first = fs.readdirSync(dir).find((n) => n.endsWith('.json'));
  return first ? path.join(dir, first) : null;
}

async function convertOnce(jsonPath) {
  const rel = fs.mkdtempSync(path.join(os.tmpdir(), 'det-'));
  try {
    await convertEditorMapToApolloPackage({ mapName: 'det', jsonPath, releaseDir: rel, baseMapDir: null });
    const out = {};
    for (const f of [
      'base_map.bin',
      'sim_map.bin',
      'routing_map.bin',
      'base_map.txt',
      'coordinate_metadata.json',
      'manifest.json',
    ]) {
      const fp = path.join(rel, f);
      if (fs.existsSync(fp)) out[f] = sha(fp);
    }
    return out;
  } finally {
    fs.rmSync(rel, { recursive: true, force: true });
  }
}

async function main() {
  const jsonPath = await findFixture();
  if (!jsonPath) {
    console.log('[skip] no editor_map fixture');
    return;
  }
  const a = await convertOnce(jsonPath);
  const b = await convertOnce(jsonPath);
  const files = Object.keys(a);
  assert.ok(files.length >= 4, 'produced the expected artifacts');
  for (const f of files) {
    assert.strictEqual(a[f], b[f], `non-deterministic output: ${f}`);
  }
  console.log(JSON.stringify({ fixture: path.basename(jsonPath), artifacts: files.length, deterministic: true }));
  console.log('[pass] converter-determinism');
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

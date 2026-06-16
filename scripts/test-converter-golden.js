// Golden-output regression net for refactors of the converter. Converts a
// self-contained, geometry-rich synthetic editor_map (curved + straight lanes,
// a closed loop, an anchored coordinate transform) and asserts the encoded
// Apollo artifacts are byte-identical to a committed baseline. Any refactor that
// changes output (intended or not) trips this — run with UPDATE_GOLDEN=1 to
// re-record after an intentional change.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');

const { convertEditorMapToApolloPackage } = require('../backend/runtime/editorMapConverter');

// Locked baseline (encoded-artifact sha256, first 16 hex). Re-record with
// UPDATE_GOLDEN=1 only for an intentional output change.
const GOLDEN = {
  'base_map.bin': 'b5f3481c0392d350',
  'sim_map.bin': 'b5f3481c0392d350',
  'routing_map.bin': 'c8f8c309d19d9fdf',
  'coordinate_metadata.json': '494eef8a26b866f3',
  'quality_gate.json': 'd5f3edc5f3d75c44',
};

function syntheticMap() {
  // Anchored so the coordinate transform (offset -> global UTM) runs.
  const origin = { x: 468300, y: 4293900, z: 0 };
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const point = [
    // straight lane boundaries
    pt('L0', 0, 0), pt('L1', 40, 0),
    pt('R0', 0, 3.5), pt('R1', 40, 3.5),
    // curved lane boundaries (bezier: 2 pts + 2 controls)
    pt('CL0', 40, 0), pt('CL1', 80, 20),
    pt('CR0', 40, 3.5), pt('CR1', 80, 23.5),
    // closed loop (circle r=20/r=17 around (200,200))
    ...Array.from({ length: 24 }, (_u, i) => {
      const a = (2 * Math.PI * i) / 24;
      return pt(`O${i}`, 200 + 20 * Math.cos(a), 200 + 20 * Math.sin(a));
    }),
    ...Array.from({ length: 24 }, (_u, i) => {
      const a = (2 * Math.PI * i) / 24;
      return pt(`I${i}`, 200 + 17 * Math.cos(a), 200 + 17 * Math.sin(a));
    }),
  ];
  const oIds = Array.from({ length: 24 }, (_u, i) => `O${i}`).concat('O0');
  const iIds = Array.from({ length: 24 }, (_u, i) => `I${i}`).concat('I0');
  const attr = { speed: 30, speedKph: 30, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };
  return {
    header: { version: 'golden', date: '2026-01-01T00:00:00.000Z' },
    apolloOrigin: origin,
    point,
    boundary: [
      { id: 'bSL', point_id: ['L0', 'L1'], type: 7, controlsPosition: [] },
      { id: 'bSR', point_id: ['R0', 'R1'], type: 7, controlsPosition: [] },
      { id: 'bCL', point_id: ['CL0', 'CL1'], type: 7, controlsPosition: [{ x: 60, y: 0 }, { x: 80, y: 8 }] },
      { id: 'bCR', point_id: ['CR0', 'CR1'], type: 7, controlsPosition: [{ x: 60, y: 3.5 }, { x: 80, y: 11.5 }] },
      { id: 'bO', point_id: oIds, type: 7, controlsPosition: [] },
      { id: 'bI', point_id: iIds, type: 7, controlsPosition: [] },
    ],
    lane: [
      { id: 'straight', left_boundary_id: 'bSL', right_boundary_id: 'bSR', width: 3.5, type: 1, attr },
      { id: 'curved', left_boundary_id: 'bCL', right_boundary_id: 'bCR', width: 3.5, type: 1, attr },
      { id: 'loop', left_boundary_id: 'bO', right_boundary_id: 'bI', width: 3, type: 1, attr },
    ],
  };
}

async function hashes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(syntheticMap()));
  const rel = path.join(dir, 'out');
  try {
    await convertEditorMapToApolloPackage({ mapName: 'golden', jsonPath, releaseDir: rel, baseMapDir: null });
    const out = {};
    for (const f of Object.keys(GOLDEN)) {
      out[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(rel, f))).digest('hex').slice(0, 16);
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const got = await hashes();
  if (process.env.UPDATE_GOLDEN === '1' || Object.values(GOLDEN).includes('__RECORD__')) {
    console.log('GOLDEN =', JSON.stringify(got, null, 2));
    if (Object.values(GOLDEN).includes('__RECORD__')) {
      console.log('[record] paste the above into GOLDEN, then re-run');
      return;
    }
  }
  for (const f of Object.keys(GOLDEN)) {
    assert.strictEqual(got[f], GOLDEN[f], `golden output changed for ${f} (got ${got[f]}, expected ${GOLDEN[f]})`);
  }
  console.log(JSON.stringify({ artifacts: Object.keys(GOLDEN).length, matchesGolden: true }));
  console.log('[pass] converter-golden');
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

'use strict';
// Locks RTK georeference verification: parsing raw GNSS best_pose, and confirming
// a map only when an RTK-fixed sample reprojects onto a published lane.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const converter = require('../backend/runtime/editorMapConverter');
const runtime = require('../backend/runtime');
const t = converter.__test__;

function testParse() {
  const text = [
    'sol_status: SOL_COMPUTED',
    'sol_type: INS_RTKFIXED',
    'latitude: 38.79426991',
    'longitude: 116.63564442',
    'height_msl: -6.91',
    'latitude_std_dev: 0.01',
    'longitude_std_dev: 0.01',
  ].join('\n');
  const samples = runtime.__test__.parseRtkBestPoses(text);
  assert.strictEqual(samples.length, 1);
  assert.strictEqual(samples[0].rtkFixed, true);
  assert.ok(Math.abs(samples[0].lat - 38.79426991) < 1e-8 && Math.abs(samples[0].lon - 116.63564442) < 1e-8);
  const notFixed = runtime.__test__.parseRtkBestPoses(text.replace('INS_RTKFIXED', 'SINGLE'));
  assert.strictEqual(notFixed[0].rtkFixed, false);
}

function utmMap() {
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const attr = { speed: 30, speedKph: 30, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };
  return {
    header: { version: 'u', date: '2026-01-01T00:00:00.000Z' },
    apolloOrigin: { x: 468340, y: 4294008, z: 0 },
    point: [pt('L0', 0, 0), pt('L1', 40, 0), pt('R0', 0, 3.5), pt('R1', 40, 3.5)],
    boundary: [
      { id: 'bL', point_id: ['L0', 'L1'], type: 7, controlsPosition: [] },
      { id: 'bR', point_id: ['R0', 'R1'], type: 7, controlsPosition: [] },
    ],
    lane: [{ id: '1', left_boundary_id: 'bL', right_boundary_id: 'bR', width: 3.5, type: 1, attr }],
  };
}

async function testVerify() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'georef-'));
  const rel = path.join(dir, 'out');
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(utmMap()));
  try {
    await converter.convertEditorMapToApolloPackage({ mapName: 'u', jsonPath, releaseDir: rel, baseMapDir: null });
    const base = fs.readFileSync(path.join(rel, 'base_map.txt'), 'utf8');
    const m = base.match(/central_curve[\s\S]*?point \{\s*x:\s*([-\d.]+)\s*y:\s*([-\d.]+)/);
    assert.ok(m, 'lane centerline point found');
    const ll = t.inverseTransverseMercator(parseFloat(m[1]), parseFloat(m[2]), t.APOLLO_TARGET_CRS);
    const cfg = { edgeDeploy: {} };

    // RTK-fixed sample ON the lane -> confirmed, ~0 distance.
    const onLane = { solType: 'INS_RTKFIXED', lat: ll.lat, lon: ll.lon, latStd: 0.01, lonStd: 0.01, rtkFixed: true };
    const v = await runtime.verifyMapGeoreferenceAgainstRtk(cfg, 'u', rel, { samples: [onLane], generatedAt: 'x' });
    assert.strictEqual(v.confirmed, true, 'on-lane RTK must confirm');
    assert.ok(v.maxLaneDistanceMeters < 0.5, `on-lane distance should be ~0, got ${v.maxLaneDistanceMeters}`);
    assert.ok(fs.existsSync(path.join(rel, 'georeference_verification.json')), 'artifact written');

    // ~150m off (0.001 deg lat) -> not confirmed (a datum/anchor error would look like this).
    const off = { solType: 'INS_RTKFIXED', lat: ll.lat + 0.0014, lon: ll.lon, latStd: 0.01, lonStd: 0.01, rtkFixed: true };
    const v2 = await runtime.verifyMapGeoreferenceAgainstRtk(cfg, 'u', rel, { samples: [off], generatedAt: 'x' });
    assert.strictEqual(v2.confirmed, false, 'far RTK must not confirm');
    assert.ok(v2.maxLaneDistanceMeters > 100, 'far distance reported');

    // No RTK fix -> not confirmed, flagged unavailable.
    const v3 = await runtime.verifyMapGeoreferenceAgainstRtk(cfg, 'u', rel, {
      samples: [{ ...onLane, rtkFixed: false }],
      generatedAt: 'x',
    });
    assert.strictEqual(v3.confirmed, false);
    assert.strictEqual(v3.rtkFixed, false);

    return { onLaneDistance: v.maxLaneDistanceMeters, offDistance: v2.maxLaneDistanceMeters };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  testParse();
  const r = await testVerify();
  console.log(JSON.stringify({ parse: 'ok', verify: r }));
  console.log('[pass] georeference-verification');
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

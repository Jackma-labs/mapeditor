'use strict';
// Locks the coordinate/localization-safety fixes from the localization audit:
//  L1 - inverseTransverseMercator handles southern-hemisphere false northing.
//  C1 - a present + misaligned vehicle blocks deploy under requireLocalizationGate.
//  H1/H2/M2 - GK-projected LOCAL_ENU maps surface convergence/datum/anchor risk
//             as warnings (visible, not blocking) in the quality gate.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const converter = require('../backend/runtime/editorMapConverter');
const runtime = require('../backend/runtime');

const t = converter.__test__;

// ---- L1: southern-hemisphere inverse TM round-trip ----
function testSouthernInverse() {
  const southCrs = { ...t.APOLLO_TARGET_CRS, hemisphere: 'south' };
  const lon = 116.6;
  const lat = -33.8; // southern
  const fwd = t.forwardTransverseMercator(lon, lat, southCrs);
  assert.ok(fwd.y > 5_000_000, `southern forward must apply the 10^7 false northing (got y=${fwd.y})`);
  const inv = t.inverseTransverseMercator(fwd.x, fwd.y, southCrs);
  assert.ok(
    Math.abs(inv.lon - lon) < 1e-6 && Math.abs(inv.lat - lat) < 1e-6,
    `southern round-trip failed: got lon ${inv.lon}, lat ${inv.lat}`,
  );
  // Northern path unchanged (no hemisphere => northern false northing 0).
  const n = t.forwardTransverseMercator(116.6, 38.8, t.APOLLO_TARGET_CRS);
  const ni = t.inverseTransverseMercator(n.x, n.y, t.APOLLO_TARGET_CRS);
  assert.ok(Math.abs(ni.lat - 38.8) < 1e-6, 'northern round-trip must be unaffected');
}

// ---- C1: deploy-gate decision for vehicle pose ----
function testVehiclePoseGate() {
  const ev = runtime.__test__.evaluateVehiclePoseDeployCheck;
  // present + misaligned + gate required -> BLOCK
  assert.strictEqual(ev({ available: true, status: 'error' }, { requireLocalizationGate: true }).blocking, true);
  // present + misaligned + gate disabled -> advisory
  assert.strictEqual(ev({ available: true, status: 'error' }, { requireLocalizationGate: false }).blocking, false);
  // present + ok -> never blocks
  assert.strictEqual(ev({ available: true, status: 'ok' }, { requireLocalizationGate: true }).blocking, false);
  // unavailable pose (office deploy) -> NOT blocking by default (preserve workflow)
  assert.strictEqual(
    ev({ available: false, message: 'edge localization pose is unavailable' }, { requireLocalizationGate: true }).blocking,
    false,
  );
  // unavailable pose + explicit requireVehiclePoseForDeploy -> BLOCK
  assert.strictEqual(
    ev(
      { available: false, message: 'unavailable' },
      { requireLocalizationGate: true, requireVehiclePoseForDeploy: true },
    ).blocking,
    true,
  );
  // missing lane centerline always blocks (the check could not run)
  assert.strictEqual(
    ev({ available: false, message: 'base_map.txt has no lane central_curve points' }, { requireLocalizationGate: false })
      .blocking,
    true,
  );
}

// ---- H1/H2/M2: GK-anchored LOCAL_ENU map surfaces risk as warnings ----
function gkAnchoredMap() {
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const attr = { speed: 30, speedKph: 30, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };
  return {
    header: { version: 'gk', date: '2026-01-01T00:00:00.000Z' },
    sourceCrs: 'LOCAL_ENU_METERS',
    coordinateMetadata: {
      sourceCrs: 'LOCAL_ENU_METERS',
      anchor: {
        source: 'inferred_same_basemap:foo:base_map_coordinate_metadata:gauss_kruger_cm114_local_origin',
        confidence: 'edge_pose_nearest_projection',
        sourceCrs: 'GAUSS_KRUGER_CM114',
        sourceOrigin: { x: 729003.7468, y: 4298924.2408, z: 2.5934 },
      },
    },
    point: [pt('L0', -30, 0), pt('L1', 40, 50), pt('R0', -30, 3.5), pt('R1', 40, 53.5)],
    boundary: [
      { id: 'bL', point_id: ['L0', 'L1'], type: 7, controlsPosition: [] },
      { id: 'bR', point_id: ['R0', 'R1'], type: 7, controlsPosition: [] },
    ],
    lane: [{ id: '1', left_boundary_id: 'bL', right_boundary_id: 'bR', width: 3.5, type: 1, attr }],
  };
}

async function testGkConvergenceGate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coordsafe-'));
  const rel = path.join(dir, 'out');
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(gkAnchoredMap()));
  try {
    await converter.convertEditorMapToApolloPackage({ mapName: 'gk', jsonPath, releaseDir: rel, baseMapDir: null });
    const meta = JSON.parse(fs.readFileSync(path.join(rel, 'coordinate_metadata.json'), 'utf8'));
    assert.strictEqual(meta.transform.mode, 'local-enu-gauss-kruger-cm114-to-utm-zone-50');
    assert.ok(Number(meta.transform.gridConvergenceDeg) > 1, 'convergence recorded');
    assert.ok(Number(meta.transform.maxFrameRotationErrorMeters) > 0, 'rotation-error bound recorded');
    assert.ok(meta.anchor && /inferred_/.test(meta.anchor.source), 'anchor provenance carried');

    const gate = JSON.parse(fs.readFileSync(path.join(rel, 'quality_gate.json'), 'utf8'));
    const byId = Object.fromEntries(gate.checks.map((c) => [c.id, c]));
    for (const id of ['coordinate-frame-convergence', 'coordinate-source-datum', 'coordinate-anchor-provenance', 'coordinate-northing-band']) {
      assert.ok(byId[id], `missing gate check ${id}`);
    }
    // Risk checks are warnings (surface) and must NOT block a deployable map.
    assert.strictEqual(byId['coordinate-frame-convergence'].status, 'warning');
    assert.strictEqual(byId['coordinate-source-datum'].status, 'warning');
    assert.strictEqual(byId['coordinate-anchor-provenance'].status, 'warning');
    assert.strictEqual(gate.ready, true, 'warnings must not block deploy');
    return { convergenceDeg: meta.transform.gridConvergenceDeg, rotErr: meta.transform.maxFrameRotationErrorMeters };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  testSouthernInverse();
  testVehiclePoseGate();
  const gk = await testGkConvergenceGate();
  console.log(JSON.stringify({ southernInverse: 'ok', vehiclePoseGate: 'ok', gkGate: gk }));
  console.log('[pass] converter-coordinate-safety');
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

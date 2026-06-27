'use strict';
// Locks elevation support: a point cloud with a slope (ramp) must produce a DEM
// whose sampled z follows the slope, and the converter must stamp that varying z
// onto the published lanes instead of a single flat anchor height.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { buildElevationGrid, sampleElevation } = require('../backend/runtime/elevationGrid');
const converter = require('../backend/runtime/editorMapConverter');

const CENTER = { x: 729003.7468, y: 4298924.2408, z: 2.5934 };
const SLOPE = 0.2; // 20% grade ramp along local x: local z = 0.2 * x

// Write a synthetic base map whose point cloud is a planar ramp (z = SLOPE*x),
// stored in the real block format: float32 xyz (first N*12 bytes) then uint8 rgb.
function writeRampBaseMap(dir) {
  const pc = path.join(dir, 'point_cloud');
  const blocks = path.join(pc, 'blocks');
  fs.mkdirSync(blocks, { recursive: true });
  fs.writeFileSync(
    path.join(pc, 'index.json'),
    JSON.stringify({
      version: 1,
      binaryLayout: { position: 'float32_xyz', color: 'uint8_rgb', order: 'positions_then_colors' },
      center: CENTER,
      bounds: {},
    }),
  );
  const pts = [];
  for (let x = -50; x <= 50; x += 0.5) {
    for (let y = -50; y <= 50; y += 0.5) {
      pts.push([x, y, SLOPE * x]);
    }
  }
  const n = pts.length;
  const buf = Buffer.alloc(n * 15); // positions n*12, then colors n*3 (zeros)
  for (let i = 0; i < n; i += 1) {
    buf.writeFloatLE(pts[i][0], i * 12);
    buf.writeFloatLE(pts[i][1], i * 12 + 4);
    buf.writeFloatLE(pts[i][2], i * 12 + 8);
  }
  fs.writeFileSync(path.join(blocks, 'l0_0_0.bin'), buf);
}

function testGrid(dir) {
  const grid = buildElevationGrid(dir);
  assert.ok(grid && grid.cellCount > 0, 'grid built');
  assert.ok(Math.abs(grid.zRange.min - -10) < 0.6 && Math.abs(grid.zRange.max - 10) < 0.6, `z range ~[-10,10], got ${JSON.stringify(grid.zRange)}`);
  // sampled z follows the slope
  for (const x of [-30, -10, 0, 15, 30]) {
    const z = sampleElevation(grid, x, 0);
    assert.ok(Number.isFinite(z) && Math.abs(z - SLOPE * x) < 0.6, `sample at x=${x}: expected ~${SLOPE * x}, got ${z}`);
  }
  // outside coverage -> null (don't invent height)
  assert.strictEqual(sampleElevation(grid, 500, 500), null, 'no coverage -> null');
}

function rampLaneMap() {
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const attr = { speed: 30, speedKph: 30, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };
  return {
    header: { version: 'ramp', date: '2026-01-01T00:00:00.000Z' },
    sourceCrs: 'LOCAL_ENU_METERS',
    coordinateMetadata: {
      sourceCrs: 'LOCAL_ENU_METERS',
      anchor: { source: 'test', sourceCrs: 'GAUSS_KRUGER_CM114', sourceOrigin: CENTER },
    },
    // lane up the ramp: x from -30 to 30 at y=0
    point: [pt('L0', -30, -1.75), pt('L1', 30, -1.75), pt('R0', -30, 1.75), pt('R1', 30, 1.75)],
    boundary: [
      { id: 'bL', point_id: ['L0', 'L1'], type: 7, controlsPosition: [] },
      { id: 'bR', point_id: ['R0', 'R1'], type: 7, controlsPosition: [] },
    ],
    lane: [{ id: '1', left_boundary_id: 'bL', right_boundary_id: 'bR', width: 3.5, type: 1, attr }],
  };
}

async function testConverterElevation(baseDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elev-'));
  const rel = path.join(dir, 'out');
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(rampLaneMap()));
  try {
    await converter.convertEditorMapToApolloPackage({ mapName: 'ramp', jsonPath, releaseDir: rel, baseMapDir: baseDir });
    const base = fs.readFileSync(path.join(rel, 'base_map.txt'), 'utf8');
    const zs = [...base.matchAll(/z:\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]));
    const distinct = new Set(zs.map((z) => z.toFixed(2)));
    assert.ok(distinct.size > 1, `lane z must vary along the ramp, got ${distinct.size} distinct (${[...distinct]})`);
    const span = Math.max(...zs) - Math.min(...zs);
    // ramp over x∈[-30,30] at slope 0.2 => ~12 m of local relief
    assert.ok(span > 8, `z span should reflect the ramp (~12m), got ${span.toFixed(2)}m`);
    // absolute z = local z + center.z (2.5934): endpoints ~ -6+2.59 and 6+2.59
    assert.ok(Math.min(...zs) < 0 && Math.max(...zs) > 6, `absolute z should span the ramp incl. center offset, got [${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}]`);
    const manifest = JSON.parse(fs.readFileSync(path.join(rel, 'manifest.json'), 'utf8'));
    const elev = manifest.summary?.elevation || manifest.elevation || null;
    return { zSpan: Number(span.toFixed(2)), distinctZ: distinct.size, elevationApplied: elev?.applied };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A curved (cubic-bezier) boundary on the ramp must follow the grade, NOT sag
// toward 0 mid-segment (regression for the bezier-control elevation bug). Curve
// from x=10..30 on slope 0.2: endpoints local z 2,6; controls at x=15,25 -> 3,5;
// mid local z must be ~4 (abs ~6.6), and no curve point may dip near the sag (~1
// local / ~3.6 abs) that unsampled z=0 controls would produce.
function curvedRampMap() {
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const attr = { speed: 30, speedKph: 30, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };
  return {
    header: { version: 'curve', date: '2026-01-01T00:00:00.000Z' },
    sourceCrs: 'LOCAL_ENU_METERS',
    coordinateMetadata: { sourceCrs: 'LOCAL_ENU_METERS', anchor: { source: 'test', sourceCrs: 'GAUSS_KRUGER_CM114', sourceOrigin: CENTER } },
    point: [pt('L0', 10, -1.75), pt('L1', 30, -1.75), pt('R0', 10, 1.75), pt('R1', 30, 1.75)],
    boundary: [
      { id: 'bL', point_id: ['L0', 'L1'], type: 7, controlsPosition: [{ x: 15, y: -1.75 }, { x: 25, y: -1.75 }] },
      { id: 'bR', point_id: ['R0', 'R1'], type: 7, controlsPosition: [{ x: 15, y: 1.75 }, { x: 25, y: 1.75 }] },
    ],
    lane: [{ id: '1', left_boundary_id: 'bL', right_boundary_id: 'bR', width: 3.5, type: 1, attr }],
  };
}

async function testCurvedNoSag(baseDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curve-'));
  const rel = path.join(dir, 'out');
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(curvedRampMap()));
  try {
    await converter.convertEditorMapToApolloPackage({ mapName: 'curve', jsonPath, releaseDir: rel, baseMapDir: baseDir });
    const base = fs.readFileSync(path.join(rel, 'base_map.txt'), 'utf8');
    const zs = [...base.matchAll(/z:\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]));
    const minZ = Math.min(...zs);
    // absolute lower-endpoint grade ~ 2 + 2.5934 = 4.59; the z=0-control sag dips to ~3.6.
    assert.ok(minZ > 4.2, `curved boundary sagged: min z ${minZ.toFixed(2)} should stay on grade (>4.2, sag would be ~3.6)`);
    return { minZ: Number(minZ.toFixed(2)), maxZ: Number(Math.max(...zs).toFixed(2)) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'basemap-'));
  try {
    writeRampBaseMap(baseDir);
    testGrid(baseDir);
    const r = await testConverterElevation(baseDir);
    const c = await testCurvedNoSag(baseDir);
    console.log(JSON.stringify({ grid: 'ok', converter: r, curvedNoSag: c }));
    console.log('[pass] elevation');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

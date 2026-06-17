'use strict';
// Locks default routing/POI generation: the converter must emit Apollo-native
// default_end_way_point.txt + default_cycle_routing.txt (apollo.routing.POI text
// proto) so Dreamview stops logging "Failed to load default routing/POI" for
// MapEditor maps. A closed loop becomes a routable multi-segment loop, so each
// loop lane gets one waypoint.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { convertEditorMapToApolloPackage } = require('../backend/runtime/editorMapConverter');

// A closed circular loop (outer + inner ring) — split into open segments and
// routed into a loop by the converter.
function loopMap() {
  const origin = { x: 468300, y: 4293900, z: 0 };
  const pt = (id, x, y) => ({ id, position: { x, y, z: 0 }, type: 1 });
  const point = [
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
    header: { version: 'route', date: '2026-01-01T00:00:00.000Z' },
    apolloOrigin: origin,
    point,
    boundary: [
      { id: 'bO', point_id: oIds, type: 7, controlsPosition: [] },
      { id: 'bI', point_id: iIds, type: 7, controlsPosition: [] },
    ],
    lane: [{ id: 'loop', left_boundary_id: 'bO', right_boundary_id: 'bI', width: 3, type: 1, attr }],
  };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-'));
  const rel = path.join(dir, 'out');
  try {
    await convertEditorMapToApolloPackage({ mapName: 'route-test', jsonPath: writeTmp(dir), releaseDir: rel, baseMapDir: null });

    const wp = path.join(rel, 'default_end_way_point.txt');
    const cyc = path.join(rel, 'default_cycle_routing.txt');
    assert.ok(fs.existsSync(wp), 'default_end_way_point.txt must be written');
    assert.ok(fs.existsSync(cyc), 'default_cycle_routing.txt must be written');

    const text = fs.readFileSync(wp, 'utf8');
    assert.ok(fs.readFileSync(cyc, 'utf8') === text, 'cycle routing must match end_way_point content');

    // apollo.routing.POI text-proto shape.
    assert.ok(/^landmark \{/m.test(text), 'must be a routing.POI landmark block');
    const waypoints = text.match(/waypoint \{/g) || [];
    assert.ok(waypoints.length >= 2, `expected multiple loop waypoints, got ${waypoints.length}`);
    assert.ok(/\n {4}id: "[^"]+"/.test(text), 'waypoints carry a lane id');
    assert.ok(/\n {4}s: [\d.]+/.test(text), 'waypoints carry a station s');
    assert.ok(/pose \{\s*\n\s*x: [-\d.]+\s*\n\s*y: [-\d.]+\s*\n\s*z: [-\d.]+/.test(text), 'waypoints carry an x/y/z pose');

    // Every waypoint id must be a real lane in base_map.txt.
    const base = fs.readFileSync(path.join(rel, 'base_map.txt'), 'utf8');
    const laneIds = new Set((base.match(/id \{\s*id: "([^"]+)"/g) || []).map((m) => m.match(/"([^"]+)"/)[1]));
    const ids = [...text.matchAll(/\n {4}id: "([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) assert.ok(laneIds.has(id), `waypoint lane ${id} must exist in base_map`);

    console.log(JSON.stringify({ waypoints: waypoints.length, allLanesExist: true }));
    console.log('[pass] converter-default-routing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeTmp(dir) {
  const p = path.join(dir, 'in.json');
  fs.writeFileSync(p, JSON.stringify(loopMap()));
  return p;
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

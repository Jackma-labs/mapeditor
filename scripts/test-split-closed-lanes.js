// Self-contained test for auto-split of closed/self-returning lanes.
// A single closed-loop lane must become multiple connected open segments that
// form a routing cycle; open lanes must pass through unchanged. No data/ needed.
const assert = require('assert');
const { splitClosedLanes } = require('../backend/runtime/splitClosedLanes');

function buildClosedLoopMap() {
  // Two concentric circular rings (outer r=20, inner r=17), one closed lane.
  const N = 24;
  const point = [];
  const outerIds = [];
  const innerIds = [];
  for (let i = 0; i < N; i += 1) {
    const a = (2 * Math.PI * i) / N;
    const oid = `o${i}`;
    const iid = `i${i}`;
    point.push({ id: oid, position: { x: 20 * Math.cos(a), y: 20 * Math.sin(a), z: 0 }, type: 1 });
    point.push({ id: iid, position: { x: 17 * Math.cos(a), y: 17 * Math.sin(a), z: 0 }, type: 1 });
    outerIds.push(oid);
    innerIds.push(iid);
  }
  // close the rings (duplicate first position)
  outerIds.push(outerIds[0]);
  innerIds.push(innerIds[0]);
  return {
    header: { version: 'closed-loop-test' },
    point,
    boundary: [
      { id: 'bo', point_id: outerIds, type: 7, controlsPosition: [] },
      { id: 'bi', point_id: innerIds, type: 7, controlsPosition: [] },
    ],
    lane: [
      {
        id: 'L1',
        left_boundary_id: 'bo',
        right_boundary_id: 'bi',
        left_boundary_reverse: false,
        right_boundary_reverse: false,
        width: 3,
        type: 1,
        attr: { speed: 40, speedKph: 40, direction: 1, prossibleDrivingDirection: 1, laneType: 1 },
      },
    ],
  };
}

function buildOpenLaneMap() {
  // Straight open lane (distinct endpoints) — must NOT be split.
  const point = [];
  const oIds = [];
  const iIds = [];
  for (let i = 0; i < 6; i += 1) {
    point.push({ id: `o${i}`, position: { x: i * 5, y: 0, z: 0 }, type: 1 });
    point.push({ id: `i${i}`, position: { x: i * 5, y: 3, z: 0 }, type: 1 });
    oIds.push(`o${i}`);
    iIds.push(`i${i}`);
  }
  return {
    point,
    boundary: [
      { id: 'bo', point_id: oIds, type: 7, controlsPosition: [] },
      { id: 'bi', point_id: iIds, type: 7, controlsPosition: [] },
    ],
    lane: [{ id: 'L1', left_boundary_id: 'bo', right_boundary_id: 'bi', width: 3, type: 1 }],
  };
}

function endpoints(map, lane) {
  const bm = new Map(map.boundary.map((b) => [String(b.id), b]));
  const ids = (b) => b.point_id || b.pointIds || b.pointId || [];
  const lb = ids(bm.get(String(lane.left_boundary_id)));
  const rb = ids(bm.get(String(lane.right_boundary_id)));
  return { start: `${lb[0]}|${rb[0]}`, end: `${lb[lb.length - 1]}|${rb[rb.length - 1]}` };
}

function main() {
  // 1) closed loop splits into a connected cycle
  const closed = splitClosedLanes(buildClosedLoopMap());
  assert.strictEqual(closed.report.splitLanes.length, 1, 'one closed lane detected');
  const segs = closed.map.lane;
  assert.ok(segs.length >= 3, `closed loop split into >=3 segments (got ${segs.length})`);
  // original closed lane removed; all outputs are new segments
  assert.ok(!segs.some((l) => l.id === 'L1'), 'original closed lane removed');
  // consecutive segments share an endpoint node; last connects back to first (cycle)
  const eps = segs.map((l) => endpoints(closed.map, l));
  for (let i = 0; i < segs.length; i += 1) {
    const next = (i + 1) % segs.length;
    assert.strictEqual(eps[i].end, eps[next].start, `segment ${i} end connects to segment ${next} start (cycle)`);
  }

  // 2) open lane passes through unchanged
  const open = splitClosedLanes(buildOpenLaneMap());
  assert.strictEqual(open.report.splitLanes.length, 0, 'open lane not split');
  assert.strictEqual(open.map.lane.length, 1, 'open lane count unchanged');
  assert.strictEqual(open.map.lane[0].id, 'L1', 'open lane id unchanged');

  console.log(
    JSON.stringify({
      closedLoopSegments: segs.length,
      cycleConnected: true,
      openLanePassthrough: true,
    }),
  );
  console.log('[pass] split-closed-lanes');
}

main();

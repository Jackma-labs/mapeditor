'use strict';

// Auto-split closed / self-returning lanes into connected open segments.
//
// Apollo HD-map lanes must be open, directional, non-self-returning segments.
// Users naturally draw loops (circle / roundabout / ramp) as a SINGLE lane whose
// centerline returns to its start (chord ~= 0). Such a lane converts to degenerate
// Apollo geometry (curves flattened, widths broken at the fold-back, overlapping
// lines). This module detects those lanes and rewrites each one into K open arc
// segments connected end-to-end into a routing cycle (a real roundabout), so the
// published map is valid and drivable.
//
// Shape-preserving: segments are resampled along the user's drawn boundary
// polylines by arc length. Geometry is NOT beautified/smoothed here (that is a
// separate, opt-in step). The user's source editor_map is never modified — this
// runs on the in-memory map during conversion only.

const CLOSED_LANE_MAX_CHORD_METERS = 2.0;
const CLOSED_LANE_MIN_LENGTH_METERS = 8.0;
const CLOSED_DUPLICATE_POINT_METERS = 0.6;
const SEGMENT_TARGET_LENGTH_METERS = 40;
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 16;
const MIN_POINTS_PER_SEGMENT = 4;
// Phase 2 smoothing: Taubin (lambda/mu) smoothing removes hand-drawn jitter
// without shrinking the loop; the lane is then rebuilt at constant width.
const SMOOTH_ITERATIONS = 30;
const SMOOTH_LAMBDA = 0.5;
const SMOOTH_MU = -0.53;
const MIN_LANE_WIDTH_METERS = 1.8;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
}

function boundaryPointIds(boundary) {
  if (!boundary) {
    return [];
  }
  return arr(boundary.point_id || boundary.pointIds || boundary.pointId);
}

function boundaryControls(boundary) {
  return arr(boundary && boundary.controlsPosition);
}

// Sample a polyline at a given arc length (0..total).
function interpAtLength(points, target) {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (points.length === 1 || target <= 0) {
    return { ...points[0] };
  }
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const seg = dist(points[i - 1], points[i]);
    if (walked + seg >= target) {
      const local = seg > 0 ? (target - walked) / seg : 0;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * local,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * local,
        z: points[i - 1].z + (points[i].z - points[i - 1].z) * local,
      };
    }
    walked += seg;
  }
  return { ...points[points.length - 1] };
}

// Resample a CLOSED loop polyline into `count` evenly arc-spaced points
// (point[0] at length 0, point[count-1] at length L*(count-1)/count; the loop
// closes point[count-1] -> point[0]). Returns distinct points (no closing dup).
function resampleClosed(points, count) {
  const total = polylineLength(points);
  if (total <= 0) {
    return points.slice(0, count);
  }
  return Array.from({ length: count }, (_unused, i) => interpAtLength(points, (total * i) / count));
}

function cubicBezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    z: u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
  };
}

// Resolve a boundary's drawn geometry (expanding a single cubic bezier when the
// boundary carries control points), honoring the lane's reverse flag.
function boundaryGeometry(boundary, pointMap, reverse) {
  const ids = boundaryPointIds(boundary).map((id) => String(id));
  let points = ids
    .map((id) => pointMap.get(id))
    .filter(Boolean)
    .map((p) => ({ x: num(p.position.x), y: num(p.position.y), z: num(p.position.z) }));
  const controls = boundaryControls(boundary).map((c) => ({ x: num(c.x), y: num(c.y), z: num(c.z) }));
  if (points.length >= 2 && controls.length >= 2) {
    const SAMPLES = 32;
    points = Array.from({ length: SAMPLES }, (_unused, i) =>
      cubicBezierPoint(points[0], controls[0], controls[1], points[points.length - 1], i / (SAMPLES - 1)),
    );
  }
  if (reverse) {
    points = points.slice().reverse();
  }
  return points;
}

function laneBoundaryIds(lane) {
  return {
    leftId: lane.left_boundary_id !== undefined && lane.left_boundary_id !== null
      ? lane.left_boundary_id
      : lane.leftBoundaryId,
    rightId: lane.right_boundary_id !== undefined && lane.right_boundary_id !== null
      ? lane.right_boundary_id
      : lane.rightBoundaryId,
    leftReverse: Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse),
    rightReverse: Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse),
  };
}

// Decide how many segments to split a loop into.
function segmentCount(loopLength) {
  const byLength = Math.ceil(loopLength / SEGMENT_TARGET_LENGTH_METERS);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, byLength));
}

// One Laplacian smoothing step on a CLOSED polyline (wraps at the ends).
function laplacianStepClosed(points, factor) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[(i + 1) % n];
    return {
      x: p.x + factor * ((a.x + b.x) / 2 - p.x),
      y: p.y + factor * ((a.y + b.y) / 2 - p.y),
      z: p.z,
    };
  });
}

// Taubin smoothing: alternating lambda (+) and mu (-) Laplacian passes remove
// high-frequency jitter while preserving the loop's overall size (no shrinkage).
function taubinSmoothClosed(points) {
  if (points.length < 4) {
    return points;
  }
  let result = points;
  for (let k = 0; k < SMOOTH_ITERATIONS; k += 1) {
    result = laplacianStepClosed(result, SMOOTH_LAMBDA);
    result = laplacianStepClosed(result, SMOOTH_MU);
  }
  return result;
}

// Build two constant-width boundary rings by offsetting a closed centerline
// along its local normal (central-difference tangent for smooth normals).
function offsetConstantWidthRings(center, halfWidth) {
  const n = center.length;
  const outer = [];
  const inner = [];
  for (let i = 0; i < n; i += 1) {
    const prev = center[(i - 1 + n) % n];
    const next = center[(i + 1) % n];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    outer.push({ x: center[i].x + nx * halfWidth, y: center[i].y + ny * halfWidth, z: center[i].z });
    inner.push({ x: center[i].x - nx * halfWidth, y: center[i].y - ny * halfWidth, z: center[i].z });
  }
  return { outer, inner };
}

// Main entry. Returns { map, report }. `map` is a shallow clone with closed
// lanes replaced by connected open segments. Open lanes are passed through.
function splitClosedLanes(editorMap, options = {}) {
  // smooth: rebuild each split loop as a smooth, constant-width lane (Phase 2).
  // Defaults on; pass { smooth: false } for shape-preserving split (Phase 1).
  const smooth = options.smooth !== false;
  const report = { splitLanes: [], segmentsAdded: 0, skipped: [], smooth };
  if (!editorMap || !Array.isArray(editorMap.lane) || editorMap.lane.length === 0) {
    return { map: editorMap, report };
  }

  const pointMap = new Map();
  for (const p of arr(editorMap.point)) {
    if (p && p.position) {
      pointMap.set(String(p.id), p);
    }
  }
  const boundaryMap = new Map();
  for (const b of arr(editorMap.boundary)) {
    boundaryMap.set(String(b.id), b);
  }

  // Count how many lanes reference each boundary, so we only remove boundaries
  // that belong exclusively to a lane we are splitting.
  const boundaryRefCount = new Map();
  for (const lane of editorMap.lane) {
    const { leftId, rightId } = laneBoundaryIds(lane);
    for (const id of [leftId, rightId]) {
      if (id !== undefined && id !== null) {
        boundaryRefCount.set(String(id), (boundaryRefCount.get(String(id)) || 0) + 1);
      }
    }
  }

  // Unique id generation for new points / boundaries / lanes.
  let pointSeq = 0;
  let idSeq = 0;
  const existingPointIds = new Set([...pointMap.keys()]);
  const newPointId = () => {
    let id;
    do {
      pointSeq += 1;
      id = `cl_p_${pointSeq}`;
    } while (existingPointIds.has(id));
    existingPointIds.add(id);
    return id;
  };

  const lanesOut = [];
  const boundariesOut = arr(editorMap.boundary).slice();
  const pointsOut = arr(editorMap.point).slice();
  const removeBoundaryIds = new Set();

  for (const lane of editorMap.lane) {
    const { leftId, rightId, leftReverse, rightReverse } = laneBoundaryIds(lane);
    const leftBoundary = boundaryMap.get(String(leftId));
    const rightBoundary = boundaryMap.get(String(rightId));

    // Only handle boundary-based lanes; pass everything else through unchanged.
    if (!leftBoundary || !rightBoundary || arr(lane.points).length >= 2 || arr(lane.point_id).length >= 2) {
      lanesOut.push(lane);
      continue;
    }

    let left = boundaryGeometry(leftBoundary, pointMap, leftReverse);
    let right = boundaryGeometry(rightBoundary, pointMap, rightReverse);
    if (left.length < 2 || right.length < 2) {
      lanesOut.push(lane);
      continue;
    }

    // Closed-loop detection on the midpoint centerline.
    const startMid = { x: (left[0].x + right[0].x) / 2, y: (left[0].y + right[0].y) / 2 };
    const lastL = left[left.length - 1];
    const lastR = right[right.length - 1];
    const endMid = { x: (lastL.x + lastR.x) / 2, y: (lastL.y + lastR.y) / 2 };
    const loopLength = Math.max(polylineLength(left), polylineLength(right));
    const chord = dist(startMid, endMid);
    const isClosed = loopLength >= CLOSED_LANE_MIN_LENGTH_METERS && chord < CLOSED_LANE_MAX_CHORD_METERS;
    if (!isClosed) {
      lanesOut.push(lane);
      continue;
    }

    // Boundaries shared with other lanes can't be safely rewritten here.
    if ((boundaryRefCount.get(String(leftId)) || 0) > 1 || (boundaryRefCount.get(String(rightId)) || 0) > 1) {
      report.skipped.push({ laneId: lane.id, reason: 'boundary-shared-with-other-lane' });
      lanesOut.push(lane);
      continue;
    }

    // Drop the closing duplicate so the loop is described by distinct points.
    if (dist(left[0], left[left.length - 1]) < CLOSED_DUPLICATE_POINT_METERS) {
      left = left.slice(0, -1);
    }
    if (dist(right[0], right[right.length - 1]) < CLOSED_DUPLICATE_POINT_METERS) {
      right = right.slice(0, -1);
    }

    const K = segmentCount(loopLength);
    const ptsPerSeg = Math.max(MIN_POINTS_PER_SEGMENT, Math.round(Math.max(left.length, right.length) / K));
    const P = K * ptsPerSeg;

    let outerPts;
    let innerPts;
    let laneWidth = num(lane.width, 3.5);
    if (smooth) {
      // Phase 2: rebuild the loop as a smooth, constant-width lane. Take the
      // midpoint centerline, Taubin-smooth it (removes hand-drawn jitter, no
      // shrinkage), and offset both sides by the measured average half-width.
      const leftR = resampleClosed(left, P);
      const rightR = resampleClosed(right, P);
      let widthSum = 0;
      for (let i = 0; i < P; i += 1) {
        widthSum += dist(leftR[i], rightR[i]);
      }
      const measuredWidth = P > 0 ? widthSum / P : num(lane.width, 3.5);
      laneWidth = Math.max(MIN_LANE_WIDTH_METERS, measuredWidth > 0 ? measuredWidth : num(lane.width, 3.5));
      let center = leftR.map((p, i) => ({
        x: (p.x + rightR[i].x) / 2,
        y: (p.y + rightR[i].y) / 2,
        z: (p.z + rightR[i].z) / 2,
      }));
      center = taubinSmoothClosed(center);
      const rings = offsetConstantWidthRings(center, laneWidth / 2);
      outerPts = rings.outer;
      innerPts = rings.inner;
    } else {
      // Phase 1: shape-preserving (no smoothing).
      outerPts = resampleClosed(left, P);
      innerPts = resampleClosed(right, P);
    }

    // Materialize ring points as new point objects (segments share node ids).
    const z0 = num(left[0].z);
    const outerIds = outerPts.map((pt) => {
      const id = newPointId();
      pointsOut.push({ id, position: { x: pt.x, y: pt.y, z: num(pt.z, z0) }, type: 1 });
      return id;
    });
    const innerIds = innerPts.map((pt) => {
      const id = newPointId();
      pointsOut.push({ id, position: { x: pt.x, y: pt.y, z: num(pt.z, z0) }, type: 1 });
      return id;
    });

    const baseId = `${lane.id}__cl`;
    const boundaryType = num(leftBoundary.type, 7);
    const width = laneWidth;
    const attr = lane.attr ? JSON.parse(JSON.stringify(lane.attr)) : undefined;
    for (let s = 0; s < K; s += 1) {
      const a = s * ptsPerSeg;
      const b = (s + 1) * ptsPerSeg; // inclusive end node (wraps to 0 on last segment)
      const oSeg = [];
      const iSeg = [];
      for (let i = a; i <= b; i += 1) {
        oSeg.push(outerIds[i % P]);
        iSeg.push(innerIds[i % P]);
      }
      const lbId = `${baseId}_b${s}L`;
      const rbId = `${baseId}_b${s}R`;
      idSeq += 1;
      boundariesOut.push({ id: lbId, point_id: oSeg, pointIds: oSeg, pointId: oSeg, type: boundaryType, controlsPosition: [] });
      boundariesOut.push({ id: rbId, point_id: iSeg, pointIds: iSeg, pointId: iSeg, type: boundaryType, controlsPosition: [] });
      const segLane = {
        id: `${baseId}_seg${s}`,
        left_boundary_id: lbId,
        right_boundary_id: rbId,
        leftBoundaryId: lbId,
        rightBoundaryId: rbId,
        left_boundary_reverse: false,
        right_boundary_reverse: false,
        leftBoundaryReverse: false,
        rightBoundaryReverse: false,
        width,
        type: lane.type,
      };
      if (attr) {
        segLane.attr = JSON.parse(JSON.stringify(attr));
      }
      if (lane.groudId !== undefined) {
        segLane.groudId = lane.groudId;
      }
      lanesOut.push(segLane);
    }

    // Remove the original closed lane's exclusive boundaries.
    removeBoundaryIds.add(String(leftId));
    removeBoundaryIds.add(String(rightId));
    report.splitLanes.push({ laneId: lane.id, segments: K, loopLength: Number(loopLength.toFixed(1)) });
    report.segmentsAdded += K;
  }

  if (report.splitLanes.length === 0) {
    return { map: editorMap, report };
  }

  const map = { ...editorMap };
  map.point = pointsOut;
  map.boundary = boundariesOut.filter((b) => !removeBoundaryIds.has(String(b.id)));
  map.lane = lanesOut;
  return { map, report };
}

module.exports = { splitClosedLanes };

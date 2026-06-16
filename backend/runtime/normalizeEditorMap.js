'use strict';

// Single-point normalization of an editor_map before conversion.
//
// Field names drift across the chain (store.export / loadHdmp / converter /
// splitClosedLanes): point_id vs pointId vs pointIds, left_boundary_id vs
// leftBoundaryId, boundaryId vs boundary_id, controlsPosition vs
// controls_position. Each reader re-implements its own alias fallbacks, and a
// missed alias silently drops geometry. This layer canonicalizes every element
// ONCE (filling all aliases to the same value and coercing shapes) so no
// downstream reader can miss a field, and reports which aliases it had to fix.
//
// It is additive/transparent: a canonical (snake_case) map is returned
// unchanged in value, so conversion output stays byte-identical.

function arr(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value]; // coerce a stray scalar/object into a single-element list
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) {
      return v;
    }
  }
  return undefined;
}

// Fill every alias of a logical field with one canonical value (idempotent).
function setAliases(target, aliases, value, report, kind) {
  if (value === undefined) {
    return;
  }
  for (const a of aliases) {
    if (target[a] === undefined || target[a] === null) {
      if (report && kind && target[aliases[0]] !== undefined) {
        report.fixed[kind] = (report.fixed[kind] || 0) + 1;
      }
      target[a] = value;
    }
  }
}

function normalizeBoundary(b, report) {
  const pointIds = arr(firstDefined(b.point_id, b.pointIds, b.pointId));
  if (!Array.isArray(b.point_id) && pointIds.length) {
    report.fixed.boundaryPointIdAlias = (report.fixed.boundaryPointIdAlias || 0) + 1;
  }
  b.point_id = pointIds;
  b.pointIds = pointIds;
  b.pointId = pointIds;
  const controls = arr(firstDefined(b.controlsPosition, b.controls_position));
  b.controlsPosition = controls;
  b.controls_position = controls;
  return b;
}

function normalizeLane(lane, report) {
  const leftId = firstDefined(lane.left_boundary_id, lane.leftBoundaryId);
  const rightId = firstDefined(lane.right_boundary_id, lane.rightBoundaryId);
  if (lane.left_boundary_id === undefined && lane.leftBoundaryId !== undefined) {
    report.fixed.laneBoundaryAlias = (report.fixed.laneBoundaryAlias || 0) + 1;
  }
  setAliases(lane, ['left_boundary_id', 'leftBoundaryId'], leftId);
  setAliases(lane, ['right_boundary_id', 'rightBoundaryId'], rightId);
  const leftRev = Boolean(firstDefined(lane.left_boundary_reverse, lane.leftBoundaryReverse, false));
  const rightRev = Boolean(firstDefined(lane.right_boundary_reverse, lane.rightBoundaryReverse, false));
  lane.left_boundary_reverse = leftRev;
  lane.leftBoundaryReverse = leftRev;
  lane.right_boundary_reverse = rightRev;
  lane.rightBoundaryReverse = rightRev;
  return lane;
}

function normalizeBoundaryRef(item, report) {
  const bid = firstDefined(item.boundaryId, item.boundary_id);
  if (bid !== undefined) {
    if (item.boundaryId === undefined) {
      report.fixed.elementBoundaryAlias = (report.fixed.elementBoundaryAlias || 0) + 1;
    }
    item.boundaryId = bid;
    item.boundary_id = bid;
  }
  return item;
}

const BOUNDARY_REF_COLLECTIONS = [
  'crosswalk',
  'crosswalks',
  'junction',
  'junctions',
  'speedBump',
  'speed_bump',
  'speedBumps',
  'stopLine',
  'stop_line',
  'stopLines',
  'parkingSpace',
  'parking_space',
  'parkingSpaces',
  'area',
  'areas',
];

function normalizeEditorMap(editorMap) {
  const report = { fixed: {} };
  if (!editorMap || typeof editorMap !== 'object') {
    return { map: editorMap, report };
  }
  // Shallow clone so we never mutate the caller's parsed object.
  const map = { ...editorMap };

  if (Array.isArray(map.boundary)) {
    map.boundary = map.boundary.filter((b) => b && typeof b === 'object').map((b) => normalizeBoundary({ ...b }, report));
  }
  for (const key of ['roadBoundary', 'road_boundary']) {
    if (Array.isArray(map[key])) {
      map[key] = map[key].filter((b) => b && typeof b === 'object').map((b) => normalizeBoundary({ ...b }, report));
    }
  }
  if (Array.isArray(map.lane)) {
    map.lane = map.lane.filter((l) => l && typeof l === 'object').map((l) => normalizeLane({ ...l }, report));
  }
  for (const key of BOUNDARY_REF_COLLECTIONS) {
    if (Array.isArray(map[key])) {
      map[key] = map[key].filter((x) => x && typeof x === 'object').map((x) => normalizeBoundaryRef({ ...x }, report));
    }
  }

  return { map, report };
}

module.exports = { normalizeEditorMap };

const fs = require('fs/promises');
const path = require('path');
const protobuf = require('protobufjs');

const LANE_TYPE = {
  NONE: 1,
  CITY_DRIVING: 2,
  BIKING: 3,
  SIDEWALK: 4,
  PARKING: 5,
  SHOULDER: 6,
};

const LANE_TURN = {
  NO_TURN: 1,
  LEFT_TURN: 2,
  RIGHT_TURN: 3,
  U_TURN: 4,
};

const LANE_DIRECTION = {
  FORWARD: 1,
  BACKWARD: 2,
  BIDIRECTION: 3,
};

function addType(parent, name, fields) {
  const type = new protobuf.Type(name);
  fields.forEach((field) => {
    type.add(new protobuf.Field(field[0], field[1], field[2], field[3] || 'optional'));
  });
  parent.add(type);
  return type;
}

function createProtoRoot() {
  const root = new protobuf.Root();
  const apollo = root.define('apollo');
  const common = apollo.define('common');
  const hdmap = apollo.define('hdmap');
  const routing = apollo.define('routing');

  addType(common, 'PointENU', [
    ['x', 1, 'double'],
    ['y', 2, 'double'],
    ['z', 3, 'double'],
  ]);

  addType(hdmap, 'Id', [['id', 1, 'string']]);
  addType(hdmap, 'Projection', [['proj', 1, 'string']]);
  addType(hdmap, 'Header', [
    ['version', 1, 'bytes'],
    ['date', 2, 'bytes'],
    ['projection', 3, 'Projection'],
    ['district', 4, 'bytes'],
    ['generation', 5, 'bytes'],
    ['revMajor', 6, 'bytes'],
    ['revMinor', 7, 'bytes'],
    ['left', 8, 'double'],
    ['top', 9, 'double'],
    ['right', 10, 'double'],
    ['bottom', 11, 'double'],
    ['vendor', 12, 'bytes'],
  ]);
  addType(hdmap, 'Polygon', [['point', 1, 'apollo.common.PointENU', 'repeated']]);
  addType(hdmap, 'LineSegment', [['point', 1, 'apollo.common.PointENU', 'repeated']]);
  addType(hdmap, 'CurveSegment', [
    ['lineSegment', 1, 'LineSegment'],
    ['s', 6, 'double'],
    ['startPosition', 7, 'apollo.common.PointENU'],
    ['heading', 8, 'double'],
    ['length', 9, 'double'],
  ]);
  addType(hdmap, 'Curve', [['segment', 1, 'CurveSegment', 'repeated']]);

  const laneBoundaryType = addType(hdmap, 'LaneBoundaryType', [
    ['s', 1, 'double'],
    ['types', 2, 'Type', 'repeated'],
  ]);
  laneBoundaryType.add(
    new protobuf.Enum('Type', {
      UNKNOWN: 0,
      DOTTED_YELLOW: 1,
      DOTTED_WHITE: 2,
      SOLID_YELLOW: 3,
      SOLID_WHITE: 4,
      DOUBLE_YELLOW: 5,
      CURB: 6,
    })
  );

  addType(hdmap, 'LaneBoundary', [
    ['curve', 1, 'Curve'],
    ['length', 2, 'double'],
    ['virtual', 3, 'bool'],
    ['boundaryType', 4, 'LaneBoundaryType', 'repeated'],
  ]);
  addType(hdmap, 'LaneSampleAssociation', [
    ['s', 1, 'double'],
    ['width', 2, 'double'],
  ]);
  const lane = addType(hdmap, 'Lane', [
    ['id', 1, 'Id'],
    ['centralCurve', 2, 'Curve'],
    ['leftBoundary', 3, 'LaneBoundary'],
    ['rightBoundary', 4, 'LaneBoundary'],
    ['length', 5, 'double'],
    ['speedLimit', 6, 'double'],
    ['overlapId', 7, 'Id', 'repeated'],
    ['predecessorId', 8, 'Id', 'repeated'],
    ['successorId', 9, 'Id', 'repeated'],
    ['leftNeighborForwardLaneId', 10, 'Id', 'repeated'],
    ['rightNeighborForwardLaneId', 11, 'Id', 'repeated'],
    ['type', 12, 'LaneType'],
    ['turn', 13, 'LaneTurn'],
    ['leftNeighborReverseLaneId', 14, 'Id', 'repeated'],
    ['rightNeighborReverseLaneId', 15, 'Id', 'repeated'],
    ['junctionId', 16, 'Id'],
    ['leftSample', 17, 'LaneSampleAssociation', 'repeated'],
    ['rightSample', 18, 'LaneSampleAssociation', 'repeated'],
    ['direction', 19, 'LaneDirection'],
    ['leftRoadSample', 20, 'LaneSampleAssociation', 'repeated'],
    ['rightRoadSample', 21, 'LaneSampleAssociation', 'repeated'],
    ['selfReverseLaneId', 22, 'Id', 'repeated'],
  ]);
  lane.add(new protobuf.Enum('LaneType', LANE_TYPE));
  lane.add(new protobuf.Enum('LaneTurn', LANE_TURN));
  lane.add(new protobuf.Enum('LaneDirection', LANE_DIRECTION));

  addType(hdmap, 'Crosswalk', [
    ['id', 1, 'Id'],
    ['polygon', 2, 'Polygon'],
    ['overlapId', 3, 'Id', 'repeated'],
  ]);
  const junction = addType(hdmap, 'Junction', [
    ['id', 1, 'Id'],
    ['polygon', 2, 'Polygon'],
    ['overlapId', 3, 'Id', 'repeated'],
    ['type', 4, 'Type'],
  ]);
  junction.add(
    new protobuf.Enum('Type', {
      UNKNOWN: 0,
      IN_ROAD: 1,
      CROSS_ROAD: 2,
      FORK_ROAD: 3,
      MAIN_SIDE: 4,
      DEAD_END: 5,
    })
  );
  addType(hdmap, 'SpeedBump', [
    ['id', 1, 'Id'],
    ['overlapId', 2, 'Id', 'repeated'],
    ['position', 3, 'Curve', 'repeated'],
  ]);
  const stopSign = addType(hdmap, 'StopSign', [
    ['id', 1, 'Id'],
    ['stopLine', 2, 'Curve', 'repeated'],
    ['overlapId', 3, 'Id', 'repeated'],
    ['type', 4, 'StopType'],
  ]);
  stopSign.add(
    new protobuf.Enum('StopType', {
      UNKNOWN: 0,
      ONE_WAY: 1,
      TWO_WAY: 2,
      THREE_WAY: 3,
      FOUR_WAY: 4,
      ALL_WAY: 5,
    })
  );
  addType(hdmap, 'YieldSign', [
    ['id', 1, 'Id'],
    ['stopLine', 2, 'Curve', 'repeated'],
    ['overlapId', 3, 'Id', 'repeated'],
  ]);
  const subsignal = addType(hdmap, 'Subsignal', [
    ['id', 1, 'Id'],
    ['type', 2, 'Type'],
    ['location', 3, 'apollo.common.PointENU'],
  ]);
  subsignal.add(
    new protobuf.Enum('Type', {
      UNKNOWN: 1,
      CIRCLE: 2,
      ARROW_LEFT: 3,
      ARROW_FORWARD: 4,
      ARROW_RIGHT: 5,
      ARROW_LEFT_AND_FORWARD: 6,
      ARROW_RIGHT_AND_FORWARD: 7,
      ARROW_U_TURN: 8,
    })
  );
  const signal = addType(hdmap, 'Signal', [
    ['id', 1, 'Id'],
    ['boundary', 2, 'Polygon'],
    ['subsignal', 3, 'Subsignal', 'repeated'],
    ['overlapId', 4, 'Id', 'repeated'],
    ['type', 5, 'Type'],
    ['stopLine', 6, 'Curve', 'repeated'],
  ]);
  signal.add(
    new protobuf.Enum('Type', {
      UNKNOWN: 1,
      MIX_2_HORIZONTAL: 2,
      MIX_2_VERTICAL: 3,
      MIX_3_HORIZONTAL: 4,
      MIX_3_VERTICAL: 5,
      SINGLE: 6,
    })
  );
  addType(hdmap, 'ParkingSpace', [
    ['id', 1, 'Id'],
    ['polygon', 2, 'Polygon'],
    ['overlapId', 3, 'Id', 'repeated'],
    ['heading', 4, 'double'],
  ]);
  addType(hdmap, 'BoundaryEdge', [
    ['curve', 1, 'Curve'],
    ['type', 2, 'Type'],
  ]).add(
    new protobuf.Enum('Type', {
      UNKNOWN: 0,
      NORMAL: 1,
      LEFT_BOUNDARY: 2,
      RIGHT_BOUNDARY: 3,
    })
  );
  addType(hdmap, 'BoundaryPolygon', [['edge', 1, 'BoundaryEdge', 'repeated']]);
  addType(hdmap, 'RoadBoundary', [
    ['outerPolygon', 1, 'BoundaryPolygon'],
    ['hole', 2, 'BoundaryPolygon', 'repeated'],
  ]);
  addType(hdmap, 'RoadSection', [
    ['id', 1, 'Id'],
    ['laneId', 2, 'Id', 'repeated'],
    ['boundary', 3, 'RoadBoundary'],
  ]);
  addType(hdmap, 'Road', [
    ['id', 1, 'Id'],
    ['section', 2, 'RoadSection', 'repeated'],
    ['junctionId', 3, 'Id'],
    ['type', 4, 'Type'],
  ]).add(
    new protobuf.Enum('Type', {
      UNKNOWN: 0,
      HIGHWAY: 1,
      CITY_ROAD: 2,
      PARK: 3,
    })
  );
  addType(hdmap, 'Map', [
    ['header', 1, 'Header'],
    ['crosswalk', 2, 'Crosswalk', 'repeated'],
    ['junction', 3, 'Junction', 'repeated'],
    ['lane', 4, 'Lane', 'repeated'],
    ['stopSign', 5, 'StopSign', 'repeated'],
    ['signal', 6, 'Signal', 'repeated'],
    ['yield', 7, 'YieldSign', 'repeated'],
    ['speedBump', 10, 'SpeedBump', 'repeated'],
    ['road', 11, 'Road', 'repeated'],
    ['parkingSpace', 12, 'ParkingSpace', 'repeated'],
  ]);

  addType(routing, 'CurvePoint', [['s', 1, 'double']]);
  addType(routing, 'CurveRange', [
    ['start', 1, 'CurvePoint'],
    ['end', 2, 'CurvePoint'],
  ]);
  addType(routing, 'Node', [
    ['laneId', 1, 'string'],
    ['length', 2, 'double'],
    ['leftOut', 3, 'CurveRange', 'repeated'],
    ['rightOut', 4, 'CurveRange', 'repeated'],
    ['cost', 5, 'double'],
    ['centralCurve', 6, 'apollo.hdmap.Curve'],
    ['isVirtual', 7, 'bool'],
    ['roadId', 8, 'string'],
  ]);
  const edge = addType(routing, 'Edge', [
    ['fromLaneId', 1, 'string'],
    ['toLaneId', 2, 'string'],
    ['cost', 3, 'double'],
    ['directionType', 4, 'DirectionType'],
  ]);
  edge.add(
    new protobuf.Enum('DirectionType', {
      FORWARD: 0,
      LEFT: 1,
      RIGHT: 2,
    })
  );
  addType(routing, 'Graph', [
    ['hdmapVersion', 1, 'string'],
    ['hdmapDistrict', 2, 'string'],
    ['node', 3, 'Node', 'repeated'],
    ['edge', 4, 'Edge', 'repeated'],
  ]);

  return root;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function id(value) {
  return { id: String(value || '') };
}

function bytes(value) {
  return Buffer.from(String(value ?? ''), 'utf8');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pointFromEditor(point) {
  const position = point?.position || point || {};
  return {
    x: number(position.x),
    y: number(position.y),
    z: number(position.z),
  };
}

function distance(a, b) {
  return Math.hypot(number(a.x) - number(b.x), number(a.y) - number(b.y));
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function interpolate(points, ratio) {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const total = polylineLength(points);
  if (total <= 0) {
    return points[0];
  }
  const target = Math.max(0, Math.min(1, ratio)) * total;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const segment = distance(start, end);
    if (walked + segment >= target) {
      const local = segment > 0 ? (target - walked) / segment : 0;
      return {
        x: start.x + (end.x - start.x) * local,
        y: start.y + (end.y - start.y) * local,
        z: start.z + (end.z - start.z) * local,
      };
    }
    walked += segment;
  }
  return points[points.length - 1];
}

function resample(points, count) {
  const size = Math.max(2, count);
  return Array.from({ length: size }, (_unused, index) => interpolate(points, index / (size - 1)));
}

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    z: u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
  };
}

function buildPointIndex(editorMap) {
  const result = new Map();
  for (const point of arr(editorMap.point)) {
    result.set(String(point.id), pointFromEditor(point));
  }
  return result;
}

function buildBoundaryIndex(editorMap) {
  const result = new Map();
  for (const boundary of [...arr(editorMap.boundary), ...arr(editorMap.roadBoundary)]) {
    result.set(String(boundary.id), boundary);
  }
  return result;
}

function boundaryPointIds(boundary) {
  return arr(boundary?.point_id || boundary?.pointIds);
}

function pointsFromBoundary(boundary, pointIndex, reverse = false) {
  if (!boundary) {
    return [];
  }
  const points = boundaryPointIds(boundary)
    .map((pointId) => pointIndex.get(String(pointId)))
    .filter(Boolean);
  const ordered = reverse ? points.reverse() : points;
  const controls = arr(boundary.controlsPosition).map(pointFromEditor);
  if (ordered.length >= 2 && controls.length >= 2) {
    return Array.from({ length: 17 }, (_unused, index) =>
      cubicBezier(ordered[0], controls[0], controls[1], ordered[ordered.length - 1], index / 16)
    );
  }
  return ordered;
}

function curveFromPoints(points) {
  const clean = arr(points).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const length = polylineLength(clean);
  const first = clean[0] || { x: 0, y: 0, z: 0 };
  const second = clean[1] || first;
  return {
    segment: [
      {
        lineSegment: {
          point: clean,
        },
        s: 0,
        startPosition: first,
        heading: Math.atan2(second.y - first.y, second.x - first.x),
        length,
      },
    ],
  };
}

function polygonFromBoundaryId(boundaryId, boundaryIndex, pointIndex) {
  const points = pointsFromBoundary(boundaryIndex.get(String(boundaryId)), pointIndex, false);
  return points.length >= 3 ? { point: points } : null;
}

function curveFromBoundaryId(boundaryId, boundaryIndex, pointIndex) {
  const points = pointsFromBoundary(boundaryIndex.get(String(boundaryId)), pointIndex, false);
  return points.length >= 2 ? curveFromPoints(points) : null;
}

function centerLineFromLane(lane, boundaryIndex, pointIndex) {
  const inlinePointIds = arr(lane.points || lane.point_id);
  if (inlinePointIds.length >= 2) {
    return inlinePointIds.map((pointId) => pointIndex.get(String(pointId))).filter(Boolean);
  }

  const left = pointsFromBoundary(
    boundaryIndex.get(String(lane.left_boundary_id || lane.leftBoundaryId)),
    pointIndex,
    Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse)
  );
  const right = pointsFromBoundary(
    boundaryIndex.get(String(lane.right_boundary_id || lane.rightBoundaryId)),
    pointIndex,
    Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse)
  );
  if (left.length > 0 && right.length > 0) {
    const count = Math.max(left.length, right.length, 2);
    const leftSamples = resample(left, count);
    const rightSamples = resample(right, count);
    return leftSamples.map((leftPoint, index) => ({
      x: (leftPoint.x + rightSamples[index].x) / 2,
      y: (leftPoint.y + rightSamples[index].y) / 2,
      z: (leftPoint.z + rightSamples[index].z) / 2,
    }));
  }
  return left.length > 0 ? left : right;
}

function laneBoundaryFromId(boundaryId, boundaryIndex, pointIndex, reverse, virtual = false) {
  const boundary = boundaryIndex.get(String(boundaryId));
  const points = pointsFromBoundary(boundary, pointIndex, reverse);
  if (points.length < 2) {
    return null;
  }
  const boundaryType = number(boundary?.attr?.type, 4);
  return {
    curve: curveFromPoints(points),
    length: polylineLength(points),
    virtual,
    boundaryType: [
      {
        s: 0,
        types: [boundaryType],
      },
    ],
  };
}

function laneTypeFromEditor(lane) {
  const value = lane?.type || lane?.attr?.laneType;
  if (String(value).toUpperCase() === 'BIKING' || value === 2) {
    return LANE_TYPE.BIKING;
  }
  return LANE_TYPE.CITY_DRIVING;
}

function turnFromEditor(lane) {
  const value = lane?.attr?.direction;
  if (value === 2) return LANE_TURN.LEFT_TURN;
  if (value === 3) return LANE_TURN.RIGHT_TURN;
  if (value === 4) return LANE_TURN.U_TURN;
  return LANE_TURN.NO_TURN;
}

function directionFromEditor(lane) {
  const value = lane?.attr?.prossibleDrivingDirection;
  if (value === 2) return LANE_DIRECTION.BACKWARD;
  if (value === 3) return LANE_DIRECTION.BIDIRECTION;
  return LANE_DIRECTION.FORWARD;
}

function buildLanes(editorMap, boundaryIndex, pointIndex) {
  const laneInfos = [];
  for (const lane of arr(editorMap.lane)) {
    const center = centerLineFromLane(lane, boundaryIndex, pointIndex);
    if (center.length < 2) {
      continue;
    }
    const length = polylineLength(center);
    const width = Math.max(0, number(lane.width, 3.5));
    const leftBoundary = laneBoundaryFromId(
      lane.left_boundary_id || lane.leftBoundaryId,
      boundaryIndex,
      pointIndex,
      Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse)
    );
    const rightBoundary = laneBoundaryFromId(
      lane.right_boundary_id || lane.rightBoundaryId,
      boundaryIndex,
      pointIndex,
      Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse)
    );
    laneInfos.push({
      source: lane,
      start: center[0],
      end: center[center.length - 1],
      proto: {
        id: id(lane.id),
        centralCurve: curveFromPoints(center),
        leftBoundary,
        rightBoundary,
        length,
        speedLimit: number(lane.speed_limit ?? lane.attr?.speed, 40),
        predecessorId: [],
        successorId: [],
        leftSample: [
          { s: 0, width: width / 2 },
          { s: length, width: width / 2 },
        ],
        rightSample: [
          { s: 0, width: width / 2 },
          { s: length, width: width / 2 },
        ],
        type: laneTypeFromEditor(lane),
        turn: turnFromEditor(lane),
        direction: directionFromEditor(lane),
      },
    });
  }

  for (const current of laneInfos) {
    for (const candidate of laneInfos) {
      if (current === candidate) {
        continue;
      }
      if (distance(current.end, candidate.start) <= 0.5) {
        current.proto.successorId.push(id(candidate.source.id));
        candidate.proto.predecessorId.push(id(current.source.id));
      }
    }
  }
  return laneInfos;
}

function computeBounds(editorMap) {
  const points = arr(editorMap.point).map(pointFromEditor);
  if (points.length === 0) {
    return {};
  }
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.min(...points.map((point) => point.y)),
    top: Math.max(...points.map((point) => point.y)),
  };
}

function createHeader(editorMap) {
  const header = editorMap.header || {};
  return {
    version: bytes(header.version || '1.0'),
    date: bytes(header.date || new Date().toISOString()),
    projection: header.projection || { proj: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs' },
    district: bytes(header.district || ''),
    generation: bytes('mapeditor-compat-converter'),
    revMajor: bytes('1'),
    revMinor: bytes('0'),
    vendor: bytes('mapeditor'),
    ...computeBounds(editorMap),
  };
}

function createMapMessage(editorMap) {
  const pointIndex = buildPointIndex(editorMap);
  const boundaryIndex = buildBoundaryIndex(editorMap);
  const laneInfos = buildLanes(editorMap, boundaryIndex, pointIndex);
  const laneIds = laneInfos.map((item) => id(item.source.id));

  return {
    header: createHeader(editorMap),
    lane: laneInfos.map((item) => item.proto),
    crosswalk: arr(editorMap.crosswalk)
      .map((item) => ({
        id: id(item.id),
        polygon: polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex),
      }))
      .filter((item) => item.polygon),
    junction: arr(editorMap.junction)
      .map((item) => ({
        id: id(item.id),
        polygon: polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex),
        type: number(item.attr?.type, 0),
      }))
      .filter((item) => item.polygon),
    speedBump: arr(editorMap.speed_bump)
      .map((item) => {
        const curve = curveFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex);
        return curve ? { id: id(item.id), position: [curve] } : null;
      })
      .filter(Boolean),
    stopSign: arr(editorMap.stopSign)
      .map((item) => {
        const stopLine = curveFromBoundaryId(item.stopLineId || item.boundaryId, boundaryIndex, pointIndex);
        return stopLine ? { id: id(item.id), stopLine: [stopLine], type: 1 } : null;
      })
      .filter(Boolean),
    yield: arr(editorMap.yieldSign)
      .map((item) => {
        const stopLine = curveFromBoundaryId(item.stopLineId || item.boundaryId, boundaryIndex, pointIndex);
        return stopLine ? { id: id(item.id), stopLine: [stopLine] } : null;
      })
      .filter(Boolean),
    signal: arr(editorMap.trafficSignal).map((item) => {
      const center = pointFromEditor(item.center || {});
      const half = 0.3;
      const stopLine = curveFromBoundaryId(item.stopLineId || item.boundaryId, boundaryIndex, pointIndex);
      return {
        id: id(item.id),
        boundary: {
          point: [
            { x: center.x - half, y: center.y - half, z: center.z },
            { x: center.x + half, y: center.y - half, z: center.z },
            { x: center.x + half, y: center.y + half, z: center.z },
            { x: center.x - half, y: center.y + half, z: center.z },
          ],
        },
        subsignal: arr(item.subSignal || item.subSignals).map((subSignal) => ({
          id: id(subSignal.id),
          type: number(subSignal.type, 1),
          location: center,
        })),
        type: number(item.type, 1),
        stopLine: stopLine ? [stopLine] : [],
      };
    }),
    parkingSpace: arr(editorMap.parkingSpace)
      .map((item) => ({
        id: id(item.id),
        polygon: polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex),
        heading: number(item.heading, 0),
      }))
      .filter((item) => item.polygon),
    road:
      laneIds.length > 0
        ? [
            {
              id: id('road_0'),
              section: [
                {
                  id: id('road_0_section_0'),
                  laneId: laneIds,
                },
              ],
              type: 2,
            },
          ]
        : [],
    _laneInfos: laneInfos,
  };
}

function createRoutingGraph(mapMessage) {
  const nodes = mapMessage._laneInfos.map((item) => ({
    laneId: String(item.source.id),
    length: item.proto.length,
    cost: item.proto.length,
    centralCurve: item.proto.centralCurve,
    isVirtual: false,
    roadId: 'road_0',
  }));
  const edges = [];
  for (const item of mapMessage._laneInfos) {
    for (const successor of item.proto.successorId || []) {
      edges.push({
        fromLaneId: String(item.source.id),
        toLaneId: successor.id,
        cost: 1,
        directionType: 0,
      });
    }
  }
  return {
    hdmapVersion: Buffer.isBuffer(mapMessage.header.version)
      ? mapMessage.header.version.toString('utf8')
      : String(mapMessage.header.version || '1.0'),
    hdmapDistrict: '',
    node: nodes,
    edge: edges,
  };
}

function indent(level) {
  return '  '.repeat(level);
}

function quote(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function scalarToText(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return quote(Buffer.from(value).toString('utf8'));
  }
  if (typeof value === 'string') {
    return quote(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function objectToText(object, level = 0, fieldMap = {}) {
  const lines = [];
  for (const [key, value] of Object.entries(object || {})) {
    if (key.startsWith('_') || value === null || typeof value === 'undefined') {
      continue;
    }
    const fieldName = fieldMap[key] || key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Buffer.isBuffer(item) && !(item instanceof Uint8Array)) {
          lines.push(`${indent(level)}${fieldName} {`);
          lines.push(objectToText(item, level + 1, fieldMap));
          lines.push(`${indent(level)}}`);
        } else {
          lines.push(`${indent(level)}${fieldName}: ${scalarToText(item)}`);
        }
      }
    } else if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      lines.push(`${indent(level)}${fieldName} {`);
      lines.push(objectToText(value, level + 1, fieldMap));
      lines.push(`${indent(level)}}`);
    } else {
      lines.push(`${indent(level)}${fieldName}: ${scalarToText(value)}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

function cleanMapForEncoding(mapMessage) {
  const { _laneInfos, ...payload } = mapMessage;
  return payload;
}

async function writeBinary(root, typeName, message, outputPath) {
  const Type = root.lookupType(typeName);
  const error = Type.verify(message);
  if (error) {
    throw new Error(`${typeName} verify failed: ${error}`);
  }
  const encoded = Type.encode(Type.create(message)).finish();
  await fs.writeFile(outputPath, encoded);
}

async function convertEditorMapToApolloPackage(options) {
  const { mapName, jsonPath, releaseDir, baseMapDir = null } = options;
  await fs.mkdir(releaseDir, { recursive: true });
  const editorMap = JSON.parse((await fs.readFile(jsonPath, 'utf8')).replace(/^\uFEFF/, ''));
  const root = createProtoRoot();
  const mapMessage = createMapMessage(editorMap);
  const cleanMap = cleanMapForEncoding(mapMessage);
  const routingGraph = createRoutingGraph(mapMessage);

  await fs.copyFile(jsonPath, path.join(releaseDir, 'editor_map.json'));
  await fs.writeFile(path.join(releaseDir, 'base_map.txt'), `${objectToText(cleanMap)}\n`, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'sim_map.txt'), `${objectToText(cleanMap)}\n`, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'routing_map.txt'), `${objectToText(routingGraph)}\n`, 'utf8');
  await writeBinary(root, 'apollo.hdmap.Map', cleanMap, path.join(releaseDir, 'base_map.bin'));
  await writeBinary(root, 'apollo.hdmap.Map', cleanMap, path.join(releaseDir, 'sim_map.bin'));
  await writeBinary(root, 'apollo.routing.Graph', routingGraph, path.join(releaseDir, 'routing_map.bin'));
  await fs.writeFile(
    path.join(releaseDir, 'manifest.json'),
    JSON.stringify(
      {
        mapName,
        generatedAt: new Date().toISOString(),
        converter: 'mapeditor-js-compat',
        nativeConverter: false,
        baseMapDir,
        files: ['editor_map.json', 'base_map.txt', 'base_map.bin', 'sim_map.txt', 'sim_map.bin', 'routing_map.txt', 'routing_map.bin'],
        summary: {
          lanes: cleanMap.lane.length,
          roads: cleanMap.road.length,
          crosswalks: cleanMap.crosswalk.length,
          junctions: cleanMap.junction.length,
          signals: cleanMap.signal.length,
          stopSigns: cleanMap.stopSign.length,
          yieldSigns: cleanMap.yield.length,
          speedBumps: cleanMap.speedBump.length,
          parkingSpaces: cleanMap.parkingSpace.length,
          routingNodes: routingGraph.node.length,
          routingEdges: routingGraph.edge.length,
        },
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    stdout: `Generated Apollo-compatible map package with JS fallback: ${releaseDir}`,
    stderr: '',
    code: 0,
  };
}

module.exports = {
  convertEditorMapToApolloPackage,
};

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

const EDITOR_STOP_LINE_BOUNDARY_TYPE = 11;
const EDITOR_AREA_TYPE = {
  DRIVEABLE: 1,
  UNDRIVEABLE: 2,
  CUSTOM: 3,
};
const EDGE_VEHICLE_WIDTH_METERS = 1.4;
const EDGE_VEHICLE_LENGTH_METERS = 3.7;
const APOLLO_SIM_MIN_TURN_RADIUS = Math.max(4.5, EDGE_VEHICLE_LENGTH_METERS * 1.2);
const APOLLO_SIM_TURN_SPEED_LAT_ACCEL = 2.0;
const APOLLO_SIM_TURN_SPEED_MIN_MPS = 1.8;
const APOLLO_SIM_DEFAULT_TURN_SPEED_MAX_MPS = 15 / 3.6;
const APOLLO_SIM_U_TURN_SPEED_MAX_MPS = 2.4;
const APOLLO_SIM_SHARP_TURN_SPEED_MAX_MPS = APOLLO_SIM_DEFAULT_TURN_SPEED_MAX_MPS;
const APOLLO_SIM_MEDIUM_TURN_SPEED_MAX_MPS = APOLLO_SIM_DEFAULT_TURN_SPEED_MAX_MPS;
const APOLLO_SIM_SOFT_TURN_SPEED_MAX_MPS = APOLLO_SIM_DEFAULT_TURN_SPEED_MAX_MPS;
const APOLLO_SIM_CENTER_SMOOTH_MIN_LENGTH = 5;
const APOLLO_SIM_CENTER_SMOOTH_MAX_DEVIATION = 3.5;
const APOLLO_SIM_CENTER_SMOOTH_SAMPLE_COUNT = 17;
const APOLLO_SIM_CENTER_HEADING_RELAX_DEGREES = [-12, -8, -4, 0, 4, 8, 12];
const APOLLO_SIM_CENTER_CONTROL_CANDIDATE_LIMIT = 9;
const APOLLO_CURVE_MIN_SAMPLE_COUNT = 17;
const APOLLO_CURVE_MAX_SAMPLE_COUNT = 97;
const APOLLO_CURVE_TARGET_SEGMENT_LENGTH_METERS = 0.4;
const APOLLO_CURVE_EXCESS_LENGTH_PER_EXTRA_SAMPLE_METERS = 0.25;
const APOLLO_TARGET_CRS = {
  datum: 'WGS84',
  ellipsoid: 'WGS84',
  projection: 'UTM',
  zone: 50,
  hemisphere: 'north',
  epsg: 'EPSG:32650',
  proj4: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs',
  centralMeridianDeg: 117,
  latitudeOfOriginDeg: 0,
  scaleFactor: 0.9996,
  falseEastingMeters: 500000,
  falseNorthingMeters: 0,
  falseNorthingSouthMeters: 10000000,
  axisOrder: ['easting', 'northing', 'up'],
  unit: 'meter',
};
const APOLLO_TARGET_PROJECTION = { proj: APOLLO_TARGET_CRS.proj4 };
const GAUSS_KRUGER_CM114_CRS = {
  datum: 'CGCS2000/WGS84-compatible',
  ellipsoid: 'GRS80/WGS84-compatible',
  projection: 'Transverse_Mercator',
  centralMeridianDeg: 114,
  latitudeOfOriginDeg: 0,
  scaleFactor: 1,
  falseEastingMeters: 500000,
  falseNorthingMeters: 0,
  axisOrder: ['easting', 'northing', 'up'],
  unit: 'meter',
  note: '3-degree Gauss-Kruger / transverse Mercator with central meridian 114E',
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
    }),
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
    }),
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
    }),
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
    }),
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
    }),
  );
  addType(hdmap, 'ParkingSpace', [
    ['id', 1, 'Id'],
    ['polygon', 2, 'Polygon'],
    ['overlapId', 3, 'Id', 'repeated'],
    ['heading', 4, 'double'],
  ]);
  addType(hdmap, 'ClearArea', [
    ['id', 1, 'Id'],
    ['overlapId', 2, 'Id', 'repeated'],
    ['polygon', 3, 'Polygon'],
  ]);
  addType(hdmap, 'LaneOverlapInfo', [
    ['startS', 1, 'double'],
    ['endS', 2, 'double'],
    ['isMerge', 3, 'bool'],
    ['regionOverlapId', 4, 'Id'],
  ]);
  addType(hdmap, 'SignalOverlapInfo', []);
  addType(hdmap, 'StopSignOverlapInfo', []);
  addType(hdmap, 'CrosswalkOverlapInfo', []);
  addType(hdmap, 'JunctionOverlapInfo', []);
  addType(hdmap, 'YieldSignOverlapInfo', []);
  addType(hdmap, 'ClearAreaOverlapInfo', []);
  addType(hdmap, 'SpeedBumpOverlapInfo', []);
  addType(hdmap, 'ParkingSpaceOverlapInfo', []);
  addType(hdmap, 'ObjectOverlapInfo', [
    ['id', 1, 'Id'],
    ['laneOverlapInfo', 3, 'LaneOverlapInfo'],
    ['signalOverlapInfo', 4, 'SignalOverlapInfo'],
    ['stopSignOverlapInfo', 5, 'StopSignOverlapInfo'],
    ['crosswalkOverlapInfo', 6, 'CrosswalkOverlapInfo'],
    ['junctionOverlapInfo', 7, 'JunctionOverlapInfo'],
    ['yieldSignOverlapInfo', 8, 'YieldSignOverlapInfo'],
    ['clearAreaOverlapInfo', 9, 'ClearAreaOverlapInfo'],
    ['speedBumpOverlapInfo', 10, 'SpeedBumpOverlapInfo'],
    ['parkingSpaceOverlapInfo', 11, 'ParkingSpaceOverlapInfo'],
  ]);
  addType(hdmap, 'Overlap', [
    ['id', 1, 'Id'],
    ['object', 2, 'ObjectOverlapInfo', 'repeated'],
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
    }),
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
    }),
  );
  addType(hdmap, 'Map', [
    ['header', 1, 'Header'],
    ['crosswalk', 2, 'Crosswalk', 'repeated'],
    ['junction', 3, 'Junction', 'repeated'],
    ['lane', 4, 'Lane', 'repeated'],
    ['stopSign', 5, 'StopSign', 'repeated'],
    ['signal', 6, 'Signal', 'repeated'],
    ['yield', 7, 'YieldSign', 'repeated'],
    ['overlap', 8, 'Overlap', 'repeated'],
    ['clearArea', 9, 'ClearArea', 'repeated'],
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
    }),
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

function arrFromKeys(object, keys) {
  return keys.flatMap((key) => arr(object?.[key]));
}

function id(value) {
  return { id: String(value || '') };
}

function addConversionWarning(warnings, warning) {
  warnings.push({
    severity: warning.severity || 'warning',
    code: warning.code,
    element: warning.element || '',
    id: String(warning.id || ''),
    message: warning.message,
    ...(warning.details ? { details: warning.details } : {}),
  });
}

function bytes(value) {
  return Buffer.from(String(value ?? ''), 'utf8');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coordinateFromArray(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      x: number(value[0], NaN),
      y: number(value[1], NaN),
      z: number(value[2], 0),
    };
  }
  if (value && typeof value === 'object') {
    const source = value.position || value;
    return {
      x: number(source.x ?? source.lng ?? source.lon ?? source.longitude, NaN),
      y: number(source.y ?? source.lat ?? source.latitude, NaN),
      z: number(source.z ?? source.height, 0),
    };
  }
  return null;
}

function finiteCoordinate(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
}

function normalizeCoordinateFrame(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) {
    return null;
  }
  if (['APOLLO_UTM_ZONE_50', 'UTM_ZONE_50', 'EPSG:32650', 'WGS84_UTM_ZONE_50'].includes(raw)) {
    return 'APOLLO_UTM_ZONE_50';
  }
  if (['LOCAL_ENU_METERS', 'LOCAL_ENU', 'LOCAL', 'EDITOR_LOCAL', 'BASE_MAP_XY'].includes(raw)) {
    return 'LOCAL_ENU_METERS';
  }
  if (['WGS84_LON_LAT', 'WGS84', 'EPSG:4326', 'LON_LAT', 'LONGITUDE_LATITUDE'].includes(raw)) {
    return 'WGS84_LON_LAT';
  }
  if (
    [
      'GAUSS_KRUGER_CM114',
      'GAUSS_KRUGER_3_DEGREE_CM114',
      'GK_CM114',
      'CM114',
      'CGCS2000_GK_CM114',
      'CGCS2000_GAUSS_KRUGER_CM114',
      'XIAN80_GK_CM114',
    ].includes(raw)
  ) {
    return 'GAUSS_KRUGER_CM114';
  }
  if (['SCREEN_PIXELS', 'SCREEN', 'PIXELS', 'CANVAS_PIXELS'].includes(raw)) {
    return 'SCREEN_PIXELS';
  }
  return raw;
}

function coordinateFrameFromEditorMap(editorMap) {
  return normalizeCoordinateFrame(
    editorMap.sourceCrs ||
      editorMap.source_crs ||
      editorMap.coordinateFrame ||
      editorMap.coordinate_frame ||
      editorMap.coordinateMetadata?.sourceCrs ||
      editorMap.coordinateMetadata?.source_crs ||
      editorMap.coordinateMetadata?.coordinateFrame ||
      editorMap.coordinate?.sourceCrs ||
      editorMap.coordinate?.frame,
  );
}

function coordinateFromNestedKeys(source, keys) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (const key of keys) {
    const coordinate = finiteCoordinate(coordinateFromArray(source[key]));
    if (coordinate) {
      return coordinate;
    }
  }
  return null;
}

function coordinatesNearlyEqual(a, b, tolerance = 0.001) {
  return (
    finiteCoordinate(a) &&
    finiteCoordinate(b) &&
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs((a.z || 0) - (b.z || 0)) <= tolerance
  );
}

function firstAnchorUtmFromEditorMap(editorMap) {
  const anchorSources = [
    editorMap.anchor,
    editorMap.coordinateAnchor,
    editorMap.coordinate_anchor,
    editorMap.coordinateMetadata?.anchor,
    editorMap.coordinate?.anchor,
  ].filter(Boolean);
  for (const anchor of anchorSources) {
    const coordinate = coordinateFromNestedKeys(anchor, ['utm', 'apolloUtm', 'apollo_utm', 'origin']);
    if (coordinate) {
      return {
        coordinate,
        source: typeof anchor.source === 'string' && anchor.source.trim() ? anchor.source.trim() : 'anchor.utm',
      };
    }
  }
  return null;
}

function anchorUtmFromEditorMap(editorMap) {
  const anchorUtm = firstAnchorUtmFromEditorMap(editorMap);
  const direct = coordinateFromNestedKeys(editorMap, [
    'apolloOrigin',
    'apollo_origin',
    'utmOrigin',
    'utm_origin',
    'mapOrigin',
    'map_origin',
    'coordinateOrigin',
    'coordinate_origin',
  ]);
  if (direct) {
    return {
      coordinate: direct,
      source: anchorUtm && coordinatesNearlyEqual(anchorUtm.coordinate, direct) ? anchorUtm.source : 'origin',
    };
  }
  const headerOrigin = finiteCoordinate(coordinateFromArray(editorMap.header?.origin));
  if (headerOrigin) {
    return { coordinate: headerOrigin, source: 'header.origin' };
  }
  if (anchorUtm) {
    return anchorUtm;
  }
  const baseMapCenterAsOrigin =
    editorMap.basemapCenterIsApolloOrigin === true || editorMap.basemap_center_is_apollo_origin === true;
  const sourceCrs = coordinateFrameFromEditorMap(editorMap) || 'LOCAL_ENU_METERS';
  const baseMapCenter = finiteCoordinate(
    coordinateFromArray(
      editorMap.basemapCenter ||
        editorMap.baseMapCenter ||
        editorMap.base_map_center ||
        editorMap.imageBasemapCenter ||
        editorMap.image_basemap_center,
    ),
  );
  if (baseMapCenterAsOrigin && baseMapCenter) {
    return { coordinate: baseMapCenter, source: 'basemapCenter(explicit)' };
  }
  return null;
}

function shouldTreatAnchorAsTargetCenter(editorMap, anchorUtm) {
  if (!anchorUtm) {
    return false;
  }
  if (anchorUtm.source === 'imported_origin') {
    return true;
  }
  if (anchorUtm.source !== 'origin') {
    return false;
  }
  return !coordinateFrameFromEditorMap(editorMap) && !firstAnchorUtmFromEditorMap(editorMap);
}

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E = Math.sqrt(WGS84_F * (2 - WGS84_F));
const WGS84_E_SQ = WGS84_E * WGS84_E;
const WGS84_E_PRIME_SQ = WGS84_E_SQ / (1 - WGS84_E_SQ);

function forwardTransverseMercator(lon, lat, options, z = 0) {
  const a = WGS84_A;
  const k0 = options.scaleFactor;
  const falseEasting = options.falseEastingMeters;
  const falseNorthing = lat < 0 ? options.falseNorthingSouthMeters || 0 : options.falseNorthingMeters || 0;
  const lonOrigin = options.centralMeridianDeg;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lonOriginRad = (lonOrigin * Math.PI) / 180;
  const n = a / Math.sqrt(1 - WGS84_E_SQ * Math.sin(latRad) * Math.sin(latRad));
  const t = Math.tan(latRad) * Math.tan(latRad);
  const c = WGS84_E_PRIME_SQ * Math.cos(latRad) * Math.cos(latRad);
  const aa = Math.cos(latRad) * (lonRad - lonOriginRad);
  const m =
    a *
    ((1 - WGS84_E_SQ / 4 - (3 * WGS84_E_SQ * WGS84_E_SQ) / 64 - (5 * WGS84_E_SQ ** 3) / 256) * latRad -
      ((3 * WGS84_E_SQ) / 8 + (3 * WGS84_E_SQ * WGS84_E_SQ) / 32 + (45 * WGS84_E_SQ ** 3) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * WGS84_E_SQ * WGS84_E_SQ) / 256 + (45 * WGS84_E_SQ ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * WGS84_E_SQ ** 3) / 3072) * Math.sin(6 * latRad));
  const x =
    falseEasting +
    k0 * n * (aa + ((1 - t + c) * aa ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_E_PRIME_SQ) * aa ** 5) / 120);
  const y =
    falseNorthing +
    k0 *
      (m +
        n *
          Math.tan(latRad) *
          ((aa * aa) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * aa ** 4) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_E_PRIME_SQ) * aa ** 6) / 720));
  return { x, y, z };
}

function inverseTransverseMercator(x, y, options, z = 0) {
  const a = WGS84_A;
  const k0 = options.scaleFactor;
  const falseEasting = options.falseEastingMeters;
  const falseNorthing = options.falseNorthingMeters || 0;
  const lonOriginRad = (options.centralMeridianDeg * Math.PI) / 180;
  const e1 = (1 - Math.sqrt(1 - WGS84_E_SQ)) / (1 + Math.sqrt(1 - WGS84_E_SQ));
  const adjustedX = x - falseEasting;
  const adjustedY = y - falseNorthing;
  const m = adjustedY / k0;
  const mu = m / (a * (1 - WGS84_E_SQ / 4 - (3 * WGS84_E_SQ ** 2) / 64 - (5 * WGS84_E_SQ ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = WGS84_E_PRIME_SQ * Math.cos(phi1) * Math.cos(phi1);
  const t1 = Math.tan(phi1) * Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - WGS84_E_SQ * Math.sin(phi1) * Math.sin(phi1));
  const r1 = (a * (1 - WGS84_E_SQ)) / (1 - WGS84_E_SQ * Math.sin(phi1) * Math.sin(phi1)) ** 1.5;
  const d = adjustedX / (n1 * k0);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_E_PRIME_SQ) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * WGS84_E_PRIME_SQ - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    lonOriginRad +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * WGS84_E_PRIME_SQ + 24 * t1 * t1) * d ** 5) / 120) /
      Math.cos(phi1);
  return {
    lon: (lon * 180) / Math.PI,
    lat: (lat * 180) / Math.PI,
    z,
  };
}

function wgs84LonLatToUtmZone50(lon, lat, z = 0) {
  return forwardTransverseMercator(lon, lat, APOLLO_TARGET_CRS, z);
}

function gaussKrugerCm114ToUtmZone50(x, y, z = 0) {
  const lonLat = inverseTransverseMercator(x, y, GAUSS_KRUGER_CM114_CRS, z);
  return wgs84LonLatToUtmZone50(lonLat.lon, lonLat.lat, z);
}

function rawPointFromEditor(point) {
  const position = point?.position || point || {};
  return {
    x: number(position.x),
    y: number(position.y),
    z: number(position.z),
  };
}

function createCoordinateTransform(editorMap) {
  const rawPoints = arr(editorMap.point).map(rawPointFromEditor);
  if (rawPoints.length === 0) {
    return null;
  }
  const bounds = {
    left: Math.min(...rawPoints.map((point) => point.x)),
    right: Math.max(...rawPoints.map((point) => point.x)),
    bottom: Math.min(...rawPoints.map((point) => point.y)),
    top: Math.max(...rawPoints.map((point) => point.y)),
  };
  const localCenter = {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.bottom + bounds.top) / 2,
    z: 0,
  };
  const sourceCrs = coordinateFrameFromEditorMap(editorMap) || 'LOCAL_ENU_METERS';
  if (sourceCrs === 'APOLLO_UTM_ZONE_50') {
    return {
      mode: 'pass-through',
      source: 'apollo-utm-zone-50',
      sourceCrs,
      targetCrs: APOLLO_TARGET_CRS,
      origin: null,
      targetCenter: localCenter,
      localCenter,
      offset: { x: 0, y: 0, z: 0 },
    };
  }
  if (sourceCrs === 'WGS84_LON_LAT') {
    const convertedPoints = rawPoints.map((point) => wgs84LonLatToUtmZone50(point.x, point.y, point.z));
    const targetBounds = {
      left: Math.min(...convertedPoints.map((point) => point.x)),
      right: Math.max(...convertedPoints.map((point) => point.x)),
      bottom: Math.min(...convertedPoints.map((point) => point.y)),
      top: Math.max(...convertedPoints.map((point) => point.y)),
    };
    return {
      mode: 'wgs84-to-utm-zone-50',
      source: 'wgs84-lon-lat',
      sourceCrs,
      targetCrs: APOLLO_TARGET_CRS,
      origin: null,
      targetCenter: {
        x: (targetBounds.left + targetBounds.right) / 2,
        y: (targetBounds.bottom + targetBounds.top) / 2,
        z: 0,
      },
      localCenter,
      offset: { x: 0, y: 0, z: 0 },
    };
  }
  if (sourceCrs === 'GAUSS_KRUGER_CM114') {
    const convertedPoints = rawPoints.map((point) => gaussKrugerCm114ToUtmZone50(point.x, point.y, point.z));
    const targetBounds = {
      left: Math.min(...convertedPoints.map((point) => point.x)),
      right: Math.max(...convertedPoints.map((point) => point.x)),
      bottom: Math.min(...convertedPoints.map((point) => point.y)),
      top: Math.max(...convertedPoints.map((point) => point.y)),
    };
    return {
      mode: 'gauss-kruger-cm114-to-utm-zone-50',
      source: 'gauss-kruger-cm114',
      sourceCrs,
      sourceCrsDefinition: GAUSS_KRUGER_CM114_CRS,
      targetCrs: APOLLO_TARGET_CRS,
      origin: null,
      targetCenter: {
        x: (targetBounds.left + targetBounds.right) / 2,
        y: (targetBounds.bottom + targetBounds.top) / 2,
        z: 0,
      },
      localCenter,
      offset: { x: 0, y: 0, z: 0 },
    };
  }
  const explicitCenter = [
    editorMap.apolloCenter,
    editorMap.apollo_center,
    editorMap.utmCenter,
    editorMap.utm_center,
    editorMap.mapCenter,
    editorMap.map_center,
    editorMap.coordinateCenter,
    editorMap.coordinate_center,
    editorMap.header?.center,
  ]
    .map(coordinateFromArray)
    .map(finiteCoordinate)
    .find(Boolean);
  const anchorUtm = anchorUtmFromEditorMap(editorMap);
  const legacyAnchorAsCenter = shouldTreatAnchorAsTargetCenter(editorMap, anchorUtm);
  const origin = anchorUtm && !legacyAnchorAsCenter ? anchorUtm.coordinate : null;
  const targetCenter = explicitCenter || (legacyAnchorAsCenter ? anchorUtm.coordinate : null);
  if (!origin && !targetCenter) {
    return null;
  }
  const offset = targetCenter
    ? {
        x: targetCenter.x - localCenter.x,
        y: targetCenter.y - localCenter.y,
        z: targetCenter.z - localCenter.z,
      }
    : {
        x: origin.x,
        y: origin.y,
        z: origin.z,
      };
  return {
    mode: 'offset',
    source: explicitCenter
      ? 'center'
      : legacyAnchorAsCenter
        ? `${anchorUtm.source}:target-center`
        : anchorUtm?.source || 'origin',
    sourceCrs,
    targetCrs: APOLLO_TARGET_CRS,
    origin: origin || null,
    targetCenter: targetCenter || {
      x: localCenter.x + offset.x,
      y: localCenter.y + offset.y,
      z: localCenter.z + offset.z,
    },
    localCenter,
    offset,
  };
}

function applyCoordinateTransform(point, transform) {
  if (!transform) {
    return point;
  }
  if (transform.mode === 'wgs84-to-utm-zone-50') {
    return wgs84LonLatToUtmZone50(point.x, point.y, point.z);
  }
  if (transform.mode === 'gauss-kruger-cm114-to-utm-zone-50') {
    return gaussKrugerCm114ToUtmZone50(point.x, point.y, point.z);
  }
  return {
    x: point.x + transform.offset.x,
    y: point.y + transform.offset.y,
    z: point.z + transform.offset.z,
  };
}

function pointFromEditor(point, transform = null) {
  return applyCoordinateTransform(rawPointFromEditor(point), transform);
}

function distance(a, b) {
  return Math.hypot(number(a.x) - number(b.x), number(a.y) - number(b.y));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function cubicBezierSampleCount(p0, p1, p2, p3) {
  const controlLength = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
  const chordLength = distance(p0, p3);
  const excessLength = Math.max(0, controlLength - chordLength);
  const lengthBased = Math.ceil(controlLength / APOLLO_CURVE_TARGET_SEGMENT_LENGTH_METERS) + 1;
  const curvatureBased =
    APOLLO_CURVE_MIN_SAMPLE_COUNT +
    Math.ceil(excessLength / APOLLO_CURVE_EXCESS_LENGTH_PER_EXTRA_SAMPLE_METERS);
  return Math.round(
    clamp(
      Math.max(APOLLO_CURVE_MIN_SAMPLE_COUNT, lengthBased, curvatureBased),
      APOLLO_CURVE_MIN_SAMPLE_COUNT,
      APOLLO_CURVE_MAX_SAMPLE_COUNT,
    ),
  );
}

function headingBetween(start, end) {
  return Math.atan2(number(end.y) - number(start.y), number(end.x) - number(start.x));
}

function normalizeAngle(angle) {
  let result = angle;
  while (result > Math.PI) {
    result -= Math.PI * 2;
  }
  while (result < -Math.PI) {
    result += Math.PI * 2;
  }
  return result;
}

function laneTurnMetrics(points) {
  if (points.length < 3) {
    return {
      minRadius: Infinity,
      maxHeadingDelta: 0,
      netHeadingDelta: 0,
    };
  }
  let maxCurvature = 0;
  let maxHeadingDelta = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const previousHeading = headingBetween(points[i - 1], points[i]);
    const nextHeading = headingBetween(points[i], points[i + 1]);
    const headingDelta = Math.abs(normalizeAngle(nextHeading - previousHeading));
    const localLength = (distance(points[i - 1], points[i]) + distance(points[i], points[i + 1])) / 2;
    const curvature = localLength > 0 ? headingDelta / localLength : 0;
    if (curvature > maxCurvature) {
      maxCurvature = curvature;
      maxHeadingDelta = headingDelta;
    }
  }
  return {
    minRadius: maxCurvature > 0 ? 1 / maxCurvature : Infinity,
    maxHeadingDelta,
    netHeadingDelta: Math.abs(
      normalizeAngle(
        headingBetween(points[points.length - 2], points[points.length - 1]) - headingBetween(points[0], points[1]),
      ),
    ),
  };
}

function buildPointIndex(editorMap, transform = null) {
  const result = new Map();
  for (const point of arr(editorMap.point)) {
    result.set(String(point.id), pointFromEditor(point, transform));
  }
  return result;
}

function buildBoundaryIndex(editorMap) {
  const result = new Map();
  for (const boundary of [...arr(editorMap.boundary), ...arrFromKeys(editorMap, ['roadBoundary', 'road_boundary'])]) {
    result.set(String(boundary.id), boundary);
  }
  return result;
}

function buildStopLineIndex(editorMap) {
  const result = new Map();
  for (const stopLine of [...arr(editorMap.stopLine), ...arr(editorMap.stop_line)]) {
    const stopLineId = stopLine?.id ?? stopLine?.stopLineId ?? stopLine?.stop_line_id;
    const boundaryId = stopLine?.boundaryId ?? stopLine?.boundary_id;
    if (stopLineId !== undefined && stopLineId !== null && boundaryId !== undefined && boundaryId !== null) {
      result.set(String(stopLineId), String(boundaryId));
    }
  }
  return result;
}

function isStopLineBoundary(boundary) {
  return Number(boundary?.type) === EDITOR_STOP_LINE_BOUNDARY_TYPE;
}

function resolveStopLineBoundaryId(item, stopLineIndex, boundaryIndex) {
  const stopLineId = item?.stopLineId ?? item?.stop_line_id;
  const boundaryId = item?.boundaryId ?? item?.boundary_id;
  if (stopLineId !== undefined && stopLineId !== null) {
    const resolvedBoundaryId = stopLineIndex.get(String(stopLineId));
    if (resolvedBoundaryId) {
      return resolvedBoundaryId;
    }
    if (isStopLineBoundary(boundaryIndex.get(String(stopLineId)))) {
      return String(stopLineId);
    }
  }
  if (boundaryId !== undefined && boundaryId !== null) {
    return String(boundaryId);
  }
  return null;
}

function boundaryPointIds(boundary) {
  return arr(boundary?.point_id || boundary?.pointIds);
}

function laneEndpointPointIds(lane, boundaryIndex, endpoint) {
  const leftBoundary = boundaryIndex.get(String(lane.left_boundary_id || lane.leftBoundaryId));
  const rightBoundary = boundaryIndex.get(String(lane.right_boundary_id || lane.rightBoundaryId));
  const leftPointIds = boundaryPointIds(leftBoundary).map((pointId) => String(pointId));
  const rightPointIds = boundaryPointIds(rightBoundary).map((pointId) => String(pointId));
  if (leftPointIds.length === 0 || rightPointIds.length === 0) {
    return [null, null];
  }
  const leftReverse = Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse);
  const rightReverse = Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse);
  const isStart = endpoint === 'start';
  const leftIndex = (isStart && leftReverse) || (!isStart && !leftReverse) ? leftPointIds.length - 1 : 0;
  const rightIndex = (isStart && rightReverse) || (!isStart && !rightReverse) ? rightPointIds.length - 1 : 0;
  return [leftPointIds[leftIndex] || null, rightPointIds[rightIndex] || null];
}

function sameEndpointPointPair(left, right) {
  return Boolean(left?.[0] && left?.[1] && left[0] === right?.[0] && left[1] === right?.[1]);
}

function reversedEndpointPointPair(left, right) {
  return Boolean(left?.[0] && left?.[1] && left[0] === right?.[1] && left[1] === right?.[0]);
}

function endpointHeading(points, endpoint) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }
  if (endpoint === 'start') {
    return headingBetween(points[0], points[1]);
  }
  return headingBetween(points[points.length - 2], points[points.length - 1]);
}

function laneEndpointHeadingAngleDegrees(current, candidate) {
  const currentHeading = endpointHeading(current.center, 'end');
  const candidateHeading = endpointHeading(candidate.center, 'start');
  if (!Number.isFinite(currentHeading) || !Number.isFinite(candidateHeading)) {
    return null;
  }
  return (Math.abs(normalizeAngle(candidateHeading - currentHeading)) * 180) / Math.PI;
}

function laneEndpointsAreTopologicallyConnected(current, candidate) {
  if (sameEndpointPointPair(current.endPointIds, candidate.startPointIds)) {
    return true;
  }
  if (!reversedEndpointPointPair(current.endPointIds, candidate.startPointIds)) {
    return false;
  }
  const angleDegrees = laneEndpointHeadingAngleDegrees(current, candidate);
  return angleDegrees !== null && angleDegrees < 100;
}

function pointsFromBoundary(boundary, pointIndex, reverse = false, transform = null) {
  if (!boundary) {
    return [];
  }
  const points = boundaryPointIds(boundary)
    .map((pointId) => pointIndex.get(String(pointId)))
    .filter(Boolean);
  const ordered = reverse ? points.slice().reverse() : points.slice();
  const rawControls = arr(boundary.controlsPosition).map((point) => pointFromEditor(point, transform));
  const controls = reverse ? rawControls.slice().reverse() : rawControls;
  if (ordered.length >= 2 && controls.length >= 2) {
    const sampleCount = cubicBezierSampleCount(ordered[0], controls[0], controls[1], ordered[ordered.length - 1]);
    return Array.from({ length: sampleCount }, (_unused, index) =>
      cubicBezier(ordered[0], controls[0], controls[1], ordered[ordered.length - 1], index / (sampleCount - 1)),
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

function polygonFromBoundaryId(boundaryId, boundaryIndex, pointIndex, transform = null) {
  const points = pointsFromBoundary(boundaryIndex.get(String(boundaryId)), pointIndex, false, transform);
  return points.length >= 3 ? { point: points } : null;
}

function curveFromBoundaryId(boundaryId, boundaryIndex, pointIndex, transform = null) {
  const points = pointsFromBoundary(boundaryIndex.get(String(boundaryId)), pointIndex, false, transform);
  return points.length >= 2 ? curveFromPoints(points) : null;
}

function distancePointToSegment(point, start, end) {
  const dx = number(end.x) - number(start.x);
  const dy = number(end.y) - number(start.y);
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) {
    return distance(point, start);
  }
  const t = clamp(
    ((number(point.x) - number(start.x)) * dx + (number(point.y) - number(start.y)) * dy) / lengthSquared,
    0,
    1,
  );
  return distance(point, {
    x: number(start.x) + dx * t,
    y: number(start.y) + dy * t,
    z: number(start.z) + (number(end.z) - number(start.z)) * t,
  });
}

function distancePointToPolyline(point, points, closed = false) {
  if (points.length === 0) {
    return Infinity;
  }
  if (points.length === 1) {
    return distance(point, points[0]);
  }
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distancePointToSegment(point, points[i - 1], points[i]));
  }
  if (closed && points.length > 2) {
    best = Math.min(best, distancePointToSegment(point, points[points.length - 1], points[0]));
  }
  return best;
}

function signedLateralDistance(point, start, end) {
  const dx = number(end.x) - number(start.x);
  const dy = number(end.y) - number(start.y);
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return 0;
  }
  return (dx * (number(point.y) - number(start.y)) - dy * (number(point.x) - number(start.x))) / length;
}

function nearestPolylinePoint(point, points) {
  let best = {
    point: null,
    distance: Infinity,
  };
  for (let i = 0; i < points.length; i += 1) {
    const candidate = points[i];
    const currentDistance = distance(point, candidate);
    if (currentDistance < best.distance) {
      best = {
        point: candidate,
        distance: currentDistance,
      };
    }
  }
  return best;
}

function cubicCenterCandidate(start, end, startHeading, endHeading, startControl, endControl) {
  const startTangent = {
    x: Math.cos(startHeading),
    y: Math.sin(startHeading),
    z: 0,
  };
  const endTangent = {
    x: Math.cos(endHeading),
    y: Math.sin(endHeading),
    z: 0,
  };
  const control1 = {
    x: start.x + startTangent.x * startControl,
    y: start.y + startTangent.y * startControl,
    z: start.z,
  };
  const control2 = {
    x: end.x - endTangent.x * endControl,
    y: end.y - endTangent.y * endControl,
    z: end.z,
  };
  const sampleCount = Math.max(
    APOLLO_SIM_CENTER_SMOOTH_SAMPLE_COUNT,
    cubicBezierSampleCount(start, control1, control2, end),
  );
  return Array.from({ length: sampleCount }, (_unused, index) =>
    cubicBezier(start, control1, control2, end, index / (sampleCount - 1)),
  );
}

function centerControlDistanceCandidates(maxControl, chord, originalLength) {
  const rawCandidates = [
    1,
    1.5,
    2.5,
    3.5,
    chord * 0.25,
    chord * 0.4,
    chord * 0.6,
    originalLength * 0.25,
    originalLength * 0.4,
    originalLength * 0.6,
    maxControl,
  ];
  const uniqueCandidates = Array.from(
    new Set(
      rawCandidates
        .filter((value) => Number.isFinite(value))
        .map((value) => clamp(value, 1, maxControl))
        .map((value) => Math.round(value * 4) / 4),
    ),
  ).sort((a, b) => a - b);

  if (uniqueCandidates.length <= APOLLO_SIM_CENTER_CONTROL_CANDIDATE_LIMIT) {
    return uniqueCandidates;
  }

  const lastIndex = uniqueCandidates.length - 1;
  return Array.from({ length: APOLLO_SIM_CENTER_CONTROL_CANDIDATE_LIMIT }, (_unused, index) => {
    const sourceIndex = Math.round((index / (APOLLO_SIM_CENTER_CONTROL_CANDIDATE_LIMIT - 1)) * lastIndex);
    return uniqueCandidates[sourceIndex];
  }).filter((value, index, values) => index === 0 || value !== values[index - 1]);
}

function centerlineStaysInsideLane(candidate, original, leftBoundaryPoints, rightBoundaryPoints, laneWidth) {
  const maxDeviation = Math.max(APOLLO_SIM_CENTER_SMOOTH_MAX_DEVIATION, laneWidth / 2);
  for (let index = 0; index < candidate.length; index += 1) {
    const point = candidate[index];
    if (distancePointToPolyline(point, original, false) > maxDeviation) {
      return false;
    }
    const previous = candidate[Math.max(0, index - 1)];
    const next = candidate[Math.min(candidate.length - 1, index + 1)];
    const left = nearestPolylinePoint(point, leftBoundaryPoints);
    const right = nearestPolylinePoint(point, rightBoundaryPoints);
    if (!left.point || !right.point) {
      return false;
    }
    const leftSide = signedLateralDistance(left.point, previous, next);
    const rightSide = signedLateralDistance(right.point, previous, next);
    if (leftSide <= 0.15 || rightSide >= -0.15) {
      return false;
    }
    if (left.distance < 0.4 || right.distance < 0.4) {
      return false;
    }
  }
  return true;
}

function smoothCenterlineForApolloPlanning(
  center,
  leftBoundaryPoints,
  rightBoundaryPoints,
  lane,
  width,
  conversionWarnings,
) {
  const originalLength = polylineLength(center);
  const originalMetrics = laneTurnMetrics(center);
  if (
    center.length < 4 ||
    originalLength < APOLLO_SIM_CENTER_SMOOTH_MIN_LENGTH ||
    originalMetrics.minRadius >= APOLLO_SIM_MIN_TURN_RADIUS ||
    originalMetrics.netHeadingDelta < Math.PI / 6
  ) {
    return center;
  }

  const start = center[0];
  const end = center[center.length - 1];
  const startHeading = headingBetween(center[0], center[1]);
  const endHeading = headingBetween(center[center.length - 2], center[center.length - 1]);
  const chord = distance(start, end);
  const maxControl = Math.max(3, Math.min(originalLength * 1.4, Math.max(chord * 1.8, 8)));
  const controlCandidates = centerControlDistanceCandidates(maxControl, chord, originalLength);
  const findBestCandidate = (headingOffsets) => {
    let bestCandidate = null;
    for (const startHeadingOffset of headingOffsets) {
      for (const endHeadingOffset of headingOffsets) {
        for (const startControl of controlCandidates) {
          for (const endControl of controlCandidates) {
            const candidate = cubicCenterCandidate(
              start,
              end,
              startHeading + startHeadingOffset,
              endHeading + endHeadingOffset,
              startControl,
              endControl,
            );
            const candidateLength = polylineLength(candidate);
            if (candidateLength < chord * 0.98 || candidateLength > originalLength * 1.35) {
              continue;
            }
            if (!centerlineStaysInsideLane(candidate, center, leftBoundaryPoints, rightBoundaryPoints, width)) {
              continue;
            }
            const metrics = laneTurnMetrics(candidate);
            if (metrics.minRadius <= originalMetrics.minRadius * 1.08) {
              continue;
            }
            const headingPenalty = (Math.abs(startHeadingOffset) + Math.abs(endHeadingOffset)) * 0.5;
            const score = metrics.minRadius - Math.abs(candidateLength - originalLength) * 0.02 - headingPenalty;
            if (!bestCandidate || score > bestCandidate.score) {
              bestCandidate = {
                candidate,
                metrics,
                startHeadingOffset,
                endHeadingOffset,
                score,
              };
            }
          }
        }
      }
    }
    return bestCandidate;
  };
  let best = findBestCandidate([0]);
  if (!best || best.metrics.minRadius < APOLLO_SIM_MIN_TURN_RADIUS + 0.5) {
    const relaxedHeadingOffsets = APOLLO_SIM_CENTER_HEADING_RELAX_DEGREES.map((degrees) => (degrees * Math.PI) / 180);
    const relaxedBest = findBestCandidate(relaxedHeadingOffsets);
    if (relaxedBest && (!best || relaxedBest.metrics.minRadius > best.metrics.minRadius)) {
      best = relaxedBest;
    }
  }

  if (!best || best.metrics.minRadius < Math.min(APOLLO_SIM_MIN_TURN_RADIUS * 0.85, originalMetrics.minRadius * 1.2)) {
    addConversionWarning(conversionWarnings, {
      severity: 'warning',
      code: 'lane-turn-radius-too-tight',
      element: 'lane',
      id: lane.id,
      message: `Lane ${lane.id || ''} has a tight Apollo centerline radius and could not be smoothed safely.`,
      details: {
        minRadius: Number(originalMetrics.minRadius.toFixed(2)),
      },
    });
    return center;
  }

  addConversionWarning(conversionWarnings, {
    severity: 'info',
    code: 'lane-centerline-smoothed-for-planning',
    element: 'lane',
    id: lane.id,
    message: `Lane ${lane.id || ''} centerline was smoothed for Apollo planning.`,
    details: {
      originalMinRadius: Number(originalMetrics.minRadius.toFixed(2)),
      smoothedMinRadius: Number(best.metrics.minRadius.toFixed(2)),
      startHeadingOffsetDegrees: Number(((best.startHeadingOffset * 180) / Math.PI).toFixed(1)),
      endHeadingOffsetDegrees: Number(((best.endHeadingOffset * 180) / Math.PI).toFixed(1)),
    },
  });
  return best.candidate;
}

function pointInPolygon(point, polygonPoints) {
  if (polygonPoints.length < 3) {
    return false;
  }
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i, i += 1) {
    const a = polygonPoints[i];
    const b = polygonPoints[j];
    const aAbove = number(a.y) > number(point.y);
    const bAbove = number(b.y) > number(point.y);
    const edgeX =
      ((number(b.x) - number(a.x)) * (number(point.y) - number(a.y))) / (number(b.y) - number(a.y) || Number.EPSILON) +
      number(a.x);
    const crosses = aAbove !== bAbove && number(point.x) < edgeX;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function sampleLaneCenter(laneInfo, spacing = 0.5) {
  const length = Math.max(0, number(laneInfo.proto?.length, polylineLength(laneInfo.center)));
  const sampleCount = Math.max(2, Math.ceil(length / spacing) + 1);
  return Array.from({ length: sampleCount }, (_unused, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    return {
      point: interpolate(laneInfo.center, ratio),
      s: length * ratio,
    };
  });
}

function rangeFromLaneSamples(laneInfo, predicate, padding) {
  const length = Math.max(0, number(laneInfo.proto?.length, polylineLength(laneInfo.center)));
  const hits = sampleLaneCenter(laneInfo).filter((sample) => predicate(sample.point));
  if (hits.length === 0) {
    return null;
  }
  const startS = clamp(Math.min(...hits.map((sample) => sample.s)) - padding, 0, length);
  const endS = clamp(Math.max(...hits.map((sample) => sample.s)) + padding, 0, length);
  return {
    startS,
    endS: Math.max(endS, Math.min(length, startS + 0.1)),
  };
}

function overlapRangeForCurve(laneInfo, curvePoints) {
  const clean = arr(curvePoints).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 2) {
    return null;
  }
  const threshold = Math.max(0.75, Math.min(3, number(laneInfo.width, 3.5) / 2 + 0.35));
  return rangeFromLaneSamples(
    laneInfo,
    (point) => distancePointToPolyline(point, clean, false) <= threshold,
    Math.min(1.5, threshold / 2),
  );
}

function overlapRangeForPolygon(laneInfo, polygonPoints) {
  const clean = arr(polygonPoints).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 3) {
    return null;
  }
  const threshold = Math.max(0.5, Math.min(2.5, number(laneInfo.width, 3.5) / 2));
  return rangeFromLaneSamples(
    laneInfo,
    (point) => pointInPolygon(point, clean) || distancePointToPolyline(point, clean, true) <= threshold,
    Math.min(1.5, threshold / 2),
  );
}

function centerLineFromLane(lane, boundaryIndex, pointIndex, transform = null) {
  const inlinePointIds = arr(lane.points || lane.point_id);
  if (inlinePointIds.length >= 2) {
    return inlinePointIds.map((pointId) => pointIndex.get(String(pointId))).filter(Boolean);
  }

  const left = pointsFromBoundary(
    boundaryIndex.get(String(lane.left_boundary_id || lane.leftBoundaryId)),
    pointIndex,
    Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse),
    transform,
  );
  const right = pointsFromBoundary(
    boundaryIndex.get(String(lane.right_boundary_id || lane.rightBoundaryId)),
    pointIndex,
    Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse),
    transform,
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

function laneBoundaryFromId(boundaryId, boundaryIndex, pointIndex, reverse, virtual = false, transform = null) {
  const boundary = boundaryIndex.get(String(boundaryId));
  const points = pointsFromBoundary(boundary, pointIndex, reverse, transform);
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
  const value = lane?.attr?.laneType ?? lane?.laneType;
  if (String(value).toUpperCase() === 'BIKING' || value === 2) {
    return LANE_TYPE.BIKING;
  }
  if (String(value).toUpperCase() === 'SIDEWALK') {
    return LANE_TYPE.SIDEWALK;
  }
  if (String(value).toUpperCase() === 'PARKING') {
    return LANE_TYPE.PARKING;
  }
  if (String(value).toUpperCase() === 'SHOULDER') {
    return LANE_TYPE.SHOULDER;
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
  if (value === 3) return LANE_DIRECTION.BIDIRECTION;
  // The editor reverses/swaps lane boundaries for reverse-drawn lanes before
  // export, so Apollo should see the generated central curve as drivable
  // forward unless the lane is explicitly bidirectional.
  return LANE_DIRECTION.FORWARD;
}

function widthSamplesFromGeometry(center, boundaryPoints, fallbackWidth, spacing = 5) {
  const length = polylineLength(center);
  const sampleCount = Math.max(2, Math.ceil(length / spacing) + 1);
  return Array.from({ length: sampleCount }, (_unused, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const point = interpolate(center, ratio);
    const measuredWidth = distancePointToPolyline(point, boundaryPoints, false);
    const width = Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : fallbackWidth;
    return {
      s: length * ratio,
      width: clamp(width, 0.2, 12),
    };
  });
}

function baseSpeedLimitFromEditor(lane) {
  const speedKph = lane.speed_limit_kph ?? lane.attr?.speedKph ?? lane.attr?.speed;
  if (Number.isFinite(Number(speedKph))) {
    return number(speedKph, 40) / 3.6;
  }
  const speedMps = lane.speed_limit_mps ?? lane.speedLimitMps ?? lane.speed_limit ?? lane.speedLimit;
  if (Number.isFinite(Number(speedMps))) {
    return number(speedMps, 40 / 3.6);
  }
  return 40 / 3.6;
}

function turnSpeedLimitForApollo(baseSpeedLimit, lane, center, conversionWarnings) {
  const metrics = laneTurnMetrics(center);
  const turn = turnFromEditor(lane);
  const turnAngle = Math.max(metrics.netHeadingDelta, metrics.maxHeadingDelta);
  const isTurningLane = turn !== LANE_TURN.NO_TURN || turnAngle >= Math.PI / 12 || metrics.minRadius < 30;
  if (!isTurningLane) {
    return baseSpeedLimit;
  }

  let cap = APOLLO_SIM_SOFT_TURN_SPEED_MAX_MPS;
  if (turn === LANE_TURN.U_TURN || turnAngle >= (Math.PI * 2) / 3) {
    cap = APOLLO_SIM_U_TURN_SPEED_MAX_MPS;
  } else if (turnAngle >= Math.PI / 3 || metrics.minRadius < 8) {
    cap = APOLLO_SIM_SHARP_TURN_SPEED_MAX_MPS;
  } else if (turnAngle >= Math.PI / 6 || metrics.minRadius < 14) {
    cap = APOLLO_SIM_MEDIUM_TURN_SPEED_MAX_MPS;
  }

  const radiusSpeed = Number.isFinite(metrics.minRadius)
    ? Math.sqrt(Math.max(1, metrics.minRadius) * APOLLO_SIM_TURN_SPEED_LAT_ACCEL)
    : cap;
  const minSpeed = Math.min(APOLLO_SIM_TURN_SPEED_MIN_MPS, baseSpeedLimit);
  const limitedSpeed = clamp(Math.min(baseSpeedLimit, cap, radiusSpeed), minSpeed, baseSpeedLimit);
  if (limitedSpeed < baseSpeedLimit - 0.05) {
    addConversionWarning(conversionWarnings, {
      severity: 'info',
      code: 'lane-turn-speed-limited',
      element: 'lane',
      id: lane.id,
      message: `Lane ${lane.id || ''} speed limit was reduced for smoother Apollo turning.`,
      details: {
        originalSpeedMps: Number(baseSpeedLimit.toFixed(2)),
        limitedSpeedMps: Number(limitedSpeed.toFixed(2)),
        originalSpeedKph: Number((baseSpeedLimit * 3.6).toFixed(1)),
        limitedSpeedKph: Number((limitedSpeed * 3.6).toFixed(1)),
        turnSpeedCapKph: Number((cap * 3.6).toFixed(1)),
        radiusSpeedKph: Number((radiusSpeed * 3.6).toFixed(1)),
        turnAngleDegrees: Number(((turnAngle * 180) / Math.PI).toFixed(1)),
        minRadius: Number.isFinite(metrics.minRadius) ? Number(metrics.minRadius.toFixed(2)) : null,
        vehicleWidthMeters: EDGE_VEHICLE_WIDTH_METERS,
        vehicleLengthMeters: EDGE_VEHICLE_LENGTH_METERS,
        defaultTurnSpeedCapKph: 15,
      },
    });
  }
  return limitedSpeed;
}

function speedLimitFromEditor(lane, center, conversionWarnings) {
  const baseSpeedLimit = baseSpeedLimitFromEditor(lane);
  return center?.length >= 3
    ? turnSpeedLimitForApollo(baseSpeedLimit, lane, center, conversionWarnings)
    : baseSpeedLimit;
}

function buildLanes(editorMap, boundaryIndex, pointIndex, conversionWarnings, transform = null) {
  const laneInfos = [];
  for (const lane of arr(editorMap.lane)) {
    const rawCenter = centerLineFromLane(lane, boundaryIndex, pointIndex, transform);
    if (rawCenter.length < 2) {
      addConversionWarning(conversionWarnings, {
        severity: 'error',
        code: 'lane-missing-centerline',
        element: 'lane',
        id: lane.id,
        message: `Lane ${lane.id || ''} was skipped because it cannot produce a valid Apollo central_curve.`,
      });
      continue;
    }
    const width = Math.max(0, number(lane.width, 3.5));
    const leftBoundary = laneBoundaryFromId(
      lane.left_boundary_id || lane.leftBoundaryId,
      boundaryIndex,
      pointIndex,
      Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse),
      false,
      transform,
    );
    const rightBoundary = laneBoundaryFromId(
      lane.right_boundary_id || lane.rightBoundaryId,
      boundaryIndex,
      pointIndex,
      Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse),
      false,
      transform,
    );
    if (!leftBoundary || !rightBoundary) {
      addConversionWarning(conversionWarnings, {
        severity: 'error',
        code: 'lane-missing-boundary',
        element: 'lane',
        id: lane.id,
        message: `Lane ${lane.id || ''} was skipped because Apollo requires valid left_boundary and right_boundary.`,
        details: {
          leftBoundaryId: lane.left_boundary_id || lane.leftBoundaryId || '',
          rightBoundaryId: lane.right_boundary_id || lane.rightBoundaryId || '',
        },
      });
      continue;
    }
    const leftBoundaryPoints = pointsFromBoundary(
      boundaryIndex.get(String(lane.left_boundary_id || lane.leftBoundaryId)),
      pointIndex,
      Boolean(lane.left_boundary_reverse || lane.leftBoundaryReverse),
      transform,
    );
    const rightBoundaryPoints = pointsFromBoundary(
      boundaryIndex.get(String(lane.right_boundary_id || lane.rightBoundaryId)),
      pointIndex,
      Boolean(lane.right_boundary_reverse || lane.rightBoundaryReverse),
      transform,
    );
    const fallbackHalfWidth = width > 0 ? width / 2 : 1.75;
    const center = smoothCenterlineForApolloPlanning(
      rawCenter,
      leftBoundaryPoints,
      rightBoundaryPoints,
      lane,
      width,
      conversionWarnings,
    );
    const length = polylineLength(center);
    laneInfos.push({
      source: lane,
      center,
      width,
      start: center[0],
      end: center[center.length - 1],
      startPointIds: laneEndpointPointIds(lane, boundaryIndex, 'start'),
      endPointIds: laneEndpointPointIds(lane, boundaryIndex, 'end'),
      proto: {
        id: id(lane.id),
        centralCurve: curveFromPoints(center),
        leftBoundary,
        rightBoundary,
        length,
        speedLimit: speedLimitFromEditor(lane, center, conversionWarnings),
        overlapId: [],
        predecessorId: [],
        successorId: [],
        leftSample: widthSamplesFromGeometry(center, leftBoundaryPoints, fallbackHalfWidth),
        rightSample: widthSamplesFromGeometry(center, rightBoundaryPoints, fallbackHalfWidth),
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
      if (laneEndpointsAreTopologicallyConnected(current, candidate)) {
        current.proto.successorId.push(id(candidate.source.id));
        candidate.proto.predecessorId.push(id(current.source.id));
      } else if (distance(current.end, candidate.start) <= 0.5) {
        const headingAngleDegrees = laneEndpointHeadingAngleDegrees(current, candidate);
        const reversedEndpoint = reversedEndpointPointPair(current.endPointIds, candidate.startPointIds);
        const oppositeEndpoint = reversedEndpoint && headingAngleDegrees !== null && headingAngleDegrees >= 100;
        addConversionWarning(conversionWarnings, {
          severity: oppositeEndpoint ? 'info' : 'warning',
          code: oppositeEndpoint
            ? 'lane-endpoints-overlap-with-opposite-heading'
            : 'lane-endpoints-near-but-not-topologically-connected',
          element: 'lane',
          id: current.source.id,
          message: oppositeEndpoint
            ? `Lane ${current.source.id || ''} shares an endpoint with lane ${
                candidate.source.id || ''
              }, but their headings differ by ${headingAngleDegrees.toFixed(
                1,
              )} degrees; this was treated as an opposing or independent endpoint, not an Apollo successor.`
            : `Lane ${current.source.id || ''} endpoint is close to lane ${candidate.source.id || ''}, but their endpoint point IDs are not shared; no Apollo successor edge was created.`,
          details: {
            sourceEndPointIds: current.endPointIds,
            targetStartPointIds: candidate.startPointIds,
            distance: Number(distance(current.end, candidate.start).toFixed(3)),
            headingAngleDegrees:
              headingAngleDegrees === null ? null : Number(headingAngleDegrees.toFixed(1)),
          },
        });
      }
    }
  }
  return laneInfos;
}

function computeBounds(editorMap, transform = null) {
  const points = arr(editorMap.point).map((point) => pointFromEditor(point, transform));
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

function createHeader(editorMap, transform = null) {
  const header = editorMap.header || {};
  return {
    version: bytes(header.version || '1.0'),
    date: bytes(header.date || new Date().toISOString()),
    projection: APOLLO_TARGET_PROJECTION,
    district: bytes(header.district || ''),
    generation: bytes('mapeditor-compat-converter'),
    revMajor: bytes('1'),
    revMinor: bytes('0'),
    vendor: bytes('mapeditor'),
    ...computeBounds(editorMap, transform),
  };
}

function roadBoundaryFromEditor(editorMap, boundaryIndex, pointIndex, conversionWarnings, transform = null) {
  const edges = arrFromKeys(editorMap, ['roadBoundary', 'road_boundary'])
    .map((item) => {
      const curve = curveFromBoundaryId(item.id, boundaryIndex, pointIndex, transform);
      if (!curve) {
        addConversionWarning(conversionWarnings, {
          severity: 'warning',
          code: 'road-boundary-invalid-curve',
          element: 'roadBoundary',
          id: item.id,
          message: `Road boundary ${item.id || ''} was not exported because it cannot produce a valid Apollo curve.`,
        });
        return null;
      }
      return {
        curve,
        type: 1,
      };
    })
    .filter(Boolean);
  return edges.length > 0
    ? {
        outerPolygon: {
          edge: edges,
        },
      }
    : null;
}

const OVERLAP_TARGETS = [
  {
    key: 'signal',
    element: 'trafficSignal',
    infoField: 'signalOverlapInfo',
    geometryKey: '_overlapCurvePoints',
    rangeFactory: overlapRangeForCurve,
  },
  {
    key: 'stopSign',
    element: 'stopSign',
    infoField: 'stopSignOverlapInfo',
    geometryKey: '_overlapCurvePoints',
    rangeFactory: overlapRangeForCurve,
  },
  {
    key: 'yield',
    element: 'yieldSign',
    infoField: 'yieldSignOverlapInfo',
    geometryKey: '_overlapCurvePoints',
    rangeFactory: overlapRangeForCurve,
  },
  {
    key: 'crosswalk',
    element: 'crosswalk',
    infoField: 'crosswalkOverlapInfo',
    geometryKey: '_overlapPolygonPoints',
    rangeFactory: overlapRangeForPolygon,
  },
  {
    key: 'speedBump',
    element: 'speedBump',
    infoField: 'speedBumpOverlapInfo',
    geometryKey: '_overlapCurvePoints',
    rangeFactory: overlapRangeForCurve,
  },
];

function objectIdValue(object) {
  return String(object?.id?.id || object?.id || '');
}

function addOverlapId(target, overlapId) {
  if (!target.overlapId) {
    target.overlapId = [];
  }
  if (!target.overlapId.some((item) => item.id === overlapId)) {
    target.overlapId.push(id(overlapId));
  }
}

function createLaneObjectOverlap(laneInfo, object, target, range) {
  const laneId = String(laneInfo.source.id || laneInfo.proto.id?.id || '');
  const objectId = objectIdValue(object);
  const overlapId = `${target.element}_${objectId}_${laneId}`;
  addOverlapId(laneInfo.proto, overlapId);
  addOverlapId(object, overlapId);
  return {
    id: id(overlapId),
    object: [
      {
        id: id(laneId),
        laneOverlapInfo: {
          startS: range.startS,
          endS: range.endS,
          isMerge: false,
        },
      },
      {
        id: id(objectId),
        [target.infoField]: {},
      },
    ],
  };
}

function buildOverlaps(mapMessage, laneInfos, conversionWarnings) {
  const overlaps = [];
  for (const target of OVERLAP_TARGETS) {
    for (const object of arr(mapMessage[target.key])) {
      let linkedLaneCount = 0;
      const geometry = object[target.geometryKey] || [];
      for (const laneInfo of laneInfos) {
        const range = target.rangeFactory(laneInfo, geometry);
        if (!range) {
          continue;
        }
        overlaps.push(createLaneObjectOverlap(laneInfo, object, target, range));
        linkedLaneCount += 1;
      }
      if (linkedLaneCount === 0) {
        addConversionWarning(conversionWarnings, {
          severity: 'warning',
          code: 'overlap-not-found',
          element: target.element,
          id: objectIdValue(object),
          message: `${target.element} ${objectIdValue(object)} was exported but no nearby lane overlap could be inferred.`,
        });
      }
    }
  }
  return overlaps;
}

function createMapMessage(editorMap) {
  const coordinateTransform = createCoordinateTransform(editorMap);
  const pointIndex = buildPointIndex(editorMap, coordinateTransform);
  const boundaryIndex = buildBoundaryIndex(editorMap);
  const stopLineIndex = buildStopLineIndex(editorMap);
  const conversionWarnings = [];
  const sourceCrs = coordinateFrameFromEditorMap(editorMap) || 'LOCAL_ENU_METERS';
  if (!coordinateTransform && sourceCrs !== 'APOLLO_UTM_ZONE_50') {
    const rawPoints = arr(editorMap.point).map(rawPointFromEditor);
    const maxAbs = rawPoints.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 0);
    addConversionWarning(conversionWarnings, {
      severity: sourceCrs === 'SCREEN_PIXELS' || maxAbs < 10000 ? 'error' : 'warning',
      code: 'apollo-coordinate-anchor-missing',
      element: 'map',
      id: '',
      message:
        'Apollo coordinate anchor is missing. Configure apolloOrigin/utmOrigin or mark points as APOLLO_UTM_ZONE_50 before publishing.',
      details: {
        sourceCrs,
        maxAbsCoordinate: Number(maxAbs.toFixed(3)),
      },
    });
  }
  if (coordinateTransform) {
    addConversionWarning(conversionWarnings, {
      severity: 'info',
      code: 'apollo-coordinate-offset-applied',
      element: 'map',
      id: '',
      message: `Apollo coordinates were offset from editor-local coordinates using ${coordinateTransform.source}.`,
      details: {
        source: coordinateTransform.source,
        sourceCrs: coordinateTransform.sourceCrs,
        targetCrs: coordinateTransform.targetCrs,
        offsetX: Number(coordinateTransform.offset.x.toFixed(6)),
        offsetY: Number(coordinateTransform.offset.y.toFixed(6)),
        targetCenterX: Number(coordinateTransform.targetCenter.x.toFixed(6)),
        targetCenterY: Number(coordinateTransform.targetCenter.y.toFixed(6)),
      },
    });
  }
  const laneInfos = buildLanes(editorMap, boundaryIndex, pointIndex, conversionWarnings, coordinateTransform);
  const laneIds = laneInfos.map((item) => id(item.source.id));
  const roadBoundary = roadBoundaryFromEditor(
    editorMap,
    boundaryIndex,
    pointIndex,
    conversionWarnings,
    coordinateTransform,
  );
  const signals = arr(editorMap.trafficSignal)
    .map((item) => {
      const center = pointFromEditor(item.center || {}, coordinateTransform);
      const half = 0.3;
      const stopLineBoundaryId = resolveStopLineBoundaryId(item, stopLineIndex, boundaryIndex);
      const stopLine = curveFromBoundaryId(stopLineBoundaryId, boundaryIndex, pointIndex, coordinateTransform);
      const stopLinePoints = pointsFromBoundary(
        boundaryIndex.get(String(stopLineBoundaryId)),
        pointIndex,
        false,
        coordinateTransform,
      );
      if (!stopLine) {
        addConversionWarning(conversionWarnings, {
          severity: 'error',
          code: 'signal-missing-stop-line',
          element: 'trafficSignal',
          id: String(item.id || ''),
          message: `Traffic signal ${item.id || ''} was skipped because Apollo requires a valid stop_line.`,
        });
        return null;
      }
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
        stopLine: [stopLine],
        _overlapCurvePoints: stopLinePoints,
      };
    })
    .filter(Boolean);
  arrFromKeys(editorMap, ['barrierGate', 'barrier_gate']).forEach((item) => {
    addConversionWarning(conversionWarnings, {
      severity: 'warning',
      code: 'barrier-gate-not-in-apollo-hdmap',
      element: 'barrierGate',
      id: item.id,
      message: `Barrier gate ${item.id || ''} is retained in editor_map.json but Apollo HDMap has no direct barrier gate element.`,
    });
  });
  const referencedStopLineIds = new Set(
    [
      ...arr(editorMap.trafficSignal),
      ...arr(editorMap.stopSign),
      ...arr(editorMap.yieldSign),
      ...arrFromKeys(editorMap, ['barrierGate', 'barrier_gate']),
    ]
      .map((item) => item?.stopLineId ?? item?.stop_line_id)
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value)),
  );
  arrFromKeys(editorMap, ['stopLine', 'stop_line']).forEach((item) => {
    const stopLineId = item?.id ?? item?.stopLineId ?? item?.stop_line_id;
    if (stopLineId !== undefined && stopLineId !== null && !referencedStopLineIds.has(String(stopLineId))) {
      addConversionWarning(conversionWarnings, {
        severity: 'warning',
        code: 'standalone-stop-line-not-exported',
        element: 'stopLine',
        id: stopLineId,
        message: `Stop line ${stopLineId || ''} is not exported as a top-level Apollo element unless it is referenced by a signal, stop sign, or yield sign.`,
      });
    }
  });

  const mapMessage = {
    header: createHeader(editorMap, coordinateTransform),
    lane: laneInfos.map((item) => item.proto),
    crosswalk: arr(editorMap.crosswalk)
      .map((item) => {
        const polygon = polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!polygon) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'crosswalk-invalid-polygon',
            element: 'crosswalk',
            id: item.id,
            message: `Crosswalk ${item.id || ''} was not exported because it has no valid Apollo polygon.`,
          });
          return null;
        }
        return {
          id: id(item.id),
          polygon,
          _overlapPolygonPoints: polygon.point,
        };
      })
      .filter(Boolean),
    junction: arr(editorMap.junction)
      .map((item) => {
        const polygon = polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!polygon) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'junction-invalid-polygon',
            element: 'junction',
            id: item.id,
            message: `Junction ${item.id || ''} was not exported because it has no valid Apollo polygon.`,
          });
          return null;
        }
        return {
          id: id(item.id),
          polygon,
          type: number(item.attr?.type, 0),
        };
      })
      .filter(Boolean),
    speedBump: arrFromKeys(editorMap, ['speed_bump', 'speedBump'])
      .map((item) => {
        const curve = curveFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!curve) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'speed-bump-invalid-curve',
            element: 'speedBump',
            id: item.id,
            message: `Speed bump ${item.id || ''} was not exported because it has no valid Apollo curve.`,
          });
          return null;
        }
        return {
          id: id(item.id),
          position: [curve],
          _overlapCurvePoints: pointsFromBoundary(
            boundaryIndex.get(String(item.boundaryId)),
            pointIndex,
            false,
            coordinateTransform,
          ),
        };
      })
      .filter(Boolean),
    stopSign: arr(editorMap.stopSign)
      .map((item) => {
        const stopLineBoundaryId = resolveStopLineBoundaryId(item, stopLineIndex, boundaryIndex);
        const stopLine = curveFromBoundaryId(stopLineBoundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!stopLine) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'stop-sign-missing-stop-line',
            element: 'stopSign',
            id: item.id,
            message: `Stop sign ${item.id || ''} was not exported because Apollo requires a valid stop_line.`,
          });
          return null;
        }
        return stopLine
          ? {
              id: id(item.id),
              stopLine: [stopLine],
              type: 1,
              _overlapCurvePoints: pointsFromBoundary(
                boundaryIndex.get(String(stopLineBoundaryId)),
                pointIndex,
                false,
                coordinateTransform,
              ),
            }
          : null;
      })
      .filter(Boolean),
    yield: arr(editorMap.yieldSign)
      .map((item) => {
        const stopLineBoundaryId = resolveStopLineBoundaryId(item, stopLineIndex, boundaryIndex);
        const stopLine = curveFromBoundaryId(stopLineBoundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!stopLine) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'yield-sign-missing-stop-line',
            element: 'yieldSign',
            id: item.id,
            message: `Yield sign ${item.id || ''} was not exported because Apollo requires a valid stop_line.`,
          });
          return null;
        }
        return stopLine
          ? {
              id: id(item.id),
              stopLine: [stopLine],
              _overlapCurvePoints: pointsFromBoundary(
                boundaryIndex.get(String(stopLineBoundaryId)),
                pointIndex,
                false,
                coordinateTransform,
              ),
            }
          : null;
      })
      .filter(Boolean),
    signal: signals,
    parkingSpace: arrFromKeys(editorMap, ['parkingSpace', 'parking_space'])
      .map((item) => {
        const polygon = polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!polygon) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'parking-space-invalid-polygon',
            element: 'parkingSpace',
            id: item.id,
            message: `Parking space ${item.id || ''} was not exported because it has no valid Apollo polygon.`,
          });
          return null;
        }
        return {
          id: id(item.id),
          polygon,
          heading: number(item.heading, 0),
        };
      })
      .filter(Boolean),
    clearArea: arr(editorMap.area)
      .map((item) => {
        if (number(item.type, 0) !== EDITOR_AREA_TYPE.UNDRIVEABLE) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'area-type-not-apollo-clear-area',
            element: 'area',
            id: item.id,
            message: `Area ${item.id || ''} was not exported as Apollo clear_area because only non-driveable areas map to clear_area.`,
            details: {
              type: item.type,
              name: item.name || '',
            },
          });
          return null;
        }
        const polygon = polygonFromBoundaryId(item.boundaryId, boundaryIndex, pointIndex, coordinateTransform);
        if (!polygon) {
          addConversionWarning(conversionWarnings, {
            severity: 'warning',
            code: 'clear-area-invalid-polygon',
            element: 'area',
            id: item.id,
            message: `Area ${item.id || ''} was not exported because it has no valid Apollo clear_area polygon.`,
          });
          return null;
        }
        return {
          id: id(item.id),
          polygon,
        };
      })
      .filter(Boolean),
    road:
      laneIds.length > 0
        ? [
            {
              id: id('road_0'),
              section: [
                {
                  id: id('road_0_section_0'),
                  laneId: laneIds,
                  ...(roadBoundary ? { boundary: roadBoundary } : {}),
                },
              ],
              type: 2,
            },
          ]
        : [],
    _laneInfos: laneInfos,
    _conversionWarnings: conversionWarnings,
    _coordinateTransform: coordinateTransform,
  };
  mapMessage.overlap = buildOverlaps(mapMessage, laneInfos, conversionWarnings);
  return mapMessage;
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

function curveToPoints(curve) {
  return arr(curve?.segment)
    .flatMap((segment) => arr(segment?.lineSegment?.point))
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .map((point) => ({
      x: point.x,
      y: point.y,
      z: number(point.z, 0),
    }));
}

function pointAtPolylineFraction(points, fraction) {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const target = clamp(fraction, 0, 1) * polylineLength(points);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const segmentLength = distance(previous, next);
    if (travelled + segmentLength >= target) {
      const ratio = segmentLength > 0 ? (target - travelled) / segmentLength : 0;
      return {
        x: previous.x + (next.x - previous.x) * ratio,
        y: previous.y + (next.y - previous.y) * ratio,
        z: (previous.z || 0) + ((next.z || 0) - (previous.z || 0)) * ratio,
      };
    }
    travelled += segmentLength;
  }
  return points[points.length - 1];
}

function headingAtPolylineFraction(points, fraction) {
  if (points.length < 2) {
    return 0;
  }
  const target = clamp(fraction, 0, 1) * polylineLength(points);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const segmentLength = distance(previous, next);
    if (travelled + segmentLength >= target || index === points.length - 1) {
      return Math.atan2(next.y - previous.y, next.x - previous.x);
    }
    travelled += segmentLength;
  }
  const previous = points[points.length - 2];
  const next = points[points.length - 1];
  return Math.atan2(next.y - previous.y, next.x - previous.x);
}

function buildRouteLaneRecords(mapMessage) {
  return arr(mapMessage._laneInfos)
    .map((item) => {
      const points = curveToPoints(item.proto?.centralCurve);
      return {
        id: String(item.source?.id || item.proto?.id?.id || ''),
        successorIds: arr(item.proto?.successorId)
          .map((successor) => successor.id)
          .filter(Boolean),
        laneType: Number(item.proto?.type || 0),
        speedLimitMps: number(item.proto?.speedLimit, 0),
        length: number(item.proto?.length, polylineLength(points)),
        points,
      };
    })
    .filter((lane) => lane.id && lane.points.length >= 2 && lane.length > 0.5);
}

function followRouteSuccessors(startLane, laneById, limit = 64) {
  const result = [];
  const visited = new Set();
  let current = startLane;
  while (current && !visited.has(current.id) && result.length < limit) {
    result.push(current);
    visited.add(current.id);
    const nextId = current.successorIds.find((successorId) => laneById.has(successorId) && !visited.has(successorId));
    current = nextId ? laneById.get(nextId) : null;
  }
  return result;
}

function chooseDefaultRouteLanePath(lanes) {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const cityDrivingLanes = lanes.filter((lane) => lane.laneType === LANE_TYPE.CITY_DRIVING);
  const candidates = cityDrivingLanes.length ? cityDrivingLanes : lanes;
  let bestPath = [];
  let bestLength = 0;
  for (const lane of candidates) {
    const lanePath = followRouteSuccessors(lane, laneById);
    const length = lanePath.reduce((sum, item) => sum + item.length, 0);
    if (length > bestLength) {
      bestPath = lanePath;
      bestLength = length;
    }
  }
  if (bestPath.length > 0) {
    return bestPath;
  }
  return lanes.length ? [lanes.reduce((best, lane) => (lane.length > best.length ? lane : best), lanes[0])] : [];
}

function buildDefaultRouteArtifacts(mapName, mapMessage) {
  const lanes = buildRouteLaneRecords(mapMessage);
  if (lanes.length === 0) {
    return null;
  }
  const lanePath = chooseDefaultRouteLanePath(lanes);
  if (lanePath.length === 0) {
    return null;
  }
  const startLane = lanePath[0];
  const endLane = lanePath[lanePath.length - 1];
  const singleLane = startLane.id === endLane.id;
  const startFraction = singleLane ? 0.12 : 0.08;
  const endFraction = singleLane ? 0.88 : 0.82;
  const start = pointAtPolylineFraction(startLane.points, startFraction);
  const end = pointAtPolylineFraction(endLane.points, endFraction);
  const heading = headingAtPolylineFraction(startLane.points, startFraction);
  const estimatedLengthMeters = lanePath.reduce((sum, lane) => sum + lane.length, 0);
  const request = {
    type: 'SendRoutingRequest',
    start: {
      x: start.x,
      y: start.y,
      heading,
    },
    end: {
      x: end.x,
      y: end.y,
      id: endLane.id,
    },
  };
  const loopPlan = {
    version: 1,
    mapName,
    mode: 'closed_loop_candidate',
    generatedAt: new Date().toISOString(),
    laneIds: lanePath.map((lane) => lane.id),
    estimatedLengthMeters: Number(estimatedLengthMeters.toFixed(3)),
    startLaneId: startLane.id,
    endLaneId: endLane.id,
    nextRoutePolicy: {
      enabled: true,
      triggerDistanceToDestinationMeters: 3,
      stopReasonDestinationHandling: 'send_next_route_before_destination',
      chassisChurnGuard: 'do_not_toggle_control_on_destination_only',
    },
    request,
  };
  const poi = {
    version: 1,
    mapName,
    points: [
      {
        id: 'default_start',
        type: 'route_start',
        x: start.x,
        y: start.y,
        heading,
        laneId: startLane.id,
      },
      {
        id: 'default_end',
        type: 'route_end',
        x: end.x,
        y: end.y,
        laneId: endLane.id,
      },
    ],
  };
  return {
    request,
    loopPlan,
    poi,
  };
}

function buildGraphConnectivity(routingGraph) {
  const nodeIds = arr(routingGraph.node)
    .map((node) => String(node.laneId || ''))
    .filter(Boolean);
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, new Set()]));
  arr(routingGraph.edge).forEach((edge) => {
    const from = String(edge.fromLaneId || '');
    const to = String(edge.toLaneId || '');
    if (!adjacency.has(from) || !adjacency.has(to)) {
      return;
    }
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  });
  const visited = new Set();
  const components = [];
  nodeIds.forEach((nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }
    const queue = [nodeId];
    const component = [];
    visited.add(nodeId);
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      adjacency.get(current).forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    components.push(component);
  });
  return {
    components,
    componentCount: components.length,
  };
}

function headerBounds(cleanMap) {
  const header = cleanMap?.header || {};
  return {
    minX: number(header.left, NaN),
    maxX: number(header.right, NaN),
    minY: number(header.bottom, NaN),
    maxY: number(header.top, NaN),
  };
}

function boundsCenter(bounds) {
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)) {
    return null;
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: 0,
  };
}

function boundsLookGlobalApollo(bounds) {
  const center = boundsCenter(bounds);
  if (!center) {
    return false;
  }
  return (
    Math.max(Math.abs(center.x), Math.abs(center.y)) > 100000 &&
    bounds.maxX - bounds.minX < 100000 &&
    bounds.maxY - bounds.minY < 100000
  );
}

function pointLooksGlobalApollo(point) {
  return finiteCoordinate(point) && Math.max(Math.abs(point.x), Math.abs(point.y)) > 100000;
}

function captureCenterCandidate(value, source, enforce) {
  const coordinate = finiteCoordinate(coordinateFromArray(value));
  return coordinate ? { coordinate, source, enforce } : null;
}

function extractCaptureCenter(editorMap) {
  const candidates = [
    captureCenterCandidate(editorMap.trajectoryCenter, 'editorMap.trajectoryCenter', true),
    captureCenterCandidate(editorMap.trajectory_center, 'editorMap.trajectory_center', true),
    captureCenterCandidate(editorMap.captureTrajectoryCenter, 'editorMap.captureTrajectoryCenter', true),
    captureCenterCandidate(editorMap.capture_trajectory_center, 'editorMap.capture_trajectory_center', true),
    captureCenterCandidate(editorMap.trajectory?.center, 'editorMap.trajectory.center', true),
    captureCenterCandidate(editorMap.trajectory?.centerUtm, 'editorMap.trajectory.centerUtm', true),
    captureCenterCandidate(editorMap.trajectory?.center_utm, 'editorMap.trajectory.center_utm', true),
    captureCenterCandidate(editorMap.basemapCenter, 'editorMap.basemapCenter', false),
    captureCenterCandidate(editorMap.baseMapCenter, 'editorMap.baseMapCenter', false),
    captureCenterCandidate(editorMap.base_map_center, 'editorMap.base_map_center', false),
  ];
  return candidates.find(Boolean) || null;
}

function buildCoordinateMetadata(mapName, editorMap, cleanMap, coordinateTransform) {
  const bounds = headerBounds(cleanMap);
  const captureCenter = extractCaptureCenter(editorMap);
  const sourceCrs = coordinateTransform?.sourceCrs || coordinateFrameFromEditorMap(editorMap) || 'LOCAL_ENU_METERS';
  const captureCenterAlreadyTarget = sourceCrs === 'APOLLO_UTM_ZONE_50';
  const captureCenterTarget = captureCenter
    ? captureCenterAlreadyTarget
      ? captureCenter.coordinate
      : applyCoordinateTransform(captureCenter.coordinate, coordinateTransform)
    : null;
  const mapCenter = boundsCenter(bounds);
  return {
    version: 1,
    mapName,
    generatedAt: new Date().toISOString(),
    frames: {
      acceptedSourceCrs: {
        WGS84_LON_LAT: 'longitude, latitude, height on WGS84; converted to UTM zone 50N',
        GAUSS_KRUGER_CM114:
          '3-degree Gauss-Kruger / transverse Mercator meters, central meridian 114E; converted to UTM zone 50N',
        LOCAL_ENU_METERS: 'editor-local meter coordinates; requires apolloOrigin/utmOrigin or explicit map center',
        APOLLO_UTM_ZONE_50: 'Apollo map coordinates already in WGS84 UTM zone 50N meters',
      },
      knownProjectedSourceCrs: {
        GAUSS_KRUGER_CM114: GAUSS_KRUGER_CM114_CRS,
      },
      targetCrs: APOLLO_TARGET_CRS,
      apolloHeaderProjection: APOLLO_TARGET_CRS.proj4,
    },
    sourceCrs,
    sourceCrsDefinition: coordinateTransform?.sourceCrsDefinition || null,
    targetCrs: APOLLO_TARGET_CRS,
    apolloHeaderProjection: APOLLO_TARGET_CRS.proj4,
    transform: coordinateTransform
      ? {
          mode: coordinateTransform.mode,
          source: coordinateTransform.source,
          offsetMeters: coordinateTransform.offset,
          origin: coordinateTransform.origin,
          localCenter: coordinateTransform.localCenter,
          targetCenter: coordinateTransform.targetCenter,
        }
      : null,
    bounds,
    mapCenter,
    captureTrajectoryCenter: captureCenterTarget
      ? {
          source: captureCenter.source,
          enforce: captureCenter.enforce,
          enforcement: captureCenter.enforce ? 'strict' : 'advisory',
          raw: captureCenter.coordinate,
          target: captureCenterTarget,
          alreadyInTargetCrs: captureCenterAlreadyTarget,
          distanceToMapCenterMeters: mapCenter ? Number(distance(captureCenterTarget, mapCenter).toFixed(3)) : null,
        }
      : null,
  };
}

function buildReleaseQualityGate({ cleanMap, routingGraph, warnings, coordinateMetadata, routeArtifacts }) {
  const checks = [];
  const addCheck = (idValue, status, title, message, details = null) => {
    checks.push({
      id: idValue,
      status,
      title,
      message,
      ...(details ? { details } : {}),
    });
  };
  const conversionErrors = warnings.filter((warning) => String(warning.severity || '').toLowerCase() === 'error');
  addCheck(
    'coordinate-metadata',
    coordinateMetadata?.targetCrs?.epsg === APOLLO_TARGET_CRS.epsg ? 'ok' : 'error',
    'Coordinate metadata',
    coordinateMetadata?.targetCrs?.epsg === APOLLO_TARGET_CRS.epsg
      ? `Target CRS is fixed to ${APOLLO_TARGET_CRS.epsg} / UTM zone ${APOLLO_TARGET_CRS.zone}N`
      : 'Target CRS metadata is missing or inconsistent',
    coordinateMetadata?.targetCrs || null,
  );
  const sourceCrs = coordinateMetadata?.sourceCrs || 'UNKNOWN';
  const transformMode = coordinateMetadata?.transform?.mode || '';
  const sourceIsTrusted =
    sourceCrs === 'APOLLO_UTM_ZONE_50' ||
    ['wgs84-to-utm-zone-50', 'gauss-kruger-cm114-to-utm-zone-50'].includes(transformMode) ||
    (sourceCrs === 'LOCAL_ENU_METERS' && transformMode === 'offset' && coordinateMetadata?.transform?.source);
  addCheck(
    'coordinate-source-crs',
    sourceIsTrusted ? 'ok' : 'error',
    'Source coordinate reference',
    sourceIsTrusted
      ? `Source CRS ${sourceCrs} is explicitly handled by transform ${transformMode || 'pass-through'}`
      : `Source CRS ${sourceCrs} is not explicit enough for production publishing; confirm the point-cloud projection or provide an Apollo anchor`,
    {
      sourceCrs,
      transform: coordinateMetadata?.transform || null,
      sourceCrsDefinition: coordinateMetadata?.sourceCrsDefinition || null,
    },
  );
  addCheck(
    'coordinate-bounds',
    boundsLookGlobalApollo(coordinateMetadata.bounds) ? 'ok' : 'error',
    'Apollo map bounds',
    boundsLookGlobalApollo(coordinateMetadata.bounds)
      ? 'Map coordinates look like global Apollo UTM coordinates'
      : 'Map bounds look like local/editor coordinates; deployment must not proceed until the coordinate anchor is fixed',
    coordinateMetadata.bounds,
  );
  const coordinateErrors = conversionErrors.filter((warning) => /^apollo-coordinate/u.test(warning.code || ''));
  if (coordinateErrors.length > 0) {
    addCheck(
      'coordinate-conversion-errors',
      'error',
      'Coordinate conversion',
      coordinateErrors.map((warning) => warning.message || warning.code).join('; '),
      coordinateErrors,
    );
  }
  const captureDistance = coordinateMetadata.captureTrajectoryCenter?.distanceToMapCenterMeters;
  if (Number.isFinite(captureDistance)) {
    const captureCenterCheck = coordinateMetadata.captureTrajectoryCenter;
    const captureDistanceStatus = captureCenterCheck.enforce
      ? captureDistance <= 100
        ? 'ok'
        : captureDistance <= 5000
          ? 'warning'
          : 'error'
      : captureDistance <= 100
        ? 'ok'
        : 'warning';
    addCheck(
      'capture-center-distance',
      captureDistanceStatus,
      'Map center vs capture trajectory center',
      `Center distance is ${captureDistance.toFixed(2)}m`,
      captureCenterCheck,
    );
  } else {
    addCheck(
      'capture-center-distance',
      'warning',
      'Map center vs capture trajectory center',
      'No capture trajectory/base-map center was found in editor_map.json; edge preflight will rely on reference maps and live pose',
    );
  }
  const laneCount = arr(cleanMap.lane).length;
  const routingNodeCount = arr(routingGraph.node).length;
  const routingEdgeCount = arr(routingGraph.edge).length;
  addCheck(
    'routing-node-coverage',
    laneCount === 0 || routingNodeCount === laneCount ? 'ok' : 'error',
    'Routing node coverage',
    `${routingNodeCount}/${laneCount} lanes have routing nodes`,
    { laneCount, routingNodeCount },
  );
  addCheck(
    'routing-edge-coverage',
    laneCount <= 1 || routingEdgeCount > 0 ? 'ok' : 'error',
    'Routing edge coverage',
    laneCount <= 1
      ? 'Single-lane map does not require successor routing edges'
      : `${routingEdgeCount} routing edges generated`,
    { laneCount, routingEdgeCount },
  );
  const connectivity = buildGraphConnectivity(routingGraph);
  addCheck(
    'routing-connectivity',
    connectivity.componentCount <= 1 ? 'ok' : 'warning',
    'Routing reachability',
    connectivity.componentCount <= 1
      ? 'Routing graph is connected'
      : `Routing graph has ${connectivity.componentCount} connected components; verify this is intentional`,
    connectivity,
  );
  const invalidSpeedLanes = arr(cleanMap.lane).filter(
    (lane) => !Number.isFinite(Number(lane.speedLimit)) || Number(lane.speedLimit) <= 0,
  );
  const suspiciousSpeedLanes = arr(cleanMap.lane).filter((lane) => Number(lane.speedLimit) > 35);
  addCheck(
    'speed-limit-units',
    invalidSpeedLanes.length ? 'error' : suspiciousSpeedLanes.length ? 'warning' : 'ok',
    'Lane speed limits',
    invalidSpeedLanes.length
      ? `${invalidSpeedLanes.length} lanes have invalid speed_limit`
      : suspiciousSpeedLanes.length
        ? `${suspiciousSpeedLanes.length} lanes exceed 35m/s; check km/h vs m/s units`
        : 'Lane speed limits are finite Apollo m/s values',
    {
      invalidLaneIds: invalidSpeedLanes
        .map((lane) => lane.id?.id)
        .filter(Boolean)
        .slice(0, 20),
      suspiciousLaneIds: suspiciousSpeedLanes
        .map((lane) => lane.id?.id)
        .filter(Boolean)
        .slice(0, 20),
    },
  );
  const unsupportedWarnings = warnings.filter((warning) =>
    [
      'signal-missing-stop-line',
      'stop-sign-missing-stop-line',
      'yield-sign-missing-stop-line',
      'overlap-not-found',
    ].includes(warning.code),
  );
  addCheck(
    'overlap-junction-stop-sign',
    unsupportedWarnings.some((warning) => String(warning.severity).toLowerCase() === 'error')
      ? 'error'
      : unsupportedWarnings.length
        ? 'warning'
        : 'ok',
    'Overlap / junction / stop sign export',
    unsupportedWarnings.length
      ? `${unsupportedWarnings.length} export warnings need review`
      : 'Overlap-related Apollo export checks passed',
    unsupportedWarnings,
  );
  addCheck(
    'default-routing-artifacts',
    routeArtifacts ? 'ok' : laneCount > 0 ? 'error' : 'warning',
    'Default route and POI files',
    routeArtifacts
      ? 'default_routing_request.json, routing_loop_plan.json and poi.json will be generated'
      : 'No default route can be generated from this map',
    routeArtifacts
      ? {
          laneIds: routeArtifacts.loopPlan.laneIds,
          estimatedLengthMeters: routeArtifacts.loopPlan.estimatedLengthMeters,
        }
      : null,
  );
  const errors = checks.filter((check) => check.status === 'error');
  const warningChecks = checks.filter((check) => check.status === 'warning');
  return {
    version: 1,
    ready: errors.length === 0,
    errors: errors.length,
    warnings: warningChecks.length,
    checks,
  };
}

function indent(level) {
  return '  '.repeat(level);
}

function quote(value) {
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
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
  const { _laneInfos, _conversionWarnings, ...payload } = mapMessage;
  return stripPrivateFields(payload);
}

function stripPrivateFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripPrivateFields);
  }
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, nestedValue]) => [key, stripPrivateFields(nestedValue)]),
  );
}

function countRoadBoundaryEdges(cleanMap) {
  return arr(cleanMap.road).reduce(
    (sum, road) =>
      sum +
      arr(road.section).reduce(
        (sectionSum, section) => sectionSum + arr(section.boundary?.outerPolygon?.edge).length,
        0,
      ),
    0,
  );
}

function countStopLineCurves(cleanMap) {
  return (
    arr(cleanMap.signal).reduce((sum, item) => sum + arr(item.stopLine).length, 0) +
    arr(cleanMap.stopSign).reduce((sum, item) => sum + arr(item.stopLine).length, 0) +
    arr(cleanMap.yield).reduce((sum, item) => sum + arr(item.stopLine).length, 0)
  );
}

function countBySeverity(warnings) {
  return warnings.reduce((result, warning) => {
    const severity = warning.severity || 'warning';
    result[severity] = (result[severity] || 0) + 1;
    return result;
  }, {});
}

function buildContractMapping({ editor, apollo, editorKey, apolloKey, support, notes = [] }) {
  const input = editor[editorKey] || 0;
  const output = apollo[apolloKey] || 0;
  let status = 'ok';
  if (support === 'unsupported') {
    status = input > 0 ? 'unsupported' : 'ok';
  } else if (support === 'embedded') {
    status = input > output ? 'warning' : 'ok';
  } else if (input > output) {
    status = 'warning';
  }
  return {
    editor: editorKey,
    apollo: apolloKey,
    support,
    input,
    output,
    status,
    notes,
  };
}

function buildConversionContract(editorMap, cleanMap, routingGraph, warnings) {
  const editor = {
    points: arr(editorMap.point).length,
    boundaries: arr(editorMap.boundary).length,
    roadBoundaries: arrFromKeys(editorMap, ['roadBoundary', 'road_boundary']).length,
    lanes: arr(editorMap.lane).length,
    junctions: arr(editorMap.junction).length,
    crosswalks: arr(editorMap.crosswalk).length,
    speedBumps: arrFromKeys(editorMap, ['speed_bump', 'speedBump']).length,
    stopLines: arrFromKeys(editorMap, ['stopLine', 'stop_line']).length,
    trafficSignals: arr(editorMap.trafficSignal).length,
    stopSigns: arr(editorMap.stopSign).length,
    yieldSigns: arr(editorMap.yieldSign).length,
    parkingSpaces: arrFromKeys(editorMap, ['parkingSpace', 'parking_space']).length,
    areas: arr(editorMap.area).length,
    barrierGates: arrFromKeys(editorMap, ['barrierGate', 'barrier_gate']).length,
  };
  const apollo = {
    lanes: arr(cleanMap.lane).length,
    roads: arr(cleanMap.road).length,
    roadBoundaryEdges: countRoadBoundaryEdges(cleanMap),
    junctions: arr(cleanMap.junction).length,
    crosswalks: arr(cleanMap.crosswalk).length,
    speedBumps: arr(cleanMap.speedBump).length,
    stopLineCurves: countStopLineCurves(cleanMap),
    trafficSignals: arr(cleanMap.signal).length,
    stopSigns: arr(cleanMap.stopSign).length,
    yieldSigns: arr(cleanMap.yield).length,
    parkingSpaces: arr(cleanMap.parkingSpace).length,
    clearAreas: arr(cleanMap.clearArea).length,
    overlaps: arr(cleanMap.overlap).length,
    routingNodes: arr(routingGraph.node).length,
    routingEdges: arr(routingGraph.edge).length,
  };
  const mappings = [
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'lanes',
      apolloKey: 'lanes',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'roadBoundaries',
      apolloKey: 'roadBoundaryEdges',
      support: 'partial',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'junctions',
      apolloKey: 'junctions',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'crosswalks',
      apolloKey: 'crosswalks',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'speedBumps',
      apolloKey: 'speedBumps',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'stopLines',
      apolloKey: 'stopLineCurves',
      support: 'embedded',
      notes: ['Apollo has no top-level stop_line; stop lines are embedded in signal, stop_sign, and yield.'],
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'trafficSignals',
      apolloKey: 'trafficSignals',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'stopSigns',
      apolloKey: 'stopSigns',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'yieldSigns',
      apolloKey: 'yieldSigns',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'parkingSpaces',
      apolloKey: 'parkingSpaces',
      support: 'full',
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'areas',
      apolloKey: 'clearAreas',
      support: 'partial',
      notes: ['Only non-driveable editor areas map to Apollo clear_area.'],
    }),
    buildContractMapping({
      editor,
      apollo,
      editorKey: 'barrierGates',
      apolloKey: 'barrierGates',
      support: 'unsupported',
      notes: ['Apollo HDMap has no direct barrier gate element; the editor keeps it in editor_map.json only.'],
    }),
  ];
  return {
    version: 1,
    target: 'ApolloLite modules/common_msgs/map_msgs/map.proto',
    editorCounts: editor,
    apolloCounts: apollo,
    warningCounts: countBySeverity(warnings),
    mappings,
  };
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
  const warnings = mapMessage._conversionWarnings || [];
  const coordinateTransform = mapMessage._coordinateTransform || null;
  const contract = buildConversionContract(editorMap, cleanMap, routingGraph, warnings);
  const coordinateMetadata = buildCoordinateMetadata(mapName, editorMap, cleanMap, coordinateTransform);
  const routeArtifacts = buildDefaultRouteArtifacts(mapName, mapMessage);
  const warningCounts = countBySeverity(warnings);
  const qualityGate = buildReleaseQualityGate({
    cleanMap,
    routingGraph,
    warnings,
    coordinateMetadata,
    routeArtifacts,
  });
  const files = [
    'editor_map.json',
    'base_map.txt',
    'base_map.bin',
    'sim_map.txt',
    'sim_map.bin',
    'routing_map.txt',
    'routing_map.bin',
    'coordinate_metadata.json',
    'quality_gate.json',
    ...(routeArtifacts ? ['default_routing_request.json', 'routing_loop_plan.json', 'poi.json'] : []),
  ];

  await fs.copyFile(jsonPath, path.join(releaseDir, 'editor_map.json'));
  await fs.writeFile(path.join(releaseDir, 'base_map.txt'), `${objectToText(cleanMap)}\n`, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'sim_map.txt'), `${objectToText(cleanMap)}\n`, 'utf8');
  await fs.writeFile(path.join(releaseDir, 'routing_map.txt'), `${objectToText(routingGraph)}\n`, 'utf8');
  await writeBinary(root, 'apollo.hdmap.Map', cleanMap, path.join(releaseDir, 'base_map.bin'));
  await writeBinary(root, 'apollo.hdmap.Map', cleanMap, path.join(releaseDir, 'sim_map.bin'));
  await writeBinary(root, 'apollo.routing.Graph', routingGraph, path.join(releaseDir, 'routing_map.bin'));
  await fs.writeFile(
    path.join(releaseDir, 'coordinate_metadata.json'),
    JSON.stringify(coordinateMetadata, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(releaseDir, 'quality_gate.json'), JSON.stringify(qualityGate, null, 2), 'utf8');
  if (routeArtifacts) {
    await fs.writeFile(
      path.join(releaseDir, 'default_routing_request.json'),
      JSON.stringify(routeArtifacts.request, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(releaseDir, 'routing_loop_plan.json'),
      JSON.stringify(routeArtifacts.loopPlan, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(releaseDir, 'poi.json'), JSON.stringify(routeArtifacts.poi, null, 2), 'utf8');
  }
  await fs.writeFile(
    path.join(releaseDir, 'manifest.json'),
    JSON.stringify(
      {
        mapName,
        generatedAt: new Date().toISOString(),
        converter: 'mapeditor-js-compat',
        nativeConverter: false,
        baseMapDir,
        coordinateMetadata,
        targetCrs: APOLLO_TARGET_CRS,
        sourceCrs: coordinateTransform?.sourceCrs || coordinateFrameFromEditorMap(editorMap) || 'LOCAL_ENU_METERS',
        anchor: coordinateTransform?.origin
          ? {
              source: coordinateTransform.source,
              utm: coordinateTransform.origin,
            }
          : null,
        bounds: {
          xMin: cleanMap.header?.left ?? null,
          xMax: cleanMap.header?.right ?? null,
          yMin: cleanMap.header?.bottom ?? null,
          yMax: cleanMap.header?.top ?? null,
        },
        coordinateTransform: coordinateTransform
          ? {
              mode: coordinateTransform.mode,
              source: coordinateTransform.source,
              sourceCrs: coordinateTransform.sourceCrs,
              sourceCrsDefinition: coordinateTransform.sourceCrsDefinition || null,
              targetCrs: coordinateTransform.targetCrs,
              offset: {
                x: coordinateTransform.offset.x,
                y: coordinateTransform.offset.y,
                z: coordinateTransform.offset.z,
              },
              origin: coordinateTransform.origin,
              localCenter: coordinateTransform.localCenter,
              targetCenter: coordinateTransform.targetCenter,
            }
          : null,
        warnings,
        contract,
        qualityGate,
        routeArtifacts: routeArtifacts
          ? {
              defaultRoutingRequest: 'default_routing_request.json',
              loopPlan: 'routing_loop_plan.json',
              poi: 'poi.json',
              laneIds: routeArtifacts.loopPlan.laneIds,
              estimatedLengthMeters: routeArtifacts.loopPlan.estimatedLengthMeters,
            }
          : null,
        files,
        summary: {
          lanes: cleanMap.lane.length,
          roads: cleanMap.road.length,
          roadBoundaryEdges: contract.apolloCounts.roadBoundaryEdges,
          crosswalks: cleanMap.crosswalk.length,
          junctions: cleanMap.junction.length,
          signals: cleanMap.signal.length,
          stopSigns: cleanMap.stopSign.length,
          yieldSigns: cleanMap.yield.length,
          clearAreas: cleanMap.clearArea.length,
          speedBumps: cleanMap.speedBump.length,
          parkingSpaces: cleanMap.parkingSpace.length,
          overlaps: cleanMap.overlap.length,
          routingNodes: routingGraph.node.length,
          routingEdges: routingGraph.edge.length,
          warnings: warningCounts.warning || 0,
          infos: warningCounts.info || 0,
          contractWarnings: contract.warningCounts.warning || 0,
          contractErrors: contract.warningCounts.error || 0,
          qualityGateReady: qualityGate.ready,
          qualityGateErrors: qualityGate.errors,
          qualityGateWarnings: qualityGate.warnings,
          defaultRouteGenerated: Boolean(routeArtifacts),
        },
      },
      null,
      2,
    ),
    'utf8',
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

// Unit tests for numerically-sensitive converter internals (projection +
// geometry). These give a fast, isolated correctness anchor so refactors of the
// 3000+ line converter are safe. Uses the __test__ exports.
const assert = require('assert');
const { __test__: T } = require('../backend/runtime/editorMapConverter');

function approx(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (eps ${eps})`);
}

function main() {
  // 1) WGS84 point on the zone-50 central meridian (117E) -> easting = false
  //    easting (500000), northing = 0 at the equator.
  const cm = T.wgs84LonLatToUtmZone50(117, 0);
  approx(cm.x, 500000, 0.01, 'CM easting');
  approx(cm.y, 0, 0.01, 'equator northing');

  // 2) Forward/inverse Transverse-Mercator round-trip < 1mm over a realistic
  //    park location (near 114-117E, ~38N).
  for (const [lon, lat] of [[114.3, 38.1], [116.9, 39.9], [117.6, 36.2]]) {
    const utm = T.wgs84LonLatToUtmZone50(lon, lat);
    const back = T.inverseTransverseMercator(utm.x, utm.y, T.APOLLO_TARGET_CRS);
    approx(back.lon, lon, 1e-6, `roundtrip lon @${lon}`); // ~10cm at this latitude
    approx(back.lat, lat, 1e-6, `roundtrip lat @${lat}`);
  }

  // 3) UTM easting stays inside the valid band (166000..834000) for in-zone data.
  for (const lon of [114, 115.5, 117, 118.5, 120]) {
    const u = T.wgs84LonLatToUtmZone50(lon, 38);
    assert.ok(u.x > 166000 && u.x < 834000, `in-zone easting band @${lon}: ${u.x}`);
  }

  // 4) Geometry helpers.
  const sq = [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 10, y: 10, z: 0 },
  ];
  approx(T.polylineLength(sq), 20, 1e-9, 'polylineLength');
  approx(T.distance(sq[0], sq[1]), 10, 1e-9, 'distance');
  const mid = T.interpolate(sq, 0.5);
  approx(mid.x, 10, 1e-6, 'interpolate mid x'); // halfway along 20m = at (10,0)
  approx(mid.y, 0, 1e-6, 'interpolate mid y');
  const b0 = T.cubicBezier({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 3, y: 0, z: 0 }, 0);
  const b1 = T.cubicBezier({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, { x: 3, y: 0, z: 0 }, 1);
  approx(b0.x, 0, 1e-9, 'bezier t=0 endpoint');
  approx(b1.x, 3, 1e-9, 'bezier t=1 endpoint');

  console.log(JSON.stringify({ cmEasting: cm.x, roundtripOk: true, geometryOk: true }));
  console.log('[pass] converter-geometry');
}

main();

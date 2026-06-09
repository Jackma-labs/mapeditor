const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { convertEditorMapToApolloPackage } = require('../backend/runtime/editorMapConverter');

function point(id, x, y, type = 1) {
  return {
    id,
    type,
    position: { x, y },
  };
}

function boundary(id, pointIds, type) {
  return {
    id,
    type,
    point_id: pointIds,
  };
}

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mapeditor-converter-contract-'));
  const jsonPath = path.join(tmpDir, 'editor_map.json');
  const releaseDir = path.join(tmpDir, 'release');

  const editorMap = {
    header: { version: 'contract-test' },
    sourceCrs: 'LOCAL_ENU_METERS',
    coordinateCenter: { x: 500018, y: 4300000, z: 0 },
    trajectoryCenter: { x: 18, y: 0, z: 0 },
    point: [
      point('lane-left-a', 0, 2, 1),
      point('lane-left-b', 30, 2, 1),
      point('lane-right-a', 0, -2, 1),
      point('lane-right-b', 30, -2, 1),
      point('road-a', 0, 4, 39),
      point('road-b', 30, 4, 39),
      point('stop-a', 8, -2.5, 5),
      point('stop-b', 8, 2.5, 5),
      point('standalone-stop-a', 18, -2.5, 5),
      point('standalone-stop-b', 18, 2.5, 5),
      point('speed-a', 15, -2.5, 4),
      point('speed-b', 15, 2.5, 4),
      point('junction-a', 28, -4, 2),
      point('junction-b', 36, -4, 2),
      point('junction-c', 36, 4, 2),
      point('junction-d', 28, 4, 2),
      point('crosswalk-a', 10, -3, 3),
      point('crosswalk-b', 12, -3, 3),
      point('crosswalk-c', 12, 3, 3),
      point('crosswalk-d', 10, 3, 3),
      point('parking-a', 20, -6, 6),
      point('parking-b', 26, -6, 6),
      point('parking-c', 26, -3, 6),
      point('parking-d', 20, -3, 6),
      point('area-a', 4, -8, 48),
      point('area-b', 12, -8, 48),
      point('area-c', 12, -5, 48),
      point('area-d', 4, -5, 48),
      point('driveable-area-a', 4, 5, 48),
      point('driveable-area-b', 12, 5, 48),
      point('driveable-area-c', 12, 8, 48),
      point('driveable-area-d', 4, 8, 48),
      point('gate-a', 24, -2.5, 5),
      point('gate-b', 24, 2.5, 5),
    ],
    boundary: [
      boundary('lane-left', ['lane-left-a', 'lane-left-b'], 7),
      boundary('lane-right', ['lane-right-a', 'lane-right-b'], 7),
      boundary('stop-boundary', ['stop-a', 'stop-b'], 11),
      boundary('standalone-stop-boundary', ['standalone-stop-a', 'standalone-stop-b'], 11),
      boundary('speed-boundary', ['speed-a', 'speed-b'], 10),
      boundary('junction-boundary', ['junction-a', 'junction-b', 'junction-c', 'junction-d', 'junction-a'], 8),
      boundary('crosswalk-boundary', ['crosswalk-a', 'crosswalk-b', 'crosswalk-c', 'crosswalk-d', 'crosswalk-a'], 9),
      boundary('parking-boundary', ['parking-a', 'parking-b', 'parking-c', 'parking-d', 'parking-a'], 12),
      boundary('clear-area-boundary', ['area-a', 'area-b', 'area-c', 'area-d', 'area-a'], 50),
      boundary(
        'driveable-area-boundary',
        ['driveable-area-a', 'driveable-area-b', 'driveable-area-c', 'driveable-area-d', 'driveable-area-a'],
        50,
      ),
      boundary('gate-boundary', ['gate-a', 'gate-b'], 52),
    ],
    roadBoundary: [boundary('road-boundary', ['road-a', 'road-b'], 40)],
    lane: [
      {
        id: 'lane-1',
        left_boundary_id: 'lane-left',
        right_boundary_id: 'lane-right',
        width: 4,
        attr: { speed: 8, direction: 1, prossibleDrivingDirection: 1, laneType: 1 },
      },
    ],
    stopLine: [
      { id: 'stop-1', boundaryId: 'stop-boundary', origin: 1 },
      { id: 'standalone-stop-1', boundaryId: 'standalone-stop-boundary', origin: 0 },
      { id: 'gate-stop-1', boundaryId: 'gate-boundary', origin: 3 },
    ],
    trafficSignal: [
      {
        id: 'signal-1',
        stopLineId: 'stop-1',
        center: { x: 8, y: 3 },
        type: 4,
        subSignal: [{ id: 'signal-1-0', type: 2 }],
      },
    ],
    stopSign: [{ id: 'stop-sign-1', stopLineId: 'stop-1' }],
    yieldSign: [{ id: 'yield-sign-1', stopLineId: 'stop-1' }],
    speed_bump: [{ id: 'speed-1', boundaryId: 'speed-boundary' }],
    junction: [{ id: 'junction-1', boundaryId: 'junction-boundary', attr: { type: 2 } }],
    crosswalk: [{ id: 'crosswalk-1', boundaryId: 'crosswalk-boundary' }],
    parkingSpace: [{ id: 'parking-1', boundaryId: 'parking-boundary', heading: 0 }],
    area: [
      { id: 'clear-area-1', boundaryId: 'clear-area-boundary', type: 2 },
      { id: 'driveable-area-1', boundaryId: 'driveable-area-boundary', type: 1 },
    ],
    barrierGate: [{ id: 'gate-1', stopLineId: 'gate-stop-1', boundaryId: 'gate-boundary' }],
  };

  await fs.writeFile(jsonPath, JSON.stringify(editorMap), 'utf8');
  await convertEditorMapToApolloPackage({ mapName: 'contract-test', jsonPath, releaseDir });

  const manifest = JSON.parse(await fs.readFile(path.join(releaseDir, 'manifest.json'), 'utf8'));
  const coordinateMetadata = JSON.parse(await fs.readFile(path.join(releaseDir, 'coordinate_metadata.json'), 'utf8'));
  const qualityGate = JSON.parse(await fs.readFile(path.join(releaseDir, 'quality_gate.json'), 'utf8'));
  const defaultRoutingRequest = JSON.parse(await fs.readFile(path.join(releaseDir, 'default_routing_request.json'), 'utf8'));
  const routingLoopPlan = JSON.parse(await fs.readFile(path.join(releaseDir, 'routing_loop_plan.json'), 'utf8'));
  const poi = JSON.parse(await fs.readFile(path.join(releaseDir, 'poi.json'), 'utf8'));
  const baseMapText = await fs.readFile(path.join(releaseDir, 'base_map.txt'), 'utf8');

  assert.strictEqual(manifest.summary.lanes, 1);
  assert.strictEqual(manifest.summary.roadBoundaryEdges, 1);
  assert.strictEqual(manifest.summary.crosswalks, 1);
  assert.strictEqual(manifest.summary.junctions, 1);
  assert.strictEqual(manifest.summary.signals, 1);
  assert.strictEqual(manifest.summary.stopSigns, 1);
  assert.strictEqual(manifest.summary.yieldSigns, 1);
  assert.strictEqual(manifest.summary.speedBumps, 1);
  assert.strictEqual(manifest.summary.parkingSpaces, 1);
  assert.strictEqual(manifest.summary.clearAreas, 1);
  assert.strictEqual(manifest.summary.overlaps, 5);
  assert.strictEqual(manifest.summary.qualityGateReady, true);
  assert.strictEqual(manifest.summary.qualityGateErrors, 0);
  assert.strictEqual(manifest.summary.defaultRouteGenerated, true);
  assert.ok(manifest.contract);
  assert.strictEqual(manifest.coordinateMetadata.targetCrs.epsg, 'EPSG:32650');
  assert.strictEqual(coordinateMetadata.targetCrs.epsg, 'EPSG:32650');
  assert.strictEqual(coordinateMetadata.targetCrs.zone, 50);
  assert.strictEqual(coordinateMetadata.captureTrajectoryCenter.enforcement, 'strict');
  assert.strictEqual(qualityGate.ready, true);
  assert.ok(qualityGate.checks.find((item) => item.id === 'coordinate-metadata' && item.status === 'ok'));
  assert.ok(qualityGate.checks.find((item) => item.id === 'coordinate-bounds' && item.status === 'ok'));
  assert.ok(qualityGate.checks.find((item) => item.id === 'capture-center-distance' && item.status === 'ok'));
  assert.strictEqual(manifest.routeArtifacts.defaultRoutingRequest, 'default_routing_request.json');
  assert.strictEqual(manifest.routeArtifacts.loopPlan, 'routing_loop_plan.json');
  assert.strictEqual(manifest.routeArtifacts.poi, 'poi.json');
  assert.deepStrictEqual(manifest.routeArtifacts.laneIds, ['lane-1']);
  assert.ok(manifest.files.includes('coordinate_metadata.json'));
  assert.ok(manifest.files.includes('quality_gate.json'));
  assert.ok(manifest.files.includes('default_routing_request.json'));
  assert.ok(manifest.files.includes('routing_loop_plan.json'));
  assert.ok(manifest.files.includes('poi.json'));
  assert.strictEqual(defaultRoutingRequest.type, 'SendRoutingRequest');
  assert.strictEqual(routingLoopPlan.nextRoutePolicy.enabled, true);
  assert.strictEqual(routingLoopPlan.nextRoutePolicy.stopReasonDestinationHandling, 'send_next_route_before_destination');
  assert.deepStrictEqual(routingLoopPlan.laneIds, ['lane-1']);
  assert.strictEqual(poi.points.length, 2);
  assert.strictEqual(manifest.contract.editorCounts.barrierGates, 1);
  assert.strictEqual(manifest.contract.apolloCounts.roadBoundaryEdges, 1);
  assert.strictEqual(manifest.contract.apolloCounts.stopLineCurves, 3);
  assert.strictEqual(manifest.contract.apolloCounts.overlaps, 5);
  assert.ok(manifest.contract.mappings.find((item) => item.editor === 'barrierGates' && item.status === 'unsupported'));
  assert.ok(manifest.warnings.some((item) => item.code === 'barrier-gate-not-in-apollo-hdmap'));
  assert.ok(!manifest.warnings.some((item) => item.code === 'apollo-overlap-not-generated'));
  assert.ok(!manifest.warnings.some((item) => item.code === 'overlap-not-found'));
  assert.ok(manifest.warnings.some((item) => item.code === 'area-type-not-apollo-clear-area'));
  assert.ok(manifest.warnings.some((item) => item.code === 'standalone-stop-line-not-exported'));
  assert.match(baseMapText, /^signal \{/m);
  assert.match(baseMapText, /^clear_area \{/m);
  assert.match(baseMapText, /outer_polygon \{/);
  assert.match(baseMapText, /^stop_sign \{/m);
  assert.match(baseMapText, /^yield \{/m);
  assert.match(baseMapText, /^overlap \{/m);
  assert.match(baseMapText, /lane_overlap_info \{/);
  assert.match(baseMapText, /signal_overlap_info \{/);
  assert.match(baseMapText, /stop_sign_overlap_info \{/);
  assert.match(baseMapText, /yield_sign_overlap_info \{/);
  assert.match(baseMapText, /crosswalk_overlap_info \{/);
  assert.match(baseMapText, /speed_bump_overlap_info \{/);

  const autoOriginJsonPath = path.join(tmpDir, 'editor_map_auto_origin.json');
  const autoOriginReleaseDir = path.join(tmpDir, 'release-auto-origin');
  const autoOriginEditorMap = JSON.parse(JSON.stringify(editorMap));
  delete autoOriginEditorMap.coordinateCenter;
  delete autoOriginEditorMap.trajectoryCenter;
  autoOriginEditorMap.basemapCenter = { x: 500000, y: 4300000, z: 0 };
  await fs.writeFile(autoOriginJsonPath, JSON.stringify(autoOriginEditorMap), 'utf8');
  await convertEditorMapToApolloPackage({
    mapName: 'auto-origin-test',
    jsonPath: autoOriginJsonPath,
    releaseDir: autoOriginReleaseDir,
  });
  const autoManifest = JSON.parse(await fs.readFile(path.join(autoOriginReleaseDir, 'manifest.json'), 'utf8'));
  const autoCoordinateMetadata = JSON.parse(
    await fs.readFile(path.join(autoOriginReleaseDir, 'coordinate_metadata.json'), 'utf8'),
  );
  const autoQualityGate = JSON.parse(await fs.readFile(path.join(autoOriginReleaseDir, 'quality_gate.json'), 'utf8'));
  assert.strictEqual(autoManifest.coordinateTransform.source, 'basemapCenter(auto-origin)');
  assert.deepStrictEqual(autoManifest.coordinateTransform.offset, { x: 500000, y: 4300000, z: 0 });
  assert.strictEqual(autoQualityGate.ready, true);
  assert.strictEqual(autoQualityGate.errors, 0);
  assert.ok(autoManifest.bounds.xMin > 499000);
  assert.ok(autoManifest.bounds.yMin > 4299000);
  assert.strictEqual(autoCoordinateMetadata.captureTrajectoryCenter.enforcement, 'advisory');
  assert.ok(autoCoordinateMetadata.captureTrajectoryCenter.distanceToMapCenterMeters < 100);

  const originJsonPath = path.join(tmpDir, 'editor_map_origin_anchor.json');
  const originReleaseDir = path.join(tmpDir, 'release-origin-anchor');
  const originEditorMap = JSON.parse(JSON.stringify(editorMap));
  delete originEditorMap.coordinateCenter;
  originEditorMap.sourceCrs = 'LOCAL_ENU_METERS';
  originEditorMap.apolloOrigin = { x: 500000, y: 4300000, z: 0 };
  originEditorMap.anchor = {
    source: 'base_map_coordinate_metadata:center_as_local_origin',
    utm: originEditorMap.apolloOrigin,
  };
  await fs.writeFile(originJsonPath, JSON.stringify(originEditorMap), 'utf8');
  await convertEditorMapToApolloPackage({
    mapName: 'origin-anchor-test',
    jsonPath: originJsonPath,
    releaseDir: originReleaseDir,
  });
  const originManifest = JSON.parse(await fs.readFile(path.join(originReleaseDir, 'manifest.json'), 'utf8'));
  const originBaseMapText = await fs.readFile(path.join(originReleaseDir, 'base_map.txt'), 'utf8');
  assert.strictEqual(originManifest.coordinateTransform.source, 'base_map_coordinate_metadata:center_as_local_origin');
  assert.deepStrictEqual(originManifest.coordinateTransform.offset, { x: 500000, y: 4300000, z: 0 });
  assert.match(originBaseMapText, /x:\s*500000(?:\.0+)?\s*\n\s*y:\s*4300002(?:\.0+)?/);

  console.log(
    JSON.stringify({
      releaseDir,
      summary: manifest.summary,
      warnings: manifest.warnings.map((item) => item.code),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

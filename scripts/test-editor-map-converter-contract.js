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
  assert.strictEqual(autoManifest.coordinateTransform, null);
  assert.strictEqual(autoQualityGate.ready, false);
  assert.ok(autoQualityGate.errors > 0);
  assert.ok(autoQualityGate.checks.find((item) => item.id === 'coordinate-source-crs' && item.status === 'error'));
  assert.ok(autoManifest.bounds.xMin < 1000);
  assert.ok(autoManifest.bounds.yMin < 1000);
  assert.strictEqual(autoCoordinateMetadata.captureTrajectoryCenter.enforcement, 'advisory');
  assert.ok(autoCoordinateMetadata.captureTrajectoryCenter.distanceToMapCenterMeters > 100000);

  const cm114JsonPath = path.join(tmpDir, 'editor_map_cm114.json');
  const cm114ReleaseDir = path.join(tmpDir, 'release-cm114');
  const cm114Map = JSON.parse(JSON.stringify(editorMap));
  delete cm114Map.coordinateCenter;
  delete cm114Map.trajectoryCenter;
  cm114Map.sourceCrs = 'GAUSS_KRUGER_CM114';
  const cm114Origin = { x: 729003.7468, y: 4298924.2408, z: 0 };
  for (const item of cm114Map.point) {
    item.position.x += cm114Origin.x;
    item.position.y += cm114Origin.y;
  }
  cm114Map.basemapCenter = cm114Origin;
  await fs.writeFile(cm114JsonPath, JSON.stringify(cm114Map), 'utf8');
  await convertEditorMapToApolloPackage({
    mapName: 'cm114-test',
    jsonPath: cm114JsonPath,
    releaseDir: cm114ReleaseDir,
  });
  const cm114Manifest = JSON.parse(await fs.readFile(path.join(cm114ReleaseDir, 'manifest.json'), 'utf8'));
  const cm114CoordinateMetadata = JSON.parse(await fs.readFile(path.join(cm114ReleaseDir, 'coordinate_metadata.json'), 'utf8'));
  const cm114QualityGate = JSON.parse(await fs.readFile(path.join(cm114ReleaseDir, 'quality_gate.json'), 'utf8'));
  assert.strictEqual(cm114Manifest.coordinateTransform.mode, 'gauss-kruger-cm114-to-utm-zone-50');
  assert.strictEqual(cm114CoordinateMetadata.sourceCrs, 'GAUSS_KRUGER_CM114');
  assert.strictEqual(cm114QualityGate.ready, true);
  assert.strictEqual(cm114QualityGate.errors, 0);
  assert.ok(cm114Manifest.bounds.xMin > 468250 && cm114Manifest.bounds.xMax < 468450);
  assert.ok(cm114Manifest.bounds.yMin > 4293850 && cm114Manifest.bounds.yMax < 4294050);

  const localCm114JsonPath = path.join(tmpDir, 'editor_map_local_cm114.json');
  const localCm114ReleaseDir = path.join(tmpDir, 'release-local-cm114');
  const localCm114Map = JSON.parse(JSON.stringify(editorMap));
  delete localCm114Map.coordinateCenter;
  delete localCm114Map.trajectoryCenter;
  localCm114Map.sourceCrs = 'LOCAL_ENU_METERS';
  localCm114Map.basemapCenter = cm114Origin;
  localCm114Map.anchor = {
    source: 'base_map_coordinate_metadata:gauss_kruger_cm114_local_origin',
    sourceCrs: 'GAUSS_KRUGER_CM114',
    sourceOrigin: cm114Origin,
  };
  await fs.writeFile(localCm114JsonPath, JSON.stringify(localCm114Map), 'utf8');
  await convertEditorMapToApolloPackage({
    mapName: 'local-cm114-test',
    jsonPath: localCm114JsonPath,
    releaseDir: localCm114ReleaseDir,
  });
  const localCm114Manifest = JSON.parse(await fs.readFile(path.join(localCm114ReleaseDir, 'manifest.json'), 'utf8'));
  const localCm114CoordinateMetadata = JSON.parse(
    await fs.readFile(path.join(localCm114ReleaseDir, 'coordinate_metadata.json'), 'utf8'),
  );
  const localCm114QualityGate = JSON.parse(await fs.readFile(path.join(localCm114ReleaseDir, 'quality_gate.json'), 'utf8'));
  assert.strictEqual(localCm114Manifest.coordinateTransform.mode, 'local-enu-gauss-kruger-cm114-to-utm-zone-50');
  assert.strictEqual(localCm114CoordinateMetadata.sourceCrs, 'LOCAL_ENU_METERS');
  assert.strictEqual(localCm114CoordinateMetadata.transform.sourceProjectedCrs, 'GAUSS_KRUGER_CM114');
  assert.strictEqual(localCm114QualityGate.ready, true);
  assert.strictEqual(localCm114QualityGate.errors, 0);
  assert.ok(localCm114Manifest.bounds.xMin > 468250 && localCm114Manifest.bounds.xMax < 468450);
  assert.ok(localCm114Manifest.bounds.yMin > 4293850 && localCm114Manifest.bounds.yMax < 4294050);

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

  const reversedTopologyJsonPath = path.join(tmpDir, 'editor_map_reversed_topology.json');
  const reversedTopologyReleaseDir = path.join(tmpDir, 'release-reversed-topology');
  const reversedTopologyMap = {
    header: { version: 'reversed-topology-test' },
    sourceCrs: 'LOCAL_ENU_METERS',
    coordinateCenter: { x: 500030, y: 4300000, z: 0 },
    trajectoryCenter: { x: 30, y: 0, z: 0 },
    point: [
      point('lane-a-left-a', 0, 2, 1),
      point('lane-a-left-b', 30, 2, 1),
      point('lane-a-right-a', 0, -2, 1),
      point('lane-a-right-b', 30, -2, 1),
      point('lane-b-left-b', 60, -2, 1),
      point('lane-b-right-b', 60, 2, 1),
    ],
    boundary: [
      boundary('lane-a-left', ['lane-a-left-a', 'lane-a-left-b'], 7),
      boundary('lane-a-right', ['lane-a-right-a', 'lane-a-right-b'], 7),
      boundary('lane-b-left', ['lane-a-right-b', 'lane-b-left-b'], 7),
      boundary('lane-b-right', ['lane-a-left-b', 'lane-b-right-b'], 7),
    ],
    lane: [
      {
        id: 'lane-a',
        left_boundary_id: 'lane-a-left',
        right_boundary_id: 'lane-a-right',
        width: 4,
        attr: { speed: 8, direction: 1, prossibleDrivingDirection: 1, laneType: 1 },
      },
      {
        id: 'lane-b',
        left_boundary_id: 'lane-b-left',
        right_boundary_id: 'lane-b-right',
        width: 4,
        attr: { speed: 8, direction: 1, prossibleDrivingDirection: 1, laneType: 1 },
      },
    ],
  };
  await fs.writeFile(reversedTopologyJsonPath, JSON.stringify(reversedTopologyMap), 'utf8');
  await convertEditorMapToApolloPackage({
    mapName: 'reversed-topology-test',
    jsonPath: reversedTopologyJsonPath,
    releaseDir: reversedTopologyReleaseDir,
  });
  const reversedTopologyManifest = JSON.parse(
    await fs.readFile(path.join(reversedTopologyReleaseDir, 'manifest.json'), 'utf8'),
  );
  assert.strictEqual(reversedTopologyManifest.summary.lanes, 2);
  assert.strictEqual(reversedTopologyManifest.summary.routingEdges, 1);
  assert.ok(
    !reversedTopologyManifest.warnings.some(
      (item) => item.code === 'lane-endpoints-near-but-not-topologically-connected',
    ),
  );

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

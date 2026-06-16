// Alias-matrix test: an editor_map written with camelCase field aliases
// (pointId, leftBoundaryId, ...) must convert to byte-identical Apollo geometry
// as the canonical snake_case form. This locks the whole field-alias surface so
// a future reader that misses an alias (the historical pointId bug) fails CI.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');

const { convertEditorMapToApolloPackage } = require('../backend/runtime/editorMapConverter');

function points() {
  // two ~parallel straight boundaries (open lane), distinct endpoints
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    pts.push({ id: `L${i}`, position: { x: i * 6, y: 0, z: 0 }, type: 1 });
    pts.push({ id: `R${i}`, position: { x: i * 6, y: 3.2, z: 0 }, type: 1 });
  }
  return pts;
}

const leftIds = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const rightIds = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];
const attr = { speed: 40, speedKph: 40, direction: 1, prossibleDrivingDirection: 1, laneType: 1 };

function canonicalMap() {
  return {
    header: { version: 'alias-test', date: '2026-01-01T00:00:00.000Z' },
    point: points(),
    boundary: [
      { id: 'bL', point_id: leftIds, type: 7, controlsPosition: [] },
      { id: 'bR', point_id: rightIds, type: 7, controlsPosition: [] },
    ],
    lane: [
      {
        id: 'L1',
        left_boundary_id: 'bL',
        right_boundary_id: 'bR',
        left_boundary_reverse: false,
        right_boundary_reverse: false,
        width: 3.2,
        type: 1,
        attr,
      },
    ],
  };
}

function camelAliasMap() {
  return {
    header: { version: 'alias-test', date: '2026-01-01T00:00:00.000Z' },
    point: points(),
    boundary: [
      { id: 'bL', pointId: leftIds, type: 7, controlsPosition: [] },
      { id: 'bR', pointIds: rightIds, type: 7, controlsPosition: [] },
    ],
    lane: [
      {
        id: 'L1',
        leftBoundaryId: 'bL',
        rightBoundaryId: 'bR',
        leftBoundaryReverse: false,
        rightBoundaryReverse: false,
        width: 3.2,
        type: 1,
        attr,
      },
    ],
  };
}

async function baseMapHash(map) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'));
  const jsonPath = path.join(dir, 'in.json');
  fs.writeFileSync(jsonPath, JSON.stringify(map));
  const rel = path.join(dir, 'out');
  try {
    await convertEditorMapToApolloPackage({ mapName: 'alias', jsonPath, releaseDir: rel, baseMapDir: null });
    const bin = fs.readFileSync(path.join(rel, 'base_map.bin'));
    return crypto.createHash('sha256').update(bin).digest('hex');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const canonical = await baseMapHash(canonicalMap());
  const camel = await baseMapHash(camelAliasMap());
  assert.strictEqual(
    camel,
    canonical,
    'camelCase-alias editor_map must convert to byte-identical base_map.bin as canonical snake_case',
  );
  console.log(JSON.stringify({ canonical: canonical.slice(0, 16), camel: camel.slice(0, 16), identical: true }));
  console.log('[pass] converter-aliases');
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});

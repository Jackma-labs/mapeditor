'use strict';

// Elevation (DEM) support for the Apollo converter.
//
// The base map's point cloud carries real height (z) — including ramps — but the
// 2D editor drops z, so lanes publish flat. This builds a 2D height grid from the
// point-cloud blocks (in the base-map LOCAL frame: coords are offsets from
// index.center) and samples a per-(x,y) drivable surface z, so the converter can
// give each lane point its real local z (the transform then adds center.z).
//
// Per cell we keep a LOW-PERCENTILE z = the ground / ramp surface, which is robust
// to walls, parked objects and other overhead points above the drivable surface.

const fs = require('fs');
const path = require('path');

const DEFAULT_CELL_METERS = 1.0;
const DEFAULT_SURFACE_PERCENTILE = 0.2; // 20th pct z per cell = drivable surface
const BYTES_PER_POINT = 15; // float32 xyz (12) + uint8 rgb (3), positions_then_colors

function pointCloudDir(baseMapDir) {
  return path.join(baseMapDir, 'point_cloud');
}

// Build the elevation grid from all point-cloud block files. Returns null if the
// base map has no point cloud.
function buildElevationGrid(baseMapDir, options = {}) {
  if (!baseMapDir) return null;
  const pcDir = pointCloudDir(baseMapDir);
  const indexPath = path.join(pcDir, 'index.json');
  const blocksDir = path.join(pcDir, 'blocks');
  if (!fs.existsSync(indexPath) || !fs.existsSync(blocksDir)) return null;
  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    return null;
  }
  const cellMeters = Number(options.cellMeters || DEFAULT_CELL_METERS);
  const pct = Number(options.surfacePercentile ?? DEFAULT_SURFACE_PERCENTILE);
  const files = fs.readdirSync(blocksDir).filter((f) => f.endsWith('.bin'));
  if (files.length === 0) return null;

  const cells = new Map(); // "gx,gy" -> z[]
  let pointsBinned = 0;
  for (const file of files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(blocksDir, file));
    } catch {
      continue;
    }
    const n = Math.floor(buf.length / BYTES_PER_POINT);
    for (let i = 0; i < n; i += 1) {
      const off = i * 12;
      const x = buf.readFloatLE(off);
      const y = buf.readFloatLE(off + 4);
      const z = buf.readFloatLE(off + 8);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const key = `${Math.floor(x / cellMeters)},${Math.floor(y / cellMeters)}`;
      let arr = cells.get(key);
      if (!arr) {
        arr = [];
        cells.set(key, arr);
      }
      arr.push(z);
      pointsBinned += 1;
    }
  }
  if (cells.size === 0) return null;

  const grid = {};
  let mnz = Infinity;
  let mxz = -Infinity;
  for (const [key, zs] of cells) {
    zs.sort((a, b) => a - b);
    const z = zs[Math.min(zs.length - 1, Math.floor(zs.length * pct))];
    grid[key] = Number(z.toFixed(3));
    if (z < mnz) mnz = z;
    if (z > mxz) mxz = z;
  }
  return {
    version: 1,
    frame: 'base-map-local: cell key = floor(localXY / cellMeters); z is local (offset from center.z)',
    cellMeters,
    surfacePercentile: pct,
    center: index.center || null,
    cellCount: cells.size,
    pointsBinned,
    zRange: { min: Number(mnz.toFixed(3)), max: Number(mxz.toFixed(3)) },
    grid,
  };
}

// Build once and cache to <baseMapDir>/point_cloud/elevation_grid.json. Rebuilds
// when the point-cloud index is newer than the cache.
function loadOrBuildElevationGrid(baseMapDir, options = {}) {
  if (!baseMapDir) return null;
  const pcDir = pointCloudDir(baseMapDir);
  const indexPath = path.join(pcDir, 'index.json');
  const cachePath = path.join(pcDir, 'elevation_grid.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cache && cache.version === 1 && fs.statSync(cachePath).mtimeMs >= fs.statSync(indexPath).mtimeMs) {
        return cache;
      }
    }
  } catch {
    /* fall through to rebuild */
  }
  const grid = buildElevationGrid(baseMapDir, options);
  if (grid) {
    try {
      fs.writeFileSync(cachePath, JSON.stringify(grid));
    } catch {
      /* cache is best-effort */
    }
  }
  return grid;
}

// Sample the drivable surface z (local) at local (x,y): nearest non-empty cell
// within searchRadiusMeters. Returns null when there is no point-cloud coverage
// near (x,y) (so the caller keeps the default z rather than inventing one).
function sampleElevation(grid, x, y, options = {}) {
  if (!grid || !grid.grid || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cell = grid.cellMeters || DEFAULT_CELL_METERS;
  const cgx = Math.floor(x / cell);
  const cgy = Math.floor(y / cell);
  const maxR = Math.max(1, Math.ceil((options.searchRadiusMeters || 3) / cell));
  let best = null;
  let bestD = Infinity;
  for (let r = 0; r <= maxR; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // current ring only
        const v = grid.grid[`${cgx + dx},${cgy + dy}`];
        if (!Number.isFinite(v)) continue;
        const ccx = (cgx + dx + 0.5) * cell;
        const ccy = (cgy + dy + 0.5) * cell;
        const d = Math.hypot(x - ccx, y - ccy);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    if (best !== null) break; // nearest ring with data wins
  }
  return best;
}

module.exports = { buildElevationGrid, loadOrBuildElevationGrid, sampleElevation, DEFAULT_CELL_METERS };

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { PNG } = require('pngjs');

const TILE_SIZE = 1024;
const DEFAULT_MAX_TILES = 72;
const DEFAULT_CELL_PIXELS = 16;
const MAX_OCCUPIED_CELLS = 60000;
const MAX_LINE_CANDIDATES = 120;
const MAX_AREA_CANDIDATES = 8;
const LOCAL_WINDOW_METERS = 24;
const MIN_LOCAL_SEGMENT_METERS = 6;
const MAX_LOCAL_SEGMENT_METERS = 30;
const MAX_AREA_CANDIDATE_METERS = 90;

const BASE_MAP_LAYER_DIRS = {
  rgb_ortho: 'map_images_rgb_ortho',
  enhanced: 'map_images',
  raw: 'map_images_raw',
  ground: 'map_images_ground',
  marking: 'map_images_marking',
  edge: 'map_images_edge',
  structure: 'map_images_structure',
};

function getPointCloudTileResolution(level) {
  return 0.5 / (2 ** Number(level));
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function validateMapName(mapName) {
  const value = String(mapName || '').trim();
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error('invalid base map name');
  }
  return value;
}

function normalizeLayer(layer) {
  return BASE_MAP_LAYER_DIRS[layer] ? layer : 'edge';
}

async function readJson(filePath) {
  return JSON.parse((await fsp.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
}

async function resolveLayer(config, mapName, preferredLayer) {
  const layers = Array.from(new Set([normalizeLayer(preferredLayer), 'edge', 'marking', 'enhanced']));
  for (const layer of layers) {
    const dirName = BASE_MAP_LAYER_DIRS[layer];
    const layerRoot = path.join(config.baseMapRoot, mapName, dirName);
    const tilesPath = path.join(layerRoot, 'tiles.json');
    if (await pathExists(tilesPath)) {
      return {
        id: layer,
        dirName,
        root: layerRoot,
        tilesPath,
      };
    }
  }
  throw new Error(`base map tiles not found: ${mapName}`);
}

function normalizeTilesByLevel(tilePayload) {
  const rawTiles = tilePayload?.tiles || {};
  if (Array.isArray(rawTiles)) {
    return { 0: rawTiles };
  }
  return Object.keys(rawTiles).reduce((result, level) => {
    const items = Array.isArray(rawTiles[level]) ? rawTiles[level] : [];
    if (items.length > 0) {
      result[level] = items;
    }
    return result;
  }, {});
}

function chooseTileLevel(tilesByLevel, requestedLevel, maxTiles) {
  if (
    requestedLevel !== undefined &&
    requestedLevel !== null &&
    Array.isArray(tilesByLevel[String(requestedLevel)]) &&
    tilesByLevel[String(requestedLevel)].length > 0
  ) {
    return String(requestedLevel);
  }
  const levels = Object.keys(tilesByLevel)
    .map((level) => Number(level))
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => right - left);
  if (levels.length === 0) {
    throw new Error('base map tile index does not contain usable tile levels');
  }
  const fitting = levels.find((level) => tilesByLevel[String(level)].length <= maxTiles);
  if (fitting !== undefined) {
    return String(fitting);
  }
  return String(levels[levels.length - 1]);
}

function getTileValue(tile, key) {
  return Number(tile[key] ?? tile[key.replace('_', '')] ?? 0);
}

function buildCellKey(x, y) {
  return `${x},${y}`;
}

function parseCellKey(key) {
  const [x, y] = key.split(',').map((value) => Number(value));
  return { x, y };
}

async function readTileCells(tilePath, tile, options) {
  const buffer = await fsp.readFile(tilePath);
  const png = PNG.sync.read(buffer);
  const width = png.width;
  const height = png.height;
  const tileCells = Math.floor(TILE_SIZE / options.cellPixels);
  const tileX = getTileValue(tile, 'offset_x');
  const tileY = getTileValue(tile, 'offset_y');
  const cells = [];

  for (let blockY = 0; blockY < height; blockY += options.cellPixels) {
    for (let blockX = 0; blockX < width; blockX += options.cellPixels) {
      let hits = 0;
      let alphaSum = 0;
      let maxAlpha = 0;
      let samples = 0;
      for (let py = blockY; py < Math.min(blockY + options.cellPixels, height); py += 1) {
        for (let px = blockX; px < Math.min(blockX + options.cellPixels, width); px += 1) {
          const offset = (py * width + px) * 4;
          const alpha = Math.max(png.data[offset], png.data[offset + 1], png.data[offset + 2]);
          samples += 1;
          alphaSum += alpha;
          if (alpha > maxAlpha) {
            maxAlpha = alpha;
          }
          if (alpha >= options.alphaThreshold) {
            hits += 1;
          }
        }
      }
      const density = samples > 0 ? hits / samples : 0;
      const avgAlpha = samples > 0 ? alphaSum / samples : 0;
      if (density < options.minDensity && maxAlpha < options.strongAlphaThreshold) {
        continue;
      }
      const cellX = tileX * tileCells + Math.floor(blockX / options.cellPixels);
      const cellY = tileY * tileCells + (tileCells - 1 - Math.floor(blockY / options.cellPixels));
      cells.push({
        key: buildCellKey(cellX, cellY),
        x: cellX,
        y: cellY,
        weight: Math.round(Math.min(255, maxAlpha * 0.72 + avgAlpha * 0.28)),
      });
    }
  }
  return cells;
}

function capOccupiedCells(cells) {
  if (cells.length <= MAX_OCCUPIED_CELLS) {
    return cells;
  }
  return cells
    .slice()
    .sort((left, right) => right.weight - left.weight)
    .slice(0, MAX_OCCUPIED_CELLS);
}

function buildCellMap(cells) {
  const map = new Map();
  for (const cell of cells) {
    const current = map.get(cell.key);
    if (!current || current.weight < cell.weight) {
      map.set(cell.key, cell);
    }
  }
  return map;
}

function cellToWorld(cellX, cellY, cellWorldSize) {
  return [
    Number(((cellX + 0.5) * cellWorldSize).toFixed(3)),
    Number(((cellY + 0.5) * cellWorldSize).toFixed(3)),
  ];
}

function extractRuns(cellMap, axis, options) {
  const grouped = new Map();
  for (const cell of cellMap.values()) {
    const groupKey = axis === 'x' ? cell.y : cell.x;
    const runValue = axis === 'x' ? cell.x : cell.y;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push({
      value: runValue,
      weight: cell.weight,
    });
  }

  const runs = [];
  for (const [groupKey, values] of grouped.entries()) {
    const sorted = values.sort((left, right) => left.value - right.value);
    let start = sorted[0];
    let previous = sorted[0];
    let weightSum = sorted[0]?.weight || 0;
    let count = sorted[0] ? 1 : 0;
    const flush = () => {
      if (!start || !previous || count < options.minRunCells) {
        return;
      }
      const lengthCells = previous.value - start.value + 1;
      const lengthMeters = lengthCells * options.cellWorldSize;
      if (lengthMeters < options.minRunMeters) {
        return;
      }
      runs.push({
        axis,
        groupKey,
        start: start.value,
        end: previous.value,
        lengthMeters,
        averageWeight: weightSum / count,
      });
    };

    for (let index = 1; index < sorted.length; index += 1) {
      const item = sorted[index];
      if (item.value === previous.value + 1) {
        previous = item;
        weightSum += item.weight;
        count += 1;
        continue;
      }
      flush();
      start = item;
      previous = item;
      weightSum = item.weight;
      count = 1;
    }
    flush();
  }

  return runs.sort((left, right) => right.lengthMeters - left.lengthMeters || right.averageWeight - left.averageWeight);
}

function runOverlaps(left, right) {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1);
  const length = Math.min(left.end - left.start + 1, right.end - right.start + 1);
  return length > 0 && overlap / length > 0.7;
}

function reduceRuns(runs, maxCount) {
  const selected = [];
  for (const run of runs) {
    const duplicate = selected.some(
      (item) => item.axis === run.axis && Math.abs(item.groupKey - run.groupKey) <= 2 && runOverlaps(item, run)
    );
    if (!duplicate) {
      selected.push(run);
    }
    if (selected.length >= maxCount) {
      break;
    }
  }
  return selected;
}

function runToCandidate(run, cellWorldSize, index) {
  const yOrX = run.groupKey;
  const coordinates =
    run.axis === 'x'
      ? [cellToWorld(run.start, yOrX, cellWorldSize), cellToWorld(run.end, yOrX, cellWorldSize)]
      : [cellToWorld(yOrX, run.start, cellWorldSize), cellToWorld(yOrX, run.end, cellWorldSize)];
  return {
    id: `candidate-line-${index}`,
    type: 'road_boundary',
    label: run.axis === 'x' ? '横向边界候选' : '纵向边界候选',
    confidence: Number(Math.min(0.94, 0.42 + run.lengthMeters / 120 + run.averageWeight / 900).toFixed(2)),
    geometry: {
      type: 'LineString',
      coordinates,
    },
    metrics: {
      lengthMeters: Number(run.lengthMeters.toFixed(2)),
      averageWeight: Number(run.averageWeight.toFixed(1)),
    },
  };
}

function extractComponents(cellMap) {
  const visited = new Set();
  const components = [];
  const neighborOffsets = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  for (const cell of cellMap.values()) {
    if (visited.has(cell.key)) {
      continue;
    }
    const queue = [cell];
    const component = [];
    visited.add(cell.key);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      for (const [dx, dy] of neighborOffsets) {
        const nextKey = buildCellKey(current.x + dx, current.y + dy);
        if (visited.has(nextKey) || !cellMap.has(nextKey)) {
          continue;
        }
        visited.add(nextKey);
        queue.push(cellMap.get(nextKey));
      }
    }
    components.push(component);
  }
  return components.sort((left, right) => right.length - left.length);
}

function buildComponentStats(cells) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let weight = 0;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
    weight += cell.weight;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    widthCells: maxX - minX + 1,
    heightCells: maxY - minY + 1,
    averageWeight: cells.length ? weight / cells.length : 0,
  };
}

function componentToAreaCandidate(cells, stats, cellWorldSize, index) {
  const margin = 0.5;
  const coordinates = [
    cellToWorld(stats.minX - margin, stats.minY - margin, cellWorldSize),
    cellToWorld(stats.maxX + margin, stats.minY - margin, cellWorldSize),
    cellToWorld(stats.maxX + margin, stats.maxY + margin, cellWorldSize),
    cellToWorld(stats.minX - margin, stats.maxY + margin, cellWorldSize),
    cellToWorld(stats.minX - margin, stats.minY - margin, cellWorldSize),
  ];
  return {
    id: `candidate-area-${index}`,
    type: 'drivable_area',
    label: '区域候选',
    confidence: Number(Math.min(0.88, 0.36 + cells.length / 1500 + stats.averageWeight / 1100).toFixed(2)),
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
    metrics: {
      widthMeters: Number((stats.widthCells * cellWorldSize).toFixed(2)),
      heightMeters: Number((stats.heightCells * cellWorldSize).toFixed(2)),
      cellCount: cells.length,
    },
  };
}

function componentToCenterlineCandidate(cells, stats, cellWorldSize, index) {
  let meanX = 0;
  let meanY = 0;
  for (const cell of cells) {
    meanX += cell.x;
    meanY += cell.y;
  }
  meanX /= cells.length;
  meanY /= cells.length;
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const lengthCells = Math.min(
    Math.max(stats.widthCells, stats.heightCells) * 0.72,
    MAX_LOCAL_SEGMENT_METERS / cellWorldSize
  );
  const dx = Math.cos(angle) * lengthCells * 0.5;
  const dy = Math.sin(angle) * lengthCells * 0.5;
  return {
    id: `candidate-centerline-${index}`,
    type: 'centerline',
    label: '中心线候选',
    confidence: Number(Math.min(0.84, 0.34 + cells.length / 2400 + stats.averageWeight / 1300).toFixed(2)),
    geometry: {
      type: 'LineString',
      coordinates: [
        cellToWorld(meanX - dx, meanY - dy, cellWorldSize),
        cellToWorld(meanX + dx, meanY + dy, cellWorldSize),
      ],
    },
    metrics: {
      lengthMeters: Number((lengthCells * cellWorldSize).toFixed(2)),
      cellCount: cells.length,
    },
  };
}

function isBoundaryCell(cell, cellMap) {
  const neighbors = [
    buildCellKey(cell.x - 1, cell.y),
    buildCellKey(cell.x + 1, cell.y),
    buildCellKey(cell.x, cell.y - 1),
    buildCellKey(cell.x, cell.y + 1),
  ];
  return neighbors.some((key) => !cellMap.has(key));
}

function buildBoundaryCellMap(cellMap) {
  const boundaryMap = new Map();
  for (const cell of cellMap.values()) {
    if (isBoundaryCell(cell, cellMap)) {
      boundaryMap.set(cell.key, cell);
    }
  }
  return boundaryMap;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cellsToLocalLineCandidate(cells, cellWorldSize, index) {
  if (!Array.isArray(cells) || cells.length < 4) {
    return null;
  }
  let meanX = 0;
  let meanY = 0;
  let weightSum = 0;
  for (const cell of cells) {
    meanX += cell.x;
    meanY += cell.y;
    weightSum += cell.weight || 0;
  }
  meanX /= cells.length;
  meanY /= cells.length;
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (const cell of cells) {
    const dx = cell.x - meanX;
    const dy = cell.y - meanY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const unitX = Math.cos(angle);
  const unitY = Math.sin(angle);
  let minProjection = Infinity;
  let maxProjection = -Infinity;
  for (const cell of cells) {
    const projection = (cell.x - meanX) * unitX + (cell.y - meanY) * unitY;
    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);
  }
  const rawLengthMeters = (maxProjection - minProjection) * cellWorldSize;
  if (rawLengthMeters < MIN_LOCAL_SEGMENT_METERS) {
    return null;
  }
  const maxHalfLengthCells = (MAX_LOCAL_SEGMENT_METERS / cellWorldSize) / 2;
  const midpointProjection = (minProjection + maxProjection) / 2;
  const halfLengthCells = Math.min(maxHalfLengthCells, (maxProjection - minProjection) / 2);
  const startProjection = midpointProjection - halfLengthCells;
  const endProjection = midpointProjection + halfLengthCells;
  const start = cellToWorld(meanX + unitX * startProjection, meanY + unitY * startProjection, cellWorldSize);
  const end = cellToWorld(meanX + unitX * endProjection, meanY + unitY * endProjection, cellWorldSize);
  const lengthMeters = clamp(rawLengthMeters, MIN_LOCAL_SEGMENT_METERS, MAX_LOCAL_SEGMENT_METERS);
  const averageWeight = weightSum / cells.length;
  return {
    id: `candidate-line-${index}`,
    type: 'road_boundary',
    label: '局部边界候选',
    confidence: Number(Math.min(0.9, 0.38 + lengthMeters / 85 + averageWeight / 1200).toFixed(2)),
    geometry: {
      type: 'LineString',
      coordinates: [start, end],
    },
    metrics: {
      lengthMeters: Number(lengthMeters.toFixed(2)),
      sourceCells: cells.length,
      averageWeight: Number(averageWeight.toFixed(1)),
    },
  };
}

function buildLocalBoundaryCandidates(boundaryCellMap, cellWorldSize) {
  const windowCells = Math.max(4, Math.round(LOCAL_WINDOW_METERS / cellWorldSize));
  const windows = new Map();
  for (const cell of boundaryCellMap.values()) {
    const key = `${Math.floor(cell.x / windowCells)},${Math.floor(cell.y / windowCells)}`;
    if (!windows.has(key)) {
      windows.set(key, []);
    }
    windows.get(key).push(cell);
  }
  return Array.from(windows.values())
    .map((cells, index) => cellsToLocalLineCandidate(cells, cellWorldSize, index))
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        right.metrics.lengthMeters - left.metrics.lengthMeters ||
        right.metrics.sourceCells - left.metrics.sourceCells
    )
    .slice(0, MAX_LINE_CANDIDATES)
    .map((candidate, index) => ({
      ...candidate,
      id: `candidate-line-${index}`,
    }));
}

async function generateAssistDrawingCandidates(config, params = {}) {
  const mapName = validateMapName(params.mapName);
  const maxTiles = Math.max(1, Math.min(Number(params.maxTiles) || DEFAULT_MAX_TILES, 160));
  const cellPixels = Math.max(8, Math.min(Number(params.cellPixels) || DEFAULT_CELL_PIXELS, 64));
  const layer = await resolveLayer(config, mapName, params.layer || 'edge');
  const tilePayload = await readJson(layer.tilesPath);
  const tilesByLevel = normalizeTilesByLevel(tilePayload);
  const level = chooseTileLevel(tilesByLevel, params.level, maxTiles);
  const levelTiles = (tilesByLevel[level] || [])
    .slice()
    .sort((left, right) => getTileValue(left, 'offset_y') - getTileValue(right, 'offset_y') || getTileValue(left, 'offset_x') - getTileValue(right, 'offset_x'))
    .slice(0, maxTiles);
  const resolution = getPointCloudTileResolution(level);
  const cellWorldSize = resolution * cellPixels;
  const readOptions = {
    cellPixels,
    alphaThreshold: Number(params.alphaThreshold) || 22,
    strongAlphaThreshold: Number(params.strongAlphaThreshold) || 108,
    minDensity: Number(params.minDensity) || 0.026,
  };
  const allCells = [];
  for (const tile of levelTiles) {
    const tileX = getTileValue(tile, 'offset_x');
    const tileY = getTileValue(tile, 'offset_y');
    const tilePath = path.join(layer.root, String(level), String(tileY), `${tileX}.png`);
    if (!(await pathExists(tilePath))) {
      continue;
    }
    const cells = await readTileCells(tilePath, tile, readOptions);
    allCells.push(...cells);
  }
  const cells = capOccupiedCells(allCells);
  const cellMap = buildCellMap(cells);
  const boundaryCellMap = buildBoundaryCellMap(cellMap);
  const lineCandidates = buildLocalBoundaryCandidates(boundaryCellMap, cellWorldSize);
  const components = extractComponents(cellMap).slice(0, 16);
  const areaCandidates = [];
  const centerlineCandidates = [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const stats = buildComponentStats(component);
    const widthMeters = stats.widthCells * cellWorldSize;
    const heightMeters = stats.heightCells * cellWorldSize;
    const maxDimensionMeters = Math.max(widthMeters, heightMeters);
    if (
      component.length >= 24 &&
      widthMeters >= 6 &&
      heightMeters >= 6 &&
      maxDimensionMeters <= MAX_AREA_CANDIDATE_METERS &&
      areaCandidates.length < MAX_AREA_CANDIDATES
    ) {
      areaCandidates.push(componentToAreaCandidate(component, stats, cellWorldSize, areaCandidates.length));
    }
    const aspect = Math.max(widthMeters, heightMeters) / Math.max(0.001, Math.min(widthMeters, heightMeters));
    if (
      component.length >= 28 &&
      aspect >= 2.1 &&
      maxDimensionMeters <= MAX_AREA_CANDIDATE_METERS &&
      centerlineCandidates.length < 10
    ) {
      centerlineCandidates.push(
        componentToCenterlineCandidate(component.slice(0, 1200), stats, cellWorldSize, centerlineCandidates.length)
      );
    }
  }
  const candidates = [...lineCandidates, ...centerlineCandidates, ...areaCandidates];
  return {
    mapName,
    layer: layer.id,
    level: Number(level),
    center: tilePayload.center || { x: 0, y: 0, z: 0 },
    resolution,
    cellWorldSize,
    candidates,
    stats: {
      requestedLayer: params.layer || 'edge',
      tileCount: levelTiles.length,
      availableTileCount: (tilesByLevel[level] || []).length,
      occupiedCellCount: cellMap.size,
      boundaryCellCount: boundaryCellMap.size,
      rawOccupiedCellCount: allCells.length,
      truncatedCells: allCells.length > cells.length,
      lineCandidateCount: lineCandidates.length,
      areaCandidateCount: areaCandidates.length,
      centerlineCandidateCount: centerlineCandidates.length,
    },
  };
}

module.exports = {
  generateAssistDrawingCandidates,
};

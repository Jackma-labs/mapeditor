const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
const unzipper = require('unzipper');
const { PNG } = require('pngjs');
const { runCommand } = require('./process');

const DEFAULT_POINT_CLOUD_RENDER_POINTS = 1000000;
const configuredPointCloudRenderPoints = Number(
  process.env.POINT_CLOUD_RENDER_POINTS || DEFAULT_POINT_CLOUD_RENDER_POINTS
);
const MAX_POINT_CLOUD_RENDER_POINTS = Number.isFinite(configuredPointCloudRenderPoints)
  ? Math.max(10000, configuredPointCloudRenderPoints)
  : DEFAULT_POINT_CLOUD_RENDER_POINTS;
const POINT_CLOUD_TILE_SIZE = 1024;
const POINT_CLOUD_TILE_LEVELS = [0, 1, 2, 3, 4];
const GROUND_GRID_SIZE_METERS = 0.5;
const GROUND_MIN_RELATIVE_Z = -0.2;
const GROUND_MAX_RELATIVE_Z = 0.35;
const CURB_EDGE_Z_DELTA = 0.12;
const INTENSITY_SAMPLE_LIMIT = 200000;
const TRAJECTORY_METADATA_READ_BYTES = 8 * 1024 * 1024;

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function pathWritable(targetPath) {
  try {
    await fsp.mkdir(targetPath, { recursive: true });
    await fsp.access(targetPath, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function getDirectorySize(targetPath) {
  let total = 0;
  const entries = await fsp.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath);
      continue;
    }
    if (entry.isFile()) {
      const stat = await fsp.stat(entryPath);
      total += stat.size;
    }
  }
  return total;
}

function normalizeForContainer(hostPath, config) {
  const dataRoot = path.resolve(config.baseMapRoot, '..');
  const resolved = path.resolve(hostPath);
  const relative = path.relative(dataRoot, resolved);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return `${config.dataRootInContainer}/${relative.replace(/\\/g, '/')}`;
  }
  return hostPath.replace(/\\/g, '/');
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildEdgeTarget(config) {
  if (!config.edgeDeploy.user || !config.edgeDeploy.host) {
    return '';
  }
  return `${config.edgeDeploy.user}@${config.edgeDeploy.host}`;
}

function validateMapName(mapName) {
  const normalized = String(mapName || '').trim();
  if (!normalized) {
    throw new Error('mapName is required');
  }
  if (normalized.length > 86) {
    throw new Error('mapName must be 86 characters or fewer');
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('mapName must not contain path separators');
  }
  if (/[\x00-\x1f:*?"<>|]/.test(normalized)) {
    throw new Error('mapName contains unsupported characters');
  }
  return normalized;
}

function resolveInside(rootDir, relativePath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`unsafe archive path: ${relativePath}`);
  }
  return resolvedPath;
}

function findArchivePath(normalizedPaths, relativePath) {
  return normalizedPaths.find(
    (entryPath) => entryPath === relativePath || entryPath.endsWith(`/${relativePath}`)
  );
}

async function extractArchivePrefix(entries, archivePrefix, targetDir) {
  for (const entry of entries) {
    const entryPath = entry.path.replace(/\\/g, '/');
    if (!entryPath.startsWith(archivePrefix)) {
      continue;
    }
    const relativePath = entryPath.slice(archivePrefix.length);
    if (!relativePath || relativePath.endsWith('/')) {
      continue;
    }
    const outputPath = resolveInside(targetDir, relativePath);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(outputPath));
  }
}

async function checkDockerRuntime(config) {
  const dockerInfo = await runCommand('docker', ['version', '--format', '{{.Server.Version}}']).catch((error) => ({
    code: 1,
    stderr: error.message,
  }));
  if (dockerInfo.code !== 0) {
    return {
      available: false,
      dockerAvailable: false,
      containerRunning: false,
      message: dockerInfo.stderr || 'Docker daemon is not available',
    };
  }

  const inspect = await runCommand('docker', [
    'inspect',
    '-f',
    '{{.State.Running}}',
    config.runtimeDockerContainer,
  ]).catch((error) => ({
    code: 1,
    stderr: error.message,
  }));
  const containerRunning = inspect.code === 0 && inspect.stdout.trim() === 'true';
  return {
    available: containerRunning,
    dockerAvailable: true,
    containerRunning,
    container: config.runtimeDockerContainer,
    image: config.runtimeDockerImage,
    message: containerRunning
      ? 'Docker runtime is ready'
      : `Container ${config.runtimeDockerContainer} is not running`,
  };
}

async function getStatus(config) {
  const localConverterAvailable = await pathExists(config.converterBinary);
  const localTileCreatorAvailable = await pathExists(config.tileMapCreatorBinary);
  const frontendAvailable = await pathExists(config.frontendBuildRoot);
  const tileMapConfigAvailable = await pathExists(config.tileMapConfig);
  const docker =
    config.runtimeMode === 'docker' ? await checkDockerRuntime(config) : await checkDockerRuntime(config).catch(() => null);

  return {
    mode: config.runtimeMode,
    local: {
      converterBinary: config.converterBinary,
      converterAvailable: localConverterAvailable,
      tileMapCreatorBinary: config.tileMapCreatorBinary,
      tileMapCreatorAvailable: localTileCreatorAvailable,
    },
    docker,
    paths: {
      baseMapRoot: config.baseMapRoot,
      editorMapRoot: config.editorMapRoot,
      releaseRoot: config.releaseRoot,
      frontendBuildRoot: config.frontendBuildRoot,
      frontendAvailable,
      tileMapConfig: config.tileMapConfig,
      tileMapConfigAvailable,
    },
    edgeDeploy: {
      mode: config.edgeDeploy.mode,
      host: config.edgeDeploy.host,
      user: config.edgeDeploy.user,
      targetMapRoot: config.edgeDeploy.targetMapRoot,
      enabled: config.edgeDeploy.mode !== 'disabled',
    },
  };
}

async function listReleasedMaps(config) {
  await fsp.mkdir(config.releaseRoot, { recursive: true });
  const entries = await fsp.readdir(config.releaseRoot, { withFileTypes: true });
  const maps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const mapName = entry.name;
    const mapDir = path.join(config.releaseRoot, mapName);
    const stat = await fsp.stat(mapDir);
    const files = await fsp.readdir(mapDir).catch(() => []);
    const expectedFiles = [
      'base_map.bin',
      'base_map.txt',
      'routing_map.bin',
      'sim_map.bin',
    ];
    maps.push({
      mapName,
      path: mapDir,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: await getDirectorySize(mapDir),
      files,
      expectedFiles,
      missingExpectedFiles: expectedFiles.filter((fileName) => !files.includes(fileName)),
    });
  }
  maps.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
  return maps;
}

async function importBaseMapZip(config, params) {
  const mapName = validateMapName(params.mapName);
  const zipPath = params.zipPath;
  const overwrite = params.overwrite === true;
  if (!zipPath || !(await pathExists(zipPath))) {
    throw new Error('uploaded zip file not found');
  }

  const archive = await unzipper.Open.file(zipPath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const normalizedPaths = entries.map((entry) => entry.path.replace(/\\/g, '/'));
  const tilePath = findArchivePath(normalizedPaths, 'map_images/tiles.json');
  if (!tilePath) {
    const looksLikePointCloudPackage = normalizedPaths.some((entryPath) =>
      isSupportedPointCloudName(entryPath) || path.extname(entryPath).toLowerCase() === '.laz'
    );
    if (looksLikePointCloudPackage) {
      throw new Error('这是点云数据包，请使用“导入点云底图”；瓦片底图 ZIP 必须包含 map_images/tiles.json');
    }
    const looksLikeApolloMapPackage =
      findArchivePath(normalizedPaths, 'editor_map.json') ||
      findArchivePath(normalizedPaths, 'base_map.bin') ||
      findArchivePath(normalizedPaths, 'routing_map.bin');
    if (looksLikeApolloMapPackage) {
      throw new Error('这是 Apollo 完整地图包，不是底图瓦片包；请在“打开标注地图”里导入，或上传包含 map_images/tiles.json 的底图 ZIP');
    }
    throw new Error('底图 ZIP 必须包含 map_images/tiles.json');
  }
  const archivePrefix = tilePath.slice(0, tilePath.length - 'map_images/tiles.json'.length);
  const targetDir = path.join(config.baseMapRoot, mapName);
  const stagingDir = path.join(config.baseMapRoot, `.import-${mapName}-${Date.now()}`);

  if ((await pathExists(targetDir)) && !overwrite) {
    throw new Error(`base map already exists: ${mapName}`);
  }

  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(stagingDir, { recursive: true });
  try {
    await extractArchivePrefix(entries, archivePrefix, stagingDir);

    const importedTilesPath = path.join(stagingDir, 'map_images', 'tiles.json');
    if (!(await pathExists(importedTilesPath))) {
      throw new Error('imported archive did not produce map_images/tiles.json');
    }
    const tilesContent = (await fsp.readFile(importedTilesPath, 'utf8')).replace(/^\uFEFF/, '');
    const tiles = JSON.parse(tilesContent);
    if (!tiles || !Array.isArray(tiles.tiles)) {
      throw new Error('map_images/tiles.json is not a valid base map tile index');
    }

    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.rename(stagingDir, targetDir);
    return {
      mapName,
      path: targetDir,
      tileCount: tiles.tiles.length,
      sizeBytes: await getDirectorySize(targetDir),
    };
  } catch (error) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function importMapPackageZip(config, params) {
  const mapName = validateMapName(params.mapName);
  const zipPath = params.zipPath;
  const overwrite = params.overwrite === true;
  if (!zipPath || !(await pathExists(zipPath))) {
    throw new Error('uploaded zip file not found');
  }

  const archive = await unzipper.Open.file(zipPath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const normalizedPaths = entries.map((entry) => entry.path.replace(/\\/g, '/'));
  const editorMapPathInArchive = findArchivePath(normalizedPaths, 'editor_map.json');
  if (!editorMapPathInArchive) {
    throw new Error('Apollo 地图包 ZIP 必须包含 editor_map.json');
  }

  const archivePrefix = editorMapPathInArchive.slice(
    0,
    editorMapPathInArchive.length - 'editor_map.json'.length
  );
  const targetReleaseDir = path.join(config.releaseRoot, mapName);
  const targetEditorMapPath = path.join(config.editorMapRoot, `${mapName}.json`);
  const stagingReleaseDir = path.join(config.releaseRoot, `.import-${mapName}-${Date.now()}`);
  const stagingEditorMapPath = path.join(config.editorMapRoot, `.import-${mapName}-${Date.now()}.json`);

  const releaseExists = await pathExists(targetReleaseDir);
  const editorMapExists = await pathExists(targetEditorMapPath);
  if ((releaseExists || editorMapExists) && !overwrite) {
    throw new Error(`地图已存在: ${mapName}`);
  }

  await fsp.mkdir(config.releaseRoot, { recursive: true });
  await fsp.mkdir(config.editorMapRoot, { recursive: true });
  await fsp.rm(stagingReleaseDir, { recursive: true, force: true });
  await fsp.rm(stagingEditorMapPath, { force: true });
  await fsp.mkdir(stagingReleaseDir, { recursive: true });

  try {
    await extractArchivePrefix(entries, archivePrefix, stagingReleaseDir);

    const importedEditorMapPath = path.join(stagingReleaseDir, 'editor_map.json');
    if (!(await pathExists(importedEditorMapPath))) {
      throw new Error('imported archive did not produce editor_map.json');
    }
    const editorMapContent = (await fsp.readFile(importedEditorMapPath, 'utf8')).replace(/^\uFEFF/, '');
    JSON.parse(editorMapContent);
    await fsp.writeFile(stagingEditorMapPath, editorMapContent, 'utf8');

    await fsp.rm(targetReleaseDir, { recursive: true, force: true });
    await fsp.rm(targetEditorMapPath, { force: true });
    await fsp.rename(stagingReleaseDir, targetReleaseDir);
    await fsp.rename(stagingEditorMapPath, targetEditorMapPath);

    const files = await fsp.readdir(targetReleaseDir).catch(() => []);
    return {
      mapName,
      editorMapPath: targetEditorMapPath,
      releasePath: targetReleaseDir,
      files,
      sizeBytes: await getDirectorySize(targetReleaseDir),
    };
  } catch (error) {
    await fsp.rm(stagingReleaseDir, { recursive: true, force: true });
    await fsp.rm(stagingEditorMapPath, { force: true });
    throw error;
  }
}

function roundPointValue(value) {
  return Number(value.toFixed(4));
}

function createPointCloudAccumulator(maxPoints = MAX_POINT_CLOUD_RENDER_POINTS) {
  const result = {
    totalPointCount: 0,
    points: [],
    bounds: {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    },
  };

  const addPoint = (x, y, z = 0, intensity = null) => {
    if (![x, y, z].every(Number.isFinite)) {
      return;
    }
    result.totalPointCount += 1;
    result.bounds.minX = Math.min(result.bounds.minX, x);
    result.bounds.minY = Math.min(result.bounds.minY, y);
    result.bounds.minZ = Math.min(result.bounds.minZ, z);
    result.bounds.maxX = Math.max(result.bounds.maxX, x);
    result.bounds.maxY = Math.max(result.bounds.maxY, y);
    result.bounds.maxZ = Math.max(result.bounds.maxZ, z);

    const point = [roundPointValue(x), roundPointValue(y), roundPointValue(z)];
    if (Number.isFinite(intensity)) {
      point.push(roundPointValue(intensity));
    }

    if (result.points.length < maxPoints) {
      result.points.push(point);
      return;
    }
    const replaceIndex = Math.floor(Math.random() * result.totalPointCount);
    if (replaceIndex < maxPoints) {
      result.points[replaceIndex] = point;
    }
  };

  const finalize = () => {
    if (result.totalPointCount === 0) {
      throw new Error('点云文件没有解析到有效 x/y/z 点');
    }
    const { bounds } = result;
    return {
      points: result.points,
      totalPointCount: result.totalPointCount,
      bounds,
      center: {
        x: roundPointValue((bounds.minX + bounds.maxX) / 2),
        y: roundPointValue((bounds.minY + bounds.maxY) / 2),
        z: roundPointValue((bounds.minZ + bounds.maxZ) / 2),
      },
    };
  };

  const mergePointCloud = (parsed) => {
    if (!parsed || !parsed.totalPointCount || !parsed.bounds) {
      return;
    }
    const previousTotal = result.totalPointCount;
    result.totalPointCount += parsed.totalPointCount;
    result.bounds.minX = Math.min(result.bounds.minX, parsed.bounds.minX);
    result.bounds.minY = Math.min(result.bounds.minY, parsed.bounds.minY);
    result.bounds.minZ = Math.min(result.bounds.minZ, parsed.bounds.minZ);
    result.bounds.maxX = Math.max(result.bounds.maxX, parsed.bounds.maxX);
    result.bounds.maxY = Math.max(result.bounds.maxY, parsed.bounds.maxY);
    result.bounds.maxZ = Math.max(result.bounds.maxZ, parsed.bounds.maxZ);

    (parsed.points || []).forEach((point, sampleIndex) => {
      if (result.points.length < maxPoints) {
        result.points.push(point);
        return;
      }
      const seen = previousTotal + sampleIndex + 1;
      const replaceIndex = Math.floor(Math.random() * seen);
      if (replaceIndex < maxPoints) {
        result.points[replaceIndex] = point;
      }
    });
  };

  return { addPoint, finalize, mergePointCloud };
}

function parseNumericPointLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const values = trimmed
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return null;
  }
  return [values[0], values[1], values[2] || 0, values[3] ?? null];
}

async function parseTextPointCloud(filePath) {
  const accumulator = createPointCloudAccumulator();
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const point = parseNumericPointLine(line);
    if (!point) {
      continue;
    }
    accumulator.addPoint(point[0], point[1], point[2], point[3]);
  }
  return accumulator.finalize();
}

function parsePcdHeader(buffer) {
  const lines = [];
  let offset = 0;
  while (offset < buffer.length) {
    const nextNewline = buffer.indexOf(0x0a, offset);
    const end = nextNewline === -1 ? buffer.length : nextNewline;
    const line = buffer.slice(offset, end).toString('ascii').replace(/\r$/, '');
    lines.push(line);
    offset = nextNewline === -1 ? buffer.length : nextNewline + 1;
    if (/^DATA\s+/i.test(line.trim())) {
      break;
    }
  }

  const header = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const [key, ...rest] = trimmed.split(/\s+/);
    header[key.toUpperCase()] = rest;
  }
  return { header, dataOffset: offset };
}

function readPcdBinaryValue(buffer, offset, type, size) {
  if (type === 'F' && size === 4) return buffer.readFloatLE(offset);
  if (type === 'F' && size === 8) return buffer.readDoubleLE(offset);
  if (type === 'I' && size === 1) return buffer.readInt8(offset);
  if (type === 'I' && size === 2) return buffer.readInt16LE(offset);
  if (type === 'I' && size === 4) return buffer.readInt32LE(offset);
  if (type === 'U' && size === 1) return buffer.readUInt8(offset);
  if (type === 'U' && size === 2) return buffer.readUInt16LE(offset);
  if (type === 'U' && size === 4) return buffer.readUInt32LE(offset);
  return NaN;
}

function decompressLzf(input, outputSize) {
  const output = Buffer.alloc(outputSize);
  let inputOffset = 0;
  let outputOffset = 0;
  while (inputOffset < input.length) {
    const control = input[inputOffset];
    inputOffset += 1;
    if (control < 32) {
      const length = control + 1;
      input.copy(output, outputOffset, inputOffset, inputOffset + length);
      inputOffset += length;
      outputOffset += length;
      continue;
    }
    let length = control >> 5;
    let reference = outputOffset - ((control & 0x1f) << 8) - 1;
    if (length === 7) {
      length += input[inputOffset];
      inputOffset += 1;
    }
    reference -= input[inputOffset];
    inputOffset += 1;
    length += 2;
    for (let index = 0; index < length; index += 1) {
      output[outputOffset] = output[reference];
      outputOffset += 1;
      reference += 1;
    }
  }
  return output;
}

async function parsePcdPointCloud(filePath) {
  const buffer = await fsp.readFile(filePath);
  const { header, dataOffset } = parsePcdHeader(buffer);
  const fields = header.FIELDS || [];
  const normalizedFields = fields.map((field) => String(field).toLowerCase());
  const sizes = (header.SIZE || []).map((value) => Number(value));
  const types = header.TYPE || [];
  const counts = fields.map((_, index) => Number((header.COUNT || [])[index] || 1));
  const dataType = String((header.DATA || [])[0] || '').toLowerCase();
  const xIndex = normalizedFields.indexOf('x');
  const yIndex = normalizedFields.indexOf('y');
  const zIndex = normalizedFields.indexOf('z');
  const intensityIndex = normalizedFields.indexOf('intensity');
  if (xIndex < 0 || yIndex < 0) {
    throw new Error('PCD 文件必须包含 x/y 字段');
  }

  const accumulator = createPointCloudAccumulator();
  if (dataType === 'ascii') {
    const body = buffer.slice(dataOffset).toString('utf8');
    body.split(/\r?\n/).forEach((line) => {
      const values = line.trim().split(/\s+/).map((value) => Number(value));
      if (values.length <= Math.max(xIndex, yIndex) || values.some((value) => Number.isNaN(value))) {
        return;
      }
      accumulator.addPoint(values[xIndex], values[yIndex], zIndex >= 0 ? values[zIndex] : 0, intensityIndex >= 0 ? values[intensityIndex] : null);
    });
    return accumulator.finalize();
  }

  let pointStep = 0;
  const fieldOffsets = fields.map((_, index) => {
    const current = pointStep;
    pointStep += (sizes[index] || 4) * (counts[index] || 1);
    return current;
  });
  const pointCount = Number((header.POINTS || [])[0]) || Math.floor((buffer.length - dataOffset) / pointStep);

  if (dataType === 'binary_compressed') {
    const compressedSize = buffer.readUInt32LE(dataOffset);
    const uncompressedSize = buffer.readUInt32LE(dataOffset + 4);
    const compressed = buffer.slice(dataOffset + 8, dataOffset + 8 + compressedSize);
    const dataBuffer = decompressLzf(compressed, uncompressedSize);
    const fieldColumnOffsets = [];
    let columnOffset = 0;
    fields.forEach((_, index) => {
      fieldColumnOffsets[index] = columnOffset;
      columnOffset += (sizes[index] || 4) * (counts[index] || 1) * pointCount;
    });
    const accumulator = createPointCloudAccumulator();
    for (let index = 0; index < pointCount; index += 1) {
      const readField = (fieldIndex) =>
        readPcdBinaryValue(
          dataBuffer,
          fieldColumnOffsets[fieldIndex] + index * (sizes[fieldIndex] || 4),
          types[fieldIndex] || 'F',
          sizes[fieldIndex] || 4,
        );
      accumulator.addPoint(
        readField(xIndex),
        readField(yIndex),
        zIndex >= 0 ? readField(zIndex) : 0,
        intensityIndex >= 0 ? readField(intensityIndex) : null,
      );
    }
    return accumulator.finalize();
  }

  if (dataType !== 'binary') {
    throw new Error(`暂不支持 PCD DATA ${dataType || 'unknown'}，请使用 ascii、binary 或 binary_compressed PCD`);
  }

  for (let index = 0; index < pointCount; index += 1) {
    const base = dataOffset + index * pointStep;
    if (base + pointStep > buffer.length) {
      break;
    }
    const readField = (fieldIndex) =>
      readPcdBinaryValue(buffer, base + fieldOffsets[fieldIndex], types[fieldIndex] || 'F', sizes[fieldIndex] || 4);
    accumulator.addPoint(
      readField(xIndex),
      readField(yIndex),
      zIndex >= 0 ? readField(zIndex) : 0,
      intensityIndex >= 0 ? readField(intensityIndex) : null,
    );
  }
  return accumulator.finalize();
}

async function parsePlyPointCloud(filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  const headerEnd = content.indexOf('end_header');
  if (headerEnd < 0) {
    throw new Error('PLY 文件缺少 end_header');
  }
  const header = content.slice(0, headerEnd).split(/\r?\n/);
  if (!header.some((line) => /^format\s+ascii\s+/i.test(line.trim()))) {
    throw new Error('暂只支持 ASCII PLY 点云');
  }
  const properties = [];
  for (const line of header) {
    const match = line.trim().match(/^property\s+\S+\s+(\S+)$/i);
    if (match) {
      properties.push(match[1]);
    }
  }
  const xIndex = properties.indexOf('x');
  const yIndex = properties.indexOf('y');
  const zIndex = properties.indexOf('z');
  if (xIndex < 0 || yIndex < 0) {
    throw new Error('PLY 文件必须包含 x/y 字段');
  }
  const body = content.slice(headerEnd + 'end_header'.length);
  const accumulator = createPointCloudAccumulator();
  body.split(/\r?\n/).forEach((line) => {
    const values = line.trim().split(/\s+/).map((value) => Number(value));
    if (values.length <= Math.max(xIndex, yIndex) || values.some((value) => Number.isNaN(value))) {
      return;
    }
    accumulator.addPoint(values[xIndex], values[yIndex], zIndex >= 0 ? values[zIndex] : 0);
  });
  return accumulator.finalize();
}

async function parseLasPointCloud(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 227) {
      throw new Error('LAS 文件头不完整');
    }
    const headerBuffer = Buffer.alloc(Math.min(375, stat.size));
    await handle.read(headerBuffer, 0, headerBuffer.length, 0);
    if (headerBuffer.slice(0, 4).toString('ascii') !== 'LASF') {
      throw new Error('LAS 文件签名无效');
    }
    const offsetToPointData = headerBuffer.readUInt32LE(96);
    const pointFormat = headerBuffer.readUInt8(104);
    const pointRecordLength = headerBuffer.readUInt16LE(105);
    if (pointFormat > 10 || pointRecordLength < 12) {
      throw new Error(`暂不支持 LAS 点格式 ${pointFormat}`);
    }
    const legacyPointCount = headerBuffer.readUInt32LE(107);
    let pointCount = legacyPointCount;
    if (pointCount === 0 && headerBuffer.length >= 255) {
      pointCount = Number(headerBuffer.readBigUInt64LE(247));
    }
    if (!pointCount || offsetToPointData >= stat.size) {
      pointCount = Math.floor((stat.size - offsetToPointData) / pointRecordLength);
    }
    const scaleX = headerBuffer.readDoubleLE(131);
    const scaleY = headerBuffer.readDoubleLE(139);
    const scaleZ = headerBuffer.readDoubleLE(147);
    const offsetX = headerBuffer.readDoubleLE(155);
    const offsetY = headerBuffer.readDoubleLE(163);
    const offsetZ = headerBuffer.readDoubleLE(171);

    const accumulator = createPointCloudAccumulator();
    const maxRecordsPerRead = Math.max(1, Math.floor((4 * 1024 * 1024) / pointRecordLength));
    const chunk = Buffer.alloc(maxRecordsPerRead * pointRecordLength);
    let readPointCount = 0;
    while (readPointCount < pointCount) {
      const remaining = pointCount - readPointCount;
      const recordsToRead = Math.min(maxRecordsPerRead, remaining);
      const bytesToRead = recordsToRead * pointRecordLength;
      const { bytesRead } = await handle.read(
        chunk,
        0,
        bytesToRead,
        offsetToPointData + readPointCount * pointRecordLength,
      );
      if (bytesRead <= 0) {
        break;
      }
      const actualRecords = Math.floor(bytesRead / pointRecordLength);
      for (let index = 0; index < actualRecords; index += 1) {
        const base = index * pointRecordLength;
        const x = chunk.readInt32LE(base) * scaleX + offsetX;
        const y = chunk.readInt32LE(base + 4) * scaleY + offsetY;
        const z = chunk.readInt32LE(base + 8) * scaleZ + offsetZ;
        const intensity = pointRecordLength >= 14 ? chunk.readUInt16LE(base + 12) : null;
        accumulator.addPoint(x, y, z, intensity);
      }
      readPointCount += actualRecords;
      if (actualRecords < recordsToRead) {
        break;
      }
    }
    return accumulator.finalize();
  } finally {
    await handle.close();
  }
}

function isKnownMetadataName(fileName) {
  const normalized = String(fileName || '').replace(/\\/g, '/').toLowerCase();
  const baseName = normalized.split('/').pop() || normalized;
  const ext = path.extname(baseName);
  if (
    [
      '.json',
      '.yaml',
      '.yml',
      '.xml',
      '.log',
      '.prj',
      '.kqs',
      '.imu',
      '.rts',
      '.whs',
      '.tim',
      '.mot',
      '.dat',
      '.err',
      '.gld',
      '.db',
      '.bin',
      '.lip',
      '.norm',
    ].includes(ext)
  ) {
    return true;
  }
  return /(camera|c2e|gnss|gps|imu|ins|nav|odom|pose|pos|rtk|traj|trajectory|calib|extrinsic|intrinsic|shuttle_log)/i.test(
    baseName
  );
}

function isSupportedPointCloudName(fileName) {
  if (isKnownMetadataName(fileName)) {
    return false;
  }
  return ['.pcd', '.ply', '.xyz', '.txt', '.csv', '.las'].includes(path.extname(fileName).toLowerCase());
}

function isSupportedPointCloudUploadName(fileName) {
  return isSupportedPointCloudName(fileName) || ['.zip', '.laz'].includes(path.extname(fileName).toLowerCase());
}

function isImageName(fileName) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'].includes(path.extname(fileName).toLowerCase());
}

function archiveBaseName(fileName) {
  return String(fileName || '').split(/[\\/]/).pop() || '';
}

function getPointCloudEntryRank(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.las') return 0;
  if (ext === '.pcd') return 1;
  if (ext === '.ply') return 2;
  return 3;
}

function selectPreferredPointCloudEntries(entries) {
  if (entries.length === 0) {
    return entries;
  }
  const bestRank = Math.min(...entries.map((entry) => getPointCloudEntryRank(entry.path)));
  return entries.filter((entry) => getPointCloudEntryRank(entry.path) === bestRank);
}

function selectPreferredPointCloudAnalyses(pointClouds) {
  if (pointClouds.length === 0) {
    return pointClouds;
  }
  const bestRank = Math.min(...pointClouds.map((item) => getPointCloudEntryRank(item.source || '')));
  return pointClouds.filter((item) => getPointCloudEntryRank(item.source || '') === bestRank);
}

async function parsePointCloudZip(filePath) {
  const archive = await unzipper.Open.file(filePath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const cloudEntries = entries.filter((entry) => isSupportedPointCloudName(entry.path));
  const imageEntries = entries.filter((entry) => isImageName(entry.path));
  if (cloudEntries.length === 0) {
    throw new Error('点云 ZIP 中没有找到支持的点云文件，请包含 .pcd/.ply/.xyz/.txt/.csv/.las');
  }

  const accumulator = createPointCloudAccumulator();
  const tempRoot = path.join(path.dirname(filePath), `.cloud-zip-${Date.now()}`);
  await fsp.rm(tempRoot, { recursive: true, force: true });
  await fsp.mkdir(tempRoot, { recursive: true });
  try {
    const selectedCloudEntries = selectPreferredPointCloudEntries(cloudEntries);
    for (let index = 0; index < selectedCloudEntries.length; index += 1) {
      const entry = selectedCloudEntries[index];
      const safeName = archiveBaseName(entry.path) || `cloud-${index}${path.extname(entry.path)}`;
      const tempPath = path.join(tempRoot, `${index}-${safeName}`);
      await pipeline(entry.stream(), fs.createWriteStream(tempPath));
      const parsed = await parsePointCloud(tempPath, safeName);
      accumulator.mergePointCloud(parsed);
    }
    const parsed = accumulator.finalize();
    parsed.sourceFiles = cloudEntries.map((entry) => entry.path);
    parsed.selectedSourceFiles = selectedCloudEntries.map((entry) => entry.path);
    parsed.imageFileCount = imageEntries.length;
    return parsed;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

function getPointCloudTileResolution(level) {
  return 0.5 / (2 ** level);
}

function normalizePointIntensity(intensity) {
  if (!Number.isFinite(intensity)) {
    return 72;
  }
  if (intensity <= 1) {
    return Math.max(32, Math.min(255, Math.round(intensity * 255)));
  }
  if (intensity <= 255) {
    return Math.max(32, Math.round(intensity));
  }
  return Math.max(32, Math.min(255, Math.round(intensity / 256)));
}

function createRasterTileAccumulator(options = {}) {
  const finestLevel = Math.max(...POINT_CLOUD_TILE_LEVELS);
  const finestResolution = getPointCloudTileResolution(finestLevel);
  const tilesByLevel = new Map(POINT_CLOUD_TILE_LEVELS.map((level) => [level, new Map()]));
  const result = {
    totalPointCount: 0,
    sourceFiles: [],
    imageFileCount: 0,
    bounds: {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    },
  };

  const tileKey = (tileX, tileY) => `${tileX},${tileY}`;
  const getTile = (level, tileX, tileY) => {
    const levelTiles = tilesByLevel.get(level);
    const key = tileKey(tileX, tileY);
    let tile = levelTiles.get(key);
    if (!tile) {
      tile = {
        x: tileX,
        y: tileY,
        alpha: new Uint8Array(POINT_CLOUD_TILE_SIZE * POINT_CLOUD_TILE_SIZE),
      };
      levelTiles.set(key, tile);
    }
    return tile;
  };

  const addAlpha = (tile, pixelX, pixelY, alpha) => {
    if (
      pixelX < 0 ||
      pixelY < 0 ||
      pixelX >= POINT_CLOUD_TILE_SIZE ||
      pixelY >= POINT_CLOUD_TILE_SIZE
    ) {
      return;
    }
    const index = pixelY * POINT_CLOUD_TILE_SIZE + pixelX;
    const current = tile.alpha[index];
    tile.alpha[index] = Math.max(current, alpha, Math.min(255, current + 24));
  };

  const addPointValue = (x, y, z = 0, value = 72, dilation = 0) => {
    if (![x, y, z].every(Number.isFinite)) {
      return;
    }
    result.totalPointCount += 1;
    result.bounds.minX = Math.min(result.bounds.minX, x);
    result.bounds.minY = Math.min(result.bounds.minY, y);
    result.bounds.minZ = Math.min(result.bounds.minZ, z);
    result.bounds.maxX = Math.max(result.bounds.maxX, x);
    result.bounds.maxY = Math.max(result.bounds.maxY, y);
    result.bounds.maxZ = Math.max(result.bounds.maxZ, z);

    const globalPixelX = Math.floor(x / finestResolution);
    const globalPixelY = Math.floor(y / finestResolution);
    const tileX = Math.floor(globalPixelX / POINT_CLOUD_TILE_SIZE);
    const tileY = Math.floor(globalPixelY / POINT_CLOUD_TILE_SIZE);
    const pixelX = globalPixelX - tileX * POINT_CLOUD_TILE_SIZE;
    const localWorldPixelY = globalPixelY - tileY * POINT_CLOUD_TILE_SIZE;
    const pixelY = POINT_CLOUD_TILE_SIZE - 1 - localWorldPixelY;
    const tile = getTile(finestLevel, tileX, tileY);
    const alpha = Math.max(0, Math.min(255, Math.round(value)));
    for (let offsetY = -dilation; offsetY <= dilation; offsetY += 1) {
      for (let offsetX = -dilation; offsetX <= dilation; offsetX += 1) {
        const distance = Math.abs(offsetX) + Math.abs(offsetY);
        const weight = distance === 0 ? 1 : 0.55;
        addAlpha(tile, pixelX + offsetX, pixelY + offsetY, alpha * weight);
      }
    }
  };

  const addPoint = (x, y, z = 0, intensity = null) => {
    addPointValue(x, y, z, normalizePointIntensity(intensity), 0);
  };

  const deriveLowerLevel = (sourceLevel, targetLevel) => {
    const sourceTiles = tilesByLevel.get(sourceLevel);
    for (const sourceTile of sourceTiles.values()) {
      const sourceAlpha = sourceTile.alpha;
      for (let pixelY = 0; pixelY < POINT_CLOUD_TILE_SIZE; pixelY += 1) {
        const rowOffset = pixelY * POINT_CLOUD_TILE_SIZE;
        const localWorldPixelY = POINT_CLOUD_TILE_SIZE - 1 - pixelY;
        const sourceGlobalPixelY = sourceTile.y * POINT_CLOUD_TILE_SIZE + localWorldPixelY;
        const targetGlobalPixelY = Math.floor(sourceGlobalPixelY / 2);
        const targetTileY = Math.floor(targetGlobalPixelY / POINT_CLOUD_TILE_SIZE);
        const targetLocalWorldPixelY = targetGlobalPixelY - targetTileY * POINT_CLOUD_TILE_SIZE;
        const targetPixelY = POINT_CLOUD_TILE_SIZE - 1 - targetLocalWorldPixelY;
        for (let pixelX = 0; pixelX < POINT_CLOUD_TILE_SIZE; pixelX += 1) {
          const alpha = sourceAlpha[rowOffset + pixelX];
          if (alpha === 0) {
            continue;
          }
          const sourceGlobalPixelX = sourceTile.x * POINT_CLOUD_TILE_SIZE + pixelX;
          const targetGlobalPixelX = Math.floor(sourceGlobalPixelX / 2);
          const targetTileX = Math.floor(targetGlobalPixelX / POINT_CLOUD_TILE_SIZE);
          const targetPixelX = targetGlobalPixelX - targetTileX * POINT_CLOUD_TILE_SIZE;
          const targetTile = getTile(targetLevel, targetTileX, targetTileY);
          const targetIndex = targetPixelY * POINT_CLOUD_TILE_SIZE + targetPixelX;
          targetTile.alpha[targetIndex] = Math.max(targetTile.alpha[targetIndex], alpha);
        }
      }
    }
  };

  const derivePyramid = () => {
    for (let level = finestLevel - 1; level >= 0; level -= 1) {
      deriveLowerLevel(level + 1, level);
    }
  };

  const writePngTile = async (filePath, alpha) => {
    const png = new PNG({
      width: POINT_CLOUD_TILE_SIZE,
      height: POINT_CLOUD_TILE_SIZE,
      colorType: 6,
    });
    for (let index = 0, offset = 0; index < alpha.length; index += 1, offset += 4) {
      const value = alpha[index];
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = 255;
    }
    await fsp.writeFile(filePath, PNG.sync.write(png));
  };

  const writeTiles = async (mapImagesDir, metadata = {}) => {
    if (result.totalPointCount === 0 && !metadata.allowEmpty) {
      throw new Error('点云文件没有解析到有效 x/y/z 点');
    }
    if (result.totalPointCount > 0) {
      derivePyramid();
    }
    const bounds = metadata.bounds || result.bounds;
    const center = {
      x: roundPointValue((bounds.minX + bounds.maxX) / 2),
      y: roundPointValue((bounds.minY + bounds.maxY) / 2),
      z: roundPointValue((bounds.minZ + bounds.maxZ) / 2),
    };
    const payload = {
      version: 1,
      sourceType: metadata.sourceType || options.sourceType || 'point_cloud_raster',
      tileSize: POINT_CLOUD_TILE_SIZE,
      pointCount: metadata.pointCount || result.totalPointCount,
      layerPointCount: result.totalPointCount,
      sourceFiles: metadata.sourceFiles || result.sourceFiles,
      imageFileCount: metadata.imageFileCount ?? result.imageFileCount,
      center,
      bounds,
      coordinate: metadata.coordinate || null,
      imageOverlay: metadata.imageOverlay || null,
      processing: metadata.processing || null,
      layers: metadata.layers || null,
      tiles: {},
    };

    await fsp.mkdir(mapImagesDir, { recursive: true });
    for (const level of POINT_CLOUD_TILE_LEVELS) {
      const levelTiles = Array.from(tilesByLevel.get(level).values()).sort((a, b) => a.y - b.y || a.x - b.x);
      payload.tiles[level] = levelTiles.map((tile) => ({
        offset_x: String(tile.x),
        offset_y: String(tile.y),
      }));
      for (const tile of levelTiles) {
        const rowDir = path.join(mapImagesDir, String(level), String(tile.y));
        await fsp.mkdir(rowDir, { recursive: true });
        await writePngTile(path.join(rowDir, `${tile.x}.png`), tile.alpha);
      }
    }
    await fsp.writeFile(path.join(mapImagesDir, 'tiles.json'), JSON.stringify(payload), 'utf8');
    return {
      totalPointCount: payload.pointCount,
      bounds: payload.bounds,
      center: payload.center,
      sourceFiles: payload.sourceFiles,
      imageFileCount: payload.imageFileCount,
      layerPointCount: result.totalPointCount,
      tileCount: POINT_CLOUD_TILE_LEVELS.reduce(
        (count, level) => count + tilesByLevel.get(level).size,
        0
      ),
    };
  };

  const addSourceFile = (fileName) => {
    result.sourceFiles.push(fileName);
  };

  const addImageFiles = (count) => {
    result.imageFileCount += count;
  };

  const getPointCount = () => result.totalPointCount;

  return { addPoint, addPointValue, addSourceFile, addImageFiles, getPointCount, writeTiles };
}

function createPointCloudProcessingStats() {
  const cells = new Map();
  const intensitySamples = [];
  const stats = {
    totalPointCount: 0,
    intensityCount: 0,
    bounds: {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    },
  };
  const cellKey = (x, y) =>
    `${Math.floor(x / GROUND_GRID_SIZE_METERS)},${Math.floor(y / GROUND_GRID_SIZE_METERS)}`;

  const addIntensitySample = (intensity) => {
    if (!Number.isFinite(intensity)) {
      return;
    }
    stats.intensityCount += 1;
    if (intensitySamples.length < INTENSITY_SAMPLE_LIMIT) {
      intensitySamples.push(intensity);
      return;
    }
    const replaceIndex = Math.floor(Math.random() * stats.intensityCount);
    if (replaceIndex < INTENSITY_SAMPLE_LIMIT) {
      intensitySamples[replaceIndex] = intensity;
    }
  };

  const addPoint = (x, y, z = 0, intensity = null) => {
    if (![x, y, z].every(Number.isFinite)) {
      return;
    }
    stats.totalPointCount += 1;
    stats.bounds.minX = Math.min(stats.bounds.minX, x);
    stats.bounds.minY = Math.min(stats.bounds.minY, y);
    stats.bounds.minZ = Math.min(stats.bounds.minZ, z);
    stats.bounds.maxX = Math.max(stats.bounds.maxX, x);
    stats.bounds.maxY = Math.max(stats.bounds.maxY, y);
    stats.bounds.maxZ = Math.max(stats.bounds.maxZ, z);
    addIntensitySample(intensity);

    const key = cellKey(x, y);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        minZ: z,
        maxZ: z,
        count: 0,
      };
      cells.set(key, cell);
    }
    cell.count += 1;
    cell.minZ = Math.min(cell.minZ, z);
    cell.maxZ = Math.max(cell.maxZ, z);
  };

  const percentile = (sortedValues, ratio, fallback) => {
    if (sortedValues.length === 0) {
      return fallback;
    }
    const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * ratio)));
    return sortedValues[index];
  };

  const finalize = () => {
    if (stats.totalPointCount === 0) {
      throw new Error('点云文件没有解析到有效 x/y/z 点');
    }
    const sortedIntensity = intensitySamples
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const p02 = percentile(sortedIntensity, 0.02, 0);
    const p50 = percentile(sortedIntensity, 0.5, 0);
    const p90 = percentile(sortedIntensity, 0.9, Infinity);
    const p98 = percentile(sortedIntensity, 0.98, Math.max(p90, 1));
    const dynamicRange = Math.max(1, p98 - p02);

    const getCell = (x, y) => cells.get(cellKey(x, y));
    const getGroundZ = (x, y) => {
      const gx = Math.floor(x / GROUND_GRID_SIZE_METERS);
      const gy = Math.floor(y / GROUND_GRID_SIZE_METERS);
      let minZ = Infinity;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const cell = cells.get(`${gx + offsetX},${gy + offsetY}`);
          if (cell && cell.count >= 2) {
            minZ = Math.min(minZ, cell.minZ);
          }
        }
      }
      return Number.isFinite(minZ) ? minZ : null;
    };

    const isGroundPoint = (x, y, z) => {
      const groundZ = getGroundZ(x, y);
      if (!Number.isFinite(groundZ)) {
        return true;
      }
      return z >= groundZ + GROUND_MIN_RELATIVE_Z && z <= groundZ + GROUND_MAX_RELATIVE_Z;
    };

    const isEdgeCell = (x, y) => {
      const gx = Math.floor(x / GROUND_GRID_SIZE_METERS);
      const gy = Math.floor(y / GROUND_GRID_SIZE_METERS);
      const center = getCell(x, y);
      if (!center) {
        return false;
      }
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const neighbor = cells.get(`${gx + offsetX},${gy + offsetY}`);
          if (neighbor && Math.abs(neighbor.minZ - center.minZ) >= CURB_EDGE_Z_DELTA) {
            return true;
          }
        }
      }
      return false;
    };

    const normalizeIntensityForRaster = (intensity) => {
      if (!Number.isFinite(intensity)) {
        return 72;
      }
      const clipped = Math.max(p02, Math.min(p98, intensity));
      const normalized = (clipped - p02) / dynamicRange;
      const sigmoid = 1 / (1 + Math.exp(-8 * (normalized - 0.55)));
      return Math.max(28, Math.min(255, Math.round(28 + sigmoid * 227)));
    };

    const isHighIntensity = (intensity) =>
      Number.isFinite(intensity) && Number.isFinite(p90) && intensity >= p90 && stats.intensityCount > 0;

    return {
      totalPointCount: stats.totalPointCount,
      bounds: stats.bounds,
      intensity: {
        count: stats.intensityCount,
        p02,
        p50,
        p90: Number.isFinite(p90) ? p90 : null,
        p98,
      },
      groundGrid: {
        cellSize: GROUND_GRID_SIZE_METERS,
        cellCount: cells.size,
        minRelativeZ: GROUND_MIN_RELATIVE_Z,
        maxRelativeZ: GROUND_MAX_RELATIVE_Z,
        edgeDeltaZ: CURB_EDGE_Z_DELTA,
      },
      getGroundZ,
      isGroundPoint,
      isEdgeCell,
      normalizeIntensityForRaster,
      isHighIntensity,
    };
  };

  return { addPoint, finalize };
}

function classifyCoordinateSystem(bounds) {
  const lonLatLike =
    bounds.minX >= -180 &&
    bounds.maxX <= 180 &&
    bounds.minY >= -90 &&
    bounds.maxY <= 90 &&
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) < 5;
  if (lonLatLike) {
    return {
      kind: 'lonlat_range_compatible',
      message: '坐标范围落在经纬度合法区间内，但也可能只是小范围局部坐标；需要 LAS CRS/VLR、采集系统配置或控制点确认。',
    };
  }
  const projectedLike = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY)) > 10000;
  if (projectedLike) {
    return {
      kind: 'projected_meters_or_large_local',
      message: '坐标范围像米制投影坐标或大范围局部坐标；需要结合采集系统确认 EPSG/投影。',
    };
  }
  return {
    kind: 'local_meters',
    message: '坐标范围像局部米制坐标，不是经纬度；后续拼合要依赖同一局部坐标系或外部定位/控制点。',
  };
}

function getImageOverlayMetadata(imageFileCount) {
  if (!imageFileCount) {
    return {
      status: 'none',
      message: '导入包中未发现图片。',
    };
  }
  return {
    status: 'stored_unplaced',
    message:
      '图片已随底图保存，但缺少相机内参、外参、时间戳和车辆轨迹，暂不能可靠贴到地图坐标上。',
    requiredForProjection: [
      'camera intrinsics',
      'camera-to-lidar or camera-to-vehicle extrinsics',
      'image timestamps',
      'vehicle/lidar poses in the same map frame',
    ],
  };
}

async function readArchiveTextEntry(entry) {
  const chunks = [];
  await pipeline(
    entry.stream(),
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    })
  );
  const buffer = Buffer.concat(chunks);
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function parseEnhancedPoseText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const values = line
        .trim()
        .split(/\s+/)
        .map((value) => Number(value));
      if (values.length < 5 || values.some((value) => Number.isNaN(value))) {
        return null;
      }
      return {
        week: values[0],
        sow: values[1],
        time: values[0] * 604800 + values[1],
        x: values[2],
        y: values[3],
        z: values[4],
        roll: values[8] ?? values[5] ?? null,
        pitch: values[9] ?? values[6] ?? null,
        yaw: values[10] ?? values[7] ?? null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
}

function readLipValues(lines, label, count = 1) {
  const index = lines.findIndex((line) => line.trim() === label);
  if (index < 0) {
    return null;
  }
  const values = [];
  for (let lineIndex = index + 1; lineIndex < lines.length && values.length < count; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) {
      continue;
    }
    const numbers = line
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    values.push(...numbers);
  }
  if (values.length < count) {
    return null;
  }
  return values.slice(0, count);
}

function parseLipCamera(lines, prefix, side, cameraId) {
  const focal = readLipValues(lines, `${prefix} Camera Focal`)?.[0] ?? null;
  const pixelSize = readLipValues(lines, `${prefix} Camera Pixel Size`)?.[0] ?? null;
  const imageSize = readLipValues(lines, `${prefix} Camera Img Size`, 2);
  const exposureDelay = readLipValues(lines, `${prefix} Exposure Delay`)?.[0] ?? null;
  const distortionK = readLipValues(lines, `${prefix} Camera Aberration K`, 3);
  const distortionP = readLipValues(lines, `${prefix} Camera Aberration P`, 3);
  const principalPoint = readLipValues(lines, `${prefix} Camera Principal Point`, 2);
  const rotationDeg = readLipValues(lines, `${prefix} Rotation Angle Camera2b1`, 3);
  const leverArmMeters = readLipValues(lines, `${prefix} LeverArm Camera2b1`, 3);
  if (!focal || !pixelSize || !imageSize || imageSize[0] <= 0 || imageSize[1] <= 0) {
    return null;
  }
  const width = imageSize[0];
  const height = imageSize[1];
  const fx = focal / pixelSize;
  const fy = focal / pixelSize;
  const cx = width / 2 + ((principalPoint?.[0] ?? 0) / pixelSize);
  const cy = height / 2 + ((principalPoint?.[1] ?? 0) / pixelSize);
  const nominalHorizontalFovDeg = (2 * Math.atan((width * pixelSize) / (2 * focal)) * 180) / Math.PI;
  const nominalVerticalFovDeg = (2 * Math.atan((height * pixelSize) / (2 * focal)) * 180) / Math.PI;
  return {
    side,
    cameraId,
    sourcePrefix: prefix,
    model: 'fisheye_brown_conrady_from_lip',
    focalMm: roundPointValue(focal),
    pixelSizeMm: roundPointValue(pixelSize),
    imageSize: {
      width,
      height,
    },
    intrinsics: {
      fx: roundPointValue(fx),
      fy: roundPointValue(fy),
      cx: roundPointValue(cx),
      cy: roundPointValue(cy),
    },
    distortion: {
      model: 'brown_conrady_approx',
      k: (distortionK || [0, 0, 0]).map(roundPointValue),
      p: (distortionP || [0, 0, 0]).map(roundPointValue),
    },
    principalPointMm: (principalPoint || [0, 0]).map(roundPointValue),
    exposureDelaySeconds: Number.isFinite(exposureDelay) ? roundPointValue(exposureDelay) : null,
    extrinsics: {
      frame: 'camera_to_vehicle_body',
      rotationDeg: (rotationDeg || [0, 0, 0]).map(roundPointValue),
      leverArmMeters: (leverArmMeters || [0, 0, 0]).map(roundPointValue),
    },
    fov: {
      nominalHorizontalDeg: roundPointValue(nominalHorizontalFovDeg),
      nominalVerticalDeg: roundPointValue(nominalVerticalFovDeg),
    },
  };
}

function parseLipCalibrationText(text) {
  const lines = text.split(/\r?\n/);
  const cameras = {};
  const left = parseLipCamera(lines, 'Left', 'L', '3');
  const right = parseLipCamera(lines, 'Right', 'R', '1');
  if (left) {
    cameras.L = left;
  }
  if (right) {
    cameras.R = right;
  }
  if (Object.keys(cameras).length === 0) {
    return null;
  }
  return {
    version: 1,
    sourceType: 'lip',
    cameras,
  };
}

function findPoseIndexByTime(poses, time) {
  let low = 0;
  let high = poses.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (poses[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, Math.min(poses.length - 1, low));
}

function estimateTrajectoryHeading(poses, time, fallbackPose) {
  if (poses.length < 2) {
    return Number.isFinite(fallbackPose?.yaw) ? (fallbackPose.yaw * Math.PI) / 180 : null;
  }
  const centerIndex = findPoseIndexByTime(poses, time);
  const center = poses[centerIndex] || fallbackPose;
  let before = null;
  let after = null;
  for (let index = centerIndex - 1; index >= 0 && centerIndex - index < 1200; index -= 1) {
    const candidate = poses[index];
    if (Math.hypot(candidate.x - center.x, candidate.y - center.y) > 0.8) {
      before = candidate;
      break;
    }
  }
  for (let index = centerIndex + 1; index < poses.length && index - centerIndex < 1200; index += 1) {
    const candidate = poses[index];
    if (Math.hypot(candidate.x - center.x, candidate.y - center.y) > 0.8) {
      after = candidate;
      break;
    }
  }
  if (before && after) {
    return Math.atan2(after.y - before.y, after.x - before.x);
  }
  if (after) {
    return Math.atan2(after.y - center.y, after.x - center.x);
  }
  if (before) {
    return Math.atan2(center.y - before.y, center.x - before.x);
  }
  return Number.isFinite(fallbackPose?.yaw) ? (fallbackPose.yaw * Math.PI) / 180 : null;
}

function normalizeAngleDeg(angleDeg) {
  let value = angleDeg;
  while (value <= -180) {
    value += 360;
  }
  while (value > 180) {
    value -= 360;
  }
  return value;
}

function buildCameraGroundProjection(mapPose, cameraCalibration, headingRad) {
  if (!cameraCalibration || !Number.isFinite(headingRad)) {
    return null;
  }
  const yawOffsetDeg = cameraCalibration.extrinsics?.rotationDeg?.[1] ?? 0;
  const fovDeg = Math.max(70, Math.min(170, cameraCalibration.fov?.nominalHorizontalDeg || 120));
  const rangeMeters = 32;
  const centerYaw = headingRad + (yawOffsetDeg * Math.PI) / 180;
  const startYaw = centerYaw - (fovDeg * Math.PI) / 360;
  const endYaw = centerYaw + (fovDeg * Math.PI) / 360;
  const footprint = [
    {
      x: roundPointValue(mapPose.x),
      y: roundPointValue(mapPose.y),
    },
  ];
  const samples = 8;
  for (let index = 0; index <= samples; index += 1) {
    const ratio = index / samples;
    const yaw = startYaw + (endYaw - startYaw) * ratio;
    footprint.push({
      x: roundPointValue(mapPose.x + Math.cos(yaw) * rangeMeters),
      y: roundPointValue(mapPose.y + Math.sin(yaw) * rangeMeters),
    });
  }
  footprint.push({
    x: roundPointValue(mapPose.x),
    y: roundPointValue(mapPose.y),
  });
  return {
    model: 'ground_fov_approx',
    confidence: 'approximate',
    rangeMeters,
    bodyHeadingDeg: roundPointValue(normalizeAngleDeg((headingRad * 180) / Math.PI)),
    cameraYawOffsetDeg: roundPointValue(yawOffsetDeg),
    cameraHeadingDeg: roundPointValue(normalizeAngleDeg((centerYaw * 180) / Math.PI)),
    fovDeg: roundPointValue(fovDeg),
    groundZ: roundPointValue(mapPose.z),
    footprint,
  };
}

function parseCameraPoseText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) {
        return null;
      }
      const frame = parseImageFrameParts(parts[0]);
      const week = Number(parts[2]);
      const sow = Number(parts[3]);
      const ecef = [Number(parts[4]), Number(parts[5]), Number(parts[6])];
      const quaternion = [Number(parts[7]), Number(parts[8]), Number(parts[9]), Number(parts[10])];
      if (!frame || !Number.isFinite(week) || !Number.isFinite(sow) || ecef.some((value) => !Number.isFinite(value))) {
        return null;
      }
      return {
        imageName: parts[0],
        cameraId: parts[1],
        week,
        sow,
        time: week * 604800 + sow,
        frameIndex: frame.frameIndex,
        side: frame.cameraSide,
        ecef,
        quaternion,
      };
    })
    .filter(Boolean);
}

function interpolateEnhancedPose(poses, time) {
  if (poses.length === 0) {
    return null;
  }
  let low = 0;
  let high = poses.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (poses[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const right = poses[Math.min(low, poses.length - 1)];
  const left = poses[Math.max(0, low - 1)];
  const nearest = Math.abs((left?.time ?? Infinity) - time) <= Math.abs((right?.time ?? Infinity) - time) ? left : right;
  if (!left || !right || left === right) {
    return nearest && Math.abs(nearest.time - time) <= 2 ? nearest : null;
  }
  const span = right.time - left.time;
  if (span <= 0 || time < left.time - 2 || time > right.time + 2) {
    return nearest && Math.abs(nearest.time - time) <= 2 ? nearest : null;
  }
  const ratio = Math.max(0, Math.min(1, (time - left.time) / span));
  return {
    week: left.week,
    sow: left.sow + (right.sow - left.sow) * ratio,
    time,
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio,
    z: left.z + (right.z - left.z) * ratio,
    roll: Number.isFinite(left.roll) && Number.isFinite(right.roll) ? left.roll + (right.roll - left.roll) * ratio : null,
    pitch:
      Number.isFinite(left.pitch) && Number.isFinite(right.pitch)
        ? left.pitch + (right.pitch - left.pitch) * ratio
        : null,
    yaw: nearest?.yaw ?? null,
  };
}

async function buildZipImagePoseIndex(zipPath) {
  const archive = await unzipper.Open.file(zipPath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const imageEntries = entries.filter((entry) => isImageName(entry.path));
  const cameraPoseEntry = entries.find((entry) => /CameraPos_C2E\.txt$/i.test(entry.path));
  const enhancedPoseEntry = entries.find((entry) => /pos_ENH\.txt$/i.test(entry.path));
  const calibrationEntry = entries.find((entry) => /\.lip$/i.test(entry.path));
  if (!cameraPoseEntry || !enhancedPoseEntry || imageEntries.length === 0) {
    return null;
  }
  const imageByBaseName = new Map();
  imageEntries.forEach((entry, index) => {
    const baseName = archiveBaseName(entry.path);
    imageByBaseName.set(baseName, {
      source: entry.path,
      imageFile: `${index}-${entry.path.replace(/[\\/]/g, '_')}`,
      sizeBytes: getZipEntrySize(entry),
    });
  });
  const [cameraRows, enhancedPoses, calibration] = await Promise.all([
    readArchiveTextEntry(cameraPoseEntry).then(parseCameraPoseText),
    readArchiveTextEntry(enhancedPoseEntry).then(parseEnhancedPoseText),
    calibrationEntry
      ? readArchiveTextEntry(calibrationEntry).then((text) => ({
          ...parseLipCalibrationText(text),
          source: calibrationEntry.path,
        }))
      : Promise.resolve(null),
  ]);
  const items = [];
  for (const row of cameraRows) {
    const imageInfo = imageByBaseName.get(row.imageName);
    const mapPose = interpolateEnhancedPose(enhancedPoses, row.time);
    if (!imageInfo || !mapPose) {
      continue;
    }
    const cameraCalibration = calibration?.cameras?.[row.side] || null;
    const headingRad = estimateTrajectoryHeading(enhancedPoses, row.time, mapPose);
    const projection = buildCameraGroundProjection(mapPose, cameraCalibration, headingRad);
    items.push({
      imageName: row.imageName,
      imageFile: imageInfo.imageFile,
      source: imageInfo.source,
      frameIndex: row.frameIndex,
      side: row.side,
      gpsWeek: row.week,
      secondsOfWeek: row.sow,
      cameraId: row.cameraId,
      map: {
        x: roundPointValue(mapPose.x),
        y: roundPointValue(mapPose.y),
        z: roundPointValue(mapPose.z),
        yaw: Number.isFinite(mapPose.yaw) ? roundPointValue(mapPose.yaw) : null,
        bodyHeadingDeg: Number.isFinite(headingRad) ? roundPointValue(normalizeAngleDeg((headingRad * 180) / Math.PI)) : null,
      },
      ecef: {
        x: roundPointValue(row.ecef[0]),
        y: roundPointValue(row.ecef[1]),
        z: roundPointValue(row.ecef[2]),
      },
      quaternion: row.quaternion.map(roundPointValue),
      calibration: cameraCalibration
        ? {
            side: cameraCalibration.side,
            cameraId: cameraCalibration.cameraId,
            model: cameraCalibration.model,
            intrinsics: cameraCalibration.intrinsics,
            distortion: cameraCalibration.distortion,
            fov: cameraCalibration.fov,
          }
        : null,
      projection,
    });
  }
  items.sort((left, right) => left.frameIndex - right.frameIndex || left.side.localeCompare(right.side));
  return {
    source: {
      cameraPose: cameraPoseEntry.path,
      enhancedPose: enhancedPoseEntry.path,
      calibration: calibrationEntry?.path || null,
    },
    imageCount: imageEntries.length,
    poseCount: cameraRows.length,
    calibration,
    indexedCount: items.length,
    items,
  };
}

async function buildImageOverlayIndex(files, stagingDir) {
  const indexes = [];
  for (const file of files) {
    const originalName = file.originalName || file.originalname || file.path;
    if (path.extname(originalName).toLowerCase() !== '.zip') {
      continue;
    }
    const index = await buildZipImagePoseIndex(file.path).catch(() => null);
    if (index && index.indexedCount > 0) {
      indexes.push(index);
    }
  }
  const items = indexes.flatMap((index) => index.items);
  if (items.length === 0) {
    return null;
  }
  const imageIndex = {
    version: 2,
    coordinateFrame: 'base_map_xy',
    count: items.length,
    sources: indexes.map((index) => index.source),
    calibration: indexes.find((index) => index.calibration)?.calibration || null,
    projection: {
      model: 'ground_fov_approx',
      confidence: 'approximate',
      message:
        'Footprints use LIP camera intrinsics/extrinsics plus trajectory heading. They are for image-assisted labeling, not final photogrammetric texture.',
    },
    items,
  };
  await fsp.writeFile(path.join(stagingDir, 'image_index.json'), JSON.stringify(imageIndex), 'utf8');
  return imageIndex;
}

function getImageOverlayMetadataFromIndex(imageFileCount, imageIndex) {
  if (imageIndex && imageIndex.count > 0) {
    return {
      status: 'indexed',
      message: '图片已按 CameraPos_C2E 与 pos_ENH 轨迹对齐，可在底图上按采集位置查看左右相机图。',
      imageFileCount,
      index: {
        version: imageIndex.version,
        coordinateFrame: imageIndex.coordinateFrame,
        count: imageIndex.count,
        sources: imageIndex.sources,
        calibration: imageIndex.calibration,
        projection: imageIndex.projection,
        items: imageIndex.items,
      },
    };
  }
  return getImageOverlayMetadata(imageFileCount);
}

async function extractImagesFromZip(zipPath, targetDir) {
  const archive = await unzipper.Open.file(zipPath);
  const imageEntries = archive.files.filter((entry) => entry.type === 'File' && isImageName(entry.path));
  for (let index = 0; index < imageEntries.length; index += 1) {
    const entry = imageEntries[index];
    const safeName = `${index}-${entry.path.replace(/[\\/]/g, '_')}`;
    await fsp.mkdir(targetDir, { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(path.join(targetDir, safeName)));
  }
  return imageEntries.length;
}

async function copyImportSources(files, stagingDir) {
  const sourcesDir = path.join(stagingDir, 'sources');
  const imageDir = path.join(stagingDir, 'source_images');
  await fsp.mkdir(sourcesDir, { recursive: true });
  let extractedImageCount = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const originalName = file.originalName || file.originalname || `source-${index}`;
    const safeName = `${index}-${path.basename(originalName) || 'source'}`;
    await fsp.copyFile(file.path, path.join(sourcesDir, safeName));
    if (isImageName(originalName)) {
      await fsp.mkdir(imageDir, { recursive: true });
      await fsp.copyFile(file.path, path.join(imageDir, safeName));
      extractedImageCount += 1;
    } else if (path.extname(originalName).toLowerCase() === '.zip') {
      extractedImageCount += await extractImagesFromZip(file.path, imageDir);
    }
  }
  return extractedImageCount;
}

function sanitizePackageName(name) {
  const normalized = String(name || 'package')
    .replace(/\.[^.]+$/i, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || 'package';
}

async function readFilePrefix(filePath, maxBytes = 512 * 1024) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.slice(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readZipEntryPrefix(entry, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = entry.stream();
    stream.on('data', (chunk) => {
      if (total >= maxBytes) {
        stream.destroy();
        return;
      }
      const remaining = maxBytes - total;
      const sliced = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
      chunks.push(sliced);
      total += sliced.length;
      if (total >= maxBytes) {
        stream.destroy();
      }
    });
    stream.on('close', () => resolve(Buffer.concat(chunks)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (error) => {
      if (total > 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(error);
    });
  });
}

function getZipEntrySize(entry) {
  const value = entry?.vars?.uncompressedSize ?? entry?.uncompressedSize ?? entry?.size ?? null;
  return Number.isFinite(value) ? value : null;
}

function readAsciiNull(buffer) {
  const end = buffer.indexOf(0);
  const value = end >= 0 ? buffer.slice(0, end) : buffer;
  return value.toString('ascii').trim();
}

function parseLasHeaderBuffer(buffer, sourceName, sizeBytes = null) {
  if (buffer.length < 227 || buffer.slice(0, 4).toString('ascii') !== 'LASF') {
    return {
      source: sourceName,
      valid: false,
      message: 'LAS 文件头无效或不完整',
    };
  }
  const readU8 = (offset) => buffer.readUInt8(offset);
  const readU16 = (offset) => buffer.readUInt16LE(offset);
  const readU32 = (offset) => buffer.readUInt32LE(offset);
  const readF64 = (offset) => buffer.readDoubleLE(offset);
  const info = {
    source: sourceName,
    valid: true,
    sizeBytes,
    version: `${readU8(24)}.${readU8(25)}`,
    systemIdentifier: readAsciiNull(buffer.slice(26, 58)),
    generatingSoftware: readAsciiNull(buffer.slice(58, 90)),
    creationDayOfYear: readU16(90),
    creationYear: readU16(92),
    headerSize: readU16(94),
    offsetToPointData: readU32(96),
    vlrCount: readU32(100),
    pointFormat: readU8(104),
    pointRecordLength: readU16(105),
    pointCount: readU32(107),
    scale: {
      x: readF64(131),
      y: readF64(139),
      z: readF64(147),
    },
    offset: {
      x: readF64(155),
      y: readF64(163),
      z: readF64(171),
    },
    bounds: {
      minX: readF64(187),
      minY: readF64(203),
      minZ: readF64(219),
      maxX: readF64(179),
      maxY: readF64(195),
      maxZ: readF64(211),
    },
    hasCrsVlr: false,
  };
  info.range = {
    x: info.bounds.maxX - info.bounds.minX,
    y: info.bounds.maxY - info.bounds.minY,
    z: info.bounds.maxZ - info.bounds.minZ,
  };
  if (buffer.length >= info.headerSize + 54 && info.vlrCount > 0) {
    let offset = info.headerSize;
    const vlrs = [];
    for (let index = 0; index < Math.min(info.vlrCount, 10); index += 1) {
      if (offset + 54 > buffer.length) {
        break;
      }
      const userId = readAsciiNull(buffer.slice(offset + 2, offset + 18));
      const recordId = buffer.readUInt16LE(offset + 18);
      const recordLength = buffer.readUInt16LE(offset + 20);
      const description = readAsciiNull(buffer.slice(offset + 22, offset + 54));
      vlrs.push({ userId, recordId, recordLength, description });
      if (userId === 'LASF_Projection' || /WKT|Geo/i.test(description)) {
        info.hasCrsVlr = true;
      }
      offset += 54 + recordLength;
    }
    info.vlrs = vlrs;
  }
  info.coordinate = classifyCoordinateSystem(info.bounds);
  if (!info.hasCrsVlr) {
    info.coordinate.message = `${info.coordinate.message} LAS 文件未包含 CRS VLR/WKT，无法仅凭文件确认 EPSG。`;
  }
  return info;
}

function parsePcdHeaderBuffer(buffer, sourceName, sizeBytes = null) {
  const text = buffer.toString('ascii');
  const dataIndex = text.search(/^DATA\s+/im);
  const headerText = dataIndex >= 0 ? text.slice(0, dataIndex + 80) : text;
  const header = {};
  headerText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const [key, ...rest] = trimmed.split(/\s+/);
    header[key.toUpperCase()] = rest;
  });
  return {
    source: sourceName,
    valid: Boolean(header.FIELDS),
    sizeBytes,
    fields: header.FIELDS || [],
    data: (header.DATA || [null])[0],
    pointCount: Number((header.POINTS || [])[0]) || Number((header.WIDTH || [])[0]) || null,
    width: Number((header.WIDTH || [])[0]) || null,
    height: Number((header.HEIGHT || [])[0]) || null,
    viewpoint: header.VIEWPOINT || null,
  };
}

function parseImageFilenameGpsTime(sourceName) {
  const filename = String(sourceName || '').split(/[\\/]/).pop() || '';
  const match = filename.match(/^(\d{4})-(\d{6})-(\d{3})_(\d+)-([LR])\.(?:jpe?g|png|webp|tiff?)$/i);
  if (!match) {
    return null;
  }
  const gpsWeek = Number(match[1]);
  const secondsOfWeek = Number(match[2]) + Number(match[3]) / 1000;
  const frameIndex = Number(match[4]);
  const cameraSide = match[5].toUpperCase();
  if (!Number.isFinite(gpsWeek) || !Number.isFinite(secondsOfWeek)) {
    return null;
  }
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  const gpsUtcLeapSeconds = 18;
  const gpsMs = gpsEpochMs + gpsWeek * 7 * 24 * 60 * 60 * 1000 + secondsOfWeek * 1000;
  const utcMs = gpsMs - gpsUtcLeapSeconds * 1000;
  return {
    gpsWeek,
    secondsOfWeek,
    gpsIso: new Date(gpsMs).toISOString(),
    utcIso: new Date(utcMs).toISOString(),
    frameIndex,
    cameraSide,
    raw: `${match[1]}-${match[2]}-${match[3]}`,
    message: '文件名匹配 GPS 周 + 周内秒时间戳，可用于和 LAS GPS Time 或外部轨迹对齐；它不是经纬度。',
  };
}

function parseImageFrameParts(sourceName) {
  const filename = String(sourceName || '').split(/[\\/]/).pop() || '';
  const match = filename.match(/^(\d{4})-(\d{6})-(\d{3})_(\d+)-([LR])\.(?:jpe?g|png|webp|tiff?)$/i);
  if (!match) {
    return null;
  }
  return {
    gpsWeek: Number(match[1]),
    secondsOfWeek: Number(match[2]) + Number(match[3]) / 1000,
    frameIndex: Number(match[4]),
    cameraSide: match[5].toUpperCase(),
  };
}

function parseJpegMetadataBuffer(buffer, sourceName, sizeBytes = null) {
  const info = {
    source: sourceName,
    valid: buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8,
    sizeBytes,
    width: null,
    height: null,
    make: null,
    model: null,
    dateTime: null,
    xmp: {},
    filenameGpsTime: parseImageFilenameGpsTime(sourceName),
    poseUsable: false,
  };
  if (!info.valid) {
    return info;
  }
  let offset = 2;
  const appTexts = [];
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    if (offset + 2 > buffer.length) {
      break;
    }
    const length = buffer.readUInt16BE(offset);
    const payload = buffer.slice(offset + 2, offset + length);
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3
    ) {
      info.height = payload.readUInt16BE(1);
      info.width = payload.readUInt16BE(3);
    }
    if (marker >= 0xe0 && marker <= 0xef) {
      appTexts.push(payload.toString('utf8'));
    }
    offset += length;
  }
  const text = appTexts.join('\n');
  const readAttr = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}="([^"]*)"`, 'i'));
    return match ? match[1] : null;
  };
  info.make = text.match(/ShareUAV/) ? 'ShareUAV' : null;
  info.model = readAttr('share:Model') || (text.match(/CM2000-[^"\s<\u0000]+/) || [null])[0];
  info.dateTime = readAttr('share:DateTime') || readAttr('drone-dji:DateTime') || null;
  [
    'share:Lat',
    'share:Lon',
    'share:AbsAlt',
    'share:Pitch',
    'share:Roll',
    'share:Yaw',
    'share:RTK',
    'drone-dji:GpsLatitude',
    'drone-dji:GpsLongitude',
    'drone-dji:GimbalRollDegree',
    'drone-dji:GimbalYawDegree',
    'drone-dji:GimbalPitchDegree',
  ].forEach((name) => {
    const value = readAttr(name);
    if (value !== null) {
      info.xmp[name] = value;
    }
  });
  const lat = Number(info.xmp['share:Lat'] || info.xmp['drone-dji:GpsLatitude']);
  const lon = Number(info.xmp['share:Lon'] || info.xmp['drone-dji:GpsLongitude']);
  const yaw = Number(info.xmp['share:Yaw'] || info.xmp['drone-dji:GimbalYawDegree']);
  info.poseUsable = Boolean(
    Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) > 0.000001 &&
      Math.abs(lon) > 0.000001 &&
      Number.isFinite(yaw)
  );
  return info;
}

function classifyTrajectorySource(sourceName) {
  const normalized = String(sourceName || '').replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('gnss')) return 'gnss_lonlat';
  if (normalized.includes('camerapos') || normalized.includes('camera')) return 'camera_pose';
  if (normalized.includes('pos_enh')) return 'enhanced_pose';
  if (normalized.includes('xyzqwxyz')) return 'pose_quaternion';
  if (/(^|[/_-])pos([/_\-.]|$)|test_pos/.test(normalized)) return 'vehicle_pose';
  return null;
}

function gpsWeekSecondsToIso(gpsWeek, secondsOfWeek) {
  if (!Number.isFinite(gpsWeek) || !Number.isFinite(secondsOfWeek)) {
    return null;
  }
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  const gpsUtcLeapSeconds = 18;
  const gpsMs = gpsEpochMs + gpsWeek * 7 * 24 * 60 * 60 * 1000 + secondsOfWeek * 1000;
  return new Date(gpsMs - gpsUtcLeapSeconds * 1000).toISOString();
}

function isLikelyTextBuffer(buffer) {
  const length = Math.min(buffer.length, 4096);
  if (length === 0) {
    return true;
  }
  let suspicious = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = buffer[index];
    if (byte === 0) {
      return false;
    }
    if (byte === 9 || byte === 10 || byte === 13) {
      continue;
    }
    if (byte < 32 || (byte > 126 && byte < 160)) {
      suspicious += 1;
    }
  }
  return suspicious / length < 0.08;
}

function isLowMotionTrajectory(coordinateKind, range) {
  const xyRange = Math.hypot(range.x || 0, range.y || 0);
  if (coordinateKind === 'lonlat_range_compatible') {
    return xyRange < 0.00005;
  }
  return xyRange < 5;
}

function parseTrajectoryMetadataBuffer(buffer, sourceName, sizeBytes = null) {
  const sourceKind = classifyTrajectorySource(sourceName);
  if (!sourceKind) {
    return null;
  }
  if (!isLikelyTextBuffer(buffer)) {
    return null;
  }
  const text = buffer.toString('utf8').replace(/\0/g, ' ');
  const lines = text.split(/\r?\n/);
  const samples = [];
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  const gpsWeekRange = { min: Infinity, max: -Infinity };
  const secondsOfWeekRange = { min: Infinity, max: -Infinity };
  const fixStatusCounts = {};
  const lowerName = String(sourceName || '').toLowerCase();
  let parsedSampleCount = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const numericText = line.replace(/^\S+\.(?:jpe?g|png|webp|tiff?)\s+/i, '');
    const nums = (numericText.match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [])
      .map(Number)
      .filter(Number.isFinite);
    if (nums.length < 5) {
      continue;
    }
    const offset = lowerName.includes('camerapos') ? 1 : 0;
    const gpsWeek = nums[offset];
    const secondsOfWeek = nums[offset + 1];
    const x = nums[offset + 2];
    const y = nums[offset + 3];
    const z = nums[offset + 4];
    if (
      !Number.isFinite(gpsWeek) ||
      !Number.isFinite(secondsOfWeek) ||
      gpsWeek < 1000 ||
      gpsWeek > 4000 ||
      secondsOfWeek < 0 ||
      secondsOfWeek > 604800 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      continue;
    }
    parsedSampleCount += 1;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.maxZ = Math.max(bounds.maxZ, z);
    gpsWeekRange.min = Math.min(gpsWeekRange.min, gpsWeek);
    gpsWeekRange.max = Math.max(gpsWeekRange.max, gpsWeek);
    secondsOfWeekRange.min = Math.min(secondsOfWeekRange.min, secondsOfWeek);
    secondsOfWeekRange.max = Math.max(secondsOfWeekRange.max, secondsOfWeek);
    if (sourceKind === 'gnss_lonlat' && nums.length >= offset + 15) {
      const status = String(nums[nums.length - 1]);
      fixStatusCounts[status] = (fixStatusCounts[status] || 0) + 1;
    }
    if (samples.length < 3) {
      samples.push({
        gpsWeek,
        secondsOfWeek,
        utcIso: gpsWeekSecondsToIso(gpsWeek, secondsOfWeek),
        x,
        y,
        z,
      });
    }
  }
  if (parsedSampleCount === 0) {
    return {
      source: sourceName,
      kind: sourceKind,
      sizeBytes,
      sampleCount: 0,
      message: '识别为定位/姿态元数据，但未在文件前段解析到有效轨迹样本。',
    };
  }
  const coordinate = classifyCoordinateSystem(bounds);
  if (
    Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY), Math.abs(bounds.minZ), Math.abs(bounds.maxZ)) >
      1000000 &&
    Math.abs(
      Math.sqrt(
        ((bounds.minX + bounds.maxX) / 2) ** 2 +
          ((bounds.minY + bounds.maxY) / 2) ** 2 +
          ((bounds.minZ + bounds.maxZ) / 2) ** 2,
      ) - 6371000,
    ) < 500000
  ) {
    coordinate.kind = 'ecef_xyz';
    coordinate.message = '轨迹坐标更像地心地固 ECEF XYZ，需要转换到地图投影坐标后才能直接用于拼图。';
  }
  const range = {
    x: bounds.maxX - bounds.minX,
    y: bounds.maxY - bounds.minY,
    z: bounds.maxZ - bounds.minZ,
  };
  const lowMotion = isLowMotionTrajectory(coordinate.kind, range);
  return {
    source: sourceName,
    kind: sourceKind,
    sizeBytes,
    parsedBytes: buffer.length,
    truncated: Boolean(sizeBytes && buffer.length < sizeBytes),
    lineCount: lines.length,
    sampleCount: parsedSampleCount,
    gpsWeekRange,
    secondsOfWeekRange,
    utcRange: {
      start: gpsWeekSecondsToIso(gpsWeekRange.min, secondsOfWeekRange.min),
      end: gpsWeekSecondsToIso(gpsWeekRange.max, secondsOfWeekRange.max),
    },
    bounds,
    range,
    coordinate,
    firstSamples: samples,
    fixStatusCounts,
    lowMotion,
    usableForStitching: !lowMotion,
    message: lowMotion ? '轨迹坐标变化过小，不适合作为多包拼图的主基准。' : null,
  };
}

function summarizeTrajectoryAnalyses(trajectories) {
  const allTrajectories = trajectories || [];
  const parsed = allTrajectories.filter((item) => item && item.sampleCount > 0);
  if (parsed.length === 0) {
    return {
      fileCount: allTrajectories.length,
      poseFileCount: 0,
      sampleCount: 0,
      coordinateKinds: [],
      message: '未解析到可用 RTK/GNSS/姿态轨迹。',
    };
  }
  const priority = {
    enhanced_pose: 0,
    gnss_lonlat: 1,
    vehicle_pose: 2,
    pose_quaternion: 3,
    camera_pose: 4,
  };
  const coordinatePriority = {
    projected_meters_or_large_local: 0,
    lonlat_range_compatible: 1,
    ecef_xyz: 2,
    local_meters: 3,
  };
  const preferred = [...parsed].sort((left, right) => {
    const leftUsable = left.usableForStitching === false ? 1 : 0;
    const rightUsable = right.usableForStitching === false ? 1 : 0;
    if (leftUsable !== rightUsable) return leftUsable - rightUsable;
    const leftRank = priority[left.kind] ?? 99;
    const rightRank = priority[right.kind] ?? 99;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftCoordinateRank = coordinatePriority[left.coordinate?.kind] ?? 99;
    const rightCoordinateRank = coordinatePriority[right.coordinate?.kind] ?? 99;
    if (leftCoordinateRank !== rightCoordinateRank) return leftCoordinateRank - rightCoordinateRank;
    return (right.sampleCount || 0) - (left.sampleCount || 0);
  })[0];
  const coordinateKinds = Array.from(new Set(parsed.map((item) => item.coordinate?.kind).filter(Boolean)));
  return {
    fileCount: allTrajectories.length,
    poseFileCount: parsed.length,
    sampleCount: parsed.reduce((total, item) => total + (item.sampleCount || 0), 0),
    coordinateKinds,
    preferredSource: preferred.source,
    preferredKind: preferred.kind,
    preferredCoordinateKind: preferred.coordinate?.kind || null,
    bounds: preferred.bounds || null,
    utcRange: preferred.utcRange || null,
    sources: parsed.slice(0, 12).map((item) => ({
      source: item.source,
      kind: item.kind,
      sampleCount: item.sampleCount,
      coordinateKind: item.coordinate?.kind || null,
      utcRange: item.utcRange || null,
      lowMotion: item.lowMotion === true,
    })),
    message:
      preferred.usableForStitching === false
        ? '已解析到轨迹，但可用轨迹变化过小，需要换用 GNSS/ECEF 转换或人工控制点。'
        : preferred.coordinate?.kind === 'projected_meters_or_large_local' ||
            preferred.coordinate?.kind === 'lonlat_range_compatible'
          ? '已解析到可作为多包拼合先验的定位轨迹。'
          : '已解析到轨迹，但需要坐标转换或控制点后才能作为拼图基准。',
  };
}

function summarizePackageAnalysis(analysis) {
  const pointCloudsForCount = selectPreferredPointCloudAnalyses(analysis.pointClouds);
  const pointCount = pointCloudsForCount.reduce((total, item) => total + (item.pointCount || 0), 0);
  const usableImages = analysis.images.filter((image) => image.poseUsable).length;
  const filenameGpsTimeImages = analysis.images.filter((image) => image.filenameGpsTime).length;
  const crsKnown = analysis.pointClouds.some((item) => item.hasCrsVlr);
  const coordinateKinds = Array.from(new Set(analysis.pointClouds.map((item) => item.coordinate?.kind).filter(Boolean)));
  const trajectory = summarizeTrajectoryAnalyses(analysis.trajectories || []);
  const recommendations = [];
  if (!analysis.counts.pointCloudFiles) {
    recommendations.push('没有发现 LAS/PCD 点云文件，不能生成底图。');
  }
  if (!crsKnown) {
    recommendations.push('点云文件未写入 CRS/EPSG；多批数据拼合需要外部提供坐标系或控制点。');
  }
  if (analysis.counts.imageFiles && usableImages === 0) {
    if (filenameGpsTimeImages) {
      recommendations.push('图片文件名包含 GPS 时间戳，可用于和 LAS GPS Time/轨迹对齐；但缺少可信姿态和标定，不能单独贴图。');
    } else {
      recommendations.push('图片有 EXIF/XMP，但样例未包含有效经纬度/姿态；需要相机标定、时间戳和轨迹才能自动贴图。');
    }
  }
  if (coordinateKinds.includes('local_meters')) {
    recommendations.push('当前坐标更像局部米制坐标；只要 las/pcd 已经在同一坐标系，可以直接拼在同一底图里。');
  }
  if (coordinateKinds.includes('projected_meters_or_large_local')) {
    recommendations.push('当前坐标不是经纬度，数值更像米制投影坐标或大范围局部坐标；如需跨批次对齐，需要确认 EPSG/投影或转换参数。');
  }
  if (trajectory.poseFileCount > 0) {
    recommendations.push(`已解析 ${trajectory.poseFileCount} 个定位/姿态文件；多包拼图应优先使用 ${trajectory.preferredSource}。`);
  }
  return {
    pointCount,
    imageCount: analysis.counts.imageFiles,
    usableImagePoseCount: usableImages,
    crsKnown,
    coordinateKinds,
    trajectory,
    recommendations,
  };
}

function summarizeCombinedPackageAnalysis(analyses) {
  const counts = {
    totalFiles: analyses.reduce((total, item) => total + item.counts.totalFiles, 0),
    pointCloudFiles: analyses.reduce((total, item) => total + item.counts.pointCloudFiles, 0),
    lasFiles: analyses.reduce((total, item) => total + item.counts.lasFiles, 0),
    pcdFiles: analyses.reduce((total, item) => total + item.counts.pcdFiles, 0),
    imageFiles: analyses.reduce((total, item) => total + item.counts.imageFiles, 0),
    metadataFiles: analyses.reduce((total, item) => total + item.counts.metadataFiles, 0),
  };
  const pointClouds = analyses.flatMap((item) => item.pointClouds || []);
  const images = analyses.flatMap((item) => item.images || []);
  const trajectories = analyses.flatMap((item) => item.trajectories || []);
  const trajectory = summarizeTrajectoryAnalyses(trajectories);
  const filenameGpsTimeImages = images.filter((image) => image.filenameGpsTime).length;
  const coordinateKinds = Array.from(new Set(pointClouds.map((item) => item.coordinate?.kind).filter(Boolean)));
  const recommendations = [];
  const addRecommendation = (message) => {
    if (message && !recommendations.includes(message)) {
      recommendations.push(message);
    }
  };
  if (!counts.pointCloudFiles) {
    addRecommendation('没有发现 LAS/PCD 点云文件，不能生成底图。');
  }
  if (counts.pointCloudFiles && !pointClouds.some((item) => item.hasCrsVlr)) {
    addRecommendation('点云文件未写入 CRS/EPSG；多批数据拼合需要外部提供坐标系或控制点。');
  }
  if (counts.imageFiles && images.filter((image) => image.poseUsable).length === 0) {
    if (filenameGpsTimeImages) {
      addRecommendation('图片文件名包含 GPS 时间戳，可用于和 LAS GPS Time/轨迹对齐；但缺少可信姿态和标定，不能单独贴图。');
    } else {
      addRecommendation('图片有 EXIF/XMP，但样例未包含有效经纬度/姿态；需要相机标定、时间戳和轨迹才能自动贴图。');
    }
  }
  if (coordinateKinds.includes('local_meters')) {
    addRecommendation('当前坐标更像局部米制坐标；只要 las/pcd 已经在同一坐标系，可以直接拼在同一底图里。');
  }
  if (coordinateKinds.includes('projected_meters_or_large_local')) {
    addRecommendation('当前坐标不是经纬度，数值更像米制投影坐标或大范围局部坐标；如需跨批次对齐，需要确认 EPSG/投影或转换参数。');
  }
  if (trajectory.poseFileCount > 0) {
    addRecommendation(`已解析 ${trajectory.poseFileCount} 个定位/姿态文件；多包拼图应优先使用 ${trajectory.preferredSource}。`);
  }
  const pointCloudsForCount = selectPreferredPointCloudAnalyses(pointClouds);
  return {
    ...counts,
    pointCount: pointCloudsForCount.reduce((total, item) => total + (item.pointCount || 0), 0),
    trajectory,
    recommendations,
  };
}

function normalizePackageAnalysesForCurrentRules(analyses) {
  return (analyses || []).map((analysis) => {
    const pointClouds = analysis.pointClouds || [];
    const metadataFromPointClouds = pointClouds
      .filter((item) => isKnownMetadataName(item.source || ''))
      .map((item) => item.source);
    const normalizedPointClouds = pointClouds.filter((item) => isSupportedPointCloudName(item.source || ''));
    const counts = {
      ...(analysis.counts || {}),
    };
    counts.pointCloudFiles = Math.max(0, (counts.pointCloudFiles || 0) - metadataFromPointClouds.length);
    counts.metadataFiles = (counts.metadataFiles || 0) + metadataFromPointClouds.length;
    return {
      ...analysis,
      counts,
      pointClouds: normalizedPointClouds,
      metadataFiles: Array.from(new Set([...(analysis.metadataFiles || []), ...metadataFromPointClouds])),
    };
  });
}

async function analyzeZipDataPackage(filePath, originalName) {
  const archive = await unzipper.Open.file(filePath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const analysis = {
    source: originalName,
    kind: 'zip',
    counts: {
      totalFiles: entries.length,
      pointCloudFiles: 0,
      imageFiles: 0,
      metadataFiles: 0,
      lasFiles: 0,
      pcdFiles: 0,
    },
    folders: Array.from(new Set(entries.map((entry) => entry.path.split(/[\\/]/)[0]).filter(Boolean))).sort(),
    pointClouds: [],
    images: [],
    metadataFiles: [],
    trajectories: [],
  };
  for (const entry of entries) {
    const ext = path.extname(entry.path).toLowerCase();
    if (isSupportedPointCloudName(entry.path)) {
      analysis.counts.pointCloudFiles += 1;
      if (ext === '.las') analysis.counts.lasFiles += 1;
      if (ext === '.pcd') analysis.counts.pcdFiles += 1;
      if (analysis.pointClouds.length < 16) {
        const prefix = await readZipEntryPrefix(entry);
        const entrySize = getZipEntrySize(entry);
        analysis.pointClouds.push(
          ext === '.las'
            ? parseLasHeaderBuffer(prefix, entry.path, entrySize)
            : parsePcdHeaderBuffer(prefix, entry.path, entrySize)
        );
      }
    } else if (isImageName(entry.path)) {
      analysis.counts.imageFiles += 1;
      if (analysis.images.length < 8) {
        const prefix = await readZipEntryPrefix(entry);
        analysis.images.push(parseJpegMetadataBuffer(prefix, entry.path, getZipEntrySize(entry)));
      }
    } else if (isKnownMetadataName(entry.path) || ['.json', '.yaml', '.yml', '.txt', '.csv', '.xml'].includes(ext)) {
      analysis.counts.metadataFiles += 1;
      if (analysis.metadataFiles.length < 20) {
        analysis.metadataFiles.push(entry.path);
      }
      if (analysis.trajectories.length < 16) {
        const prefix = await readZipEntryPrefix(entry, TRAJECTORY_METADATA_READ_BYTES);
        const trajectory = parseTrajectoryMetadataBuffer(prefix, entry.path, getZipEntrySize(entry));
        if (trajectory) {
          analysis.trajectories.push(trajectory);
        }
      }
    }
  }
  analysis.summary = summarizePackageAnalysis(analysis);
  return analysis;
}

async function analyzeSingleDataFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const stat = await fsp.stat(filePath);
  if (ext === '.zip') {
    return analyzeZipDataPackage(filePath, originalName);
  }
  const prefix = await readFilePrefix(
    filePath,
    isKnownMetadataName(originalName) ? TRAJECTORY_METADATA_READ_BYTES : 512 * 1024
  );
  const analysis = {
    source: originalName,
    kind: 'files',
    counts: {
      totalFiles: 1,
      pointCloudFiles: isSupportedPointCloudName(originalName) ? 1 : 0,
      imageFiles: isImageName(originalName) ? 1 : 0,
      metadataFiles: isKnownMetadataName(originalName) ? 1 : 0,
      lasFiles: ext === '.las' ? 1 : 0,
      pcdFiles: ext === '.pcd' ? 1 : 0,
    },
    folders: [],
    pointClouds: [],
    images: [],
    metadataFiles: [],
    trajectories: [],
  };
  if (ext === '.las') {
    analysis.pointClouds.push(parseLasHeaderBuffer(prefix, originalName, stat.size));
  } else if (ext === '.pcd') {
    analysis.pointClouds.push(parsePcdHeaderBuffer(prefix, originalName, stat.size));
  } else if (isImageName(originalName)) {
    analysis.images.push(parseJpegMetadataBuffer(prefix, originalName, stat.size));
  } else if (isKnownMetadataName(originalName)) {
    analysis.metadataFiles.push(originalName);
    const trajectory = parseTrajectoryMetadataBuffer(prefix, originalName, stat.size);
    if (trajectory) {
      analysis.trajectories.push(trajectory);
    }
  }
  analysis.summary = summarizePackageAnalysis(analysis);
  return analysis;
}

async function analyzeDataPackage(config, params) {
  const files = Array.isArray(params.files) ? params.files : [];
  if (files.length === 0) {
    throw new Error('file is required');
  }
  const packageRoot = path.join(config.baseMapRoot, '..', 'import_packages');
  await fsp.mkdir(packageRoot, { recursive: true });
  const packageName = sanitizePackageName(params.packageName || files[0].originalName || files[0].originalname);
  const packageId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${packageName}`;
  const targetDir = path.join(packageRoot, packageId);
  const uploadDir = path.join(targetDir, 'uploads');
  await fsp.mkdir(uploadDir, { recursive: true });
  const analyses = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const originalName = file.originalName || file.originalname || `upload-${index}`;
      const safeName = `${index}-${path.basename(originalName) || 'upload'}`;
      const copiedPath = path.join(uploadDir, safeName);
      await fsp.copyFile(file.path, copiedPath);
      analyses.push(await analyzeSingleDataFile(copiedPath, originalName));
    }
    const combined = {
      packageId,
      path: targetDir,
      uploadedFiles: files.map((file) => file.originalName || file.originalname || file.path),
      analyses,
      summary: summarizeCombinedPackageAnalysis(analyses),
    };
    await fsp.writeFile(path.join(targetDir, 'analysis.json'), JSON.stringify(combined, null, 2), 'utf8');
    return combined;
  } catch (error) {
    await fsp.rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}

async function refreshDataPackageAnalysis(config, params) {
  const packageId = validatePackageId(params.packageId);
  const packageDir = await resolveDataPackageDir(config, packageId);
  const uploadDir = path.join(packageDir, 'uploads');
  if (!(await pathExists(uploadDir))) {
    throw new Error(`data package uploads not found: ${packageId}`);
  }
  const existing = await readAnalysisFile(packageDir).catch(() => null);
  const entries = await fsp.readdir(uploadDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      path: path.join(uploadDir, entry.name),
      originalName: entry.name.replace(/^\d+-/, ''),
    }));
  if (files.length === 0) {
    throw new Error(`data package has no uploaded files: ${packageId}`);
  }
  const analyses = [];
  for (const file of files) {
    analyses.push(await analyzeSingleDataFile(file.path, file.originalName));
  }
  const combined = {
    packageId,
    path: packageDir,
    uploadedFiles: existing?.uploadedFiles || files.map((file) => file.originalName),
    analyses,
    summary: summarizeCombinedPackageAnalysis(analyses),
  };
  await fsp.writeFile(path.join(packageDir, 'analysis.json'), JSON.stringify(combined, null, 2), 'utf8');
  return combined;
}

function getImportPackageRoot(config) {
  return path.resolve(config.baseMapRoot, '..', 'import_packages');
}

function validatePackageId(packageId) {
  const normalized = String(packageId || '').trim();
  if (!normalized) {
    throw new Error('packageId is required');
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('packageId must not contain path separators');
  }
  return normalized;
}

function defaultMapNameFromPackageId(packageId) {
  return sanitizePackageName(String(packageId || '').replace(/^\d{14}-/, '') || packageId);
}

async function readAnalysisFile(packageDir) {
  const analysisPath = path.join(packageDir, 'analysis.json');
  if (!(await pathExists(analysisPath))) {
    return null;
  }
  const content = await fsp.readFile(analysisPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function listDataPackages(config) {
  const packageRoot = getImportPackageRoot(config);
  if (!(await pathExists(packageRoot))) {
    return [];
  }
  const entries = await fsp.readdir(packageRoot, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageId = entry.name;
    const packageDir = path.join(packageRoot, packageId);
    const stat = await fsp.stat(packageDir);
    const analysis = await readAnalysisFile(packageDir).catch(() => null);
    const analyses = normalizePackageAnalysesForCurrentRules(analysis?.analyses || []);
    const summary = analyses.length ? summarizeCombinedPackageAnalysis(analyses) : analysis?.summary || null;
    packages.push({
      packageId,
      path: packageDir,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      defaultMapName: defaultMapNameFromPackageId(packageId),
      summary,
      analyses,
      uploadedFiles: analysis?.uploadedFiles || [],
      sizeBytes: await getDirectorySize(packageDir),
    });
  }
  packages.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
  return packages;
}

async function resolveDataPackageDir(config, packageId) {
  const normalizedPackageId = validatePackageId(packageId);
  const packageRoot = getImportPackageRoot(config);
  const packageDir = path.resolve(packageRoot, normalizedPackageId);
  if (!packageDir.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('packageId resolved outside import package root');
  }
  if (!(await pathExists(packageDir))) {
    throw new Error(`data package not found: ${normalizedPackageId}`);
  }
  return packageDir;
}

async function importDataPackageBaseMap(config, params) {
  const packageId = validatePackageId(params.packageId);
  const packageDir = await resolveDataPackageDir(config, packageId);
  const uploadDir = path.join(packageDir, 'uploads');
  if (!(await pathExists(uploadDir))) {
    throw new Error(`data package uploads not found: ${packageId}`);
  }
  const entries = await fsp.readdir(uploadDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      path: path.join(uploadDir, entry.name),
      originalName: entry.name.replace(/^\d+-/, ''),
    }))
    .filter((file) => isSupportedPointCloudUploadName(file.originalName) || isImageName(file.originalName));
  if (files.length === 0) {
    throw new Error(`data package has no importable point cloud files: ${packageId}`);
  }
  const mapName = params.mapName || defaultMapNameFromPackageId(packageId);
  const result = await importPointCloudFilesBaseMap(config, {
    mapName,
    overwrite: params.overwrite === true,
    files,
  });
  return {
    ...result,
    packageId,
    packagePath: packageDir,
  };
}

async function scanTextPointCloud(filePath, onPoint) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const point = parseNumericPointLine(line);
    if (point) {
      onPoint(point[0], point[1], point[2], point[3]);
    }
  }
}

async function scanPcdPointCloud(filePath, onPoint) {
  const buffer = await fsp.readFile(filePath);
  const { header, dataOffset } = parsePcdHeader(buffer);
  const fields = header.FIELDS || [];
  const normalizedFields = fields.map((field) => String(field).toLowerCase());
  const sizes = (header.SIZE || []).map((value) => Number(value));
  const types = header.TYPE || [];
  const counts = fields.map((_, index) => Number((header.COUNT || [])[index] || 1));
  const dataType = String((header.DATA || [])[0] || '').toLowerCase();
  const xIndex = normalizedFields.indexOf('x');
  const yIndex = normalizedFields.indexOf('y');
  const zIndex = normalizedFields.indexOf('z');
  const intensityIndex = normalizedFields.indexOf('intensity');
  if (xIndex < 0 || yIndex < 0) {
    throw new Error('PCD 文件必须包含 x/y 字段');
  }

  if (dataType === 'ascii') {
    const body = buffer.slice(dataOffset).toString('utf8');
    body.split(/\r?\n/).forEach((line) => {
      const values = line.trim().split(/\s+/).map((value) => Number(value));
      if (values.length <= Math.max(xIndex, yIndex) || values.some((value) => Number.isNaN(value))) {
        return;
      }
      onPoint(
        values[xIndex],
        values[yIndex],
        zIndex >= 0 ? values[zIndex] : 0,
        intensityIndex >= 0 ? values[intensityIndex] : null
      );
    });
    return;
  }

  let pointStep = 0;
  const fieldOffsets = fields.map((_, index) => {
    const current = pointStep;
    pointStep += (sizes[index] || 4) * (counts[index] || 1);
    return current;
  });
  const pointCount = Number((header.POINTS || [])[0]) || Math.floor((buffer.length - dataOffset) / pointStep);

  if (dataType === 'binary_compressed') {
    const compressedSize = buffer.readUInt32LE(dataOffset);
    const uncompressedSize = buffer.readUInt32LE(dataOffset + 4);
    const compressed = buffer.slice(dataOffset + 8, dataOffset + 8 + compressedSize);
    const dataBuffer = decompressLzf(compressed, uncompressedSize);
    const fieldColumnOffsets = [];
    let columnOffset = 0;
    fields.forEach((_, index) => {
      fieldColumnOffsets[index] = columnOffset;
      columnOffset += (sizes[index] || 4) * (counts[index] || 1) * pointCount;
    });
    for (let index = 0; index < pointCount; index += 1) {
      const readField = (fieldIndex) =>
        readPcdBinaryValue(
          dataBuffer,
          fieldColumnOffsets[fieldIndex] + index * (sizes[fieldIndex] || 4),
          types[fieldIndex] || 'F',
          sizes[fieldIndex] || 4
        );
      onPoint(
        readField(xIndex),
        readField(yIndex),
        zIndex >= 0 ? readField(zIndex) : 0,
        intensityIndex >= 0 ? readField(intensityIndex) : null
      );
    }
    return;
  }

  if (dataType !== 'binary') {
    throw new Error(`暂不支持 PCD DATA ${dataType || 'unknown'}，请使用 ascii、binary 或 binary_compressed PCD`);
  }

  for (let index = 0; index < pointCount; index += 1) {
    const base = dataOffset + index * pointStep;
    if (base + pointStep > buffer.length) {
      break;
    }
    const readField = (fieldIndex) =>
      readPcdBinaryValue(buffer, base + fieldOffsets[fieldIndex], types[fieldIndex] || 'F', sizes[fieldIndex] || 4);
    onPoint(
      readField(xIndex),
      readField(yIndex),
      zIndex >= 0 ? readField(zIndex) : 0,
      intensityIndex >= 0 ? readField(intensityIndex) : null
    );
  }
}

async function scanPlyPointCloud(filePath, onPoint) {
  const content = await fsp.readFile(filePath, 'utf8');
  const headerEnd = content.indexOf('end_header');
  if (headerEnd < 0) {
    throw new Error('PLY 文件缺少 end_header');
  }
  const header = content.slice(0, headerEnd).split(/\r?\n/);
  if (!header.some((line) => /^format\s+ascii\s+/i.test(line.trim()))) {
    throw new Error('暂只支持 ASCII PLY 点云');
  }
  const properties = [];
  for (const line of header) {
    const match = line.trim().match(/^property\s+\S+\s+(\S+)$/i);
    if (match) {
      properties.push(match[1]);
    }
  }
  const xIndex = properties.indexOf('x');
  const yIndex = properties.indexOf('y');
  const zIndex = properties.indexOf('z');
  if (xIndex < 0 || yIndex < 0) {
    throw new Error('PLY 文件必须包含 x/y 字段');
  }
  const body = content.slice(headerEnd + 'end_header'.length);
  body.split(/\r?\n/).forEach((line) => {
    const values = line.trim().split(/\s+/).map((value) => Number(value));
    if (values.length <= Math.max(xIndex, yIndex) || values.some((value) => Number.isNaN(value))) {
      return;
    }
    onPoint(values[xIndex], values[yIndex], zIndex >= 0 ? values[zIndex] : 0, null);
  });
}

async function scanLasPointCloud(filePath, onPoint) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < 227) {
      throw new Error('LAS 文件头不完整');
    }
    const headerBuffer = Buffer.alloc(Math.min(375, stat.size));
    await handle.read(headerBuffer, 0, headerBuffer.length, 0);
    if (headerBuffer.slice(0, 4).toString('ascii') !== 'LASF') {
      throw new Error('LAS 文件签名无效');
    }
    const offsetToPointData = headerBuffer.readUInt32LE(96);
    const pointFormat = headerBuffer.readUInt8(104);
    const pointRecordLength = headerBuffer.readUInt16LE(105);
    if (pointFormat > 10 || pointRecordLength < 12) {
      throw new Error(`暂不支持 LAS 点格式 ${pointFormat}`);
    }
    const legacyPointCount = headerBuffer.readUInt32LE(107);
    let pointCount = legacyPointCount;
    if (pointCount === 0 && headerBuffer.length >= 255) {
      pointCount = Number(headerBuffer.readBigUInt64LE(247));
    }
    if (!pointCount || offsetToPointData >= stat.size) {
      pointCount = Math.floor((stat.size - offsetToPointData) / pointRecordLength);
    }
    const scaleX = headerBuffer.readDoubleLE(131);
    const scaleY = headerBuffer.readDoubleLE(139);
    const scaleZ = headerBuffer.readDoubleLE(147);
    const offsetX = headerBuffer.readDoubleLE(155);
    const offsetY = headerBuffer.readDoubleLE(163);
    const offsetZ = headerBuffer.readDoubleLE(171);
    const maxRecordsPerRead = Math.max(1, Math.floor((4 * 1024 * 1024) / pointRecordLength));
    const chunk = Buffer.alloc(maxRecordsPerRead * pointRecordLength);
    let readPointCount = 0;
    while (readPointCount < pointCount) {
      const remaining = pointCount - readPointCount;
      const recordsToRead = Math.min(maxRecordsPerRead, remaining);
      const bytesToRead = recordsToRead * pointRecordLength;
      const { bytesRead } = await handle.read(
        chunk,
        0,
        bytesToRead,
        offsetToPointData + readPointCount * pointRecordLength
      );
      if (bytesRead <= 0) {
        break;
      }
      const actualRecords = Math.floor(bytesRead / pointRecordLength);
      for (let index = 0; index < actualRecords; index += 1) {
        const base = index * pointRecordLength;
        const x = chunk.readInt32LE(base) * scaleX + offsetX;
        const y = chunk.readInt32LE(base + 4) * scaleY + offsetY;
        const z = chunk.readInt32LE(base + 8) * scaleZ + offsetZ;
        const intensity = pointRecordLength >= 14 ? chunk.readUInt16LE(base + 12) : null;
        onPoint(x, y, z, intensity);
      }
      readPointCount += actualRecords;
      if (actualRecords < recordsToRead) {
        break;
      }
    }
  } finally {
    await handle.close();
  }
}

async function scanPointCloudZip(filePath, onPoint) {
  const archive = await unzipper.Open.file(filePath);
  const entries = archive.files.filter((entry) => entry.type === 'File');
  const cloudEntries = entries.filter((entry) => isSupportedPointCloudName(entry.path));
  const imageEntries = entries.filter((entry) => isImageName(entry.path));
  if (cloudEntries.length === 0) {
    throw new Error('点云 ZIP 中没有找到支持的点云文件，请包含 .pcd/.ply/.xyz/.txt/.csv/.las');
  }
  const tempRoot = path.join(path.dirname(filePath), `.cloud-raster-zip-${Date.now()}`);
  await fsp.rm(tempRoot, { recursive: true, force: true });
  await fsp.mkdir(tempRoot, { recursive: true });
  try {
    const selectedCloudEntries = selectPreferredPointCloudEntries(cloudEntries);
    for (let index = 0; index < selectedCloudEntries.length; index += 1) {
      const entry = selectedCloudEntries[index];
      const safeName = archiveBaseName(entry.path) || `cloud-${index}${path.extname(entry.path)}`;
      const tempPath = path.join(tempRoot, `${index}-${safeName}`);
      await pipeline(entry.stream(), fs.createWriteStream(tempPath));
      await scanPointCloudFile(tempPath, safeName, onPoint);
    }
    return {
      sourceFiles: cloudEntries.map((entry) => entry.path),
      selectedSourceFiles: selectedCloudEntries.map((entry) => entry.path),
      imageFileCount: imageEntries.length,
    };
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function scanPointCloudFile(filePath, originalName = '', onPoint) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.zip') {
    return scanPointCloudZip(filePath, onPoint);
  }
  if (ext === '.pcd') {
    await scanPcdPointCloud(filePath, onPoint);
  } else if (ext === '.ply') {
    await scanPlyPointCloud(filePath, onPoint);
  } else if (ext === '.las') {
    await scanLasPointCloud(filePath, onPoint);
  } else if (ext === '.laz') {
    throw new Error('暂不支持压缩 LAZ，请先转换为 LAS 或 PCD 后导入');
  } else if (['.xyz', '.txt', '.csv'].includes(ext)) {
    await scanTextPointCloud(filePath, onPoint);
  } else {
    throw new Error('点云底图暂支持 .pcd、.ply、.xyz、.txt、.csv、.las，或包含这些文件的 .zip');
  }
  return {
    sourceFiles: [originalName || path.basename(filePath)],
    imageFileCount: 0,
  };
}

async function parsePointCloud(filePath, originalName = '') {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.zip') {
    return parsePointCloudZip(filePath);
  }
  if (ext === '.pcd') {
    return parsePcdPointCloud(filePath);
  }
  if (ext === '.ply') {
    return parsePlyPointCloud(filePath);
  }
  if (ext === '.las') {
    return parseLasPointCloud(filePath);
  }
  if (ext === '.laz') {
    throw new Error('暂不支持压缩 LAZ，请先转换为 LAS 或 PCD 后导入');
  }
  if (['.xyz', '.txt', '.csv'].includes(ext)) {
    return parseTextPointCloud(filePath);
  }
  throw new Error('点云底图暂支持 .pcd、.ply、.xyz、.txt、.csv、.las，或包含这些文件的 .zip');
}

async function importPointCloudBaseMap(config, params) {
  const cloudPath = params.cloudPath;
  const originalName = params.originalName || path.basename(cloudPath || '');
  if (!cloudPath || !(await pathExists(cloudPath))) {
    throw new Error('uploaded point cloud file not found');
  }
  return importPointCloudFilesBaseMap(config, {
    mapName: params.mapName,
    overwrite: params.overwrite === true,
    files: [{ path: cloudPath, originalName }],
  });
}

async function importPointCloudFilesBaseMap(config, params) {
  const mapName = validateMapName(params.mapName);
  const files = Array.isArray(params.files) ? params.files : [];
  const overwrite = params.overwrite === true;
  if (files.length === 0) {
    throw new Error('file is required');
  }

  const cloudFiles = files.filter((file) => isSupportedPointCloudUploadName(file.originalName || file.originalname || file.path));
  const imageFiles = files.filter((file) => isImageName(file.originalName || file.originalname || file.path));
  if (cloudFiles.length === 0) {
    throw new Error('点云底图请上传 .pcd/.ply/.xyz/.txt/.csv/.las 文件，或包含这些文件的 .zip');
  }

  const targetDir = path.join(config.baseMapRoot, mapName);
  const stagingDir = path.join(config.baseMapRoot, `.import-${mapName}-${Date.now()}`);
  if ((await pathExists(targetDir)) && !overwrite) {
    throw new Error(`base map already exists: ${mapName}`);
  }

  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(stagingDir, 'map_images'), { recursive: true });
  await fsp.mkdir(path.join(stagingDir, 'sources'), { recursive: true });
  try {
    const statsCollector = createPointCloudProcessingStats();
    const sourceFiles = [];
    let imageFileCount = imageFiles.length;
    for (const file of cloudFiles) {
      const originalName = file.originalName || file.originalname || path.basename(file.path);
      const parsed = await scanPointCloudFile(file.path, originalName, statsCollector.addPoint);
      sourceFiles.push(...(parsed.selectedSourceFiles || parsed.sourceFiles || [originalName]));
      imageFileCount += parsed.imageFileCount || 0;
    }
    const stats = statsCollector.finalize();
    const coordinate = classifyCoordinateSystem(stats.bounds);
    const imageIndex = await buildImageOverlayIndex(files, stagingDir);
    const imageOverlay = getImageOverlayMetadataFromIndex(imageFileCount, imageIndex);
    const layers = {
      enhanced: createRasterTileAccumulator({ sourceType: 'point_cloud_enhanced' }),
      raw: createRasterTileAccumulator({ sourceType: 'point_cloud_raw' }),
      ground: createRasterTileAccumulator({ sourceType: 'point_cloud_ground' }),
      marking: createRasterTileAccumulator({ sourceType: 'point_cloud_marking' }),
      edge: createRasterTileAccumulator({ sourceType: 'point_cloud_edge' }),
      structure: createRasterTileAccumulator({ sourceType: 'point_cloud_structure' }),
    };

    const renderEnhancedPoint = (x, y, z = 0, intensity = null) => {
      if (![x, y, z].every(Number.isFinite)) {
        return;
      }
      const value = stats.normalizeIntensityForRaster(intensity);
      const groundZ = stats.getGroundZ(x, y);
      const relativeZ = Number.isFinite(groundZ) ? z - groundZ : 0;
      const isGround = stats.isGroundPoint(x, y, z);
      const isMarking = isGround && stats.isHighIntensity(intensity);
      const isEdge = isGround && stats.isEdgeCell(x, y);
      layers.raw.addPointValue(x, y, z, value, 0);
      if (isGround) {
        const groundValue = Math.max(34, Math.round(value * 0.58));
        layers.ground.addPointValue(x, y, z, groundValue, 0);
        layers.enhanced.addPointValue(x, y, z, Math.max(32, Math.round(value * 0.5)), 0);
      }
      if (isEdge) {
        layers.edge.addPointValue(x, y, z, 185, 0);
        layers.enhanced.addPointValue(x, y, z, 155, 0);
      }
      if (isMarking) {
        layers.marking.addPointValue(x, y, z, 255, 1);
        layers.enhanced.addPointValue(x, y, z, 255, 1);
      }
      if (!isGround) {
        const structureValue = Math.max(86, Math.min(210, Math.round(value * 0.72 + 46)));
        const enhancedValue = relativeZ > 0.5 ? Math.max(96, structureValue) : Math.max(72, structureValue - 24);
        layers.structure.addPointValue(x, y, z, structureValue, 0);
        layers.enhanced.addPointValue(x, y, z, enhancedValue, 0);
      }
    };

    for (const file of cloudFiles) {
      const originalName = file.originalName || file.originalname || path.basename(file.path);
      await scanPointCloudFile(file.path, originalName, renderEnhancedPoint);
    }

    const layerDescriptors = [
      { id: 'enhanced', name: '增强底图', path: 'map_images' },
      { id: 'raw', name: '原始投影', path: 'map_images_raw' },
      { id: 'ground', name: '地面过滤', path: 'map_images_ground' },
      { id: 'marking', name: '标线增强', path: 'map_images_marking' },
      { id: 'edge', name: '路沿/边界', path: 'map_images_edge' },
      { id: 'structure', name: '立物/杆牌', path: 'map_images_structure' },
    ].filter((layer) => layer.id === 'enhanced' || layers[layer.id].getPointCount() > 0);
    const metadata = {
      pointCount: stats.totalPointCount,
      bounds: stats.bounds,
      sourceFiles,
      imageFileCount,
      coordinate,
      imageOverlay,
      layers: layerDescriptors,
      processing: {
        mode: 'enhanced_point_cloud_raster',
        tileResolutionMetersPerPixel: getPointCloudTileResolution(Math.max(...POINT_CLOUD_TILE_LEVELS)),
        groundGrid: stats.groundGrid,
        intensity: stats.intensity,
        outputs: layerDescriptors.map((layer) => layer.id),
      },
    };
    const parsed = await layers.enhanced.writeTiles(path.join(stagingDir, 'map_images'), metadata);
    for (const layer of layerDescriptors) {
      if (layer.id === 'enhanced') {
        continue;
      }
      await layers[layer.id].writeTiles(path.join(stagingDir, layer.path), {
        ...metadata,
        sourceType: `point_cloud_${layer.id}`,
        allowEmpty: true,
      });
    }
    await copyImportSources(files, stagingDir);
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.rename(stagingDir, targetDir);
    return {
      mapName,
      path: targetDir,
      pointCount: parsed.totalPointCount,
      tileCount: parsed.tileCount,
      layers: layerDescriptors.map((layer) => layer.id),
      coordinate,
      imageOverlay,
      bounds: parsed.bounds,
      sizeBytes: await getDirectorySize(targetDir),
    };
  } catch (error) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

async function getRuntimeDoctor(config) {
  const status = await getStatus(config);
  const checks = [];
  const addCheck = (name, ok, severity, message) => {
    checks.push({
      name,
      status: ok ? 'ok' : severity,
      message,
    });
  };

  addCheck(
    'frontend-build',
    status.paths.frontendAvailable,
    'error',
    status.paths.frontendAvailable
      ? 'Frontend build is available'
      : `Frontend build not found at ${status.paths.frontendBuildRoot}`
  );
  addCheck(
    'tile-config',
    status.paths.tileMapConfigAvailable,
    'error',
    status.paths.tileMapConfigAvailable
      ? 'Tile-map config is available'
      : `Tile-map config not found at ${status.paths.tileMapConfig}`
  );
  addCheck(
    'base-map-dir',
    await pathWritable(config.baseMapRoot),
    'error',
    `Base map directory is writable: ${config.baseMapRoot}`
  );
  addCheck(
    'editor-map-dir',
    await pathWritable(config.editorMapRoot),
    'error',
    `Editor map directory is writable: ${config.editorMapRoot}`
  );
  addCheck(
    'release-dir',
    await pathWritable(config.releaseRoot),
    'error',
    `Release directory is writable: ${config.releaseRoot}`
  );

  if (config.runtimeMode === 'local') {
    addCheck(
      'editor-map-converter',
      status.local.converterAvailable,
      'error',
      status.local.converterAvailable
        ? 'Native editor_map_converter is available'
        : `Native editor_map_converter is missing at ${status.local.converterBinary}`
    );
    addCheck(
      'tile-map-images-creator',
      status.local.tileMapCreatorAvailable,
      'warning',
      status.local.tileMapCreatorAvailable
        ? 'Native tile_map_images_creator is available'
        : `Native tile_map_images_creator is missing at ${status.local.tileMapCreatorBinary}`
    );
  }

  if (config.runtimeMode === 'docker') {
    addCheck(
      'docker-runtime',
      status.docker && status.docker.available,
      'error',
      status.docker ? status.docker.message : 'Docker runtime status is unavailable'
    );
  }

  addCheck(
    'edge-deploy',
    status.edgeDeploy.enabled,
    'warning',
    status.edgeDeploy.enabled
      ? `Edge deploy enabled for ${status.edgeDeploy.user}@${status.edgeDeploy.host}:${status.edgeDeploy.targetMapRoot}`
      : 'Edge deploy is disabled'
  );

  const hasError = checks.some((check) => check.status === 'error');
  const hasWarning = checks.some((check) => check.status === 'warning');
  return {
    ready: !hasError,
    hasWarning,
    status,
    checks,
  };
}

function getDeployConfig(config) {
  const edge = config.edgeDeploy;
  return {
    mode: edge.mode,
    enabled: edge.mode !== 'disabled',
    host: edge.host,
    user: edge.user,
    target: buildEdgeTarget(config),
    targetMapRoot: edge.targetMapRoot,
    postDeployCommandConfigured: Boolean(edge.postDeployCommand),
  };
}

async function preflightEdgeDeploy(config) {
  const deployConfig = getDeployConfig(config);
  const checks = [];
  const addCheck = (name, ok, severity, message, details = null) => {
    checks.push({
      name,
      status: ok ? 'ok' : severity,
      message,
      details,
    });
  };

  addCheck(
    'edge-mode',
    deployConfig.enabled,
    'error',
    deployConfig.enabled ? `Edge deploy mode is ${deployConfig.mode}` : 'Edge deploy is disabled'
  );
  addCheck(
    'edge-target',
    Boolean(deployConfig.host && deployConfig.user),
    'error',
    deployConfig.host && deployConfig.user
      ? `Edge target is ${deployConfig.target}`
      : 'MAP_EDGE_HOST and MAP_EDGE_USER are required'
  );

  if (!deployConfig.enabled || !deployConfig.host || !deployConfig.user) {
    return {
      ready: false,
      deployConfig,
      checks,
    };
  }

  if (deployConfig.mode !== 'ssh') {
    addCheck('edge-mode-supported', false, 'error', `Unsupported edge deploy mode: ${deployConfig.mode}`);
    return {
      ready: false,
      deployConfig,
      checks,
    };
  }

  const sshBaseArgs = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    deployConfig.target,
  ];

  try {
    const result = await runCommand('ssh', [...sshBaseArgs, 'echo mapeditor-ok'], {
      timeoutMs: 10000,
    });
    addCheck('ssh-connectivity', true, 'error', `SSH connectivity ok: ${result.stdout.trim()}`);
  } catch (error) {
    addCheck('ssh-connectivity', false, 'error', 'SSH connectivity failed', error.message);
  }

  try {
    const remoteCommand = [
      'mkdir',
      '-p',
      quoteShell(deployConfig.targetMapRoot),
      '&&',
      'test',
      '-w',
      quoteShell(deployConfig.targetMapRoot),
    ].join(' ');
    await runCommand('ssh', [...sshBaseArgs, remoteCommand], {
      timeoutMs: 10000,
    });
    addCheck('target-map-root', true, 'error', `Target map root is writable: ${deployConfig.targetMapRoot}`);
  } catch (error) {
    addCheck(
      'target-map-root',
      false,
      'error',
      `Target map root is not writable: ${deployConfig.targetMapRoot}`,
      error.message
    );
  }

  const ready = !checks.some((check) => check.status === 'error');
  return {
    ready,
    deployConfig,
    checks,
  };
}

async function runLocalConverter(config, mapName, jsonPath, releaseDir, baseMapDir) {
  if (!(await pathExists(config.converterBinary))) {
    throw new Error(`converter binary not found at ${config.converterBinary}`);
  }
  const args = [`--input_json=${jsonPath}`, `--output_dir=${releaseDir}`];
  if (baseMapDir && (await pathExists(baseMapDir))) {
    args.push(`--base_map_dir=${baseMapDir}`);
  }
  if (config.skipValidation) {
    args.push('--skip_validate=true');
  }
  return runCommand(config.converterBinary, args);
}

async function runDockerConverter(config, mapName, jsonPath, releaseDir, baseMapDir) {
  const docker = await checkDockerRuntime(config);
  if (!docker.available) {
    throw new Error(docker.message);
  }
  const containerJsonPath = normalizeForContainer(jsonPath, config);
  const containerReleaseDir = normalizeForContainer(releaseDir, config);
  const args = [
    'exec',
    config.runtimeDockerContainer,
    config.editorMapConverterInContainer,
    `--input_json=${containerJsonPath}`,
    `--output_dir=${containerReleaseDir}`,
  ];
  if (baseMapDir) {
    args.push(`--base_map_dir=${normalizeForContainer(baseMapDir, config)}`);
  }
  if (config.skipValidation) {
    args.push('--skip_validate=true');
  }
  return runCommand('docker', args);
}

async function convertEditorMap(config, params) {
  const { mapName, jsonPath, releaseDir, baseMapDir } = params;
  if (config.runtimeMode === 'docker') {
    return runDockerConverter(config, mapName, jsonPath, releaseDir, baseMapDir);
  }
  return runLocalConverter(config, mapName, jsonPath, releaseDir, baseMapDir);
}

async function createBaseMap(config, params = {}) {
  const outputName = params.outputName || 'sample';
  if (config.runtimeMode === 'docker') {
    const docker = await checkDockerRuntime(config);
    if (!docker.available) {
      throw new Error(docker.message);
    }
    return runCommand('docker', [
      'exec',
      config.runtimeDockerContainer,
      config.tileMapCreatorInContainer,
      '-c',
      `${config.configRootInContainer}/image_creator_conf.pb.txt`,
    ]);
  }

  if (!(await pathExists(config.tileMapCreatorBinary))) {
    throw new Error(`tile map creator binary not found at ${config.tileMapCreatorBinary}`);
  }
  return runCommand(config.tileMapCreatorBinary, ['-c', config.tileMapConfig], {
    spawnOptions: {
      env: {
        ...process.env,
        MAP_OUTPUT_NAME: outputName,
      },
    },
  });
}

async function deployReleasedMap(config, params) {
  const { mapName } = params;
  if (!mapName) {
    throw new Error('mapName is required');
  }
  if (config.edgeDeploy.mode === 'disabled') {
    throw new Error('edge deploy is disabled');
  }
  const sourceDir = path.join(config.releaseRoot, mapName);
  if (!(await pathExists(sourceDir))) {
    throw new Error(`released map not found at ${sourceDir}`);
  }
  if (config.edgeDeploy.mode !== 'ssh') {
    throw new Error(`unsupported edge deploy mode: ${config.edgeDeploy.mode}`);
  }
  if (!config.edgeDeploy.host || !config.edgeDeploy.user) {
    throw new Error('edgeDeploy.host and edgeDeploy.user are required');
  }
  const preflight = await preflightEdgeDeploy(config);
  if (!preflight.ready) {
    const failedChecks = preflight.checks
      .filter((check) => check.status === 'error')
      .map((check) => `${check.name}: ${check.message}`)
      .join('; ');
    throw new Error(`edge deploy preflight failed: ${failedChecks}`);
  }
  const edgeTarget = buildEdgeTarget(config);
  const target = `${edgeTarget}:${config.edgeDeploy.targetMapRoot}/`;
  const copyResult = await runCommand('scp', ['-r', sourceDir, target], { timeoutMs: 10 * 60 * 1000 });
  let postDeployResult = null;
  if (config.edgeDeploy.postDeployCommand) {
    postDeployResult = await runCommand('ssh', [
      edgeTarget,
      config.edgeDeploy.postDeployCommand,
    ]);
  }
  return { preflight, copyResult, postDeployResult };
}

async function deployLatestReleasedMap(config) {
  const maps = await listReleasedMaps(config);
  if (maps.length === 0) {
    throw new Error(`no released maps found at ${config.releaseRoot}`);
  }
  const latest = maps[0];
  const result = await deployReleasedMap(config, { mapName: latest.mapName });
  return {
    mapName: latest.mapName,
    releasedMap: latest,
    ...result,
  };
}

module.exports = {
  getStatus,
  getRuntimeDoctor,
  getDeployConfig,
  preflightEdgeDeploy,
  listReleasedMaps,
  analyzeDataPackage,
  refreshDataPackageAnalysis,
  listDataPackages,
  importDataPackageBaseMap,
  importBaseMapZip,
  importPointCloudBaseMap,
  importPointCloudFilesBaseMap,
  importMapPackageZip,
  convertEditorMap,
  createBaseMap,
  deployReleasedMap,
  deployLatestReleasedMap,
};

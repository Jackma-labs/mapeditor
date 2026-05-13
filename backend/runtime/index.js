const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const { pipeline } = require('stream/promises');
const unzipper = require('unzipper');
const { runCommand } = require('./process');

const DEFAULT_POINT_CLOUD_RENDER_POINTS = 1000000;
const configuredPointCloudRenderPoints = Number(
  process.env.POINT_CLOUD_RENDER_POINTS || DEFAULT_POINT_CLOUD_RENDER_POINTS
);
const MAX_POINT_CLOUD_RENDER_POINTS = Number.isFinite(configuredPointCloudRenderPoints)
  ? Math.max(10000, configuredPointCloudRenderPoints)
  : DEFAULT_POINT_CLOUD_RENDER_POINTS;

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
  const sizes = (header.SIZE || []).map((value) => Number(value));
  const types = header.TYPE || [];
  const counts = fields.map((_, index) => Number((header.COUNT || [])[index] || 1));
  const dataType = String((header.DATA || [])[0] || '').toLowerCase();
  const xIndex = fields.indexOf('x');
  const yIndex = fields.indexOf('y');
  const zIndex = fields.indexOf('z');
  const intensityIndex = fields.indexOf('intensity');
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
        accumulator.addPoint(x, y, z);
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

function isSupportedPointCloudName(fileName) {
  return ['.pcd', '.ply', '.xyz', '.txt', '.csv', '.las'].includes(path.extname(fileName).toLowerCase());
}

function isSupportedPointCloudUploadName(fileName) {
  return isSupportedPointCloudName(fileName) || ['.zip', '.laz'].includes(path.extname(fileName).toLowerCase());
}

function isImageName(fileName) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'].includes(path.extname(fileName).toLowerCase());
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
    for (let index = 0; index < cloudEntries.length; index += 1) {
      const entry = cloudEntries[index];
      const safeName = path.basename(entry.path) || `cloud-${index}${path.extname(entry.path)}`;
      const tempPath = path.join(tempRoot, `${index}-${safeName}`);
      await pipeline(entry.stream(), fs.createWriteStream(tempPath));
      const parsed = await parsePointCloud(tempPath, safeName);
      accumulator.mergePointCloud(parsed);
    }
    const parsed = accumulator.finalize();
    parsed.sourceFiles = cloudEntries.map((entry) => entry.path);
    parsed.imageFileCount = imageEntries.length;
    return parsed;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
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
  const mapName = validateMapName(params.mapName);
  const cloudPath = params.cloudPath;
  const originalName = params.originalName || path.basename(cloudPath || '');
  const overwrite = params.overwrite === true;
  if (!cloudPath || !(await pathExists(cloudPath))) {
    throw new Error('uploaded point cloud file not found');
  }

  const parsed = await parsePointCloud(cloudPath, originalName);
  const targetDir = path.join(config.baseMapRoot, mapName);
  const stagingDir = path.join(config.baseMapRoot, `.import-${mapName}-${Date.now()}`);
  if ((await pathExists(targetDir)) && !overwrite) {
    throw new Error(`base map already exists: ${mapName}`);
  }

  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(stagingDir, 'map_images'), { recursive: true });
  try {
    const payload = {
      type: 'point_cloud',
      version: 1,
      sourceFile: originalName,
      sourceFiles: parsed.sourceFiles || [originalName],
      imageFileCount: parsed.imageFileCount || 0,
      pointCount: parsed.totalPointCount,
      renderedPointCount: parsed.points.length,
      center: parsed.center,
      bounds: parsed.bounds,
      points: parsed.points,
    };
    await fsp.writeFile(path.join(stagingDir, 'map_images', 'tiles.json'), JSON.stringify(payload), 'utf8');
    await fsp.copyFile(cloudPath, path.join(stagingDir, originalName || 'source.pointcloud'));
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.rename(stagingDir, targetDir);
    return {
      mapName,
      path: targetDir,
      pointCount: parsed.totalPointCount,
      renderedPointCount: parsed.points.length,
      bounds: parsed.bounds,
      sizeBytes: await getDirectorySize(targetDir),
    };
  } catch (error) {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
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

  const accumulator = createPointCloudAccumulator();
  const sourceFiles = [];
  let imageFileCount = imageFiles.length;
  for (const file of cloudFiles) {
    const originalName = file.originalName || file.originalname || path.basename(file.path);
    const parsed = await parsePointCloud(file.path, originalName);
    accumulator.mergePointCloud(parsed);
    sourceFiles.push(...(parsed.sourceFiles || [originalName]));
    imageFileCount += parsed.imageFileCount || 0;
  }
  const parsed = accumulator.finalize();
  parsed.sourceFiles = sourceFiles;
  parsed.imageFileCount = imageFileCount;

  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(stagingDir, 'map_images'), { recursive: true });
  await fsp.mkdir(path.join(stagingDir, 'sources'), { recursive: true });
  try {
    const payload = {
      type: 'point_cloud',
      version: 1,
      sourceFile: sourceFiles[0] || mapName,
      sourceFiles: parsed.sourceFiles || sourceFiles,
      imageFileCount: parsed.imageFileCount || 0,
      pointCount: parsed.totalPointCount,
      renderedPointCount: parsed.points.length,
      center: parsed.center,
      bounds: parsed.bounds,
      points: parsed.points,
    };
    await fsp.writeFile(path.join(stagingDir, 'map_images', 'tiles.json'), JSON.stringify(payload), 'utf8');
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const originalName = file.originalName || file.originalname || `source-${index}`;
      const safeName = `${index}-${path.basename(originalName) || 'source'}`;
      await fsp.copyFile(file.path, path.join(stagingDir, 'sources', safeName));
    }
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.rename(stagingDir, targetDir);
    return {
      mapName,
      path: targetDir,
      pointCount: parsed.totalPointCount,
      renderedPointCount: parsed.points.length,
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
  importBaseMapZip,
  importPointCloudBaseMap,
  importPointCloudFilesBaseMap,
  importMapPackageZip,
  convertEditorMap,
  createBaseMap,
  deployReleasedMap,
  deployLatestReleasedMap,
};

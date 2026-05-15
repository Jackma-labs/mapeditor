const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const WebSocket = require('ws');

const config = require('./config');
const runtime = require('./runtime');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const dataRoot = path.resolve(config.baseMapRoot, '..');
const importTmpRoot = path.join(dataRoot, 'import_tmp');
const runtimeJobRoot = path.join(dataRoot, 'runtime_jobs');
fs.mkdirSync(importTmpRoot, { recursive: true });
fs.mkdirSync(runtimeJobRoot, { recursive: true });
const upload = multer({
  dest: importTmpRoot,
  limits: {
    fileSize: config.uploadFileSizeBytes,
  },
});

if (fs.existsSync(config.frontendBuildRoot)) {
  app.use(express.static(config.frontendBuildRoot));
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/plugins/map' });

let lastAccessedBaseMapDir = null;

const BASE_MAP_LAYER_DIRS = {
  enhanced: 'map_images',
  raw: 'map_images_raw',
  ground: 'map_images_ground',
  marking: 'map_images_marking',
  edge: 'map_images_edge',
  structure: 'map_images_structure',
};

function getBaseMapLayerDir(layer = 'enhanced') {
  return BASE_MAP_LAYER_DIRS[layer] || null;
}
const runtimeJobs = new Map();
const HEAVY_RUNTIME_JOB_TYPES = new Set([
  'import-data-package-base-map',
  'import-data-packages-merged-base-map',
]);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function buildRuntimeJobPath(jobId) {
  return path.join(runtimeJobRoot, `${jobId}.json`);
}

function buildRuntimeJobLogPath(jobId) {
  return path.join(runtimeJobRoot, `${jobId}.log`);
}

function readRuntimeJobLogs(jobId, tail = 200) {
  const logPath = buildRuntimeJobLogPath(jobId);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(Number(tail) || 200, 1000))).map((line) => {
    try {
      return JSON.parse(line);
    } catch (_error) {
      return { time: '', level: 'info', message: line };
    }
  });
}

function serializeRuntimeJob(job, options = {}) {
  const payload = {
    id: job.id,
    type: job.type,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    request: job.request || null,
    result: job.result || null,
    error: job.error || null,
    logPath: buildRuntimeJobLogPath(job.id),
  };
  if (options.includeLogs) {
    payload.logs = readRuntimeJobLogs(job.id, options.tail);
  }
  return payload;
}

async function persistRuntimeJob(job) {
  job.updatedAt = new Date().toISOString();
  await fsp.mkdir(runtimeJobRoot, { recursive: true });
  await fsp.writeFile(buildRuntimeJobPath(job.id), JSON.stringify(serializeRuntimeJob(job), null, 2), 'utf8');
}

async function appendRuntimeJobLog(job, message, level = 'info') {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
  };
  await fsp.mkdir(runtimeJobRoot, { recursive: true });
  await fsp.appendFile(buildRuntimeJobLogPath(job.id), `${JSON.stringify(entry)}\n`, 'utf8');
  job.lastLog = entry;
  await persistRuntimeJob(job);
}

async function updateRuntimeJobProgress(job, message, level = 'info') {
  job.message = message;
  await appendRuntimeJobLog(job, message, level);
}

function loadRuntimeJobs() {
  const files = fs.readdirSync(runtimeJobRoot).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(runtimeJobRoot, file), 'utf8');
      const job = JSON.parse(raw);
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.message = 'Server restarted before the job finished';
        job.error = { message: job.message };
        job.finishedAt = job.finishedAt || new Date().toISOString();
        fs.writeFileSync(path.join(runtimeJobRoot, file), JSON.stringify(job, null, 2), 'utf8');
        fs.appendFileSync(
          buildRuntimeJobLogPath(job.id),
          `${JSON.stringify({ time: new Date().toISOString(), level: 'error', message: job.message })}\n`,
          'utf8'
        );
      }
      runtimeJobs.set(job.id, job);
    } catch (error) {
      log('Failed to load runtime job:', file, error);
    }
  }
}

function listRuntimeJobs() {
  return Array.from(runtimeJobs.values())
    .map((job) => serializeRuntimeJob(job))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function isActiveRuntimeJob(job) {
  return job?.status === 'queued' || job?.status === 'running';
}

function findActiveHeavyRuntimeJob() {
  for (const job of runtimeJobs.values()) {
    if (isActiveRuntimeJob(job) && HEAVY_RUNTIME_JOB_TYPES.has(job.type)) {
      return job;
    }
  }
  return null;
}

function sendRuntimeJobBusy(res, activeJob) {
  res.status(409).json({
    code: 15066,
    message: `A base-map generation job is already running: ${activeJob.id}`,
    data: {
      job: serializeRuntimeJob(activeJob),
    },
  });
}

async function removeRuntimeJobFiles(jobId) {
  await Promise.all([
    fsp.rm(buildRuntimeJobPath(jobId), { force: true }),
    fsp.rm(buildRuntimeJobLogPath(jobId), { force: true }),
  ]);
}

function sanitizeUploadFileName(name, index) {
  const base = path.basename(String(name || `upload-${index}`))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 180);
  return `${index}-${base || 'upload'}`;
}

function formatBytes(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const power = Math.min(Math.floor(Math.log(numberValue) / Math.log(1024)), units.length - 1);
  return `${(numberValue / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

async function assertZipHasEndOfCentralDirectory(filePath, displayName) {
  const stat = await fsp.stat(filePath);
  const minZipSize = 22;
  if (stat.size < minZipSize) {
    throw new Error(`ZIP 文件不完整：${displayName} 只有 ${formatBytes(stat.size)}，请重新打包后上传。`);
  }
  const maxCommentBytes = 65535;
  const readSize = Math.min(stat.size, minZipSize + maxCommentBytes);
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, stat.size - readSize);
    for (let index = buffer.length - minZipSize; index >= 0; index -= 1) {
      if (
        buffer[index] === 0x50 &&
        buffer[index + 1] === 0x4b &&
        buffer[index + 2] === 0x05 &&
        buffer[index + 3] === 0x06
      ) {
        return;
      }
    }
  } finally {
    await handle.close();
  }
  throw new Error(
    `ZIP 文件尾部不完整或不是标准 ZIP：${displayName}。服务器收到 ${formatBytes(
      stat.size
    )}，但没有找到中央目录结束标记。请确认上传没有中断、不是分卷 ZIP，并重新打包上传。`
  );
}

async function validateUploadedFiles(uploadedFiles) {
  for (const file of uploadedFiles) {
    if (!file?.path) {
      continue;
    }
    const stat = await fsp.stat(file.path);
    if (file.size && stat.size !== file.size) {
      throw new Error(
        `上传文件大小不一致：${file.originalname || file.filename}，浏览器报告 ${formatBytes(
          file.size
        )}，服务器收到 ${formatBytes(stat.size)}。请重新上传。`
      );
    }
    if (path.extname(file.originalname || file.filename || '').toLowerCase() === '.zip') {
      await assertZipHasEndOfCentralDirectory(file.path, file.originalname || file.filename || file.path);
    }
  }
}

async function moveUploadedFilesToJobDir(jobId, uploadedFiles) {
  const jobTmpDir = path.join(importTmpRoot, `job-${jobId}`);
  await fsp.mkdir(jobTmpDir, { recursive: true });
  const files = [];
  for (let index = 0; index < uploadedFiles.length; index += 1) {
    const file = uploadedFiles[index];
    const targetPath = path.join(jobTmpDir, sanitizeUploadFileName(file.originalname, index));
    try {
      await fsp.rename(file.path, targetPath);
    } catch (_error) {
      await fsp.copyFile(file.path, targetPath);
      await fsp.unlink(file.path).catch(() => {});
    }
    files.push({
      path: targetPath,
      originalName: file.originalname,
    });
  }
  return {
    jobTmpDir,
    files,
  };
}

function pruneRuntimeJobs() {
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [jobId, job] of runtimeJobs.entries()) {
    const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : null;
    if (finishedAt && now - finishedAt > maxAgeMs) {
      runtimeJobs.delete(jobId);
      removeRuntimeJobFiles(jobId).catch(() => {});
    }
  }
}

function startRuntimeJob(type, runner, request = null) {
  pruneRuntimeJobs();
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    status: 'queued',
    message: 'Queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    request,
    result: null,
    error: null,
  };
  runtimeJobs.set(job.id, job);
  persistRuntimeJob(job).catch((error) => log(`Persist runtime job ${job.id} failed:`, error));
  appendRuntimeJobLog(job, 'Queued').catch(() => {});
  setImmediate(async () => {
    job.status = 'running';
    job.message = 'Running';
    job.startedAt = new Date().toISOString();
    await appendRuntimeJobLog(job, 'Running');
    try {
      job.result = await runner(job);
      job.status = 'succeeded';
      job.message = 'Success';
      await appendRuntimeJobLog(job, 'Success');
    } catch (error) {
      log(`Runtime job ${job.id} failed:`, error);
      job.status = 'failed';
      job.message = error.message;
      job.error = {
        message: error.message,
      };
      await appendRuntimeJobLog(job, error.message, 'error');
    } finally {
      job.finishedAt = new Date().toISOString();
      await persistRuntimeJob(job);
    }
  });
  return job;
}

loadRuntimeJobs();

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

async function ensureDir(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

async function listBaseMaps() {
  try {
    const entries = await fsp.readdir(config.baseMapRoot, {
      withFileTypes: true,
    });
    const results = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const mapName = entry.name;
      const tileJson = path.join(
        config.baseMapRoot,
        mapName,
        'map_images',
        'tiles.json'
      );
      if (await pathExists(tileJson)) {
        results.push(mapName);
      }
    }
    results.sort();
    return results;
  } catch (error) {
    log('Failed to list base maps:', error);
    return [];
  }
}

async function listEditorMaps() {
  try {
    await ensureDir(config.editorMapRoot);
    const entries = await fsp.readdir(config.editorMapRoot, {
      withFileTypes: true,
    });
    const results = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(entry.name.replace(/\.json$/i, ''));
      }
    }
    results.sort();
    return results;
  } catch (error) {
    log('Failed to list editor maps:', error);
    return [];
  }
}

function buildEditorMapPath(mapName) {
  return path.join(config.editorMapRoot, `${mapName}.json`);
}

async function loadEditorMap(mapName) {
  const filePath = buildEditorMapPath(mapName);
  const content = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function saveEditorMap(mapName, data) {
  await ensureDir(config.editorMapRoot);
  const filePath = buildEditorMapPath(mapName);
  const content = JSON.stringify(data, null, 2);
  await fsp.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function prepareReleaseDir(mapName, allowOverwrite) {
  const releaseDir = path.join(config.releaseRoot, mapName);
  if (await pathExists(releaseDir)) {
    if (!allowOverwrite) {
      return { exists: true, dir: releaseDir };
    }
    await fsp.rm(releaseDir, { recursive: true, force: true });
  }
  await ensureDir(releaseDir);
  return { exists: false, dir: releaseDir };
}

function sendWsResponse(ws, requestId, info) {
  const payload = {
    action: 'response',
    data: {
      requestId,
      info,
    },
  };
  ws.send(JSON.stringify(payload));
}

async function handleGetBaseMapDir(ws, requestId) {
  const mapList = await listBaseMaps();
  sendWsResponse(ws, requestId, {
    code: 0,
    message: 'Success',
    data: { map_list: mapList },
  });
}

async function handleGetMapFileList(ws, requestId) {
  const mapList = await listEditorMaps();
  sendWsResponse(ws, requestId, {
    code: 0,
    message: 'Success',
    data: { map_list: mapList },
  });
}

async function handleOpenMapFile(ws, requestId, info) {
  info = info || {};
  try {
    const { mapName } = info;
    if (!mapName) {
      throw new Error('Missing mapName');
    }
    const map = await loadEditorMap(mapName);
    sendWsResponse(ws, requestId, {
      code: 0,
      message: 'Success',
      data: { map },
    });
  } catch (error) {
    log('OpenMapFile failed:', error);
    sendWsResponse(ws, requestId, {
      code: 15010,
      message: `加载标注地图失败: ${error.message}`,
    });
  }
}

async function handleSaveMapFile(ws, requestId, info) {
  info = info || {};
  const { mapName, map, ifCheckFileDuplicated } = info || {};
  if (!mapName || !map) {
    sendWsResponse(ws, requestId, {
      code: 15011,
      message: '保存地图缺少必要参数',
    });
    return;
  }
  try {
    const filePath = buildEditorMapPath(mapName);
    const exists = await pathExists(filePath);
    if (exists && ifCheckFileDuplicated) {
      sendWsResponse(ws, requestId, {
        code: 15007,
        message: '文件已存在，需确认覆盖',
      });
      return;
    }
    await saveEditorMap(mapName, map);
    sendWsResponse(ws, requestId, {
      code: 0,
      message: 'Success',
      data: { mapName },
    });
  } catch (error) {
    log('SaveMapFile failed:', error);
    sendWsResponse(ws, requestId, {
      code: 15012,
      message: `保存地图失败: ${error.message}`,
    });
  }
}

async function runConverter(mapName, jsonPath, releaseDir) {
  const baseMapDir =
    lastAccessedBaseMapDir &&
    (await pathExists(lastAccessedBaseMapDir))
      ? lastAccessedBaseMapDir
      : null;
  log(`Launching converter for ${mapName} with ${config.runtimeMode} runtime`);
  return runtime.convertEditorMap(config, {
    mapName,
    jsonPath,
    releaseDir,
    baseMapDir,
  });
}

async function handleReleaseMapFile(ws, requestId, info) {
  info = info || {};
  const { mapName, map, ifCheckFileDuplicated } = info || {};
  if (!mapName || !map) {
    sendWsResponse(ws, requestId, {
      code: 15013,
      message: '发布地图缺少必要参数',
    });
    return;
  }
  try {
    await ensureDir(config.releaseRoot);
    const { exists, dir } = await prepareReleaseDir(
      mapName,
      !ifCheckFileDuplicated
    );
    if (exists && ifCheckFileDuplicated) {
      sendWsResponse(ws, requestId, {
        code: 15017,
        message: '发布目录已存在，需确认覆盖',
      });
      return;
    }
    const jsonPath = await saveEditorMap(mapName, map);
    const result = await runConverter(mapName, jsonPath, dir);
    sendWsResponse(ws, requestId, {
      code: 0,
      message: 'Success',
      data: {
        mapName,
        output_dir: dir,
        stdout: result.stdout.trim(),
      },
    });
  } catch (error) {
    log('ReleaseMapFile failed:', error);
    sendWsResponse(ws, requestId, {
      code: 15018,
      message: `发布地图失败: ${error.message}`,
    });
  }
}

function handleGetAccountMapToolInfo(ws, requestId) {
  sendWsResponse(ws, requestId, {
    code: 0,
    message: 'Success',
    data: {
      mapEditorPrerogative: {
        status: 0,
        expireTime: null,
      },
    },
  });
}

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      log('Received invalid JSON message:', raw);
      return;
    }
    const { type, data: payload } = message;
    const requestId = payload && payload.requestId;
    if (!requestId) {
      log('Missing requestId in message:', message);
      return;
    }
    try {
      switch (type) {
        case 'GetBaseMapDir':
          await handleGetBaseMapDir(ws, requestId);
          break;
        case 'GetMapFileList':
          await handleGetMapFileList(ws, requestId);
          break;
        case 'OpenMapFile':
          await handleOpenMapFile(ws, requestId, payload ? payload.info : undefined);
          break;
        case 'SaveMapFile':
          await handleSaveMapFile(ws, requestId, payload ? payload.info : undefined);
          break;
        case 'ReleaseMapFile':
          await handleReleaseMapFile(ws, requestId, payload ? payload.info : undefined);
          break;
        case 'GetAccountMapToolInfo':
          handleGetAccountMapToolInfo(ws, requestId);
          break;
        default:
          log('Unhandled message type:', type);
          sendWsResponse(ws, requestId, {
            code: 404,
            message: `Unknown request type: ${type}`,
          });
          break;
      }
    } catch (error) {
      log('Error handling websocket message:', error);
      sendWsResponse(ws, requestId, {
        code: 15099,
        message: `服务端异常: ${error.message}`,
      });
    }
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/config', (_req, res) => {
  res.json({
    port: config.port,
    baseMapRoot: config.baseMapRoot,
    editorMapRoot: config.editorMapRoot,
    releaseRoot: config.releaseRoot,
    converterBinary: config.converterBinary,
    converterAvailable: fs.existsSync(config.converterBinary),
    frontendBuildRoot: config.frontendBuildRoot,
    frontendAvailable: fs.existsSync(config.frontendBuildRoot),
    runtimeMode: config.runtimeMode,
    runtimeDockerContainer: config.runtimeDockerContainer,
    edgeDeploy: config.edgeDeploy,
  });
});

app.get('/runtime/status', async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: 'Success',
      data: await runtime.getStatus(config),
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

app.get('/runtime/doctor', async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: 'Success',
      data: await runtime.getRuntimeDoctor(config),
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

app.get('/runtime/released-maps', async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: 'Success',
      data: {
        maps: await runtime.listReleasedMaps(config),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
});

app.post('/runtime/import-base-map', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('file is required');
    }
    await validateUploadedFiles([req.file]);
    const result = await runtime.importBaseMapZip(config, {
      zipPath: req.file.path,
      mapName: req.body.mapName,
      overwrite: req.body.overwrite === 'true',
    });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Import base map failed:', error);
    res.status(500).json({
      code: 15050,
      message: error.message,
    });
  } finally {
    if (req.file && req.file.path) {
      fsp.unlink(req.file.path).catch(() => {});
    }
  }
});

app.post('/runtime/import-point-cloud-base-map', upload.any(), async (req, res) => {
  try {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    if (uploadedFiles.length === 0) {
      throw new Error('file is required');
    }
    await validateUploadedFiles(uploadedFiles);
    const result =
      uploadedFiles.length === 1
        ? await runtime.importPointCloudBaseMap(config, {
            cloudPath: uploadedFiles[0].path,
            originalName: uploadedFiles[0].originalname,
            mapName: req.body.mapName,
            overwrite: req.body.overwrite === 'true',
          })
        : await runtime.importPointCloudFilesBaseMap(config, {
            files: uploadedFiles.map((file) => ({
              path: file.path,
              originalName: file.originalname,
            })),
            mapName: req.body.mapName,
            overwrite: req.body.overwrite === 'true',
          });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Import point cloud base map failed:', error);
    res.status(500).json({
      code: 15052,
      message: error.message,
    });
  } finally {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    for (const file of uploadedFiles) {
      if (file && file.path) {
        fsp.unlink(file.path).catch(() => {});
      }
    }
  }
});

app.post('/runtime/analyze-data-package', upload.any(), async (req, res) => {
  try {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    if (uploadedFiles.length === 0) {
      throw new Error('file is required');
    }
    await validateUploadedFiles(uploadedFiles);
    const result = await runtime.analyzeDataPackage(config, {
      files: uploadedFiles.map((file) => ({
        path: file.path,
        originalName: file.originalname,
      })),
      packageName: req.body.packageName,
    });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Analyze data package failed:', error);
    res.status(500).json({
      code: 15053,
      message: error.message,
    });
  } finally {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    for (const file of uploadedFiles) {
      if (file && file.path) {
        fsp.unlink(file.path).catch(() => {});
      }
    }
  }
});

app.post('/runtime/analyze-data-package-job', upload.any(), async (req, res) => {
  let staged = null;
  try {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    if (uploadedFiles.length === 0) {
      throw new Error('file is required');
    }
    await validateUploadedFiles(uploadedFiles);
    const stagingId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    staged = await moveUploadedFilesToJobDir(stagingId, uploadedFiles);
    const request = {
      packageName: req.body.packageName || '',
      fileCount: uploadedFiles.length,
      uploadedFiles: uploadedFiles.map((file) => file.originalname),
    };
    const job = startRuntimeJob(
      'analyze-data-package',
      async (runtimeJob) => {
        try {
          await appendRuntimeJobLog(runtimeJob, `Analyzing ${staged.files.length} uploaded file(s)`);
          return await runtime.analyzeDataPackage(config, {
            files: staged.files,
            packageName: req.body.packageName,
          });
        } finally {
          await fsp.rm(staged.jobTmpDir, { recursive: true, force: true }).catch(() => {});
        }
      },
      request
    );
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    log('Start analyze data package job failed:', error);
    if (staged?.jobTmpDir) {
      await fsp.rm(staged.jobTmpDir, { recursive: true, force: true }).catch(() => {});
    }
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    for (const file of uploadedFiles) {
      if (file && file.path) {
        await fsp.unlink(file.path).catch(() => {});
      }
    }
    res.status(500).json({
      code: 15057,
      message: error.message,
    });
  }
});

app.get('/runtime/data-packages', async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: 'Success',
      data: {
        packages: await runtime.listDataPackages(config),
      },
    });
  } catch (error) {
    log('List data packages failed:', error);
    res.status(500).json({
      code: 15054,
      message: error.message,
    });
  }
});

app.patch('/runtime/data-packages/:packageId', async (req, res) => {
  try {
    const result = await runtime.updateDataPackage(config, {
      ...(req.body || {}),
      packageId: req.params.packageId,
    });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Update data package failed:', error);
    res.status(500).json({
      code: 15060,
      message: error.message,
    });
  }
});

app.delete('/runtime/data-packages/:packageId', async (req, res) => {
  try {
    const result = await runtime.deleteDataPackage(config, {
      packageId: req.params.packageId,
    });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Delete data package failed:', error);
    res.status(500).json({
      code: 15061,
      message: error.message,
    });
  }
});

app.post('/runtime/refresh-data-package-analysis-job', async (req, res) => {
  try {
    const body = req.body || {};
    const job = startRuntimeJob('refresh-data-package-analysis', () =>
      runtime.refreshDataPackageAnalysis(config, body),
      {
        packageId: body.packageId || '',
      }
    );
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    log('Start refresh data package analysis job failed:', error);
    res.status(500).json({
      code: 15058,
      message: error.message,
    });
  }
});

app.post('/runtime/refresh-all-data-package-analysis-job', async (req, res) => {
  try {
    const body = req.body || {};
    const onlyMissing = body.onlyMissing !== false;
    const job = startRuntimeJob(
      'refresh-all-data-package-analysis',
      async (runtimeJob) => {
        const packages = await runtime.listDataPackages(config);
        const targets = onlyMissing
          ? packages.filter((item) => item.workflowStatus?.code === 'pending_precheck')
          : packages;
        const results = [];
        await appendRuntimeJobLog(runtimeJob, `Refreshing ${targets.length} package(s)`);
        for (const item of targets) {
          await appendRuntimeJobLog(runtimeJob, `Prechecking ${item.packageId}`);
          const result = await runtime.refreshDataPackageAnalysis(config, {
            packageId: item.packageId,
          });
          results.push({
            packageId: item.packageId,
            summary: result.summary,
          });
        }
        return {
          refreshedCount: results.length,
          skippedCount: packages.length - targets.length,
          results,
        };
      },
      {
        onlyMissing,
      }
    );
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    log('Start refresh all data packages analysis job failed:', error);
    res.status(500).json({
      code: 15062,
      message: error.message,
    });
  }
});

app.post('/runtime/data-package-stitch-plan', async (req, res) => {
  try {
    const body = req.body || {};
    const packageIds = Array.isArray(body.packageIds) ? body.packageIds : [];
    const result = await runtime.buildDataPackageStitchPlan(config, packageIds);
    res.status(result.ready ? 200 : 409).json({
      code: result.ready ? 0 : 15063,
      message: result.ready ? 'Success' : 'Selected packages cannot be merged safely',
      data: result,
    });
  } catch (error) {
    log('Build data package stitch plan failed:', error);
    res.status(500).json({
      code: 15063,
      message: error.message,
    });
  }
});

app.post('/runtime/import-data-package-base-map', async (req, res) => {
  try {
    const result = await runtime.importDataPackageBaseMap(config, req.body || {});
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Import data package base map failed:', error);
    res.status(500).json({
      code: 15055,
      message: error.message,
    });
  }
});

app.post('/runtime/import-data-package-base-map-job', async (req, res) => {
  try {
    const body = req.body || {};
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const job = startRuntimeJob('import-data-package-base-map', (runtimeJob) =>
      runtime.importDataPackageBaseMap(config, {
        ...body,
        progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
      }),
      {
        packageId: body.packageId || '',
        mapName: body.mapName || '',
        overwrite: body.overwrite === true,
      }
    );
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    log('Start data package import job failed:', error);
    res.status(500).json({
      code: 15056,
      message: error.message,
    });
  }
});

app.post('/runtime/import-data-packages-merged-base-map-job', async (req, res) => {
  try {
    const body = req.body || {};
    const packageIds = Array.isArray(body.packageIds) ? body.packageIds : [];
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const job = startRuntimeJob('import-data-packages-merged-base-map', (runtimeJob) =>
      runtime.importMergedDataPackagesBaseMap(config, {
        ...body,
        progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
      }),
      {
        packageIds,
        mapName: body.mapName || '',
        overwrite: body.overwrite === true,
      }
    );
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    log('Start merged data package import job failed:', error);
    res.status(500).json({
      code: 15059,
      message: error.message,
    });
  }
});

app.get('/runtime/jobs', (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  res.json({
    code: 0,
    message: 'Success',
    data: {
      jobs: listRuntimeJobs().slice(0, limit),
    },
  });
});

app.get('/runtime/jobs/:jobId', (req, res) => {
  const job = runtimeJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({
      code: 404,
      message: `job not found: ${req.params.jobId}`,
    });
    return;
  }
  res.json({
    code: 0,
    message: 'Success',
    data: {
      job: serializeRuntimeJob(job, {
        includeLogs: req.query.logs === 'true',
        tail: req.query.tail,
      }),
    },
  });
});

app.get('/runtime/jobs/:jobId/logs', (req, res) => {
  if (!runtimeJobs.has(req.params.jobId)) {
    res.status(404).json({
      code: 404,
      message: `job not found: ${req.params.jobId}`,
    });
    return;
  }
  res.json({
    code: 0,
    message: 'Success',
    data: {
      logs: readRuntimeJobLogs(req.params.jobId, req.query.tail),
    },
  });
});

app.post('/runtime/import-map-package', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('file is required');
    }
    await validateUploadedFiles([req.file]);
    const result = await runtime.importMapPackageZip(config, {
      zipPath: req.file.path,
      mapName: req.body.mapName,
      overwrite: req.body.overwrite === 'true',
    });
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    log('Import map package failed:', error);
    res.status(500).json({
      code: 15051,
      message: error.message,
    });
  } finally {
    if (req.file && req.file.path) {
      fsp.unlink(req.file.path).catch(() => {});
    }
  }
});

app.get('/runtime/deploy-config', (_req, res) => {
  res.json({
    code: 0,
    message: 'Success',
    data: runtime.getDeployConfig(config),
  });
});

app.post('/runtime/discover-edge-map-root', async (req, res) => {
  try {
    const result = await runtime.discoverEdgeMapRoot(config, req.body || {});
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 15064,
      message: error.message,
    });
  }
});

app.post('/runtime/configure-edge-deploy', async (req, res) => {
  try {
    const result = await runtime.configureEdgeDeploy(config, req.body || {});
    const preflight = await runtime.preflightEdgeDeploy(config);
    res.status(preflight.ready ? 200 : 409).json({
      code: preflight.ready ? 0 : 15065,
      message: preflight.ready ? 'Success' : 'Edge deploy config saved, but preflight failed',
      data: {
        ...result,
        preflight,
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15065,
      message: error.message,
    });
  }
});

app.get('/runtime/deployments', async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: 'Success',
      data: {
        deployments: await runtime.listDeployments(config),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15046,
      message: error.message,
    });
  }
});

app.post('/runtime/preflight-deploy', async (_req, res) => {
  try {
    const result = await runtime.preflightEdgeDeploy(config);
    res.status(result.ready ? 200 : 500).json({
      code: result.ready ? 0 : 15042,
      message: result.ready ? 'Success' : 'Preflight failed',
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 15042,
      message: error.message,
      data: error.result || null,
    });
  }
});

app.post('/runtime/create-base-map', async (req, res) => {
  try {
    const result = await runtime.createBaseMap(config, req.body || {});
    res.json({
      code: 0,
      message: 'Success',
      data: {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15030,
      message: error.message,
      data: error.result || null,
    });
  }
});

app.post('/runtime/deploy-map-job', async (req, res) => {
  try {
    const body = req.body || {};
    const job = startRuntimeJob('deploy-map', () => runtime.deployReleasedMap(config, body), {
      mapName: body.mapName || '',
    });
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15047,
      message: error.message,
    });
  }
});

app.post('/runtime/deploy-latest-job', async (_req, res) => {
  try {
    const job = startRuntimeJob('deploy-latest', () => runtime.deployLatestReleasedMap(config), {});
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15048,
      message: error.message,
    });
  }
});

app.post('/runtime/rollback-deployment-job', async (req, res) => {
  try {
    const body = req.body || {};
    const job = startRuntimeJob('rollback-deployment', () => runtime.rollbackDeployment(config, body), {
      deploymentId: body.deploymentId || '',
      mapName: body.mapName || '',
    });
    res.status(202).json({
      code: 0,
      message: 'Accepted',
      data: {
        job: serializeRuntimeJob(job),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15049,
      message: error.message,
    });
  }
});

app.post('/runtime/deploy-map', async (req, res) => {
  try {
    const result = await runtime.deployReleasedMap(config, req.body || {});
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 15040,
      message: error.message,
      data: error.result || null,
    });
  }
});

app.post('/runtime/deploy-latest', async (_req, res) => {
  try {
    const result = await runtime.deployLatestReleasedMap(config);
    res.json({
      code: 0,
      message: 'Success',
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      code: 15041,
      message: error.message,
      data: error.result || null,
    });
  }
});

app.get('/mapcreator/:mapName/tiles.json', async (req, res) => {
  const { mapName } = req.params;
  const tilePath = path.join(
    config.baseMapRoot,
    mapName,
    'map_images',
    'tiles.json'
  );
  if (!(await pathExists(tilePath))) {
    res
      .status(404)
      .json({ code: 404, message: `tiles.json not found for ${mapName}` });
    return;
  }
  try {
    const content = await fsp.readFile(tilePath, 'utf8');
    lastAccessedBaseMapDir = path.join(config.baseMapRoot, mapName);
    res.set('Access-Control-Allow-Origin', '*');
    res.type('application/json').send(content);
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

app.get('/mapcreator/:mapName/layers/:layer/tiles.json', async (req, res) => {
  const { mapName, layer } = req.params;
  const layerDir = getBaseMapLayerDir(layer);
  if (!layerDir) {
    res.status(404).json({ code: 404, message: `unknown base map layer: ${layer}` });
    return;
  }
  const tilePath = path.join(config.baseMapRoot, mapName, layerDir, 'tiles.json');
  if (!(await pathExists(tilePath))) {
    res.status(404).json({ code: 404, message: `tiles.json not found for ${mapName}/${layer}` });
    return;
  }
  try {
    const payload = JSON.parse((await fsp.readFile(tilePath, 'utf8')).replace(/^\uFEFF/, ''));
    payload.layerId = layer;
    lastAccessedBaseMapDir = path.join(config.baseMapRoot, mapName);
    res.set('Access-Control-Allow-Origin', '*');
    res.type('application/json').send(JSON.stringify(payload));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

app.get('/mapcreator/:mapName/:level/proj.png', async (req, res) => {
  const { mapName, level } = req.params;
  const pngPath = path.join(
    config.baseMapRoot,
    mapName,
    'traffic_light_data',
    level,
    'proj.png'
  );
  if (!(await pathExists(pngPath))) {
    res.status(404).send('Not Found');
    return;
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.sendFile(pngPath);
});

app.get('/mapcreator/:mapName/source_images/:file', async (req, res) => {
  const { mapName, file } = req.params;
  const imagePath = path.join(config.baseMapRoot, mapName, 'source_images', file);
  if (!(await pathExists(imagePath))) {
    res.status(404).send('Not Found');
    return;
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.sendFile(imagePath);
});

app.get('/mapcreator/:mapName/image_index.json', async (req, res) => {
  const { mapName } = req.params;
  const indexPath = path.join(config.baseMapRoot, mapName, 'image_index.json');
  if (!(await pathExists(indexPath))) {
    res.status(404).json({ code: 404, message: `image_index.json not found for ${mapName}` });
    return;
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.sendFile(indexPath);
});

app.get('/mapcreator/:mapName/layers/:layer/:level/:y/:file', async (req, res) => {
  const { mapName, layer, level, y, file } = req.params;
  const layerDir = getBaseMapLayerDir(layer);
  if (!layerDir) {
    res.status(404).send('Not Found');
    return;
  }
  const pngPath = path.join(config.baseMapRoot, mapName, layerDir, level, y, file);
  if (!(await pathExists(pngPath))) {
    res.status(404).send('Not Found');
    return;
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.sendFile(pngPath);
});

app.get('/mapcreator/:mapName/:level/:y/:file', async (req, res) => {
  const { mapName, level, y, file } = req.params;
  const pngPath = path.join(
    config.baseMapRoot,
    mapName,
    'map_images',
    level,
    y,
    file
  );
  if (!(await pathExists(pngPath))) {
    res.status(404).send('Not Found');
    return;
  }
  res.set('Access-Control-Allow-Origin', '*');
  res.sendFile(pngPath);
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/mapcreator/') || req.path === '/healthz') {
    next();
    return;
  }
  const indexPath = path.join(config.frontendBuildRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
    return;
  }
  res.status(404).json({
    code: 404,
    message:
      'Frontend build not found. Run npm run build in frontend or use npm run dev.',
  });
});

server.listen(config.port, async () => {
  await Promise.all([
    ensureDir(config.baseMapRoot),
    ensureDir(config.editorMapRoot),
    ensureDir(config.releaseRoot),
  ]);
  log(`Simple map backend listening on ${config.port}`);
  log('Base map root:', config.baseMapRoot);
  log('Editor map root:', config.editorMapRoot);
  log('Release root:', config.releaseRoot);
  log('Converter binary:', config.converterBinary);
  log('Frontend build root:', config.frontendBuildRoot);
});

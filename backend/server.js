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

const importTmpRoot = path.join(config.baseMapRoot, '..', 'import_tmp');
fs.mkdirSync(importTmpRoot, { recursive: true });
const upload = multer({
  dest: importTmpRoot,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024,
  },
});

if (fs.existsSync(config.frontendBuildRoot)) {
  app.use(express.static(config.frontendBuildRoot));
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/plugins/map' });

let lastAccessedBaseMapDir = null;
const runtimeJobs = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function serializeRuntimeJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result || null,
    error: job.error || null,
  };
}

function pruneRuntimeJobs() {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [jobId, job] of runtimeJobs.entries()) {
    const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : null;
    if (finishedAt && now - finishedAt > maxAgeMs) {
      runtimeJobs.delete(jobId);
    }
  }
}

function startRuntimeJob(type, runner) {
  pruneRuntimeJobs();
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    status: 'queued',
    message: 'Queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  runtimeJobs.set(job.id, job);
  setImmediate(async () => {
    job.status = 'running';
    job.message = 'Running';
    job.startedAt = new Date().toISOString();
    try {
      job.result = await runner();
      job.status = 'succeeded';
      job.message = 'Success';
    } catch (error) {
      log(`Runtime job ${job.id} failed:`, error);
      job.status = 'failed';
      job.message = error.message;
      job.error = {
        message: error.message,
      };
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  });
  return job;
}

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
    const job = startRuntimeJob('import-data-package-base-map', () =>
      runtime.importDataPackageBaseMap(config, body)
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
      job: serializeRuntimeJob(job),
    },
  });
});

app.post('/runtime/import-map-package', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('file is required');
    }
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

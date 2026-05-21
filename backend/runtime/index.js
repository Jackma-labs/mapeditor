const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const https = require('https');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');
const unzipper = require('unzipper');
const { PNG } = require('pngjs');
const WebSocketClient = require('ws');
const { convertEditorMapToApolloPackage } = require('./editorMapConverter');
const { runCommand } = require('./process');
const { generateAssistDrawingCandidates } = require('./assistDrawingCandidates');

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
const APOLLOLITE_RUNTIME_FILE_GROUPS = [
  {
    name: 'base_map',
    candidates: ['base_map.bin', 'base_map.txt'],
  },
  {
    name: 'sim_map',
    candidates: ['sim_map.bin', 'sim_map.txt'],
  },
  {
    name: 'routing_map',
    candidates: ['routing_map.bin', 'routing_map.txt'],
  },
];
const APOLLOLITE_TRACE_FILES = ['editor_map.json'];
const APOLLOLITE_GLOBAL_FLAGFILE = 'modules/common/data/global_flagfile.txt';
const APOLLOLITE_CYBER_LAUNCH_CANDIDATES = [
  'bazel-bin/cyber/tools/cyber_launch/cyber_launch',
  'bazel-bin/cyber/tools/cyber_launch/cyber_launch.exe',
];
const APOLLOLITE_DREAMVIEW_CANDIDATES = [
  'bazel-bin/modules/dreamview/dreamview',
  'bazel-bin/modules/dreamview_plus/dreamview_plus',
];
const APOLLOLITE_MONITOR_CANDIDATES = [
  'bazel-bin/modules/monitor/libmonitor.so',
];
const APOLLOLITE_FRONTEND_ASSET_CANDIDATES = [
  'modules/dreamview/frontend/dist',
  'modules/dreamview/frontend/build',
  'modules/dreamview_plus/frontend/dist',
  'modules/dreamview_plus/frontend/build',
];
const APOLLOLITE_SIMULATION_COMPONENTS = [
  {
    name: 'Routing',
    actionModule: 'Routing',
    candidates: ['bazel-bin/modules/routing/librouting_component.so'],
  },
  {
    name: 'Planning',
    actionModule: 'Planning',
    candidates: ['bazel-bin/modules/planning/libplanning_component.so'],
  },
  {
    name: 'Control',
    actionModule: 'Control',
    candidates: ['bazel-bin/modules/control/libcontrol_component.so'],
  },
];
const APOLLOLITE_DREAMVIEW_HTTP_TIMEOUT_MS = 1500;
const APOLLOLITE_DREAMVIEW_WS_TIMEOUT_MS = 5000;
const APOLLOLITE_SIM_MOTION_TIMEOUT_MS = 15000;
const APOLLOLITE_DREAMVIEW_RESTART_TIMEOUT_MS = 20000;

function normalizeZipOpenError(error, label) {
  const message = String(error?.message || error || '');
  if (
    /FILE_ENDED/i.test(message) ||
    /End-of-central-directory/i.test(message) ||
    /invalid zip/i.test(message) ||
    /central directory/i.test(message)
  ) {
    return new Error(
      `${label} 不是完整有效的 ZIP 文件。请确认压缩包已完整生成、上传没有中断、不是分卷 ZIP，然后重新上传。原始错误：${message}`
    );
  }
  return error;
}

async function openZipArchive(zipPath, label = 'ZIP 文件') {
  try {
    return await unzipper.Open.file(zipPath);
  } catch (error) {
    throw normalizeZipOpenError(error, label);
  }
}

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

function createConfigWithEdgeDeploy(config, edgeDeploy) {
  return {
    ...config,
    edgeDeploy: {
      ...config.edgeDeploy,
      ...edgeDeploy,
    },
  };
}

function normalizeEdgeDeployParams(config, params = {}) {
  const host = String(params.host ?? config.edgeDeploy.host ?? '').trim();
  const user = String(params.user ?? config.edgeDeploy.user ?? '').trim();
  const port = Number(params.port ?? config.edgeDeploy.port ?? 22) || 22;
  const targetMapRoot = String(params.targetMapRoot ?? config.edgeDeploy.targetMapRoot ?? '').trim();
  const postDeployCommand = String(params.postDeployCommand ?? config.edgeDeploy.postDeployCommand ?? '').trim();
  const mode = params.mode || (host && user ? 'ssh' : 'disabled');
  return {
    mode,
    host,
    user,
    port,
    targetMapRoot,
    postDeployCommand,
  };
}

function uniqueList(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function envQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:@-]*$/.test(text)) {
    return text;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function updateEnvServer(config, values) {
  if (!config.appRoot) {
    return null;
  }
  const envPath = path.join(config.appRoot, '.env.server');
  const existing = (await fsp.readFile(envPath, 'utf8').catch(() => '')).split(/\r?\n/);
  const keys = new Set(Object.keys(values));
  const lines = [];
  for (const line of existing) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && keys.has(match[1])) {
      continue;
    }
    if (line.length > 0) {
      lines.push(line);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${envQuote(value)}`);
  }
  await fsp.writeFile(envPath, `${lines.join('\n')}\n`, 'utf8');
  return envPath;
}

async function discoverEdgeMapRoot(config, params = {}) {
  const edgeDeploy = normalizeEdgeDeployParams(config, params);
  if (!edgeDeploy.host || !edgeDeploy.user) {
    throw new Error('edge host and user are required');
  }
  const deployConfig = createConfigWithEdgeDeploy(config, edgeDeploy);
  const candidates = uniqueList([
    edgeDeploy.targetMapRoot,
    '/apollo/modules/map/data',
    '/apollo/data/map',
    '/home/apollo/modules/map/data',
    '/opt/apollo/modules/map/data',
  ]);
  const candidateText = candidates.map((item) => quoteShell(item)).join(' ');
  const remoteCommand = [
    'set -e',
    `for d in ${candidateText}; do if [ -d "$d" ]; then printf '%s\\n' "$d"; exit 0; fi; done`,
    'for root in /apollo "$HOME/apollo" /opt/apollo; do if [ -d "$root" ] && mkdir -p "$root/modules/map/data" 2>/dev/null; then printf \'%s\\n\' "$root/modules/map/data"; exit 0; fi; done',
    'exit 2',
  ].join('; ');
  const result = await runCommand('ssh', [...buildSshBaseArgs(deployConfig), remoteCommand], {
    timeoutMs: 15000,
  });
  const targetMapRoot = result.stdout.trim().split(/\r?\n/).filter(Boolean)[0] || '';
  if (!targetMapRoot) {
    throw new Error('Apollo map root was not found on edge device');
  }
  return {
    targetMapRoot,
    candidates,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function configureEdgeDeploy(config, params = {}) {
  const next = normalizeEdgeDeployParams(config, params);
  let discovery = null;
  let discoveryError = null;
  if (next.mode !== 'disabled' && params.autoDiscover !== false) {
    try {
      discovery = await discoverEdgeMapRoot(config, next);
      next.targetMapRoot = discovery.targetMapRoot;
    } catch (error) {
      discoveryError = error.message;
      if (!next.targetMapRoot) {
        throw error;
      }
    }
  }
  config.edgeDeploy.mode = next.mode;
  config.edgeDeploy.host = next.host;
  config.edgeDeploy.user = next.user;
  config.edgeDeploy.port = next.port;
  config.edgeDeploy.targetMapRoot = next.targetMapRoot || '/apollo/modules/map/data';
  config.edgeDeploy.postDeployCommand = next.postDeployCommand;
  const envPath = await updateEnvServer(config, {
    MAP_EDGE_DEPLOY_MODE: config.edgeDeploy.mode,
    MAP_EDGE_HOST: config.edgeDeploy.host,
    MAP_EDGE_USER: config.edgeDeploy.user,
    MAP_EDGE_PORT: config.edgeDeploy.port,
    MAP_EDGE_TARGET_MAP_ROOT: config.edgeDeploy.targetMapRoot,
    MAP_EDGE_POST_DEPLOY_COMMAND: config.edgeDeploy.postDeployCommand,
  });
  return {
    deployConfig: getDeployConfig(config),
    discovery,
    discoveryError,
    envPath,
  };
}

function buildSshBaseArgs(config) {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
  ];
  if (config.edgeDeploy.port) {
    args.push('-p', String(config.edgeDeploy.port));
  }
  args.push(buildEdgeTarget(config));
  return args;
}

function buildScpBaseArgs(config) {
  const args = [];
  if (config.edgeDeploy.port) {
    args.push('-P', String(config.edgeDeploy.port));
  }
  return args;
}

function createDeploymentId(prefix = 'deploy') {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getDeploymentHistoryPath(config) {
  return path.join(path.resolve(config.releaseRoot, '..'), 'deployments', 'history.json');
}

async function readDeploymentHistory(config) {
  const historyPath = getDeploymentHistoryPath(config);
  if (!(await pathExists(historyPath))) {
    return [];
  }
  const content = await fsp.readFile(historyPath, 'utf8');
  const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
  return Array.isArray(parsed.records) ? parsed.records : [];
}

async function appendDeploymentRecord(config, record) {
  const historyPath = getDeploymentHistoryPath(config);
  await fsp.mkdir(path.dirname(historyPath), { recursive: true });
  const records = await readDeploymentHistory(config).catch(() => []);
  records.unshift(record);
  await fsp.writeFile(historyPath, JSON.stringify({ records: records.slice(0, 200) }, null, 2), 'utf8');
  return record;
}

async function listDeployments(config) {
  return readDeploymentHistory(config);
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

function getApolloLiteConfig(config) {
  const apolloLite = config.apolloLite || {};
  const root = String(apolloLite.root || '').trim();
  const mapRoot = String(apolloLite.mapRoot || (root ? path.join(root, 'modules/map/data') : '')).trim();
  return {
    enabled: apolloLite.enabled === true,
    root,
    mapRoot,
    dreamviewUrl: String(apolloLite.dreamviewUrl || 'http://127.0.0.1:8888').trim(),
    dreamviewProxyTarget: String(apolloLite.dreamviewProxyTarget || 'http://127.0.0.1:8888').trim(),
    dockerContainer: String(apolloLite.dockerContainer || '').trim(),
    autoStageOnRelease: apolloLite.autoStageOnRelease === true,
    validationCommand: String(apolloLite.validationCommand || '').trim(),
  };
}

async function probeHttpUrl(urlString, timeoutMs = APOLLOLITE_DREAMVIEW_HTTP_TIMEOUT_MS) {
  if (!urlString) {
    return {
      url: '',
      ok: false,
      message: 'Dreamview URL is not configured',
    };
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (error) {
    return {
      url: urlString,
      ok: false,
      error: error.message,
      message: `Invalid Dreamview URL: ${urlString}`,
    };
  }

  const client = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        finish({
          url: urlString,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          message: `HTTP ${res.statusCode}`,
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', (error) => {
      finish({
        url: urlString,
        ok: false,
        error: error.message,
        message: error.message,
      });
    });
    req.end();
  });
}

function mapApolloContainerPathToHost(root, targetPath) {
  if (!root || !targetPath) {
    return targetPath;
  }
  const normalized = targetPath.replace(/\\/gu, '/');
  if (normalized === '/apollo') {
    return root;
  }
  if (normalized.startsWith('/apollo/')) {
    return path.join(root, ...normalized.slice('/apollo/'.length).split('/').filter(Boolean));
  }
  return targetPath;
}

async function readMappedApolloLiteSymlink(root, linkPath) {
  try {
    const stat = await fsp.lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      return null;
    }
    const target = await fsp.readlink(linkPath);
    const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
    return mapApolloContainerPathToHost(root, resolved);
  } catch (error) {
    return null;
  }
}

async function findApolloLiteCandidate(root, candidates) {
  if (!root) {
    return null;
  }
  const bazelBinTarget = await readMappedApolloLiteSymlink(root, path.join(root, 'bazel-bin'));
  for (const candidate of candidates) {
    const fullPath = path.join(root, ...candidate.split('/'));
    if (await pathExists(fullPath)) {
      return fullPath;
    }
    const mappedSymlinkPath = await readMappedApolloLiteSymlink(root, fullPath);
    if (mappedSymlinkPath && await pathExists(mappedSymlinkPath)) {
      return mappedSymlinkPath;
    }
    if (bazelBinTarget && candidate.startsWith('bazel-bin/')) {
      const mappedBazelPath = path.join(bazelBinTarget, ...candidate.slice('bazel-bin/'.length).split('/'));
      if (await pathExists(mappedBazelPath)) {
        return mappedBazelPath;
      }
    }
  }
  return null;
}

async function findApolloLiteFrontendAssets(root) {
  if (!root) {
    return null;
  }
  const configuredPath = await findApolloLiteCandidate(root, APOLLOLITE_FRONTEND_ASSET_CANDIDATES);
  if (configuredPath) {
    return configuredPath;
  }
  for (const cacheName of ['bazel', 'bazel-dreamview']) {
    const cacheRoot = path.join(root, '.cache', cacheName);
    let outputBases = [];
    try {
      outputBases = await fsp.readdir(cacheRoot, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const outputBase of outputBases) {
      if (!outputBase.isDirectory()) {
        continue;
      }
      const externalRoot = path.join(cacheRoot, outputBase.name, 'external');
      let externalRepos = [];
      try {
        externalRepos = await fsp.readdir(externalRoot, { withFileTypes: true });
      } catch (error) {
        continue;
      }
      for (const externalRepo of externalRepos) {
        if (!externalRepo.isDirectory() || !externalRepo.name.includes('dreamview_frontend_assets')) {
          continue;
        }
        const assetPath = path.join(externalRoot, externalRepo.name, 'dist');
        if (await pathExists(assetPath)) {
          return assetPath;
        }
      }
    }
  }
  return null;
}

async function readApolloLiteDefaultMapFlag(root) {
  const flagfilePath = root ? path.join(root, ...APOLLOLITE_GLOBAL_FLAGFILE.split('/')) : '';
  if (!flagfilePath || !(await pathExists(flagfilePath))) {
    return {
      available: false,
      flagfilePath,
      mapDir: '',
      mapName: '',
    };
  }
  try {
    const content = await fsp.readFile(flagfilePath, 'utf8');
    const mapDirLine = content.split(/\r?\n/).find((line) => line.startsWith('--map_dir='));
    const mapDir = mapDirLine ? mapDirLine.slice('--map_dir='.length).trim() : '';
    return {
      available: true,
      flagfilePath,
      mapDir,
      mapName: mapDir ? path.basename(mapDir) : '',
    };
  } catch (error) {
    return {
      available: false,
      flagfilePath,
      mapDir: '',
      mapName: '',
      error: error.message,
    };
  }
}

async function getApolloLiteStatus(config) {
  const apolloLite = getApolloLiteConfig(config);
  const rootAvailable = apolloLite.root ? await pathExists(apolloLite.root) : false;
  const apolloShAvailable = apolloLite.root ? await pathExists(path.join(apolloLite.root, 'apollo.sh')) : false;
  const mapRootWritable = apolloLite.mapRoot ? await pathWritable(apolloLite.mapRoot) : false;
  const whlAvailable = process.platform === 'win32' ? false : await pathExists('/usr/local/bin/whl');
  const cyberLaunchPath = await findApolloLiteCandidate(apolloLite.root, APOLLOLITE_CYBER_LAUNCH_CANDIDATES);
  const dreamviewPath = await findApolloLiteCandidate(apolloLite.root, APOLLOLITE_DREAMVIEW_CANDIDATES);
  const monitorPath = await findApolloLiteCandidate(apolloLite.root, APOLLOLITE_MONITOR_CANDIDATES);
  const frontendAssetPath = await findApolloLiteFrontendAssets(apolloLite.root);
  const defaultMapFlag = await readApolloLiteDefaultMapFlag(apolloLite.root);
  const stagingReady = apolloLite.enabled && Boolean(apolloLite.mapRoot) && mapRootWritable;
  const dreamviewRuntimeAvailable = Boolean(cyberLaunchPath && dreamviewPath && frontendAssetPath);
  const dreamviewHttp = dreamviewRuntimeAvailable
    ? await probeHttpUrl(apolloLite.dreamviewUrl)
    : {
      url: apolloLite.dreamviewUrl,
      ok: false,
      message: 'Dreamview runtime is not built or configured',
    };
  const dreamviewHttpReady = Boolean(dreamviewHttp.ok);
  const simulationReady =
    stagingReady && (Boolean(apolloLite.validationCommand) || (dreamviewRuntimeAvailable && dreamviewHttpReady));
  const stagingMessage = !apolloLite.enabled
    ? 'ApolloLite staging is disabled'
    : !apolloLite.mapRoot
      ? 'ApolloLite mapRoot is not configured'
      : mapRootWritable
        ? 'ApolloLite staging map directory is writable'
        : `ApolloLite map directory is not writable: ${apolloLite.mapRoot}`;
  const simulationMessage = !apolloLite.enabled
    ? 'ApolloLite simulation is disabled'
    : !stagingReady
      ? 'ApolloLite map staging is not ready'
    : apolloLite.validationCommand
      ? 'ApolloLite validation command is configured'
        : dreamviewRuntimeAvailable && dreamviewHttpReady
          ? `ApolloLite Dreamview is reachable at ${apolloLite.dreamviewUrl}`
          : dreamviewRuntimeAvailable
            ? `ApolloLite Dreamview is built, but not reachable at ${apolloLite.dreamviewUrl}: ${dreamviewHttp.message || 'no response'}`
            : 'ApolloLite map staging is ready, but Dreamview runtime is not built or configured';
  return {
    ...apolloLite,
    rootAvailable,
    apolloShAvailable,
    mapRootWritable,
    whlAvailable,
    ready: stagingReady,
    stagingReady,
    simulationReady,
    dreamviewRuntimeAvailable,
    dreamviewHttpReady,
    dreamviewHttp,
    cyberLaunchAvailable: Boolean(cyberLaunchPath),
    dreamviewBinaryAvailable: Boolean(dreamviewPath),
    monitorAvailable: Boolean(monitorPath),
    frontendAssetsAvailable: Boolean(frontendAssetPath),
    cyberLaunchPath,
    dreamviewPath,
    monitorPath,
    frontendAssetPath,
    defaultMapFlag,
    defaultMapName: defaultMapFlag.mapName,
    validationCommandConfigured: Boolean(apolloLite.validationCommand),
    message: stagingMessage,
    stagingMessage,
    simulationMessage,
  };
}

async function getStatus(config) {
  const localConverterAvailable = await pathExists(config.converterBinary);
  const localConverterFallbackAvailable = true;
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
      converterFallbackAvailable: localConverterFallbackAvailable,
      tileMapCreatorBinary: config.tileMapCreatorBinary,
      tileMapCreatorAvailable: localTileCreatorAvailable,
    },
    docker,
    paths: {
      baseMapRoot: config.baseMapRoot,
      editorMapRoot: config.editorMapRoot,
      releaseRoot: config.releaseRoot,
      importPackageRoot: config.importPackageRoot,
      captureSourceRoot: config.captureSourceRoot || '',
      captureAutoSync: config.captureAutoSync || null,
      inboxAutoPrebuild: config.inboxAutoPrebuild || null,
      frontendBuildRoot: config.frontendBuildRoot,
      frontendAvailable,
      tileMapConfig: config.tileMapConfig,
      tileMapConfigAvailable,
    },
    edgeDeploy: {
      mode: config.edgeDeploy.mode,
      host: config.edgeDeploy.host,
      user: config.edgeDeploy.user,
      port: config.edgeDeploy.port,
      targetMapRoot: config.edgeDeploy.targetMapRoot,
      enabled: config.edgeDeploy.mode !== 'disabled',
    },
    apolloLite: await getApolloLiteStatus(config),
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
    const sizeBytes = await getDirectorySize(mapDir);
    const missingExpectedFiles = expectedFiles.filter((fileName) => !files.includes(fileName));
    const ready = missingExpectedFiles.length === 0 && sizeBytes > 0;
    maps.push({
      mapName,
      path: mapDir,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes,
      files,
      expectedFiles,
      missingExpectedFiles,
      ready,
      status: ready ? 'ready' : 'invalid',
      statusMessage: ready ? 'Ready for deployment and simulation' : `Missing ${missingExpectedFiles.join(', ') || 'valid map files'}`,
    });
  }
  maps.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
  return maps;
}

async function getReleasedMapSummary(config, mapName) {
  const normalizedMapName = validateMapName(mapName);
  const maps = await listReleasedMaps(config);
  return maps.find((map) => map.mapName === normalizedMapName) || null;
}

async function requireReleasedMapReady(config, mapName) {
  const summary = await getReleasedMapSummary(config, mapName);
  if (!summary) {
    throw new Error(`released map not found: ${mapName}`);
  }
  if (!summary.ready) {
    throw new Error(`released map is incomplete: ${summary.mapName}; ${summary.statusMessage}`);
  }
  return summary;
}

async function selectLatestReadyReleasedMap(config) {
  const maps = await listReleasedMaps(config);
  if (maps.length === 0) {
    throw new Error(`no released maps found at ${config.releaseRoot}`);
  }
  const latestReady = maps.find((map) => map.ready);
  if (latestReady) {
    return latestReady;
  }
  throw new Error(`no complete released map found. ${maps.map((map) => `${map.mapName}: ${map.statusMessage}`).join(' | ')}`);
}

async function readReleasedMapManifest(mapDir) {
  const manifestPath = path.join(mapDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  const content = await fsp.readFile(manifestPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function inspectReleasedMapForApolloLite(config, mapName) {
  const normalizedMapName = validateMapName(mapName);
  const mapDir = path.join(config.releaseRoot, normalizedMapName);
  if (!(await pathExists(mapDir))) {
    throw new Error(`released map not found: ${normalizedMapName}`);
  }
  const files = {};
  const candidateFiles = Array.from(
    new Set([
      ...APOLLOLITE_TRACE_FILES,
      'manifest.json',
      ...APOLLOLITE_RUNTIME_FILE_GROUPS.flatMap((group) => group.candidates),
    ])
  );
  for (const fileName of candidateFiles) {
    const filePath = path.join(mapDir, fileName);
    const exists = await pathExists(filePath);
    const stat = exists ? await fsp.stat(filePath) : null;
    files[fileName] = {
      exists,
      sizeBytes: stat ? stat.size : 0,
      usable: exists && stat && stat.size > 0,
    };
  }

  const errors = [];
  const warnings = [];
  const runtimeSelections = {};
  const textFallbacks = [];
  for (const fileName of APOLLOLITE_TRACE_FILES) {
    if (!files[fileName].usable) {
      errors.push(`${fileName} is missing or empty`);
    }
  }
  if (!files['manifest.json'].usable) {
    warnings.push('manifest.json is missing; traceability metadata will be limited');
  }
  for (const group of APOLLOLITE_RUNTIME_FILE_GROUPS) {
    const selected = group.candidates.find((fileName) => files[fileName].usable) || null;
    if (!selected) {
      errors.push(`${group.name} is missing; expected one of ${group.candidates.join(', ')}`);
      continue;
    }
    runtimeSelections[group.name] = selected;
    const binary = `${group.name}.bin`;
    const text = `${group.name}.txt`;
    if (files[binary] && files[binary].exists && !files[binary].usable && files[text]?.usable) {
      textFallbacks.push({ emptyBinary: binary, textFile: text });
      warnings.push(`${binary} is empty; ApolloLite staging will use ${text}`);
    }
    if (selected.endsWith('.txt')) {
      warnings.push(`${group.name} uses text-map fallback; native Apollo binary output is still preferred`);
    }
  }

  const manifest = await readReleasedMapManifest(mapDir).catch((error) => ({
    parseError: error.message,
  }));
  if (manifest?.parseError) {
    warnings.push(`manifest.json parse failed: ${manifest.parseError}`);
  }

  return {
    mapName: normalizedMapName,
    path: mapDir,
    ready: errors.length === 0,
    errors,
    warnings,
    files,
    runtimeSelections,
    textFallbacks,
    manifest,
  };
}

function resolveApolloLiteMapPath(mapRoot, mapName) {
  const targetDir = path.resolve(mapRoot, mapName);
  const relative = path.relative(path.resolve(mapRoot), targetDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`unsafe ApolloLite map path: ${mapName}`);
  }
  return targetDir;
}

async function selectReleasedMapName(config, mapName) {
  if (mapName) {
    return validateMapName(mapName);
  }
  const maps = await listReleasedMaps(config);
  if (maps.length === 0) {
    throw new Error(`no released maps found at ${config.releaseRoot}`);
  }
  const rejected = [];
  for (const map of maps) {
    const inspection = await inspectReleasedMapForApolloLite(config, map.mapName).catch((error) => ({
      ready: false,
      errors: [error.message],
    }));
    if (inspection.ready) {
      return map.mapName;
    }
    rejected.push(`${map.mapName}: ${(inspection.errors || []).join('; ')}`);
  }
  throw new Error(`no ApolloLite-ready released map found. ${rejected.join(' | ')}`);
}

async function runApolloLiteValidationCommand(config, params) {
  const commandTemplate = params.validationCommand;
  if (!commandTemplate) {
    return null;
  }
  const replacements = {
    mapName: params.mapName,
    mapDir: params.mapDir,
    apolloLiteRoot: params.apolloLiteRoot,
  };
  let command = commandTemplate;
  for (const [key, value] of Object.entries(replacements)) {
    command = command.replaceAll(`{${key}}`, String(value || '').replace(/"/g, '\\"'));
  }
  if (process.platform === 'win32') {
    return runCommand('cmd', ['/c', command], { timeoutMs: 5 * 60 * 1000 });
  }
  return runCommand('bash', ['-lc', command], { timeoutMs: 5 * 60 * 1000 });
}

async function updateApolloLiteDefaultMapFlag(apolloLite, mapName) {
  if (!apolloLite.root || !(await pathExists(apolloLite.root))) {
    return null;
  }
  const flagfilePath = path.join(apolloLite.root, 'modules/common/data/global_flagfile.txt');
  if (!(await pathExists(flagfilePath))) {
    return null;
  }
  const mapDirValue = `/apollo/modules/map/data/${mapName}`;
  const backupPath = `${flagfilePath}.mapeditor.bak`;
  if (!(await pathExists(backupPath))) {
    await fsp.copyFile(flagfilePath, backupPath).catch(() => {});
  }
  const lines = (await fsp.readFile(flagfilePath, 'utf8')).split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith('--map_dir=')) {
      replaced = true;
      return `--map_dir=${mapDirValue}`;
    }
    return line;
  });
  if (!replaced) {
    nextLines.push(`--map_dir=${mapDirValue}`);
  }
  await fsp.writeFile(flagfilePath, `${nextLines.join('\n').replace(/\n+$/u, '')}\n`, 'utf8');
  return {
    flagfilePath,
    backupPath,
    mapDir: mapDirValue,
  };
}

async function stageReleasedMapToApolloLite(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  const apolloLite = await getApolloLiteStatus(config);
  if (!apolloLite.enabled) {
    throw new Error('ApolloLite staging is disabled');
  }
  if (!apolloLite.mapRoot) {
    throw new Error('MAP_APOLLOLITE_MAP_ROOT is required');
  }
  if (!apolloLite.mapRootWritable) {
    throw new Error(`ApolloLite map root is not writable: ${apolloLite.mapRoot}`);
  }

  const mapName = await selectReleasedMapName(config, params.mapName);
  await progress(`Checking released map for ApolloLite: ${mapName}`);
  const inspection = await inspectReleasedMapForApolloLite(config, mapName);
  if (!inspection.ready) {
    throw new Error(`ApolloLite map preflight failed: ${inspection.errors.join('; ')}`);
  }

  const targetDir = resolveApolloLiteMapPath(apolloLite.mapRoot, mapName);
  const stagingDir = resolveApolloLiteMapPath(apolloLite.mapRoot, `.mapeditor-stage-${mapName}-${Date.now()}`);
  await progress(`Copying map package into ApolloLite staging: ${targetDir}`);
  await fsp.rm(stagingDir, { recursive: true, force: true });
  await fsp.cp(inspection.path, stagingDir, { recursive: true, force: true });

  const removedEmptyBinaries = [];
  for (const fallback of inspection.textFallbacks) {
    const emptyBinaryPath = path.join(stagingDir, fallback.emptyBinary);
    await fsp.rm(emptyBinaryPath, { force: true });
    removedEmptyBinaries.push(fallback.emptyBinary);
  }

  const stagedAt = new Date().toISOString();
  const stageWarnings = [...inspection.warnings];
  const stageManifest = {
    mapName,
    stagedAt,
    sourceDir: inspection.path,
    targetDir,
    runtimeSelections: inspection.runtimeSelections,
    warnings: stageWarnings,
    removedEmptyBinaries,
    apolloLiteRoot: apolloLite.root,
  };
  await fsp.writeFile(path.join(stagingDir, 'mapeditor_apollolite_stage.json'), JSON.stringify(stageManifest, null, 2), 'utf8');
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.rename(stagingDir, targetDir);
  const defaultMapFlag = await updateApolloLiteDefaultMapFlag(apolloLite, mapName);
  let dreamviewChange = null;
  let dreamviewRestart = null;
  if (apolloLite.simulationReady) {
    try {
      await progress(`Switching Dreamview to ApolloLite map: ${mapName}`);
      dreamviewChange = await changeDreamviewMap(apolloLite, mapName);
    } catch (error) {
      await progress(`Dreamview map switch needs runtime reload: ${error.message}`);
      try {
        dreamviewRestart = await restartApolloLiteDreamview(apolloLite, progress);
        dreamviewChange = await changeDreamviewMap(apolloLite, mapName);
      } catch (restartError) {
        const message = `Dreamview map switch failed after restart: ${restartError.message}`;
        stageWarnings.push(message);
        await progress(message);
      }
    }
  }

  let validation = null;
  if (apolloLite.validationCommand) {
    await progress('Running ApolloLite validation command');
    validation = await runApolloLiteValidationCommand(config, {
      validationCommand: apolloLite.validationCommand,
      mapName,
      mapDir: targetDir,
      apolloLiteRoot: apolloLite.root,
    });
  }

  const record = await appendDeploymentRecord(config, {
    id: createDeploymentId('apollolite-stage'),
    type: 'apollolite-stage',
    mapName,
    status: 'succeeded',
    startedAt: stagedAt,
    finishedAt: new Date().toISOString(),
    sourceDir: inspection.path,
    targetDir,
    apolloLite: {
      root: apolloLite.root,
      mapRoot: apolloLite.mapRoot,
      stagingReady: apolloLite.stagingReady,
      simulationReady: apolloLite.simulationReady,
      simulationMessage: apolloLite.simulationMessage,
      validationCommandConfigured: apolloLite.validationCommandConfigured,
    },
    defaultMapFlag,
    dreamviewChange,
    dreamviewRestart,
    warnings: stageWarnings,
    removedEmptyBinaries,
  });

  await progress(`ApolloLite staging ready: ${mapName}`);
  return {
    mapName,
    sourceDir: inspection.path,
    targetDir,
    inspection,
    removedEmptyBinaries,
    defaultMapFlag,
    dreamviewChange,
    dreamviewRestart,
    validation,
    apolloLite: {
      root: apolloLite.root,
      mapRoot: apolloLite.mapRoot,
      stagingReady: apolloLite.stagingReady,
      simulationReady: apolloLite.simulationReady,
      simulationMessage: apolloLite.simulationMessage,
      validationCommandConfigured: apolloLite.validationCommandConfigured,
    },
    record,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDreamviewWebSocketUrl(apolloLite) {
  const target = apolloLite.dreamviewProxyTarget || apolloLite.dreamviewUrl || 'http://127.0.0.1:8888';
  const parsed = new URL(target);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = !pathname || pathname === '/' ? '/websocket' : `${pathname}/websocket`;
  parsed.search = '';
  return parsed.toString();
}

function extractTopLevelProtoBlocks(text, blockName) {
  const blocks = [];
  const lines = text.split(/\r?\n/u);
  let collecting = false;
  let depth = 0;
  let current = [];
  const startPattern = new RegExp(`^\\s*${blockName}\\s*\\{\\s*$`, 'u');
  for (const line of lines) {
    if (!collecting && startPattern.test(line)) {
      collecting = true;
      current = [line];
      depth = (line.match(/\{/gu) || []).length - (line.match(/\}/gu) || []).length;
      continue;
    }
    if (!collecting) {
      continue;
    }
    current.push(line);
    depth += (line.match(/\{/gu) || []).length - (line.match(/\}/gu) || []).length;
    if (depth <= 0) {
      blocks.push(current.join('\n'));
      collecting = false;
      current = [];
      depth = 0;
    }
  }
  return blocks;
}

function parseApolloMapLanes(mapText) {
  const laneBlocks = extractTopLevelProtoBlocks(mapText, 'lane');
  return laneBlocks
    .map((block) => {
      const id = block.match(/\bid:\s*"([^"]+)"/u)?.[1] || '';
      const successorIds = Array.from(block.matchAll(/successor_id\s*\{\s*id:\s*"([^"]+)"/gu)).map((match) => match[1]);
      const laneType = Number(block.match(/\n\s*type:\s*(\d+)/u)?.[1] || 0);
      const centralStart = block.search(/central_curve\s*\{/u);
      const centralBody = centralStart >= 0 ? block.slice(centralStart) : block;
      const stopMatch = centralBody.search(/\n\s*(left_boundary|right_boundary|overlap_id|successor_id|predecessor_id|junction_id)\s*\{/u);
      const centralText = stopMatch >= 0 ? centralBody.slice(0, stopMatch) : centralBody;
      const points = Array.from(
        centralText.matchAll(
          /point\s*\{\s*x:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*y:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/giu
        )
      ).map((match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
      })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      const length = polylineLength(points);
      return {
        id,
        successorIds,
        laneType,
        points,
        length,
      };
    })
    .filter((lane) => lane.id && lane.points.length >= 2 && lane.length > 0.5);
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function pointAtPolylineFraction(points, fraction) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const target = Math.max(0, Math.min(1, fraction)) * polylineLength(points);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const segmentLength = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (travelled + segmentLength >= target) {
      const ratio = segmentLength > 0 ? (target - travelled) / segmentLength : 0;
      return {
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio,
      };
    }
    travelled += segmentLength;
  }
  return points[points.length - 1];
}

function headingAtPolylineFraction(points, fraction) {
  if (points.length < 2) {
    return 0;
  }
  const target = Math.max(0, Math.min(1, fraction)) * polylineLength(points);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const segmentLength = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (travelled + segmentLength >= target || index === points.length - 1) {
      return Math.atan2(next.y - prev.y, next.x - prev.x);
    }
    travelled += segmentLength;
  }
  const prev = points[points.length - 2];
  const next = points[points.length - 1];
  return Math.atan2(next.y - prev.y, next.x - prev.x);
}

function closestPointOnPolyline(points, target) {
  const totalLength = polylineLength(points);
  let best = null;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const segmentLength = Math.hypot(dx, dy);
    const ratio = segmentLength > 0
      ? Math.max(0, Math.min(1, ((target.x - prev.x) * dx + (target.y - prev.y) * dy) / (segmentLength * segmentLength)))
      : 0;
    const point = {
      x: prev.x + dx * ratio,
      y: prev.y + dy * ratio,
    };
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    const fraction = totalLength > 0 ? (travelled + segmentLength * ratio) / totalLength : 0;
    if (!best || distance < best.distanceMeters) {
      best = {
        point,
        distanceMeters: distance,
        fraction,
        heading: Math.atan2(dy, dx),
      };
    }
    travelled += segmentLength;
  }
  return best;
}

function findNearestLaneProjection(lanes, point) {
  let best = null;
  for (const lane of lanes) {
    const projection = closestPointOnPolyline(lane.points, point);
    if (!projection) {
      continue;
    }
    if (!best || projection.distanceMeters < best.distanceMeters) {
      best = {
        ...projection,
        lane,
      };
    }
  }
  return best;
}

function followSimulationSuccessors(startLane, laneById) {
  const pathItems = [];
  const visited = new Set();
  let current = startLane;
  while (current && !visited.has(current.id) && pathItems.length < 16) {
    pathItems.push(current);
    visited.add(current.id);
    const nextId = current.successorIds.find((id) => laneById.has(id) && !visited.has(id));
    current = nextId ? laneById.get(nextId) : null;
  }
  return pathItems;
}

function chooseSimulationLanePath(lanes, startPose = null) {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const cityDrivingLanes = lanes.filter((lane) => lane.laneType === 2);
  const routableStartLanes = cityDrivingLanes.length > 0 ? cityDrivingLanes : lanes;
  if (startPose && Number.isFinite(startPose.x) && Number.isFinite(startPose.y)) {
    const startProjection = findNearestLaneProjection(routableStartLanes, startPose);
    if (startProjection) {
      const lanesFromPose = followSimulationSuccessors(startProjection.lane, laneById);
      if (lanesFromPose.length > 0) {
        return {
          lanes: lanesFromPose,
          startProjection,
        };
      }
    }
  }
  let bestPath = [];
  let bestLength = 0;
  for (const lane of lanes) {
    const pathItems = followSimulationSuccessors(lane, laneById);
    const length = pathItems.reduce((sum, item) => sum + item.length, 0);
    if (length > bestLength) {
      bestPath = pathItems;
      bestLength = length;
    }
  }
  if (bestPath.length > 0) {
    return {
      lanes: bestPath,
      startProjection: null,
    };
  }
  const longestLane = lanes.reduce((best, lane) => (lane.length > (best?.length || 0) ? lane : best), null);
  return {
    lanes: longestLane ? [longestLane] : [],
    startProjection: null,
  };
}

async function buildApolloLiteSimulationRoute(mapDir, startPose = null) {
  const baseMapTextPath = path.join(mapDir, 'base_map.txt');
  if (!(await pathExists(baseMapTextPath))) {
    throw new Error(`ApolloLite smoke test requires base_map.txt: ${baseMapTextPath}`);
  }
  const mapText = await fsp.readFile(baseMapTextPath, 'utf8');
  const lanes = parseApolloMapLanes(mapText);
  if (lanes.length === 0) {
    throw new Error(`no drivable lanes found in ${baseMapTextPath}`);
  }
  const laneSelection = chooseSimulationLanePath(lanes, startPose);
  const lanePath = laneSelection.lanes;
  if (lanePath.length === 0) {
    throw new Error(`no usable route can be derived from ${baseMapTextPath}`);
  }
  const startLane = lanePath[0];
  const hasCityDrivingLanes = lanes.some((lane) => lane.laneType === 2);
  let endLaneIndex = 0;
  for (let index = lanePath.length - 1; index > 0; index -= 1) {
    if (lanePath[index].laneType === 2 || !hasCityDrivingLanes) {
      endLaneIndex = index;
      break;
    }
  }
  const effectiveLanePath = lanePath.slice(0, endLaneIndex + 1);
  const endLane = effectiveLanePath[effectiveLanePath.length - 1];
  const singleLane = startLane.id === endLane.id;
  const startFraction = laneSelection.startProjection?.fraction ?? (singleLane ? 0.12 : 0.08);
  const endFraction = singleLane ? 0.88 : 0.82;
  const laneStart = pointAtPolylineFraction(startLane.points, startFraction);
  const usePoseStart = startPose && laneSelection.startProjection && laneSelection.startProjection.distanceMeters < 1.5;
  const start = usePoseStart
    ? { x: startPose.x, y: startPose.y }
    : laneStart;
  const end = pointAtPolylineFraction(endLane.points, endFraction);
  const heading = usePoseStart && Number.isFinite(startPose.heading)
    ? startPose.heading
    : headingAtPolylineFraction(startLane.points, startFraction);
  return {
    laneIds: effectiveLanePath.map((lane) => lane.id),
    estimatedLengthMeters: effectiveLanePath.reduce((sum, lane) => sum + lane.length, 0),
    startMode: usePoseStart ? 'current_vehicle_pose' : 'map_lane',
    startLaneId: startLane.id,
    startProjectionDistanceMeters: laneSelection.startProjection?.distanceMeters ?? null,
    request: {
      type: 'SendRoutingRequest',
      start: {
        x: start.x,
        y: start.y,
        heading,
      },
      end: {
        x: end.x,
        y: end.y,
        id: endLane.id,
      },
    },
  };
}

async function inspectApolloLiteSimulationComponents(apolloLite) {
  const components = [];
  for (const component of APOLLOLITE_SIMULATION_COMPONENTS) {
    const componentPath = await findApolloLiteCandidate(apolloLite.root, component.candidates);
    components.push({
      name: component.name,
      actionModule: component.actionModule,
      available: Boolean(componentPath),
      path: componentPath || '',
    });
  }
  return components;
}

function connectDreamviewWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketClient(wsUrl, { perMessageDeflate: false });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Dreamview websocket timeout: ${wsUrl}`));
    }, APOLLOLITE_DREAMVIEW_WS_TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendDreamviewMessage(ws, payload) {
  if (ws.readyState !== WebSocketClient.OPEN) {
    throw new Error('Dreamview websocket is not open');
  }
  ws.send(JSON.stringify(payload));
}

function normalizeDreamviewName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function getDreamviewStatusMaps(status) {
  const maps = status?.maps;
  if (Array.isArray(maps)) {
    return maps
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        return item?.name || item?.id || item?.mapName || '';
      })
      .filter(Boolean);
  }
  if (maps && typeof maps === 'object') {
    return Object.keys(maps);
  }
  return [];
}

function getDreamviewStatusModes(status) {
  const modes = status?.modes;
  if (Array.isArray(modes)) {
    return modes.filter(Boolean);
  }
  if (modes && typeof modes === 'object') {
    return Object.keys(modes);
  }
  return [];
}

function getDreamviewCurrentMap(status) {
  return status?.currentMap || status?.current_map || status?.currentMapName || status?.current_map_name || '';
}

function getDreamviewCurrentMode(status) {
  return status?.currentMode || status?.current_mode || '';
}

function resolveDreamviewMapValue(status, mapName) {
  const maps = getDreamviewStatusMaps(status);
  const exact = maps.find((candidate) => candidate === mapName);
  if (exact) {
    return exact;
  }
  const normalizedMapName = normalizeDreamviewName(mapName);
  return maps.find((candidate) => normalizeDreamviewName(candidate) === normalizedMapName) || mapName;
}

function resolveDreamviewSimulationMode(status) {
  const modes = getDreamviewStatusModes(status);
  return (
    modes.find((mode) => mode === 'Mkz Standard Debug') ||
    modes.find((mode) => /standard debug/iu.test(mode)) ||
    modes.find((mode) => /debug/iu.test(mode)) ||
    ''
  );
}

function readDreamviewHmiStatus(ws, timeoutMs = APOLLOLITE_DREAMVIEW_HTTP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };
    const onMessage = (data) => {
      let message = null;
      try {
        message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      } catch (error) {
        return;
      }
      if (message?.type !== 'HMIStatus') {
        return;
      }
      cleanup();
      resolve(message.data || {});
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    ws.on('message', onMessage);
  });
}

async function switchDreamviewMapOnSocket(ws, mapName, progress = async () => {}) {
  const expectedMap = normalizeDreamviewName(mapName);
  const beforeStatus = await readDreamviewHmiStatus(ws);
  const beforeMap = getDreamviewCurrentMap(beforeStatus);
  const dreamviewMapValue = resolveDreamviewMapValue(beforeStatus, mapName);
  if (normalizeDreamviewName(beforeMap) === expectedMap) {
    return {
      mapName,
      dreamviewMapValue,
      currentMap: beforeMap,
      alreadyCurrent: true,
    };
  }

  sendDreamviewMessage(ws, { type: 'HMIAction', action: 'CHANGE_MAP', value: dreamviewMapValue });
  await delay(1000);
  const afterStatus = await readDreamviewHmiStatus(ws, APOLLOLITE_DREAMVIEW_WS_TIMEOUT_MS);
  const afterMap = getDreamviewCurrentMap(afterStatus);
  if (afterMap && normalizeDreamviewName(afterMap) !== expectedMap) {
    await progress(`Dreamview is still on ${afterMap || 'unknown map'} after CHANGE_MAP ${dreamviewMapValue}`);
    throw new Error(`Dreamview did not switch to ${mapName}; current map is ${afterMap}`);
  }
  return {
    mapName,
    dreamviewMapValue,
    currentMap: afterMap || '',
    alreadyCurrent: false,
  };
}

async function ensureDreamviewSimulationMode(ws, progress = async () => {}) {
  const beforeStatus = await readDreamviewHmiStatus(ws);
  const currentMode = getDreamviewCurrentMode(beforeStatus);
  const targetMode = resolveDreamviewSimulationMode(beforeStatus);
  if (!targetMode || currentMode === targetMode) {
    return {
      currentMode,
      targetMode,
      changed: false,
    };
  }

  await progress(`Switching Dreamview mode: ${targetMode}`);
  sendDreamviewMessage(ws, { type: 'HMIAction', action: 'CHANGE_MODE', value: targetMode });
  await delay(1500);
  const afterStatus = await readDreamviewHmiStatus(ws, APOLLOLITE_DREAMVIEW_WS_TIMEOUT_MS);
  return {
    currentMode: getDreamviewCurrentMode(afterStatus) || currentMode,
    targetMode,
    changed: true,
  };
}

async function waitForApolloLiteDreamviewHttp(apolloLite, timeoutMs = APOLLOLITE_DREAMVIEW_RESTART_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = null;
  while (Date.now() < deadline) {
    lastProbe = await probeHttpUrl(apolloLite.dreamviewUrl).catch((error) => ({
      ok: false,
      message: error.message,
    }));
    if (lastProbe?.ok) {
      return lastProbe;
    }
    await delay(1000);
  }
  throw new Error(`Dreamview did not become reachable after restart: ${lastProbe?.message || 'timeout'}`);
}

async function restartApolloLiteDreamview(apolloLite, progress = async () => {}) {
  const containerName = await resolveApolloLiteDockerContainer(apolloLite);
  if (!containerName) {
    throw new Error('ApolloLite docker container was not found');
  }
  await progress(`Restarting Dreamview to reload map config: ${containerName}`);
  const command = [
    'cd /apollo',
    'source /apollo/scripts/apollo_base.sh >/dev/null 2>&1 || true',
    "pkill -f '[d]reamview/launch/dreamview.launch' || true",
    'pkill -x dreamview || true',
    'sleep 1',
    'mkdir -p /apollo/data/log/mapeditor_dreamview',
    'nohup /apollo/bazel-bin/cyber/tools/cyber_launch/cyber_launch start /apollo/modules/dreamview/launch/dreamview.launch >/apollo/data/log/mapeditor_dreamview/dreamview_restart.log 2>&1 &',
  ].join(' && ');
  const startedAt = new Date().toISOString();
  await runCommand('docker', ['exec', containerName, 'bash', '-lc', command], {
    timeoutMs: APOLLOLITE_DREAMVIEW_RESTART_TIMEOUT_MS,
  });
  const http = await waitForApolloLiteDreamviewHttp(apolloLite);
  return {
    containerName,
    startedAt,
    finishedAt: new Date().toISOString(),
    http,
  };
}

async function changeDreamviewMap(apolloLite, mapName) {
  const wsUrl = buildDreamviewWebSocketUrl(apolloLite);
  const ws = await connectDreamviewWebSocket(wsUrl);
  try {
    const result = await switchDreamviewMapOnSocket(ws, mapName);
    return {
      wsUrl,
      ...result,
      changedAt: new Date().toISOString(),
    };
  } finally {
    ws.close();
  }
}

async function runDreamviewSimulationSequence(apolloLite, route, progress) {
  const wsUrl = buildDreamviewWebSocketUrl(apolloLite);
  await progress(`Connecting Dreamview websocket: ${wsUrl}`);
  const ws = await connectDreamviewWebSocket(wsUrl);
  const observedTypes = new Set();
  let mapSwitch = null;
  let modeSwitch = null;
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
      if (message?.type) {
        observedTypes.add(message.type);
      }
    } catch (error) {
      // Dreamview can emit non-JSON diagnostics; they are not needed for the smoke test.
    }
  });
  try {
    sendDreamviewMessage(ws, { type: 'ToggleSimControl', enable: true });
    await delay(500);
    mapSwitch = await switchDreamviewMapOnSocket(ws, route.mapName, progress);
    modeSwitch = await ensureDreamviewSimulationMode(ws, progress);
    for (const component of APOLLOLITE_SIMULATION_COMPONENTS) {
      await progress(`Starting ApolloLite module: ${component.actionModule}`);
      sendDreamviewMessage(ws, {
        type: 'HMIAction',
        action: 'START_MODULE',
        value: component.actionModule,
      });
      await delay(400);
    }
    await delay(1200);
    await progress(`Sending simulation route across ${route.laneIds.length} lane(s)`);
    sendDreamviewMessage(ws, route.request);
    await delay(1200);
  } finally {
    ws.close();
  }
  return {
    wsUrl,
    observedTypes: Array.from(observedTypes),
    mapSwitch,
    modeSwitch,
  };
}

async function stopDreamviewSimulationSequence(apolloLite, progress) {
  const wsUrl = buildDreamviewWebSocketUrl(apolloLite);
  await progress(`Stopping ApolloLite simulation modules: ${wsUrl}`);
  const ws = await connectDreamviewWebSocket(wsUrl);
  const stoppedModules = [];
  try {
    for (const component of [...APOLLOLITE_SIMULATION_COMPONENTS].reverse()) {
      sendDreamviewMessage(ws, {
        type: 'HMIAction',
        action: 'STOP_MODULE',
        value: component.actionModule,
      });
      stoppedModules.push(component.actionModule);
      await delay(300);
    }
    sendDreamviewMessage(ws, { type: 'ToggleSimControl', enable: false });
    await delay(300);
  } finally {
    ws.close();
  }
  return {
    wsUrl,
    stoppedModules,
    simControlEnabled: false,
    stoppedAt: new Date().toISOString(),
  };
}

async function resolveApolloLiteDockerContainer(apolloLite) {
  if (apolloLite.dockerContainer) {
    return apolloLite.dockerContainer;
  }
  const result = await runCommand('docker', ['ps', '--format', '{{.Names}}'], {
    timeoutMs: 5000,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return '';
  }
  const names = result.stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  return names.find((name) => /apollo.*dev|apollo.*lite|apollo_dev/u.test(name)) || '';
}

function parseChassisSample(stdout) {
  const speedMatches = Array.from(stdout.matchAll(/speed_mps:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/giu));
  const speedMps = speedMatches.length > 0 ? Number(speedMatches[speedMatches.length - 1][1]) : null;
  const drivingMode = stdout.match(/driving_mode:\s*([A-Z_]+)/u)?.[1] || '';
  const gearLocation = stdout.match(/gear_location:\s*([A-Z_]+)/u)?.[1] || '';
  return {
    speedMps: Number.isFinite(speedMps) ? speedMps : null,
    drivingMode,
    gearLocation,
    rawExcerpt: stdout.trim().slice(0, 2000),
  };
}

function parseLocalizationPose(stdout) {
  const positionMatches = Array.from(
    stdout.matchAll(
      /position\s*\{\s*x:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*y:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/giu
    )
  );
  if (positionMatches.length === 0) {
    return null;
  }
  const position = positionMatches[positionMatches.length - 1];
  const headingMatches = Array.from(stdout.matchAll(/heading:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/giu));
  const heading = headingMatches.length > 0 ? Number(headingMatches[headingMatches.length - 1][1]) : null;
  const pose = {
    x: Number(position[1]),
    y: Number(position[2]),
    heading,
  };
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
    return null;
  }
  return pose;
}

async function readApolloLiteChassisSample(containerName) {
  const command = [
    'cd /apollo',
    'source cyber/setup.bash >/dev/null 2>&1 || true',
    "timeout 2 cyber_channel echo /apollo/canbus/chassis 2>/dev/null | sed -n '1,180p' || true",
  ].join(' && ');
  const result = await runCommand('docker', ['exec', '-u', 'dell', containerName, 'bash', '-lc', command], {
    timeoutMs: 5000,
  });
  return parseChassisSample(result.stdout || '');
}

async function readApolloLiteLocalizationPose(apolloLite, progress) {
  const containerName = await resolveApolloLiteDockerContainer(apolloLite);
  if (!containerName) {
    return null;
  }
  await progress(`Reading current vehicle pose from ApolloLite container: ${containerName}`);
  const command = [
    'cd /apollo',
    'source cyber/setup.bash >/dev/null 2>&1 || true',
    "timeout 2 cyber_channel echo /apollo/localization/pose 2>/dev/null | sed -n '1,180p' || true",
  ].join(' && ');
  const result = await runCommand('docker', ['exec', '-u', 'dell', containerName, 'bash', '-lc', command], {
    timeoutMs: 5000,
  }).catch(() => null);
  if (!result) {
    return null;
  }
  return parseLocalizationPose(result.stdout || '');
}

async function waitForApolloLiteMotion(apolloLite, progress) {
  const containerName = await resolveApolloLiteDockerContainer(apolloLite);
  if (!containerName) {
    return {
      available: false,
      moved: false,
      containerName: '',
      maxSpeedMps: null,
      message: 'ApolloLite docker container was not found; route was sent but vehicle motion could not be verified',
    };
  }
  await progress(`Reading chassis from ApolloLite container: ${containerName}`);
  const deadline = Date.now() + APOLLOLITE_SIM_MOTION_TIMEOUT_MS;
  let lastSample = null;
  let maxSpeedMps = 0;
  while (Date.now() < deadline) {
    lastSample = await readApolloLiteChassisSample(containerName).catch((error) => ({
      speedMps: null,
      error: error.message,
      rawExcerpt: '',
    }));
    if (Number.isFinite(lastSample.speedMps)) {
      maxSpeedMps = Math.max(maxSpeedMps, Math.abs(lastSample.speedMps));
      if (maxSpeedMps > 0.05) {
        return {
          available: true,
          moved: true,
          containerName,
          maxSpeedMps,
          lastSample,
          message: 'vehicle motion detected',
        };
      }
    }
    await delay(1000);
  }
  return {
    available: true,
    moved: false,
    containerName,
    maxSpeedMps,
    lastSample,
    message: 'route was sent, but chassis speed did not rise above 0.05 m/s',
  };
}

async function runApolloLiteSimulationSmokeTest(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  await progress('Preparing ApolloLite map');
  const stage = await stageReleasedMapToApolloLite(config, {
    mapName: params.mapName || '',
    progress,
  });
  const apolloLite = {
    ...getApolloLiteConfig(config),
    ...(stage.apolloLite || {}),
  };
  const components = await inspectApolloLiteSimulationComponents(apolloLite);
  const missingComponents = components.filter((component) => !component.available);
  if (missingComponents.length > 0) {
    throw new Error(
      `ApolloLite PNC components are missing: ${missingComponents.map((component) => component.name).join(', ')}. Build routing/planning/control first.`
    );
  }
  const startPose = await readApolloLiteLocalizationPose(apolloLite, progress);
  if (startPose) {
    await progress(`Current vehicle pose: x=${startPose.x.toFixed(3)}, y=${startPose.y.toFixed(3)}`);
  }
  await progress('Building route from staged Apollo map');
  const route = await buildApolloLiteSimulationRoute(stage.targetDir, startPose);
  route.mapName = stage.mapName;
  route.startPose = startPose;
  const dreamview = await runDreamviewSimulationSequence(apolloLite, route, progress);
  await progress('Checking whether the simulated vehicle starts moving');
  const motion = await waitForApolloLiteMotion(apolloLite, progress);
  const cleanup = await stopDreamviewSimulationSequence(apolloLite, progress).catch((error) => ({
    error: error.message,
  }));
  const ready = motion.moved === true;
  const result = {
    ready,
    mapName: stage.mapName,
    targetDir: stage.targetDir,
    stage,
    apolloLite,
    components,
    route,
    dreamview,
    motion,
    cleanup,
  };
  await appendDeploymentRecord(config, {
    id: createDeploymentId('apollolite-sim'),
    type: 'apollolite-sim-smoke-test',
    mapName: stage.mapName,
    status: ready ? 'succeeded' : 'failed',
    startedAt: stage.record?.finishedAt || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    targetDir: stage.targetDir,
    route: {
      laneIds: route.laneIds,
      estimatedLengthMeters: route.estimatedLengthMeters,
    },
    motion,
    cleanup,
  }).catch(() => {});
  if (!ready) {
    const message = motion.message || 'ApolloLite simulation route was sent, but vehicle motion was not confirmed';
    await progress(message);
    const error = new Error(message);
    error.result = result;
    throw error;
  }
  await progress(`ApolloLite simulation smoke test passed: max speed ${motion.maxSpeedMps.toFixed(3)} m/s`);
  return result;
}

async function importBaseMapZip(config, params) {
  const mapName = validateMapName(params.mapName);
  const zipPath = params.zipPath;
  const overwrite = params.overwrite === true;
  if (!zipPath || !(await pathExists(zipPath))) {
    throw new Error('uploaded zip file not found');
  }

  const archive = await openZipArchive(zipPath, `底图 ZIP ${path.basename(zipPath)}`);
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

  const archive = await openZipArchive(zipPath, `Apollo 地图包 ZIP ${path.basename(zipPath)}`);
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
  const archive = await openZipArchive(filePath, `点云 ZIP ${path.basename(filePath)}`);
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
      stitchPlan: metadata.stitchPlan || null,
      sourceAsset: metadata.sourceAsset || null,
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
  const archive = await openZipArchive(zipPath, `图片姿态 ZIP ${path.basename(zipPath)}`);
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
  const archive = await openZipArchive(zipPath, `图片 ZIP ${path.basename(zipPath)}`);
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
  const archive = await openZipArchive(filePath, `采图包 ZIP ${originalName || path.basename(filePath)}`);
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
  const packageRoot = getImportPackageRoot(config);
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
      displayName: packageName,
      uploadedFiles: files.map((file) => file.originalName || file.originalname || file.path),
      analyses,
      summary: summarizeCombinedPackageAnalysis(analyses),
    };
    await writePackageMetadata(targetDir, {
      packageId,
      displayName: packageName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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
  const existing = await readAnalysisFile(packageDir).catch(() => null);
  const files = await listDataPackageImportFilesFromRoot(packageDir, uploadDir);
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

async function listImportableFilesRecursive(rootDir, baseDir = rootDir) {
  const results = [];
  const walk = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const originalName = path.relative(baseDir, entryPath).replace(/\\/g, '/').replace(/^\d+-/, '');
      if (isSupportedPointCloudUploadName(originalName) || isImageName(originalName)) {
        results.push({
          path: entryPath,
          originalName,
        });
      }
    }
  };
  await walk(rootDir);
  results.sort((left, right) => left.originalName.localeCompare(right.originalName, 'zh-CN'));
  return results;
}

async function listDataPackageImportFilesFromRoot(packageDir, uploadDir = path.join(packageDir, 'uploads')) {
  if (await pathExists(uploadDir)) {
    const entries = await fsp.readdir(uploadDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        path: path.join(uploadDir, entry.name),
        originalName: entry.name.replace(/^\d+-/, ''),
      }))
      .filter((file) => isSupportedPointCloudUploadName(file.originalName) || isImageName(file.originalName));
  }
  return listImportableFilesRecursive(packageDir, packageDir);
}

function getImportPackageRoot(config) {
  return path.resolve(
    config.importPackageRoot || path.resolve(config.baseMapRoot, '..', 'import_packages')
  );
}

function getImportPackageTrashRoot(config) {
  return path.resolve(
    config.importPackageTrashRoot ||
      path.resolve(config.baseMapRoot, '..', 'import_packages_trash')
  );
}

function getCaptureSourceRoot(config) {
  return config.captureSourceRoot ? path.resolve(config.captureSourceRoot) : '';
}

function getCaptureResultDirNames(config) {
  const names = Array.isArray(config.captureResultDirNames) ? config.captureResultDirNames : [];
  return names.length > 0 ? names : ['ResultOut', 'Resultout', 'resultout', 'Result', 'result'];
}

async function findCaptureResultDir(packageDir, names) {
  const entries = await fsp.readdir(packageDir, { withFileTypes: true }).catch(() => []);
  const dirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const name of names) {
    const exact = dirNames.find((entryName) => entryName === name);
    if (exact) {
      return path.join(packageDir, exact);
    }
  }
  for (const name of names) {
    const lowerName = name.toLowerCase();
    const matched = dirNames.find((entryName) => entryName.toLowerCase() === lowerName);
    if (matched) {
      return path.join(packageDir, matched);
    }
  }
  return null;
}

async function listLasFilesRecursive(rootDir) {
  const results = [];
  const walk = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.las') {
        const stat = await fsp.stat(entryPath);
        results.push({
          path: entryPath,
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  };
  await walk(rootDir);
  results.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  return results;
}

function getCapturePackageNewestTime(files, packageStat) {
  const newestFileTime = files.reduce((maxTime, item) => {
    const time = Date.parse(item.modifiedAt || '') || 0;
    return Math.max(maxTime, time);
  }, 0);
  return Math.max(newestFileTime, packageStat?.mtime?.getTime?.() || 0);
}

function isCapturePackageStable(files, packageStat, minAgeMinutes) {
  const minAgeMs = Math.max(0, Number(minAgeMinutes) || 0) * 60 * 1000;
  if (minAgeMs <= 0) {
    return true;
  }
  const newestTime = getCapturePackageNewestTime(files, packageStat);
  return newestTime > 0 && Date.now() - newestTime >= minAgeMs;
}

function assertPathInside(parent, child, label) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  if (childPath !== parentPath && !childPath.startsWith(`${parentPath}${path.sep}`)) {
    throw new Error(`${label} resolved outside configured root`);
  }
  return childPath;
}

async function scanCaptureSourcePackages(config, options = {}) {
  const sourceRoot = getCaptureSourceRoot(config);
  if (!sourceRoot) {
    throw new Error('MAP_CAPTURE_SOURCE_ROOT is not configured');
  }
  if (!(await pathExists(sourceRoot))) {
    throw new Error(`capture source root not found: ${sourceRoot}`);
  }
  const resultDirNames = getCaptureResultDirNames(config);
  const packageRoot = getImportPackageRoot(config);
  await fsp.mkdir(packageRoot, { recursive: true });
  const entries = await fsp.readdir(sourceRoot, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourcePackage = entry.name;
    const sourcePath = path.join(sourceRoot, sourcePackage);
    const resultDir = await findCaptureResultDir(sourcePath, resultDirNames);
    if (!resultDir) {
      continue;
    }
    const files = await listLasFilesRecursive(resultDir).catch(() => []);
    if (files.length === 0) {
      continue;
    }
    const stat = await fsp.stat(sourcePath);
    const minAgeMinutes = Number(options.minAgeMinutes || 0);
    const newestTime = getCapturePackageNewestTime(files, stat);
    const packageId = `sync-${sanitizePackageName(sourcePackage)}`;
    packages.push({
      sourcePackage,
      sourcePath,
      resultDir,
      packageId,
      displayName: sanitizePackageName(sourcePackage),
      fileCount: files.length,
      totalBytes: files.reduce((sum, item) => sum + Number(item.size || 0), 0),
      modifiedAt: stat.mtime.toISOString(),
      newestLastWriteUtc: newestTime ? new Date(newestTime).toISOString() : stat.mtime.toISOString(),
      stable: isCapturePackageStable(files, stat, minAgeMinutes),
      minAgeMinutes,
      imported: await pathExists(path.join(packageRoot, packageId, 'analysis.json')),
    });
  }
  packages.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
  return {
    sourceRoot,
    resultDirNames,
    packages,
  };
}

async function importCaptureSourcePackage(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  const sourcePackage = String(params.sourcePackage || '').trim();
  if (!sourcePackage) {
    throw new Error('sourcePackage is required');
  }
  if (sourcePackage.includes('/') || sourcePackage.includes('\\')) {
    throw new Error('sourcePackage must be a direct child of capture source root');
  }
  const sourceRoot = getCaptureSourceRoot(config);
  if (!sourceRoot) {
    throw new Error('MAP_CAPTURE_SOURCE_ROOT is not configured');
  }
  const sourcePath = assertPathInside(sourceRoot, path.join(sourceRoot, sourcePackage), 'sourcePackage');
  const resultDir = await findCaptureResultDir(sourcePath, getCaptureResultDirNames(config));
  if (!resultDir) {
    throw new Error(`ResultOut directory not found under ${sourcePath}`);
  }
  const files = await listLasFilesRecursive(resultDir);
  if (files.length === 0) {
    throw new Error(`no LAS files found under ${resultDir}`);
  }
  if (params.skipStabilityCheck !== true) {
    const sourceStat = await fsp.stat(sourcePath);
    const minAgeMinutes = Number(params.minAgeMinutes || 0);
    if (!isCapturePackageStable(files, sourceStat, minAgeMinutes)) {
      throw new Error(
        `capture package is still changing; wait at least ${minAgeMinutes} minute(s): ${sourcePackage}`
      );
    }
  }
  const packageRoot = getImportPackageRoot(config);
  await fsp.mkdir(packageRoot, { recursive: true });
  const packageId = `sync-${sanitizePackageName(sourcePackage)}`;
  const displayName = sanitizePackageName(sourcePackage);
  const targetDir = path.join(packageRoot, packageId);
  if (await pathExists(targetDir)) {
    if (params.overwrite !== true) {
      return {
        skipped: true,
        reason: 'already_imported',
        packageId,
        displayName,
        path: targetDir,
      };
    }
    await progress(`Removing existing imported asset: ${packageId}`);
    await fsp.rm(targetDir, { recursive: true, force: true });
  }
  const uploadDir = path.join(targetDir, 'uploads');
  await fsp.mkdir(uploadDir, { recursive: true });
  const analyses = [];
  const manifestFiles = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const safeName = `${index}-${path.basename(file.name) || 'source.las'}`;
      const targetPath = path.join(uploadDir, safeName);
      await progress(`Copying LAS ${index + 1}/${files.length}: ${file.name}`);
      await fsp.copyFile(file.path, targetPath);
      analyses.push(await analyzeSingleDataFile(targetPath, file.name));
      manifestFiles.push({
        source: file.path,
        name: file.name,
        size: file.size,
        modifiedAt: file.modifiedAt,
      });
    }
    const sourceManifest = {
      sourceRoot,
      sourcePackage,
      sourcePath,
      resultDir,
      importedAt: new Date().toISOString(),
      fileCount: manifestFiles.length,
      totalBytes: manifestFiles.reduce((sum, item) => sum + Number(item.size || 0), 0),
      files: manifestFiles,
    };
    const combined = {
      packageId,
      path: targetDir,
      displayName,
      uploadedFiles: manifestFiles.map((file) => file.name),
      analyses,
      summary: summarizeCombinedPackageAnalysis(analyses),
    };
    await writePackageMetadata(targetDir, {
      packageId,
      displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fsp.writeFile(path.join(targetDir, 'source_manifest.json'), JSON.stringify(sourceManifest, null, 2), 'utf8');
    await fsp.writeFile(path.join(targetDir, 'analysis.json'), JSON.stringify(combined, null, 2), 'utf8');
    await progress(`Capture source imported: ${displayName}`);
    return {
      ...combined,
      sourceManifest,
    };
  } catch (error) {
    await fsp.rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}

async function syncCaptureSourcePackages(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  const minAgeMinutes = Math.max(0, Number(params.minAgeMinutes || 0));
  const scan = await scanCaptureSourcePackages(config, { minAgeMinutes });
  const overwrite = params.overwrite === true;
  const onlyNew = params.onlyNew !== false;
  const limit = Math.max(1, Math.min(Number(params.limit) || 50, 200));
  const autoGenerateBaseMaps = params.autoGenerateBaseMaps === true;
  const autoMerge = params.autoMerge === true;
  const maxBaseMapJobs = Math.max(1, Math.min(Number(params.maxBaseMapJobs) || 20, 100));
  const mergedMapName = sanitizePackageName(params.mergedMapName || 'capture_source_merged');
  const targets = scan.packages
    .filter((item) => item.stable !== false)
    .filter((item) => overwrite || !onlyNew || !item.imported)
    .slice(0, limit);
  const results = [];
  const unstableCount = scan.packages.filter((item) => item.stable === false).length;
  await progress(
    `Capture source scan: ${scan.packages.length} package(s), ${targets.length} to sync, ${unstableCount} waiting for stability`
  );
  for (let index = 0; index < targets.length; index += 1) {
    const item = targets[index];
    await progress(`Syncing capture package ${index + 1}/${targets.length}: ${item.sourcePackage}`);
    results.push(
      await importCaptureSourcePackage(config, {
        sourcePackage: item.sourcePackage,
        overwrite,
        minAgeMinutes,
        progress,
      })
    );
  }
  const generatedBaseMaps = [];
  if (autoGenerateBaseMaps) {
    const packages = await listDataPackages(config);
    const baseMapTargets = packages
      .filter((item) => item.sourceManifest?.sourceRoot === scan.sourceRoot)
      .filter((item) => item.workflowStatus?.canGenerateBaseMap)
      .filter((item) => params.overwriteBaseMaps === true || !item.baseMapExists)
      .slice(0, maxBaseMapJobs);
    await progress(`Base-map prebuild queue: ${baseMapTargets.length} package(s)`);
    for (let index = 0; index < baseMapTargets.length; index += 1) {
      const item = baseMapTargets[index];
      const mapName = sanitizePackageName(item.defaultMapName || item.displayName || item.packageId);
      await progress(`Generating base map ${index + 1}/${baseMapTargets.length}: ${mapName}`);
      generatedBaseMaps.push(
        await importDataPackageBaseMap(config, {
          packageId: item.packageId,
          mapName,
          overwrite: params.overwriteBaseMaps === true,
          progress,
        })
      );
    }
  }
  let mergedMap = null;
  if (autoMerge) {
    const packages = await listDataPackages(config);
    const groups = new Map();
    for (const item of selectLatestMergeCandidates(packages)) {
      if (item.sourceManifest?.sourceRoot !== scan.sourceRoot || !item.workflowStatus?.canMerge || !item.coordinateGroup) {
        continue;
      }
      if (!groups.has(item.coordinateGroup)) {
        groups.set(item.coordinateGroup, []);
      }
      groups.get(item.coordinateGroup).push(item);
    }
    const mergeGroups = Array.from(groups.values()).sort((left, right) => {
      const rightPoints = right.reduce((sum, item) => sum + Number(item.summary?.pointCount || 0), 0);
      const leftPoints = left.reduce((sum, item) => sum + Number(item.summary?.pointCount || 0), 0);
      return right.length - left.length || rightPoints - leftPoints;
    });
    const mergeTargets = mergeGroups[0] || [];
    if (mergeTargets.length >= 2) {
      await progress(`Generating stitched base map: ${mergedMapName}; packages=${mergeTargets.length}`);
      mergedMap = await importMergedDataPackagesBaseMap(config, {
        packageIds: mergeTargets.map((item) => item.packageId),
        mapName: mergedMapName,
        overwrite: params.overwriteMergedMap !== false,
        progress,
      });
    } else {
      await progress('Skipping stitched base map: fewer than 2 compatible packages');
    }
  }
  return {
    sourceRoot: scan.sourceRoot,
    scannedCount: scan.packages.length,
    importedCount: results.filter((item) => !item.skipped).length,
    skippedCount: results.filter((item) => item.skipped).length,
    generatedBaseMapCount: generatedBaseMaps.length,
    generatedBaseMaps,
    mergedMap,
    results,
  };
}

async function prebuildDataPackageBaseMaps(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  const maxAnalysisJobs = Math.max(1, Math.min(Number(params.maxAnalysisJobs) || 20, 100));
  const maxBaseMapJobs = Math.max(1, Math.min(Number(params.maxBaseMapJobs) || 20, 100));
  const autoMerge = params.autoMerge !== false;
  const mergedMapName = sanitizePackageName(params.mergedMapName || 'capture_inbox_merged');
  const overwriteBaseMaps = params.overwriteBaseMaps === true;
  const overwriteMergedMap = params.overwriteMergedMap === true;
  const initialPackages = await listDataPackages(config);
  const analysisTargets = initialPackages
    .filter((item) => item.workflowStatus?.errors?.includes('analysis_missing'))
    .slice(0, maxAnalysisJobs);
  const refreshedAnalyses = [];
  await progress(`Inbox precheck queue: ${analysisTargets.length} package(s)`);
  for (let index = 0; index < analysisTargets.length; index += 1) {
    const item = analysisTargets[index];
    await progress(`Prechecking package ${index + 1}/${analysisTargets.length}: ${item.displayName}`);
    refreshedAnalyses.push(await refreshDataPackageAnalysis(config, { packageId: item.packageId }));
  }

  const packages = await listDataPackages(config);
  const baseMapTargets = packages
    .filter((item) => item.workflowStatus?.canGenerateBaseMap)
    .filter((item) => overwriteBaseMaps || !item.baseMapExists)
    .slice(0, maxBaseMapJobs);
  const generatedBaseMaps = [];
  await progress(`Inbox base-map prebuild queue: ${baseMapTargets.length} package(s)`);
  for (let index = 0; index < baseMapTargets.length; index += 1) {
    const item = baseMapTargets[index];
    const mapName = sanitizePackageName(item.defaultMapName || item.displayName || item.packageId);
    await progress(`Generating base map ${index + 1}/${baseMapTargets.length}: ${mapName}`);
    generatedBaseMaps.push(
      await importDataPackageBaseMap(config, {
        packageId: item.packageId,
        mapName,
        overwrite: overwriteBaseMaps,
        progress,
      })
    );
  }

  let mergedMap = null;
  if (autoMerge) {
    const mergedMapExists = await pathExists(path.join(config.baseMapRoot, mergedMapName, 'map_images', 'tiles.json'));
    if (generatedBaseMaps.length === 0 && mergedMapExists && !overwriteMergedMap) {
      await progress(`Skipping stitched base map: ${mergedMapName} is already current`);
    } else {
      const latestPackages = await listDataPackages(config);
      const groups = new Map();
      for (const item of selectLatestMergeCandidates(latestPackages)) {
        if (!item.workflowStatus?.canMerge || !item.coordinateGroup) {
          continue;
        }
        if (!groups.has(item.coordinateGroup)) {
          groups.set(item.coordinateGroup, []);
        }
        groups.get(item.coordinateGroup).push(item);
      }
      const mergeGroups = Array.from(groups.values()).sort((left, right) => {
        const rightPoints = right.reduce((sum, item) => sum + Number(item.summary?.pointCount || 0), 0);
        const leftPoints = left.reduce((sum, item) => sum + Number(item.summary?.pointCount || 0), 0);
        return right.length - left.length || rightPoints - leftPoints;
      });
      const mergeTargets = mergeGroups[0] || [];
      if (mergeTargets.length >= 2) {
        await progress(`Generating stitched base map: ${mergedMapName}; packages=${mergeTargets.length}`);
        mergedMap = await importMergedDataPackagesBaseMap(config, {
          packageIds: mergeTargets.map((item) => item.packageId),
          mapName: mergedMapName,
          overwrite: true,
          progress,
        });
      } else {
        await progress('Skipping stitched base map: fewer than 2 compatible packages');
      }
    }
  }

  return {
    scannedCount: initialPackages.length,
    refreshedAnalysisCount: refreshedAnalyses.length,
    generatedBaseMapCount: generatedBaseMaps.length,
    refreshedAnalyses,
    generatedBaseMaps,
    mergedMap,
  };
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

function normalizePackageDisplayName(displayName) {
  const normalized = String(displayName || '')
    .trim()
    .replace(/[\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 96);
  if (!normalized) {
    throw new Error('displayName is required');
  }
  if (/[\\/:*?"<>|]/.test(normalized)) {
    throw new Error('displayName must not contain path separators or reserved filename characters');
  }
  return normalized;
}

async function readPackageMetadata(packageDir) {
  const metadataPath = path.join(packageDir, 'package_metadata.json');
  if (!(await pathExists(metadataPath))) {
    return {};
  }
  const content = await fsp.readFile(metadataPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function writePackageMetadata(packageDir, metadata) {
  await fsp.writeFile(path.join(packageDir, 'package_metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
}

async function readPackageSourceManifest(packageDir) {
  const manifestPath = path.join(packageDir, 'source_manifest.json');
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  const content = await fsp.readFile(manifestPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function readAnalysisFile(packageDir) {
  const analysisPath = path.join(packageDir, 'analysis.json');
  if (!(await pathExists(analysisPath))) {
    return null;
  }
  const content = await fsp.readFile(analysisPath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

function combineBounds(items) {
  const boundsList = (items || []).map((item) => item.bounds).filter(Boolean);
  if (boundsList.length === 0) {
    return null;
  }
  const result = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const bounds of boundsList) {
    result.minX = Math.min(result.minX, Number(bounds.minX));
    result.minY = Math.min(result.minY, Number(bounds.minY));
    result.minZ = Math.min(result.minZ, Number(bounds.minZ || 0));
    result.maxX = Math.max(result.maxX, Number(bounds.maxX));
    result.maxY = Math.max(result.maxY, Number(bounds.maxY));
    result.maxZ = Math.max(result.maxZ, Number(bounds.maxZ || 0));
  }
  if (!Object.values(result).every(Number.isFinite)) {
    return null;
  }
  return {
    minX: roundPointValue(result.minX),
    minY: roundPointValue(result.minY),
    minZ: roundPointValue(result.minZ),
    maxX: roundPointValue(result.maxX),
    maxY: roundPointValue(result.maxY),
    maxZ: roundPointValue(result.maxZ),
  };
}

function buildCoordinateGroup(kind, bounds) {
  if (!kind || !bounds) {
    return null;
  }
  const centerX = (Number(bounds.minX) + Number(bounds.maxX)) / 2;
  const centerY = (Number(bounds.minY) + Number(bounds.maxY)) / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return null;
  }
  const bucketSize = kind === 'lonlat_range_compatible' ? 0.05 : 10000;
  return `${kind}:x${Math.round(centerX / bucketSize)}:y${Math.round(centerY / bucketSize)}`;
}

function buildPackageQuality(summary, analyses) {
  const pointClouds = (analyses || []).flatMap((analysis) => analysis.pointClouds || []);
  const preferredPointClouds = selectPreferredPointCloudAnalyses(pointClouds);
  const bounds = combineBounds(preferredPointClouds);
  const pointCount = Number(summary?.pointCount || 0);
  const width = bounds ? Math.max(0, Number(bounds.maxX) - Number(bounds.minX)) : 0;
  const height = bounds ? Math.max(0, Number(bounds.maxY) - Number(bounds.minY)) : 0;
  const areaSquareMeters = width > 0 && height > 0 ? width * height : 0;
  const pointDensity = areaSquareMeters > 0 ? pointCount / areaSquareMeters : 0;
  const coordinateKinds = Array.from(new Set(pointClouds.map((item) => item.coordinate?.kind).filter(Boolean)));
  const representativeCoordinateKind =
    summary?.trajectory?.preferredCoordinateKind || coordinateKinds[0] || null;
  const coordinateGroup = buildCoordinateGroup(representativeCoordinateKind, bounds);
  const hasMixedCoordinateKinds = coordinateKinds.length > 1;
  let rating = 'unknown';
  if (pointCount > 0 && areaSquareMeters > 0) {
    if (pointDensity >= 120) {
      rating = 'excellent';
    } else if (pointDensity >= 40) {
      rating = 'good';
    } else if (pointDensity >= 10) {
      rating = 'usable';
    } else {
      rating = 'sparse';
    }
  }
  return {
    rating,
    pointDensity: Number.isFinite(pointDensity) ? Number(pointDensity.toFixed(2)) : 0,
    areaSquareMeters: Number.isFinite(areaSquareMeters) ? Number(areaSquareMeters.toFixed(2)) : 0,
    bounds,
    coordinateKinds,
    representativeCoordinateKind,
    coordinateGroup,
    hasMixedCoordinateKinds,
  };
}

async function baseMapExistsForPackage(config, displayName) {
  const mapName = sanitizePackageName(displayName || '');
  if (!mapName) {
    return false;
  }
  return pathExists(path.join(config.baseMapRoot, mapName, 'map_images', 'tiles.json'));
}

function normalizeCaptureReplacementKey(packageInfo) {
  const sourceName =
    packageInfo?.sourceManifest?.displayName ||
    packageInfo?.displayName ||
    packageInfo?.defaultMapName ||
    packageInfo?.packageId ||
    '';
  const withoutPrefix = String(sourceName).replace(/^sync[-_]/i, '');
  const withoutNotes = withoutPrefix
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/【[^】]*】/g, '');
  return sanitizePackageName(withoutNotes).toLowerCase();
}

function getPackageFreshnessTime(packageInfo) {
  return Math.max(
    Date.parse(packageInfo?.sourceManifest?.newestLastWriteUtc || '') || 0,
    Date.parse(packageInfo?.sourceManifest?.syncedAt || '') || 0,
    Date.parse(packageInfo?.modifiedAt || '') || 0,
    Date.parse(packageInfo?.createdAt || '') || 0
  );
}

function annotateLatestCapturePackages(packages) {
  const latestByKey = new Map();
  for (const item of packages) {
    const key = normalizeCaptureReplacementKey(item);
    if (!key) {
      continue;
    }
    const current = latestByKey.get(key);
    if (!current || getPackageFreshnessTime(item) >= getPackageFreshnessTime(current)) {
      latestByKey.set(key, item);
    }
  }
  return packages.map((item) => {
    const key = normalizeCaptureReplacementKey(item);
    const latest = key ? latestByKey.get(key) : null;
    return {
      ...item,
      captureReplacementKey: key || null,
      isLatestCapturePackage: !latest || latest.packageId === item.packageId,
      supersededByPackageId: latest && latest.packageId !== item.packageId ? latest.packageId : null,
    };
  });
}

function selectLatestMergeCandidates(packages) {
  return annotateLatestCapturePackages(packages).filter((item) => item.isLatestCapturePackage);
}

function buildPackageWorkflowStatus({ summary, analyses, quality, sourceManifest, baseMapExists }) {
  const pointCloudFiles = Number(summary?.pointCloudFiles || 0);
  const hasAnalysis = Array.isArray(analyses) && analyses.length > 0;
  const errors = [];
  const warnings = [];
  if (!sourceManifest) {
    warnings.push('missing_source_manifest');
  }
  if (!hasAnalysis) {
    if (baseMapExists) {
      return {
        code: 'base_map_ready',
        label: '底图已生成',
        canGenerateBaseMap: true,
        canMerge: false,
        errors: ['analysis_missing'],
        warnings,
        recommendedAction: 'run_precheck',
      };
    }
    return {
      code: 'pending_precheck',
      label: '待预检',
      canGenerateBaseMap: false,
      canMerge: false,
      errors: ['analysis_missing'],
      warnings,
      recommendedAction: 'run_precheck',
    };
  }
  if (pointCloudFiles <= 0) {
    errors.push('point_cloud_missing');
  }
  if (quality?.hasMixedCoordinateKinds) {
    errors.push('coordinate_mixed');
  }
  if (!quality?.coordinateGroup) {
    warnings.push('coordinate_group_unknown');
  }
  if (quality?.rating === 'sparse') {
    warnings.push('point_density_sparse');
  }
  if (errors.length > 0) {
    return {
      code: errors.includes('point_cloud_missing') ? 'missing_point_cloud' : 'precheck_failed',
      label: errors.includes('point_cloud_missing') ? '缺点云' : '需处理',
      canGenerateBaseMap: false,
      canMerge: false,
      errors,
      warnings,
      recommendedAction: 'inspect_package',
    };
  }
  if (baseMapExists) {
    return {
      code: 'base_map_ready',
      label: '底图已生成',
      canGenerateBaseMap: true,
      canMerge: true,
      errors,
      warnings,
      recommendedAction: 'open_or_merge',
    };
  }
  return {
    code: 'ready_for_basemap',
    label: '可生成底图',
    canGenerateBaseMap: true,
    canMerge: true,
    errors,
    warnings,
    recommendedAction: 'generate_base_map',
  };
}

async function listDataPackages(config, options = {}) {
  const includeAnalyses = options.includeAnalyses !== false;
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
    const metadata = await readPackageMetadata(packageDir).catch(() => ({}));
    const sourceManifest = await readPackageSourceManifest(packageDir).catch(() => null);
    const analyses = normalizePackageAnalysesForCurrentRules(analysis?.analyses || []);
    const summary = analyses.length ? summarizeCombinedPackageAnalysis(analyses) : analysis?.summary || null;
    const displayName = metadata.displayName || analysis?.displayName || defaultMapNameFromPackageId(packageId);
    const quality = buildPackageQuality(summary, analyses);
    const baseMapExists = await baseMapExistsForPackage(config, displayName);
    const workflowStatus = buildPackageWorkflowStatus({
      summary,
      analyses,
      quality,
      sourceManifest,
      baseMapExists,
    });
    packages.push({
      packageId,
      path: packageDir,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      displayName,
      defaultMapName: displayName,
      sourceManifest,
      summary,
      analyses: includeAnalyses ? analyses : undefined,
      analysisCount: analyses.length,
      quality,
      coordinateGroup: quality.coordinateGroup,
      workflowStatus,
      baseMapExists,
      uploadedFiles: analysis?.uploadedFiles || [],
      sizeBytes: await getDirectorySize(packageDir),
    });
  }
  const annotatedPackages = annotateLatestCapturePackages(packages);
  annotatedPackages.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
  return annotatedPackages;
}

async function updateDataPackage(config, params) {
  const packageId = validatePackageId(params.packageId);
  const packageDir = await resolveDataPackageDir(config, packageId);
  const existing = await readPackageMetadata(packageDir).catch(() => ({}));
  const displayName = normalizePackageDisplayName(params.displayName);
  const now = new Date().toISOString();
  await writePackageMetadata(packageDir, {
    ...existing,
    packageId,
    displayName,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  });
  const packages = await listDataPackages(config);
  return (
    packages.find((item) => item.packageId === packageId) || {
      packageId,
      displayName,
      defaultMapName: displayName,
    }
  );
}

async function deleteDataPackage(config, params) {
  const packageId = validatePackageId(params.packageId);
  const packageRoot = getImportPackageRoot(config);
  const trashRoot = getImportPackageTrashRoot(config);
  const packageDir = await resolveDataPackageDir(config, packageId);
  if (!packageDir.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('packageId resolved outside import package root');
  }
  await fsp.mkdir(trashRoot, { recursive: true });
  const deletedAt = new Date().toISOString();
  const stamp = deletedAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  let trashDir = path.resolve(trashRoot, `${stamp}-${packageId}`);
  if (!trashDir.startsWith(`${trashRoot}${path.sep}`)) {
    throw new Error('trash path resolved outside import package trash root');
  }
  let suffix = 1;
  while (await pathExists(trashDir)) {
    suffix += 1;
    trashDir = path.resolve(trashRoot, `${stamp}-${packageId}-${suffix}`);
  }
  const existing = await readPackageMetadata(packageDir).catch(() => ({}));
  await writePackageMetadata(packageDir, {
    ...existing,
    packageId,
    deletedAt,
    deletedFrom: packageDir,
    updatedAt: deletedAt,
  });
  await fsp.rename(packageDir, trashDir);
  return {
    packageId,
    deletedAt,
    trashPath: trashDir,
  };
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

async function getDataPackageImportFiles(config, packageId) {
  const normalizedPackageId = validatePackageId(packageId);
  const packageDir = await resolveDataPackageDir(config, normalizedPackageId);
  const uploadDir = path.join(packageDir, 'uploads');
  const files = await listDataPackageImportFilesFromRoot(packageDir, uploadDir);
  return { packageId: normalizedPackageId, packageDir, files };
}

function createStitchAnchor(packageInfo) {
  const summary = packageInfo?.summary || {};
  const trajectory = summary.trajectory || {};
  const trajectoryBounds = trajectory.bounds;
  if (trajectoryBounds && trajectory.preferredCoordinateKind) {
    const x = (Number(trajectoryBounds.minX) + Number(trajectoryBounds.maxX)) / 2;
    const y = (Number(trajectoryBounds.minY) + Number(trajectoryBounds.maxY)) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      source: 'trajectory',
      coordinateKind: trajectory.preferredCoordinateKind,
      preferredSource: trajectory.preferredSource || null,
      x: roundPointValue(x),
      y: roundPointValue(y),
    };
  }
  const pointClouds = (packageInfo?.analyses || []).flatMap((item) => item.pointClouds || []);
  const pointCloud = selectPreferredPointCloudAnalyses(pointClouds)[0] || pointClouds[0];
  if (pointCloud?.bounds) {
    const x = (Number(pointCloud.bounds.minX) + Number(pointCloud.bounds.maxX)) / 2;
    const y = (Number(pointCloud.bounds.minY) + Number(pointCloud.bounds.maxY)) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      source: 'point_cloud',
      coordinateKind: pointCloud.coordinate?.kind || null,
      preferredSource: pointCloud.source || null,
      x: roundPointValue(x),
      y: roundPointValue(y),
    };
  }
  return null;
}

async function buildDataPackageStitchPlan(config, packageIds) {
  const packages = [];
  for (const packageId of packageIds) {
    const packageDir = await resolveDataPackageDir(config, packageId);
    const analysis = await readAnalysisFile(packageDir).catch(() => null);
    const metadata = await readPackageMetadata(packageDir).catch(() => ({}));
    const analyses = normalizePackageAnalysesForCurrentRules(analysis?.analyses || []);
    const summary = analyses.length ? summarizeCombinedPackageAnalysis(analyses) : analysis?.summary || null;
    const quality = buildPackageQuality(summary, analyses);
    const packageInfo = {
      packageId,
      path: packageDir,
      analyses,
      summary,
      quality,
    };
    const trajectoryAnchor = createStitchAnchor({
      summary: {
        trajectory: packageInfo.summary?.trajectory || {},
      },
      analyses: [],
    });
    const pointCloudAnchor = createStitchAnchor({
      summary: {},
      analyses: packageInfo.analyses,
    });
    packages.push({
      packageId,
      displayName: metadata.displayName || defaultMapNameFromPackageId(packageId),
      anchor: trajectoryAnchor || pointCloudAnchor,
      trajectoryAnchor,
      pointCloudAnchor,
      quality,
      coordinateGroup: quality.coordinateGroup,
      pointCloudFiles: packageInfo.summary?.pointCloudFiles || 0,
      trajectory: packageInfo.summary?.trajectory || null,
    });
  }
  const reference = packages.find((item) => item.anchor)?.anchor || null;
  const coordinateGroups = Array.from(new Set(packages.map((item) => item.coordinateGroup).filter(Boolean)));
  const missingCoordinateGroups = packages.filter((item) => !item.coordinateGroup).map((item) => item.packageId);
  const mismatchedCoordinateGroups = coordinateGroups.length > 1;
  const ready = Boolean(reference) && missingCoordinateGroups.length === 0 && !mismatchedCoordinateGroups;
  return {
    ready,
    reference,
    coordinateGroups,
    missingCoordinateGroups,
    errors: [
      ...(reference ? [] : ['missing_reference_anchor']),
      ...(missingCoordinateGroups.length ? ['missing_coordinate_group'] : []),
      ...(mismatchedCoordinateGroups ? ['coordinate_group_mismatch'] : []),
    ],
    packages: packages.map((item) => ({
      ...item,
      offsetFromReference:
        reference && item.anchor
          ? {
              x: roundPointValue(item.anchor.x - reference.x),
              y: roundPointValue(item.anchor.y - reference.y),
            }
          : null,
      stitchingReadiness:
        ready && item.anchor && item.coordinateGroup === coordinateGroups[0]
          ? 'same_anchor_coordinate_kind'
          : !item.anchor
            ? 'missing_anchor'
            : !item.coordinateGroup
              ? 'missing_coordinate_group'
              : 'anchor_coordinate_kind_differs',
    })),
  };
}

async function importDataPackageBaseMap(config, params) {
  const packageId = validatePackageId(params.packageId);
  const progress = typeof params.progress === 'function' ? params.progress : null;
  if (progress) {
    await progress(`Preparing data package ${packageId}`);
  }
  const { packageDir, files } = await getDataPackageImportFiles(config, packageId);
  if (files.length === 0) {
    throw new Error(`data package has no importable point cloud files: ${packageId}`);
  }
  const metadata = await readPackageMetadata(packageDir).catch(() => ({}));
  const sourceManifest = await readPackageSourceManifest(packageDir).catch(() => null);
  const mapName = params.mapName || sanitizePackageName(metadata.displayName || defaultMapNameFromPackageId(packageId));
  const result = await importPointCloudFilesBaseMap(config, {
    mapName,
    overwrite: params.overwrite === true,
    files,
    progress,
    sourceAsset: {
      type: 'data_package',
      packageId,
      displayName: metadata.displayName || defaultMapNameFromPackageId(packageId),
      sourceManifest,
    },
  });
  return {
    ...result,
    packageId,
    packagePath: packageDir,
  };
}

async function importMergedDataPackagesBaseMap(config, params) {
  const progress = typeof params?.progress === 'function' ? params.progress : null;
  const requestedPackageIds = Array.isArray(params?.packageIds) ? params.packageIds : [];
  const packageIds = Array.from(new Set(requestedPackageIds.map(validatePackageId)));
  if (packageIds.length < 2) {
    throw new Error('at least two packageIds are required');
  }
  if (progress) {
    await progress(`Preparing ${packageIds.length} data packages for merged base map`);
  }
  const allFiles = [];
  for (const packageId of packageIds) {
    if (progress) {
      await progress(`Collecting import files: ${packageId}`);
    }
    const { files } = await getDataPackageImportFiles(config, packageId);
    allFiles.push(...files.map((file) => ({ ...file, packageId })));
  }
  const importableFiles = allFiles.filter(
    (file) => isSupportedPointCloudUploadName(file.originalName) || isImageName(file.originalName)
  );
  if (importableFiles.length === 0) {
    throw new Error('selected data packages have no importable point cloud files');
  }
  const mapName = params.mapName || sanitizePackageName(`merged_${packageIds[0]}`);
  if (progress) {
    await progress(`Building stitch plan for ${packageIds.length} data packages`);
  }
  const stitchPlan = await buildDataPackageStitchPlan(config, packageIds);
  if (!stitchPlan.ready && params.allowMixedCoordinateGroups !== true) {
    throw new Error(
      `selected packages cannot be merged safely: ${stitchPlan.errors.join(', ') || 'unknown stitch-plan error'}`
    );
  }
  const result = await importPointCloudFilesBaseMap(config, {
    mapName,
    overwrite: params.overwrite === true,
    files: importableFiles,
    progress,
    stitchPlan,
    sourceAsset: {
      type: 'merged_data_packages',
      packageIds,
      stitchPlan,
    },
  });
  return {
    ...result,
    packageIds,
    stitchPlan,
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
  const archive = await openZipArchive(filePath, `点云 ZIP ${path.basename(filePath)}`);
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
  const progress = typeof params.progress === 'function' ? params.progress : null;
  if (files.length === 0) {
    throw new Error('file is required');
  }

  const cloudFiles = files.filter((file) => isSupportedPointCloudUploadName(file.originalName || file.originalname || file.path));
  const imageFiles = files.filter((file) => isImageName(file.originalName || file.originalname || file.path));
  if (cloudFiles.length === 0) {
    throw new Error('点云底图请上传 .pcd/.ply/.xyz/.txt/.csv/.las 文件，或包含这些文件的 .zip');
  }
  if (progress) {
    await progress(`Starting base-map generation: ${mapName}; point-cloud files=${cloudFiles.length}`);
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
      if (progress) {
        await progress(`Scanning statistics ${sourceFiles.length + 1}/${cloudFiles.length}: ${originalName}`);
      }
      const parsed = await scanPointCloudFile(file.path, originalName, statsCollector.addPoint);
      sourceFiles.push(...(parsed.selectedSourceFiles || parsed.sourceFiles || [originalName]));
      imageFileCount += parsed.imageFileCount || 0;
    }
    const stats = statsCollector.finalize();
    if (progress) {
      await progress(`Statistics ready: ${stats.totalPointCount} points; rendering raster layers`);
    }
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
      layers.raw.addPointValue(x, y, z, Math.max(32, Math.round(value * 0.72)), 0);
      if (isGround) {
        const groundValue = Math.max(48, Math.round(value * 0.72));
        layers.ground.addPointValue(x, y, z, groundValue, 0);
        layers.enhanced.addPointValue(x, y, z, Math.max(38, Math.round(value * 0.54)), 0);
      }
      if (isEdge) {
        layers.edge.addPointValue(x, y, z, 245, 1);
        layers.enhanced.addPointValue(x, y, z, 180, 1);
      }
      if (isMarking) {
        layers.marking.addPointValue(x, y, z, 255, 2);
        layers.enhanced.addPointValue(x, y, z, 255, 1);
      }
      if (!isGround) {
        const structureValue = Math.max(86, Math.min(210, Math.round(value * 0.72 + 46)));
        const enhancedValue = relativeZ > 0.5 ? Math.max(96, structureValue) : Math.max(72, structureValue - 24);
        layers.structure.addPointValue(x, y, z, Math.max(120, structureValue), 1);
        layers.enhanced.addPointValue(x, y, z, enhancedValue, 0);
      }
    };

    for (let fileIndex = 0; fileIndex < cloudFiles.length; fileIndex += 1) {
      const file = cloudFiles[fileIndex];
      const originalName = file.originalName || file.originalname || path.basename(file.path);
      if (progress) {
        await progress(`Rendering raster ${fileIndex + 1}/${cloudFiles.length}: ${originalName}`);
      }
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
      stitchPlan: params.stitchPlan || null,
      sourceAsset: params.sourceAsset || null,
      processing: {
        mode: 'resultout_las_annotation_raster',
        purpose: 'apollo_hdmap_annotation',
        tileResolutionMetersPerPixel: getPointCloudTileResolution(Math.max(...POINT_CLOUD_TILE_LEVELS)),
        groundGrid: stats.groundGrid,
        intensity: stats.intensity,
        outputs: layerDescriptors.map((layer) => layer.id),
      },
    };
    if (progress) {
      await progress('Writing tile layer: enhanced');
    }
    const parsed = await layers.enhanced.writeTiles(path.join(stagingDir, 'map_images'), metadata);
    for (const layer of layerDescriptors) {
      if (layer.id === 'enhanced') {
        continue;
      }
      if (progress) {
        await progress(`Writing tile layer: ${layer.id}`);
      }
      await layers[layer.id].writeTiles(path.join(stagingDir, layer.path), {
        ...metadata,
        sourceType: `point_cloud_${layer.id}`,
        allowEmpty: true,
      });
    }
    if (progress) {
      await progress('Copying source files into base map package');
    }
    await copyImportSources(files, stagingDir);
    if (params.stitchPlan) {
      await fsp.writeFile(path.join(stagingDir, 'stitch_plan.json'), JSON.stringify(params.stitchPlan, null, 2), 'utf8');
    }
    if (progress) {
      await progress(`Activating base map: ${mapName}`);
    }
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
      stitchPlan: params.stitchPlan || null,
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
    const converterReady = status.local.converterAvailable || status.local.converterFallbackAvailable;
    addCheck(
      'editor-map-converter',
      converterReady,
      'error',
      status.local.converterAvailable
        ? 'Native editor_map_converter is available'
        : `Native editor_map_converter is missing at ${status.local.converterBinary}; JS compatible converter will be used`
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
  addCheck(
    'apollolite-staging',
    status.apolloLite.stagingReady,
    status.apolloLite.enabled ? 'error' : 'warning',
    status.apolloLite.stagingMessage || status.apolloLite.message
  );
  if (status.apolloLite.enabled && status.apolloLite.root) {
    addCheck(
      'apollolite-root',
      status.apolloLite.rootAvailable && status.apolloLite.apolloShAvailable,
      'warning',
      status.apolloLite.apolloShAvailable
        ? `ApolloLite source is available: ${status.apolloLite.root}`
        : `ApolloLite source is incomplete or missing apollo.sh: ${status.apolloLite.root}`
    );
    addCheck(
      'apollolite-simulation',
      status.apolloLite.simulationReady,
      'warning',
      status.apolloLite.simulationMessage
    );
  }

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
    port: edge.port || 22,
    target: buildEdgeTarget(config),
    targetMapRoot: edge.targetMapRoot,
    postDeployCommand: edge.postDeployCommand || '',
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

  const sshBaseArgs = buildSshBaseArgs(config);

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
    return convertEditorMapToApolloPackage({
      mapName,
      jsonPath,
      releaseDir,
      baseMapDir,
    });
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

async function deployReleasedMap(config, params = {}) {
  const { mapName } = params;
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  const deploymentId = params.deploymentId || createDeploymentId('deploy');
  const startedAt = new Date().toISOString();
  const baseRecord = {
    id: deploymentId,
    type: 'deploy',
    mapName: mapName || '',
    startedAt,
    finishedAt: null,
    status: 'failed',
    target: getDeployConfig(config),
  };
  if (!mapName) {
    throw new Error('mapName is required');
  }
  try {
    await progress(`Preparing edge deployment for ${mapName}`);
    if (config.edgeDeploy.mode === 'disabled') {
      throw new Error('edge deploy is disabled');
    }
    const sourceDir = path.join(config.releaseRoot, mapName);
    if (!(await pathExists(sourceDir))) {
      throw new Error(`released map not found at ${sourceDir}`);
    }
    await requireReleasedMapReady(config, mapName);
    if (config.edgeDeploy.mode !== 'ssh') {
      throw new Error(`unsupported edge deploy mode: ${config.edgeDeploy.mode}`);
    }
    if (!config.edgeDeploy.host || !config.edgeDeploy.user) {
      throw new Error('edgeDeploy.host and edgeDeploy.user are required');
    }
    await progress(`Running edge preflight: ${config.edgeDeploy.user}@${config.edgeDeploy.host}`);
    const preflight = await preflightEdgeDeploy(config);
    if (!preflight.ready) {
      const failedChecks = preflight.checks
        .filter((check) => check.status === 'error')
        .map((check) => `${check.name}: ${check.message}`)
        .join('; ');
      throw new Error(`edge deploy preflight failed: ${failedChecks}`);
    }
    const edgeTarget = buildEdgeTarget(config);
    const sshBaseArgs = buildSshBaseArgs(config);
    const remoteRoot = config.edgeDeploy.targetMapRoot.replace(/\/+$/, '');
    const remoteMapDir = `${remoteRoot}/${mapName}`;
    const backupRoot = `${remoteRoot}/.mapeditor_backups`;
    const rollbackRoot = `${remoteRoot}/.mapeditor_replaced`;
    const uploadParent = `${remoteRoot}/.mapeditor_uploads/${deploymentId}`;
    const backupDir = `${backupRoot}/${mapName}-${deploymentId}`;
    const remoteUploadedDir = `${uploadParent}/${path.basename(sourceDir)}`;
    await progress(`Checking existing map on edge: ${remoteMapDir}`);
    const hadBackupResult = await runCommand('ssh', [
      ...sshBaseArgs,
      `[ -d ${quoteShell(remoteMapDir)} ] && echo yes || echo no`,
    ]);
    const hadBackup = hadBackupResult.stdout.trim() === 'yes';
    await progress(`Preparing remote deployment directories under ${remoteRoot}`);
    await runCommand('ssh', [
      ...sshBaseArgs,
      `mkdir -p ${quoteShell(uploadParent)} ${quoteShell(backupRoot)} ${quoteShell(rollbackRoot)}`,
    ]);
    const copyTarget = `${edgeTarget}:${uploadParent}/`;
    await progress(`Copying released map to edge: ${mapName}`);
    const copyResult = await runCommand('scp', [...buildScpBaseArgs(config), '-r', sourceDir, copyTarget], {
      timeoutMs: 10 * 60 * 1000,
    });
    await progress(`Activating map on edge: ${remoteMapDir}`);
    const activateCommand = [
      `[ -d ${quoteShell(remoteMapDir)} ] && rm -rf ${quoteShell(backupDir)} && mv ${quoteShell(remoteMapDir)} ${quoteShell(
        backupDir
      )} || true`,
      `rm -rf ${quoteShell(remoteMapDir)}`,
      `mv ${quoteShell(remoteUploadedDir)} ${quoteShell(remoteMapDir)}`,
      `rm -rf ${quoteShell(uploadParent)}`,
    ].join(' && ');
    const activateResult = await runCommand('ssh', [...sshBaseArgs, activateCommand], {
      timeoutMs: 2 * 60 * 1000,
    });
    let postDeployResult = null;
    if (config.edgeDeploy.postDeployCommand) {
      await progress('Running post-deploy command on edge');
      postDeployResult = await runCommand('ssh', [...sshBaseArgs, config.edgeDeploy.postDeployCommand]);
    }
    await progress('Recording deployment result');
    const record = await appendDeploymentRecord(config, {
      ...baseRecord,
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      sourceDir,
      remoteMapDir,
      backupDir: hadBackup ? backupDir : null,
      hadBackup,
      copy: {
        code: copyResult.code,
        stderr: copyResult.stderr,
      },
      activate: {
        code: activateResult.code,
        stderr: activateResult.stderr,
      },
      postDeploy: postDeployResult
        ? {
            code: postDeployResult.code,
            stdout: postDeployResult.stdout,
            stderr: postDeployResult.stderr,
          }
        : null,
    });
    await progress(`Deployment succeeded: ${mapName}`);
    return { deployment: record, preflight, copyResult, activateResult, postDeployResult };
  } catch (error) {
    await appendDeploymentRecord(config, {
      ...baseRecord,
      finishedAt: new Date().toISOString(),
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}

async function deployLatestReleasedMap(config, params = {}) {
  const progress = typeof params.progress === 'function' ? params.progress : async () => {};
  await progress('Selecting latest released map');
  const latest = await selectLatestReadyReleasedMap(config);
  await progress(`Latest complete released map selected: ${latest.mapName}`);
  const result = await deployReleasedMap(config, { mapName: latest.mapName, progress });
  return {
    mapName: latest.mapName,
    releasedMap: latest,
    ...result,
  };
}

async function rollbackDeployment(config, params = {}) {
  const records = await listDeployments(config);
  const targetRecord = params.deploymentId
    ? records.find((record) => record.id === params.deploymentId)
    : records.find(
        (record) =>
          record.type === 'deploy' &&
          record.status === 'succeeded' &&
          record.mapName === params.mapName &&
          record.backupDir
      );
  if (!targetRecord) {
    throw new Error(params.deploymentId ? `deployment not found: ${params.deploymentId}` : 'no rollbackable deployment found');
  }
  if (!targetRecord.backupDir) {
    throw new Error(`deployment has no backup to rollback: ${targetRecord.id}`);
  }
  const rollbackId = createDeploymentId('rollback');
  const preflight = await preflightEdgeDeploy(config);
  if (!preflight.ready) {
    const failedChecks = preflight.checks
      .filter((check) => check.status === 'error')
      .map((check) => `${check.name}: ${check.message}`)
      .join('; ');
    throw new Error(`edge deploy preflight failed: ${failedChecks}`);
  }
  const sshBaseArgs = buildSshBaseArgs(config);
  const remoteRoot = config.edgeDeploy.targetMapRoot.replace(/\/+$/, '');
  const remoteMapDir = targetRecord.remoteMapDir || `${remoteRoot}/${targetRecord.mapName}`;
  const replacedDir = `${remoteRoot}/.mapeditor_replaced/${targetRecord.mapName}-${rollbackId}`;
  const rollbackCommand = [
    `[ -d ${quoteShell(targetRecord.backupDir)} ]`,
    `mkdir -p ${quoteShell(path.posix.dirname(replacedDir))}`,
    `[ -d ${quoteShell(remoteMapDir)} ] && rm -rf ${quoteShell(replacedDir)} && mv ${quoteShell(remoteMapDir)} ${quoteShell(
      replacedDir
    )} || true`,
    `mv ${quoteShell(targetRecord.backupDir)} ${quoteShell(remoteMapDir)}`,
  ].join(' && ');
  try {
    const rollbackResult = await runCommand('ssh', [...sshBaseArgs, rollbackCommand], {
      timeoutMs: 2 * 60 * 1000,
    });
    let postDeployResult = null;
    if (config.edgeDeploy.postDeployCommand) {
      postDeployResult = await runCommand('ssh', [...sshBaseArgs, config.edgeDeploy.postDeployCommand]);
    }
    const record = await appendDeploymentRecord(config, {
      id: rollbackId,
      type: 'rollback',
      mapName: targetRecord.mapName,
      status: 'succeeded',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      target: getDeployConfig(config),
      rollbackOf: targetRecord.id,
      restoredFrom: targetRecord.backupDir,
      replacedDir,
      remoteMapDir,
      result: {
        code: rollbackResult.code,
        stdout: rollbackResult.stdout,
        stderr: rollbackResult.stderr,
      },
      postDeploy: postDeployResult
        ? {
            code: postDeployResult.code,
            stdout: postDeployResult.stdout,
            stderr: postDeployResult.stderr,
          }
        : null,
    });
    return { deployment: record, preflight, rollbackResult, postDeployResult };
  } catch (error) {
    await appendDeploymentRecord(config, {
      id: rollbackId,
      type: 'rollback',
      mapName: targetRecord.mapName,
      status: 'failed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      target: getDeployConfig(config),
      rollbackOf: targetRecord.id,
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}

module.exports = {
  getStatus,
  getRuntimeDoctor,
  getApolloLiteStatus,
  getDeployConfig,
  discoverEdgeMapRoot,
  configureEdgeDeploy,
  preflightEdgeDeploy,
  listReleasedMaps,
  listDeployments,
  analyzeDataPackage,
  refreshDataPackageAnalysis,
  listDataPackages,
  updateDataPackage,
  deleteDataPackage,
  scanCaptureSourcePackages,
  importCaptureSourcePackage,
  syncCaptureSourcePackages,
  prebuildDataPackageBaseMaps,
  buildDataPackageStitchPlan,
  importDataPackageBaseMap,
  importMergedDataPackagesBaseMap,
  generateAssistDrawingCandidates,
  importBaseMapZip,
  importPointCloudBaseMap,
  importPointCloudFilesBaseMap,
  importMapPackageZip,
  convertEditorMap,
  createBaseMap,
  inspectReleasedMapForApolloLite,
  stageReleasedMapToApolloLite,
  runApolloLiteSimulationSmokeTest,
  deployReleasedMap,
  deployLatestReleasedMap,
  rollbackDeployment,
};

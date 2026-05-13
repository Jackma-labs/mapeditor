const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream/promises');
const unzipper = require('unzipper');
const { runCommand } = require('./process');

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
  const tilePath = normalizedPaths.find(
    (entryPath) => entryPath === 'map_images/tiles.json' || entryPath.endsWith('/map_images/tiles.json')
  );
  if (!tilePath) {
    throw new Error('base map zip must contain map_images/tiles.json');
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
    for (const entry of entries) {
      const entryPath = entry.path.replace(/\\/g, '/');
      if (!entryPath.startsWith(archivePrefix)) {
        continue;
      }
      const relativePath = entryPath.slice(archivePrefix.length);
      if (!relativePath || relativePath.endsWith('/')) {
        continue;
      }
      const outputPath = resolveInside(stagingDir, relativePath);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await pipeline(entry.stream(), fs.createWriteStream(outputPath));
    }

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
  convertEditorMap,
  createBaseMap,
  deployReleasedMap,
  deployLatestReleasedMap,
};

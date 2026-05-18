const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');

const defaults = {
  appRoot,
  port: Number(process.env.MAP_BACKEND_PORT || process.env.PORT || 58000),
  uploadFileSizeBytes: Number(process.env.MAP_UPLOAD_FILE_SIZE_BYTES || 30 * 1024 * 1024 * 1024),
  baseMapRoot: path.join(appRoot, 'data/base_map'),
  editorMapRoot: path.join(appRoot, 'data/editor_map'),
  releaseRoot: path.join(appRoot, 'data/released_map'),
  importPackageRoot: path.join(appRoot, 'data/import_packages'),
  importPackageTrashRoot: path.join(appRoot, 'data/import_packages_trash'),
  captureSourceRoot: process.env.MAP_CAPTURE_SOURCE_ROOT || '',
  captureResultDirNames: (process.env.MAP_CAPTURE_RESULT_DIR_NAMES || 'ResultOut,Resultout,resultout,Result,result')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  captureAutoSync: {
    enabled: process.env.MAP_CAPTURE_AUTO_SYNC === 'true',
    intervalMinutes: Number(process.env.MAP_CAPTURE_AUTO_SYNC_INTERVAL_MINUTES || 10),
    limit: Number(process.env.MAP_CAPTURE_AUTO_SYNC_LIMIT || 50),
    autoGenerateBaseMaps: process.env.MAP_CAPTURE_AUTO_GENERATE_BASE_MAPS !== 'false',
    maxBaseMapJobs: Number(process.env.MAP_CAPTURE_AUTO_MAX_BASE_MAP_JOBS || 20),
    autoMerge: process.env.MAP_CAPTURE_AUTO_MERGE !== 'false',
    mergedMapName: process.env.MAP_CAPTURE_AUTO_MERGED_MAP_NAME || 'capture_source_merged',
  },
  inboxAutoPrebuild: {
    enabled: process.env.MAP_INBOX_AUTO_PREBUILD === 'true',
    intervalMinutes: Number(process.env.MAP_INBOX_AUTO_PREBUILD_INTERVAL_MINUTES || 10),
    maxAnalysisJobs: Number(process.env.MAP_INBOX_AUTO_MAX_ANALYSIS_JOBS || 20),
    maxBaseMapJobs: Number(process.env.MAP_INBOX_AUTO_MAX_BASE_MAP_JOBS || 20),
    autoMerge: process.env.MAP_INBOX_AUTO_MERGE !== 'false',
    mergedMapName: process.env.MAP_INBOX_AUTO_MERGED_MAP_NAME || 'capture_inbox_merged',
  },
  converterBinary: path.join(
    appRoot,
    'runtime/bin/editor_map_converter'
  ),
  skipValidation: process.env.MAP_SKIP_VALIDATION === 'true',
  frontendBuildRoot: path.join(appRoot, 'frontend/build/map_editor_frontend'),
  runtimeMode: process.env.MAP_RUNTIME_MODE || 'local',
  runtimeDockerContainer: process.env.MAP_RUNTIME_DOCKER_CONTAINER || 'map_editor',
  runtimeDockerImage:
    process.env.MAP_RUNTIME_DOCKER_IMAGE ||
    'registry.cn-hangzhou.aliyuncs.com/wheelos/apollo:hdmap-aarch64-20.04-20251212_2123',
  apolloRootInContainer: process.env.MAP_APOLLO_ROOT_IN_CONTAINER || '/apollo',
  dataRootInContainer: process.env.MAP_DATA_ROOT_IN_CONTAINER || '/apollo/data',
  configRootInContainer: process.env.MAP_CONFIG_ROOT_IN_CONTAINER || '/apollo/external_conf',
  tileMapCreatorInContainer:
    process.env.MAP_TILE_MAP_CREATOR_IN_CONTAINER ||
    '/apollo/bazel-bin/modules/private_tools/tile_map_images_creator/tile_map_images_creator',
  editorMapConverterInContainer:
    process.env.MAP_EDITOR_MAP_CONVERTER_IN_CONTAINER ||
    '/apollo/bazel-bin/modules/private_tools/map_tool/editor_map_converter',
  tileMapCreatorBinary: path.join(appRoot, 'runtime/bin/tile_map_images_creator'),
  tileMapConfig: path.join(appRoot, 'config/image_creator_conf.pb.txt'),
  edgeDeploy: {
    mode: process.env.MAP_EDGE_DEPLOY_MODE || 'disabled',
    host: process.env.MAP_EDGE_HOST || '',
    user: process.env.MAP_EDGE_USER || '',
    port: Number(process.env.MAP_EDGE_PORT || 22),
    targetMapRoot: process.env.MAP_EDGE_TARGET_MAP_ROOT || '/apollo/modules/map/data',
    postDeployCommand: process.env.MAP_EDGE_POST_DEPLOY_COMMAND || '',
  },
  apolloLite: {
    enabled: process.env.MAP_APOLLOLITE_ENABLED === 'true',
    root: process.env.MAP_APOLLOLITE_ROOT || '',
    mapRoot: process.env.MAP_APOLLOLITE_MAP_ROOT || '',
    dreamviewUrl: process.env.MAP_APOLLOLITE_DREAMVIEW_URL || 'http://127.0.0.1:8888',
    dreamviewProxyTarget: process.env.MAP_APOLLOLITE_DREAMVIEW_PROXY_TARGET || 'http://127.0.0.1:8888',
    autoStageOnRelease: process.env.MAP_APOLLOLITE_AUTO_STAGE_ON_RELEASE === 'true',
    validationCommand: process.env.MAP_APOLLOLITE_VALIDATION_COMMAND || '',
  },
};

const CONFIG_FILENAME = 'server.config.json';
const configPath = path.join(__dirname, CONFIG_FILENAME);

let userConfig = {};
if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    userConfig = JSON.parse(raw);
  } catch (error) {
    console.warn(
      `[simple-map-backend] Failed to parse ${CONFIG_FILENAME}:`,
      error
    );
  }
}

const merged = Object.assign({}, defaults, userConfig);
merged.edgeDeploy = {
  ...defaults.edgeDeploy,
  ...(userConfig.edgeDeploy || {}),
};
merged.apolloLite = {
  ...defaults.apolloLite,
  ...(userConfig.apolloLite || {}),
};

if (process.env.MAP_BACKEND_PORT || process.env.PORT) {
  merged.port = Number(process.env.MAP_BACKEND_PORT || process.env.PORT);
}
if (process.env.MAP_UPLOAD_FILE_SIZE_BYTES) {
  merged.uploadFileSizeBytes = Number(process.env.MAP_UPLOAD_FILE_SIZE_BYTES);
}
if (process.env.MAP_BASE_MAP_ROOT) {
  merged.baseMapRoot = process.env.MAP_BASE_MAP_ROOT;
}
if (process.env.MAP_EDITOR_MAP_ROOT) {
  merged.editorMapRoot = process.env.MAP_EDITOR_MAP_ROOT;
}
if (process.env.MAP_RELEASE_ROOT) {
  merged.releaseRoot = process.env.MAP_RELEASE_ROOT;
}
if (process.env.MAP_IMPORT_PACKAGE_ROOT) {
  merged.importPackageRoot = process.env.MAP_IMPORT_PACKAGE_ROOT;
}
if (process.env.MAP_IMPORT_PACKAGE_TRASH_ROOT) {
  merged.importPackageTrashRoot = process.env.MAP_IMPORT_PACKAGE_TRASH_ROOT;
}
if (process.env.MAP_CAPTURE_SOURCE_ROOT) {
  merged.captureSourceRoot = process.env.MAP_CAPTURE_SOURCE_ROOT;
}
if (process.env.MAP_CAPTURE_RESULT_DIR_NAMES) {
  merged.captureResultDirNames = process.env.MAP_CAPTURE_RESULT_DIR_NAMES.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
if (process.env.MAP_CAPTURE_AUTO_SYNC) {
  merged.captureAutoSync.enabled = process.env.MAP_CAPTURE_AUTO_SYNC === 'true';
}
if (process.env.MAP_CAPTURE_AUTO_SYNC_INTERVAL_MINUTES) {
  merged.captureAutoSync.intervalMinutes = Number(process.env.MAP_CAPTURE_AUTO_SYNC_INTERVAL_MINUTES);
}
if (process.env.MAP_CAPTURE_AUTO_SYNC_LIMIT) {
  merged.captureAutoSync.limit = Number(process.env.MAP_CAPTURE_AUTO_SYNC_LIMIT);
}
if (process.env.MAP_CAPTURE_AUTO_GENERATE_BASE_MAPS) {
  merged.captureAutoSync.autoGenerateBaseMaps = process.env.MAP_CAPTURE_AUTO_GENERATE_BASE_MAPS !== 'false';
}
if (process.env.MAP_CAPTURE_AUTO_MAX_BASE_MAP_JOBS) {
  merged.captureAutoSync.maxBaseMapJobs = Number(process.env.MAP_CAPTURE_AUTO_MAX_BASE_MAP_JOBS);
}
if (process.env.MAP_CAPTURE_AUTO_MERGE) {
  merged.captureAutoSync.autoMerge = process.env.MAP_CAPTURE_AUTO_MERGE !== 'false';
}
if (process.env.MAP_CAPTURE_AUTO_MERGED_MAP_NAME) {
  merged.captureAutoSync.mergedMapName = process.env.MAP_CAPTURE_AUTO_MERGED_MAP_NAME;
}
if (process.env.MAP_INBOX_AUTO_PREBUILD) {
  merged.inboxAutoPrebuild.enabled = process.env.MAP_INBOX_AUTO_PREBUILD === 'true';
}
if (process.env.MAP_INBOX_AUTO_PREBUILD_INTERVAL_MINUTES) {
  merged.inboxAutoPrebuild.intervalMinutes = Number(process.env.MAP_INBOX_AUTO_PREBUILD_INTERVAL_MINUTES);
}
if (process.env.MAP_INBOX_AUTO_MAX_ANALYSIS_JOBS) {
  merged.inboxAutoPrebuild.maxAnalysisJobs = Number(process.env.MAP_INBOX_AUTO_MAX_ANALYSIS_JOBS);
}
if (process.env.MAP_INBOX_AUTO_MAX_BASE_MAP_JOBS) {
  merged.inboxAutoPrebuild.maxBaseMapJobs = Number(process.env.MAP_INBOX_AUTO_MAX_BASE_MAP_JOBS);
}
if (process.env.MAP_INBOX_AUTO_MERGE) {
  merged.inboxAutoPrebuild.autoMerge = process.env.MAP_INBOX_AUTO_MERGE !== 'false';
}
if (process.env.MAP_INBOX_AUTO_MERGED_MAP_NAME) {
  merged.inboxAutoPrebuild.mergedMapName = process.env.MAP_INBOX_AUTO_MERGED_MAP_NAME;
}
if (process.env.MAP_CONVERTER_BINARY) {
  merged.converterBinary = process.env.MAP_CONVERTER_BINARY;
}
if (process.env.MAP_FRONTEND_BUILD_ROOT) {
  merged.frontendBuildRoot = process.env.MAP_FRONTEND_BUILD_ROOT;
}
if (process.env.MAP_SKIP_VALIDATION) {
  merged.skipValidation = process.env.MAP_SKIP_VALIDATION === 'true';
}
if (process.env.MAP_RUNTIME_MODE) {
  merged.runtimeMode = process.env.MAP_RUNTIME_MODE;
}
if (process.env.MAP_RUNTIME_DOCKER_CONTAINER) {
  merged.runtimeDockerContainer = process.env.MAP_RUNTIME_DOCKER_CONTAINER;
}
if (process.env.MAP_RUNTIME_DOCKER_IMAGE) {
  merged.runtimeDockerImage = process.env.MAP_RUNTIME_DOCKER_IMAGE;
}
if (process.env.MAP_APOLLO_ROOT_IN_CONTAINER) {
  merged.apolloRootInContainer = process.env.MAP_APOLLO_ROOT_IN_CONTAINER;
}
if (process.env.MAP_DATA_ROOT_IN_CONTAINER) {
  merged.dataRootInContainer = process.env.MAP_DATA_ROOT_IN_CONTAINER;
}
if (process.env.MAP_CONFIG_ROOT_IN_CONTAINER) {
  merged.configRootInContainer = process.env.MAP_CONFIG_ROOT_IN_CONTAINER;
}
if (process.env.MAP_TILE_MAP_CREATOR_IN_CONTAINER) {
  merged.tileMapCreatorInContainer = process.env.MAP_TILE_MAP_CREATOR_IN_CONTAINER;
}
if (process.env.MAP_EDITOR_MAP_CONVERTER_IN_CONTAINER) {
  merged.editorMapConverterInContainer = process.env.MAP_EDITOR_MAP_CONVERTER_IN_CONTAINER;
}
if (process.env.MAP_TILE_MAP_CREATOR_BINARY) {
  merged.tileMapCreatorBinary = process.env.MAP_TILE_MAP_CREATOR_BINARY;
}
if (process.env.MAP_TILE_MAP_CONFIG) {
  merged.tileMapConfig = process.env.MAP_TILE_MAP_CONFIG;
}
if (process.env.MAP_EDGE_DEPLOY_MODE) {
  merged.edgeDeploy.mode = process.env.MAP_EDGE_DEPLOY_MODE;
}
if (process.env.MAP_EDGE_HOST) {
  merged.edgeDeploy.host = process.env.MAP_EDGE_HOST;
}
if (process.env.MAP_EDGE_USER) {
  merged.edgeDeploy.user = process.env.MAP_EDGE_USER;
}
if (process.env.MAP_EDGE_PORT) {
  merged.edgeDeploy.port = Number(process.env.MAP_EDGE_PORT);
}
if (process.env.MAP_EDGE_TARGET_MAP_ROOT) {
  merged.edgeDeploy.targetMapRoot = process.env.MAP_EDGE_TARGET_MAP_ROOT;
}
if (process.env.MAP_EDGE_POST_DEPLOY_COMMAND) {
  merged.edgeDeploy.postDeployCommand = process.env.MAP_EDGE_POST_DEPLOY_COMMAND;
}
if (process.env.MAP_APOLLOLITE_ENABLED) {
  merged.apolloLite.enabled = process.env.MAP_APOLLOLITE_ENABLED === 'true';
}
if (process.env.MAP_APOLLOLITE_ROOT) {
  merged.apolloLite.root = process.env.MAP_APOLLOLITE_ROOT;
}
if (process.env.MAP_APOLLOLITE_MAP_ROOT) {
  merged.apolloLite.mapRoot = process.env.MAP_APOLLOLITE_MAP_ROOT;
}
if (process.env.MAP_APOLLOLITE_AUTO_STAGE_ON_RELEASE) {
  merged.apolloLite.autoStageOnRelease = process.env.MAP_APOLLOLITE_AUTO_STAGE_ON_RELEASE === 'true';
}
if (process.env.MAP_APOLLOLITE_VALIDATION_COMMAND) {
  merged.apolloLite.validationCommand = process.env.MAP_APOLLOLITE_VALIDATION_COMMAND;
}

function ensureAbsolute(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.length === 0) {
    return dirPath;
  }
  if (path.isAbsolute(dirPath)) {
    return dirPath;
  }
  return path.resolve(__dirname, dirPath);
}

merged.baseMapRoot = ensureAbsolute(merged.baseMapRoot);
merged.editorMapRoot = ensureAbsolute(merged.editorMapRoot);
merged.releaseRoot = ensureAbsolute(merged.releaseRoot);
merged.importPackageRoot = ensureAbsolute(merged.importPackageRoot);
merged.importPackageTrashRoot = ensureAbsolute(merged.importPackageTrashRoot);
merged.captureSourceRoot = ensureAbsolute(merged.captureSourceRoot);
merged.converterBinary = ensureAbsolute(merged.converterBinary);
merged.frontendBuildRoot = ensureAbsolute(merged.frontendBuildRoot);
merged.tileMapCreatorBinary = ensureAbsolute(merged.tileMapCreatorBinary);
merged.tileMapConfig = ensureAbsolute(merged.tileMapConfig);
merged.apolloLite.root = ensureAbsolute(merged.apolloLite.root);
merged.apolloLite.mapRoot = ensureAbsolute(merged.apolloLite.mapRoot);

module.exports = merged;

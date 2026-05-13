const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');

const defaults = {
  port: Number(process.env.MAP_BACKEND_PORT || process.env.PORT || 58000),
  baseMapRoot: path.join(appRoot, 'data/base_map'),
  editorMapRoot: path.join(appRoot, 'data/editor_map'),
  releaseRoot: path.join(appRoot, 'data/released_map'),
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
    targetMapRoot: process.env.MAP_EDGE_TARGET_MAP_ROOT || '/apollo/modules/map/data',
    postDeployCommand: process.env.MAP_EDGE_POST_DEPLOY_COMMAND || '',
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

if (process.env.MAP_BACKEND_PORT || process.env.PORT) {
  merged.port = Number(process.env.MAP_BACKEND_PORT || process.env.PORT);
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
if (process.env.MAP_EDGE_TARGET_MAP_ROOT) {
  merged.edgeDeploy.targetMapRoot = process.env.MAP_EDGE_TARGET_MAP_ROOT;
}
if (process.env.MAP_EDGE_POST_DEPLOY_COMMAND) {
  merged.edgeDeploy.postDeployCommand = process.env.MAP_EDGE_POST_DEPLOY_COMMAND;
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
merged.converterBinary = ensureAbsolute(merged.converterBinary);
merged.frontendBuildRoot = ensureAbsolute(merged.frontendBuildRoot);
merged.tileMapCreatorBinary = ensureAbsolute(merged.tileMapCreatorBinary);
merged.tileMapConfig = ensureAbsolute(merged.tileMapConfig);

module.exports = merged;

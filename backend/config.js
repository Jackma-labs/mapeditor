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

module.exports = merged;
